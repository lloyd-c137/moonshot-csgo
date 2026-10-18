#!/usr/bin/env python3
"""Convert the selected OpenGameArt OBJ pickups to small, self-contained GLB files."""

from __future__ import annotations

import hashlib
import json
import math
import struct
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/source/pickups'
OUTPUT = ROOT / 'public/assets/pickups'

SPECS = [
    {
        'name': 'revive-medkit', 'archive': 'first-aid-kit-ggbotnet.zip',
        'obj': 'FirstAid.obj', 'mtl': 'FirstAid.mtl', 'texture': 'FirstAid.png',
        'height': 0.72, 'title': 'First Aid Kit 3D', 'author': 'GGBotNet',
        'url': 'https://opengameart.org/content/first-aid-kit-3d', 'license': 'CC0'
    },
    {
        'name': 'eye-monitor', 'archive': 'low-poly-monitor-mitylernal.zip',
        'obj': 'Monitor.obj', 'mtl': 'Monitor.mtl', 'height': 0.62,
        'title': 'Low-poly Monitor', 'author': 'Mitylernal',
        'url': 'https://opengameart.org/content/low-poly-monitor', 'license': 'CC0', 'upAxis': 'z'
    },
    {
        'name': 'stealth-crystal', 'archive': 'lowpoly-crystals-aredon.zip',
        'obj': 'crystals_pink.obj', 'mtl': 'crystals_pink.mtl',
        'height': 0.78, 'title': 'LowPoly Crystals', 'author': 'Aredon',
        'url': 'https://opengameart.org/content/lowpoly-crystals', 'license': 'CC0'
    },
    {
        'name': 'creation-gear', 'archive': 'gear-pack-elegant-crow.zip',
        'obj': 'gear_pack/models/gear_12.obj', 'texture': 'gear_pack/textures_512x512/gear_12_tex_512.png',
        'height': 0.7, 'title': 'Gear Pack', 'author': 'Elegant Crow',
        'url': 'https://opengameart.org/content/gear-pack', 'license': 'CC-BY-SA-4.0',
        'textureBaseColor': [0.88, 0.94, 1.0]
    }
]


def parse_mtl(raw: bytes | None) -> dict[str, dict]:
    materials: dict[str, dict] = {}
    current: dict | None = None
    for line in (raw or b'').decode('utf-8', 'replace').splitlines():
        parts = line.strip().split(maxsplit=1)
        if not parts:
            continue
        if parts[0] == 'newmtl':
            current = {'color': [1.0, 1.0, 1.0]}
            materials[parts[1]] = current
        elif current is not None and parts[0] == 'Kd':
            current['color'] = [float(value) for value in parts[1].split()[:3]]
        elif current is not None and parts[0] in ('d', 'Tr'):
            alpha = float(parts[1])
            current['alpha'] = 1 - alpha if parts[0] == 'Tr' else alpha
    return materials


def parse_obj(raw: bytes):
    positions: list[tuple[float, float, float]] = []
    texcoords: list[tuple[float, float]] = []
    normals: list[tuple[float, float, float]] = []
    faces: dict[str, list[list[tuple[int, int | None, int | None]]]] = {}
    material = 'default'
    mtllib = None

    def index(value: str, count: int) -> int:
        number = int(value)
        return number - 1 if number > 0 else count + number

    for line in raw.decode('utf-8', 'replace').splitlines():
        parts = line.strip().split()
        if not parts or parts[0].startswith('#'):
            continue
        if parts[0] == 'mtllib' and len(parts) > 1:
            mtllib = ' '.join(parts[1:])
        elif parts[0] == 'v':
            positions.append(tuple(map(float, parts[1:4])))
        elif parts[0] == 'vt':
            texcoords.append(tuple(map(float, parts[1:3])))
        elif parts[0] == 'vn':
            normals.append(tuple(map(float, parts[1:4])))
        elif parts[0] == 'usemtl':
            material = ' '.join(parts[1:])
        elif parts[0] == 'f':
            polygon = []
            for token in parts[1:]:
                values = token.split('/')
                v = index(values[0], len(positions))
                vt = index(values[1], len(texcoords)) if len(values) > 1 and values[1] else None
                vn = index(values[2], len(normals)) if len(values) > 2 and values[2] else None
                polygon.append((v, vt, vn))
            for offset in range(1, len(polygon) - 1):
                faces.setdefault(material, []).append([polygon[0], polygon[offset], polygon[offset + 1]])
    if not positions or not faces:
        raise ValueError('OBJ contains no triangle geometry')
    return positions, texcoords, normals, faces, mtllib


def append_bytes(buffer: bytearray, data: bytes, alignment: int = 4) -> int:
    while len(buffer) % alignment:
        buffer.append(0)
    offset = len(buffer)
    buffer.extend(data)
    return offset


def orient(point: tuple[float, float, float], up_axis: str) -> tuple[float, float, float]:
    # OpenGameArt's monitor OBJ is Z-up; rotate it into glTF/PlayCanvas Y-up coordinates.
    return (point[0], point[2], -point[1]) if up_axis == 'z' else point


def convert(spec: dict) -> dict:
    with zipfile.ZipFile(SOURCE / spec['archive']) as archive:
        raw_obj = archive.read(spec['obj'])
        raw_mtl = archive.read(spec['mtl']) if spec.get('mtl') else None
        image_path = spec.get('texture')
        if not image_path and raw_mtl:
            for line in raw_mtl.decode('utf-8', 'replace').splitlines():
                if line.strip().startswith('map_Kd '):
                    image_path = line.strip().split(maxsplit=1)[1]
                    break
        image = archive.read(image_path) if image_path else None

    vertices, source_uvs, source_normals, faces, _ = parse_obj(raw_obj)
    up_axis = spec.get('upAxis', 'y')
    vertices = [orient(point, up_axis) for point in vertices]
    source_normals = [orient(normal, up_axis) for normal in source_normals]
    bounds_min = [min(point[axis] for point in vertices) for axis in range(3)]
    bounds_max = [max(point[axis] for point in vertices) for axis in range(3)]
    source_height = bounds_max[1] - bounds_min[1]
    if source_height <= 1e-6:
        raise ValueError(f'{spec["name"]} source mesh has no Y height')
    scale = spec['height'] / source_height
    center_x = (bounds_min[0] + bounds_max[0]) / 2
    center_z = (bounds_min[2] + bounds_max[2]) / 2
    materials = parse_mtl(raw_mtl)
    if spec.get('textureBaseColor'):
        materials = {name: {'color': spec['textureBaseColor']} for name in faces}
    for name in faces:
        materials.setdefault(name, {'color': [1.0, 1.0, 1.0]})

    blob = bytearray()
    views: list[dict] = []
    accessors: list[dict] = []

    def accessor(data: bytes, component_type: int, count: int, kind: str, target: int, minimum=None, maximum=None):
        offset = append_bytes(blob, data)
        view_index = len(views)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data), 'target': target})
        item = {'bufferView': view_index, 'componentType': component_type, 'count': count, 'type': kind}
        if minimum is not None:
            item['min'] = minimum
            item['max'] = maximum
        accessors.append(item)
        return len(accessors) - 1

    material_names = list(faces)
    gltf_materials = []
    for name in material_names:
        color = materials[name].get('color', [1, 1, 1])
        alpha = materials[name].get('alpha', 1.0)
        pbr = {'baseColorFactor': [*color, alpha], 'metallicFactor': 0.0, 'roughnessFactor': 0.72}
        if image:
            pbr['baseColorTexture'] = {'index': 0}
        gltf_materials.append({'name': name, 'pbrMetallicRoughness': pbr, 'doubleSided': True})

    primitives = []
    for material_index, name in enumerate(material_names):
        unique: dict[tuple, int] = {}
        out_positions: list[tuple[float, float, float]] = []
        out_uvs: list[tuple[float, float]] = []
        out_normals: list[tuple[float, float, float]] = []
        indices: list[int] = []

        for triangle in faces[name]:
            transformed = [
                ((vertices[v][0] - center_x) * scale, (vertices[v][1] - bounds_min[1]) * scale, (vertices[v][2] - center_z) * scale)
                for v, _, _ in triangle
            ]
            edge_a = tuple(transformed[1][i] - transformed[0][i] for i in range(3))
            edge_b = tuple(transformed[2][i] - transformed[0][i] for i in range(3))
            face_normal = (
                edge_a[1] * edge_b[2] - edge_a[2] * edge_b[1],
                edge_a[2] * edge_b[0] - edge_a[0] * edge_b[2],
                edge_a[0] * edge_b[1] - edge_a[1] * edge_b[0]
            )
            length = math.sqrt(sum(value * value for value in face_normal)) or 1
            face_normal = tuple(value / length for value in face_normal)
            for corner, (v, vt, vn) in enumerate(triangle):
                uv = source_uvs[vt] if vt is not None else (0.0, 0.0)
                normal = source_normals[vn] if vn is not None else face_normal
                normal_length = math.sqrt(sum(value * value for value in normal)) or 1
                normal = tuple(value / normal_length for value in normal)
                key = (v, vt, vn) if vn is not None else (v, vt, *normal)
                if key not in unique:
                    unique[key] = len(out_positions)
                    out_positions.append(transformed[corner])
                    out_uvs.append(uv)
                    out_normals.append(normal)
                indices.append(unique[key])

        position_bytes = b''.join(struct.pack('<3f', *value) for value in out_positions)
        normal_bytes = b''.join(struct.pack('<3f', *value) for value in out_normals)
        uv_bytes = b''.join(struct.pack('<2f', *value) for value in out_uvs)
        index_size, component_type = (2, 5123) if len(out_positions) < 65536 else (4, 5125)
        index_bytes = b''.join(struct.pack('<H' if index_size == 2 else '<I', value) for value in indices)
        position_accessor = accessor(
            position_bytes, 5126, len(out_positions), 'VEC3', 34962,
            [min(p[axis] for p in out_positions) for axis in range(3)],
            [max(p[axis] for p in out_positions) for axis in range(3)]
        )
        normal_accessor = accessor(normal_bytes, 5126, len(out_normals), 'VEC3', 34962)
        uv_accessor = accessor(uv_bytes, 5126, len(out_uvs), 'VEC2', 34962)
        index_accessor = accessor(index_bytes, component_type, len(indices), 'SCALAR', 34963)
        primitives.append({'attributes': {'POSITION': position_accessor, 'NORMAL': normal_accessor, 'TEXCOORD_0': uv_accessor}, 'indices': index_accessor, 'material': material_index})

    images = []
    textures = []
    if image:
        image_offset = append_bytes(blob, image)
        image_view = len(views)
        views.append({'buffer': 0, 'byteOffset': image_offset, 'byteLength': len(image)})
        images.append({'bufferView': image_view, 'mimeType': 'image/png', 'name': Path(image_path).stem})
        textures.append({'sampler': 0, 'source': 0})

    doc = {
        'asset': {'version': '2.0', 'generator': 'Moonshot OpenGameArt pickup conversion'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': spec['name'], 'mesh': 0}],
        'meshes': [{'name': spec['name'], 'primitives': primitives}],
        'materials': gltf_materials,
        'accessors': accessors, 'bufferViews': views,
        'buffers': [{'byteLength': len(blob)}]
    }
    if image:
        doc.update({'images': images, 'textures': textures, 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]})
    json_chunk = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    json_chunk += b' ' * ((4 - len(json_chunk) % 4) % 4)
    blob.extend(b'\0' * ((4 - len(blob) % 4) % 4))
    bin_chunk = bytes(blob)
    glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(json_chunk) + 8 + len(bin_chunk))
    glb += struct.pack('<I4s', len(json_chunk), b'JSON') + json_chunk
    glb += struct.pack('<I4s', len(bin_chunk), b'BIN\0') + bin_chunk
    out_path = OUTPUT / f'{spec["name"]}.glb'
    out_path.write_bytes(glb)
    return {
        'name': spec['name'], 'title': spec['title'], 'author': spec['author'], 'source': spec['url'],
        'license': spec['license'], 'path': f'/assets/pickups/{out_path.name}', 'bytes': len(glb),
        'sha256': hashlib.sha256(glb).hexdigest(), 'triangles': sum(len(triangles) for triangles in faces.values()),
        'boundsMeters': [round((bounds_max[axis] - bounds_min[axis]) * scale, 3) for axis in range(3)],
        'heightMeters': round(source_height * scale, 3)
    }


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    entries = []
    for spec in SPECS:
        entries.append(convert(spec))
    manifest = {
        'generator': 'tools/preparePickupModels.py',
        'sources': [
            {'archive': spec['archive'], 'sha256': hashlib.sha256((SOURCE / spec['archive']).read_bytes()).hexdigest(),
             'source': spec['url'], 'title': spec['title'], 'author': spec['author'], 'license': spec['license']}
            for spec in SPECS
        ],
        'models': entries
    }
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(entries, indent=2))


if __name__ == '__main__':
    main()
