// 纪老师 in the world: a rigged mannequin with a red duty armband, walking his patrol, the circle he watches painted
// on the floor in red so players can keep out of it, a name tag, and a
// speech bubble when he catches someone. He is placed from the room clock (gameplay/teacher.ts).
import type { AppBase, Entity as EntityType } from 'playcanvas';
import { BLEND_ADDITIVE, Color, CULLFACE_NONE, Entity, Mesh, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';
import { CHARACTER_VISUAL_HEIGHT } from '../characters/CharacterAssetLoader';
import { box, merge, place } from '../render/shapes';
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
    if (halfAngle < 180) for (const side of [-halfAngle, halfAngle]) strip(0, 0, ...point(side));
    return merge(strips);
};

export const createTeacher = (
    app: AppBase,
    camera: EntityType,
    layer: HTMLElement,
    characters: CharacterAssetLoader
) => {
    const character = characters.create({
        name: 'teacher',
        colour: [1, 1, 1],
        materialColours: { M_Main: [1, 1, 1], M_Joints: [1, 1, 1], M_Head: [1, 1, 1] }
    });
    const root = character.root;
    const armbandMaterial = new StandardMaterial();
    armbandMaterial.diffuse = new Color(0.9, 0.08, 0.1);
    armbandMaterial.update();
    const armband = new Entity('teacher-duty-armband');
    armband.addComponent('render', { type: 'cylinder', material: armbandMaterial, castShadows: false });
    const leftArm = root.findByName('upperarm_l');
    if (leftArm) {
        leftArm.addChild(armband);
        armband.setLocalPosition(0, -0.05, 0);
        armband.setLocalScale(0.16, 0.035, 0.16);
    }
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
            new MeshInstance(meshOf(app, fan(TEACHER.range, 180, 64)), coneFill),
            new MeshInstance(meshOf(app, fanEdge(TEACHER.range, 180, 0.08, 96)), coneEdge)
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

    const screen = new Vec3();
    const head = new Vec3();
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
            root.setPosition(pose.x, floorY, pose.z);
            root.setEulerAngles(0, pose.yaw, 0);
            character.play(pose.walking ? 'Walk_Formal_Loop' : 'Idle_Talking_Loop');
            // Name tag and bubble over his head (DOM), when in front of the camera and near enough.
            head.set(pose.x, floorY + CHARACTER_VISUAL_HEIGHT + 0.06, pose.z);
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
        /** Whether a player at capsule centre `at` is inside his watch (the circle around him). */
        sees(at: Vec3) {
            return inTeacherView(pose, at.x, at.z);
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
