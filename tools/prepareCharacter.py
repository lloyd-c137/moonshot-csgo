"""Import Quaternius UAL1 and export a skinned GLB with a separately UV-mapped head material.

Run with Blender 4.5.x:
  blender --background --python tools/prepareCharacter.py -- SOURCE.glb OUTPUT.glb
"""

import bpy
import math
import sys
from mathutils import Vector


def arguments():
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 2:
        raise SystemExit("Expected source and output GLB paths after --")
    return args


def head_weight(vertex, group_index):
    return next((group.weight for group in vertex.groups if group.group == group_index), 0.0)


source_path, output_path = arguments()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
if source_path.lower().endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=source_path)
elif source_path.lower().endswith((".glb", ".gltf")):
    bpy.ops.import_scene.gltf(filepath=source_path)
else:
    raise SystemExit("Source must be FBX, GLB, or glTF")

mesh = bpy.data.objects.get("Mannequin")
armature = bpy.data.objects.get("Armature")
if not mesh or mesh.type != "MESH" or not armature or armature.type != "ARMATURE":
    raise RuntimeError("Expected the UAL1 Mannequin mesh and Armature")
head_group = mesh.vertex_groups.get("Head")
if head_group is None:
    raise RuntimeError("The imported character has no Head vertex group")

# The source uses degenerate UVs. Keep its geometry and skin weights, separate only the
# head-facing material region, and unwrap that region around the head with its seam at the back.
head_faces = []
head_vertices = set()
for polygon in mesh.data.polygons:
    if all(head_weight(mesh.data.vertices[index], head_group.index) >= 0.5 for index in polygon.vertices):
        head_faces.append(polygon)
        head_vertices.update(polygon.vertices)
if len(head_faces) < 100:
    raise RuntimeError(f"Head selection unexpectedly small: {len(head_faces)} faces")

head_points = [mesh.matrix_world @ mesh.data.vertices[index].co for index in head_vertices]
minimum_z = min(point.z for point in head_points)
maximum_z = max(point.z for point in head_points)
center_x = (min(point.x for point in head_points) + max(point.x for point in head_points)) / 2
center_y = (min(point.y for point in head_points) + max(point.y for point in head_points)) / 2
if maximum_z - minimum_z < 0.1:
    raise RuntimeError("Head bounds are too small for UV projection")

head_material = bpy.data.materials.new("M_Head")
head_material.use_nodes = True
principled = head_material.node_tree.nodes.get("Principled BSDF")
principled.inputs["Base Color"].default_value = (1, 1, 1, 1)
principled.inputs["Roughness"].default_value = 0.82
mesh.data.materials.append(head_material)
head_material_index = len(mesh.data.materials) - 1
uv_layer = mesh.data.uv_layers.active or mesh.data.uv_layers.new(name="UVMap")

for polygon in head_faces:
    polygon.material_index = head_material_index
    projected = []
    for loop_index in polygon.loop_indices:
        vertex = mesh.data.vertices[mesh.data.loops[loop_index].vertex_index]
        point = mesh.matrix_world @ vertex.co
        # Blender is Z-up, so its -Y axis maps to the glTF -Z-facing front; keep the seam on the back.
        u = (math.atan2(point.x - center_x, -(point.y - center_y)) / (2 * math.pi)) % 1.0
        v = (point.z - minimum_z) / (maximum_z - minimum_z)
        projected.append([u, v])
    if max(uv[0] for uv in projected) - min(uv[0] for uv in projected) > 0.5:
        for uv in projected:
            if uv[0] < 0.5:
                uv[0] += 1.0
    for loop_index, uv in zip(polygon.loop_indices, projected):
        uv_layer.data[loop_index].uv = uv

for obj in bpy.context.scene.objects:
    obj.select_set(obj in (mesh, armature))
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_skins=True,
    export_apply=False,
)
print(f"Exported {len(head_faces)} UV-mapped head faces from {len(bpy.data.actions)} actions to {output_path}")
