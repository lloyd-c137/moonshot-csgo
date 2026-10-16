// 纪老师 in the world: a figure in a dark suit with glasses and a red duty armband, walking his patrol (legs swing,
// he bobs), his field of view painted on the floor as a red fan so players can keep out of it, a name tag, and a
// speech bubble when he catches someone. He is placed from the room clock (gameplay/teacher.ts).
import type { AppBase, Entity as EntityType, RigidBodyComponentSystem } from 'playcanvas';
import {
    BLEND_ADDITIVE,
    Color,
    CULLFACE_BACK,
    CULLFACE_NONE,
    Entity,
    Mesh,
    MeshInstance,
    StandardMaterial,
    Vec3
} from 'playcanvas';

import { box, cylinder, merge, place, sphere } from '../render/shapes';
import type { Shape } from '../render/shapes';

import { inTeacherView, TEACHER, teacherAt } from './teacher';
import type { TeacherPose } from './teacher';

const meshOf = (app: AppBase, shape: Shape) => {
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setIndices(shape.indices);
    mesh.update();
    mesh.incRefCount();
    return mesh;
};
const solid = (colour: [number, number, number], gloss = 0.3) => {
    const m = new StandardMaterial();
    m.diffuse = new Color(...colour);
    m.gloss = gloss;
    m.cull = CULLFACE_BACK;
    m.update();
    return m;
};

/** A flat fan (the view cone on the floor), apex at the origin, opening toward -Z. */
const fan = (radius: number, halfAngle: number, segments = 24): Shape => {
    const positions = [0, 0, 0];
    const normals = [0, 1, 0];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
        const a = ((-halfAngle + (2 * halfAngle * i) / segments) * Math.PI) / 180;
        positions.push(-Math.sin(a) * radius, 0, -Math.cos(a) * radius);
        normals.push(0, 1, 0);
        if (i > 0) indices.push(0, i, i + 1);
    }
    return { positions, normals, indices };
};
/** The fan's outline: its arc and two edges as thin flat strips. */
const fanEdge = (radius: number, halfAngle: number, width: number, segments = 32): Shape => {
    const strips: Shape[] = [];
    const strip = (ax: number, az: number, bx: number, bz: number) => {
        const length = Math.hypot(bx - ax, bz - az);
        strips.push(
            place(box(width, 0.002, length), {
                x: (ax + bx) / 2,
                z: (az + bz) / 2,
                yaw: Math.atan2(bx - ax, bz - az)
            })
        );
    };
    const point = (deg: number): [number, number] => [
        -Math.sin((deg * Math.PI) / 180) * radius,
        -Math.cos((deg * Math.PI) / 180) * radius
    ];
    for (let i = 0; i < segments; i++) {
        const [ax, az] = point(-halfAngle + (2 * halfAngle * i) / segments);
        const [bx, bz] = point(-halfAngle + (2 * halfAngle * (i + 1)) / segments);
        strip(ax, az, bx, bz);
    }
    for (const side of [-halfAngle, halfAngle]) strip(0, 0, ...point(side));
    return merge(strips);
};

export const createTeacher = (app: AppBase, camera: EntityType, layer: HTMLElement) => {
    const suit = solid([0.13, 0.16, 0.24]);
    const shirt = solid([0.94, 0.95, 0.96]);
    const tie = solid([0.7, 0.1, 0.12]);
    const skin = solid([0.92, 0.78, 0.66]);
    const hair = solid([0.08, 0.08, 0.09], 0.5);
    const glass = solid([0.05, 0.05, 0.06], 0.9);
    const band = solid([0.85, 0.12, 0.14]);
    const shoe = solid([0.05, 0.05, 0.05], 0.7);

    // Local frame: feet at y = 0, facing -Z.
    const root = new Entity('teacher');
    const body = new Entity('teacher-body');
    body.addComponent('render', {
        castShadows: false,
        meshInstances: [
            new MeshInstance(meshOf(app, place(cylinder(0.25, 0.78, 20, true, 0.22), { y: 1.2 })), suit),
            new MeshInstance(meshOf(app, place(box(0.16, 0.36, 0.02), { y: 1.36, z: -0.235 })), shirt),
            new MeshInstance(meshOf(app, place(box(0.05, 0.3, 0.02), { y: 1.33, z: -0.248 })), tie),
            new MeshInstance(meshOf(app, place(sphere(16, 12), { y: 1.76, sx: 0.15, sy: 0.18, sz: 0.15 })), skin),
            new MeshInstance(meshOf(app, place(sphere(16, 8), { y: 1.84, sx: 0.155, sy: 0.12, sz: 0.155 })), hair),
            new MeshInstance(
                meshOf(
                    app,
                    merge([
                        place(box(0.08, 0.045, 0.012), { x: -0.055, y: 1.78, z: -0.148 }),
                        place(box(0.08, 0.045, 0.012), { x: 0.055, y: 1.78, z: -0.148 }),
                        place(box(0.04, 0.01, 0.01), { y: 1.79, z: -0.15 })
                    ])
                ),
                glass
            ),
            // Arms hanging, with the red duty armband on the left.
            new MeshInstance(
                meshOf(
                    app,
                    merge([
                        place(cylinder(0.065, 0.62, 10), { x: -0.31, y: 1.18 }),
                        place(cylinder(0.065, 0.62, 10), { x: 0.31, y: 1.18 })
                    ])
                ),
                suit
            ),
            new MeshInstance(meshOf(app, place(cylinder(0.072, 0.1, 10), { x: -0.31, y: 1.33 })), band),
            new MeshInstance(
                meshOf(
                    app,
                    merge([
                        place(sphere(8, 6), { x: -0.31, y: 0.85, sx: 0.06, sy: 0.07, sz: 0.06 }),
                        place(sphere(8, 6), { x: 0.31, y: 0.85, sx: 0.06, sy: 0.07, sz: 0.06 })
                    ])
                ),
                skin
            )
        ]
    });
    root.addChild(body);
    // Legs swing from the hip while he walks.
    const legMesh = meshOf(app, place(cylinder(0.085, 0.8, 10), { y: -0.4 }));
    const shoeMesh = meshOf(app, place(box(0.12, 0.08, 0.26), { y: -0.8, z: -0.05 }));
    const legs = [-0.11, 0.11].map((x) => {
        const leg = new Entity('teacher-leg');
        leg.addComponent('render', {
            castShadows: false,
            meshInstances: [new MeshInstance(legMesh, suit), new MeshInstance(shoeMesh, shoe)]
        });
        leg.setLocalPosition(x, 0.82, 0);
        root.addChild(leg);
        return leg;
    });
    // View cone on the floor.
    const coneFill = new StandardMaterial();
    coneFill.useLighting = false;
    coneFill.diffuse = new Color(0, 0, 0);
    coneFill.emissive = new Color(1, 0.18, 0.2);
    coneFill.emissiveIntensity = 0.1;
    coneFill.blendType = BLEND_ADDITIVE;
    coneFill.depthWrite = false;
    coneFill.cull = CULLFACE_NONE;
    coneFill.update();
    const coneEdge = coneFill.clone();
    coneEdge.emissiveIntensity = 0.7;
    coneEdge.update();
    const cone = new Entity('teacher-view');
    cone.addComponent('render', {
        castShadows: false,
        meshInstances: [
            new MeshInstance(meshOf(app, fan(TEACHER.range, TEACHER.halfAngle)), coneFill),
            new MeshInstance(meshOf(app, fanEdge(TEACHER.range, TEACHER.halfAngle, 0.06)), coneEdge)
        ]
    });
    cone.setLocalPosition(0, 0.03, 0);
    root.addChild(cone);
    app.root.addChild(root);

    const tag = document.createElement('span');
    tag.className = 'name-tag teacher-tag';
    tag.innerHTML = '<b>纪老师</b> 德育主任';
    const bubble = document.createElement('span');
    bubble.className = 'teacher-bubble';
    bubble.hidden = true;
    layer.append(tag, bubble);

    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    const screen = new Vec3();
    const head = new Vec3();
    const eye = new Vec3();
    const target = new Vec3();
    let pose: TeacherPose = teacherAt(0);
    let floorY = 0;
    let bubbleUntil = 0;

    return {
        get pose() {
            return pose;
        },
        /** Places him at room time `roomMs`; `floor` is the floor height under the player (single storey). */
        update(roomMs: number, now: number, floor: number) {
            pose = teacherAt(roomMs);
            floorY = floor;
            const bob = pose.walking ? Math.abs(Math.sin(roomMs / 300)) * 0.035 : 0;
            root.setPosition(pose.x, floorY + bob, pose.z);
            root.setEulerAngles(0, pose.yaw, 0);
            const swing = pose.walking ? Math.sin(roomMs / 300) * 26 : 0;
            legs[0].setLocalEulerAngles(swing, 0, 0);
            legs[1].setLocalEulerAngles(-swing, 0, 0);
            // Name tag and bubble over his head (DOM), when in front of the camera and near enough.
            head.set(pose.x, floorY + 2.1, pose.z);
            camera.camera!.worldToScreen(head, screen);
            const distance = head.distance(camera.getPosition());
            const shown = screen.z > 0 && distance < 40;
            tag.hidden = !shown;
            if (shown)
                tag.style.transform = `translate(-50%, -100%) translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px)`;
            bubble.hidden = !shown || now > bubbleUntil;
            if (!bubble.hidden)
                bubble.style.transform = `translate(-50%, -100%) translate(${Math.round(screen.x)}px, ${Math.round(screen.y - 28)}px)`;
        },
        /**
         * Whether he can see a player at capsule centre `at` right now: inside his view cone and with a clear line
         * from his eyes to the player's head (walls and glass block it).
         */
        sees(at: Vec3, player: EntityType) {
            if (!inTeacherView(pose, at.x, at.z)) return false;
            eye.set(pose.x, floorY + TEACHER.eye, pose.z);
            target.set(at.x, at.y + 0.6, at.z);
            const hit = rigidbody.raycastFirst(eye, target);
            return !hit || hit.entity === player;
        },
        /** Shows his speech bubble for a few seconds. */
        say(text: string, now: number) {
            bubble.textContent = text;
            bubbleUntil = now + 3200;
        },
        root
    };
};

export type Teacher = ReturnType<typeof createTeacher>;
