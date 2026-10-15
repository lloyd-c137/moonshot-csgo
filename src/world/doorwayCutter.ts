import type { AppBase, Entity } from 'playcanvas';
import { Mat4, Mesh, MeshInstance, Vec3 } from 'playcanvas';

import { worldTriangles } from '../physics/collisionWorld';

import type { Doorway } from './doorways';
import { cutTriangles, doorwayReveals, doorwayTouches } from './doorways';

type V3 = [number, number, number];

const faceNormal = ([a, b, c]: V3[]): V3 => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const length = Math.hypot(...n) || 1;
    return [n[0] / length, n[1] / length, n[2] / length];
};

/**
 * Cuts GAMEPLAY_AUTHORED doorways out of a source render entity (walls or glazing) and lines them with jamb/head
 * faces. The entity's mesh is replaced by the cut copy in the entity's own local space, so the render component,
 * material and the mesh collider built afterwards all see the opening. The GLB data is not modified.
 */
export const cutDoorwaysInto = (app: AppBase, entity: Entity, doorways: Doorway[], lineReveals: boolean) => {
    const instances = entity.render?.meshInstances ?? [];
    if (!instances.length || !doorways.length) return 0;
    const triangles = worldTriangles(entity);
    // Only doorways that actually intersect this mesh's footprint.
    const relevant = doorways.filter((doorway) => triangles.some((triangle) => doorwayTouches(doorway, triangle)));
    if (!relevant.length) return 0;
    const cut = cutTriangles(triangles, relevant);
    if (lineReveals) {
        for (const doorway of relevant) {
            for (const { corners, normal } of doorwayReveals(doorway)) {
                const [a, b, c, d] = corners;
                const n = faceNormal([a, b, c]);
                const wound = n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] >= 0;
                const quad = wound ? [a, b, c, d] : [a, d, c, b];
                cut.push([quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]);
            }
        }
    }
    const inverse = new Mat4().copy(entity.getWorldTransform()).invert();
    const linear = entity.getWorldTransform();
    const local = new Vec3();
    const world = new Vec3();
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const triangle of cut) {
        const [nx, ny, nz] = faceNormal(triangle);
        // Local normal = Mᵀ · n (inverse-transpose of the inverse), renormalised.
        const m = linear.data;
        const lx = m[0] * nx + m[1] * ny + m[2] * nz;
        const ly = m[4] * nx + m[5] * ny + m[6] * nz;
        const lz = m[8] * nx + m[9] * ny + m[10] * nz;
        const length = Math.hypot(lx, ly, lz) || 1;
        for (const vertex of triangle) {
            world.set(vertex[0], vertex[1], vertex[2]);
            inverse.transformPoint(world, local);
            positions.push(local.x, local.y, local.z);
            normals.push(lx / length, ly / length, lz / length);
            indices.push(indices.length);
        }
    }
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setIndices(indices);
    mesh.update();
    const material = instances[0].material!;
    entity.render!.meshInstances = [new MeshInstance(mesh, material, entity)];
    return relevant.length;
};
