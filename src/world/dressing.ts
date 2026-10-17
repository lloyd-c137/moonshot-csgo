// Visual dressing of the FF-01 level: floor finishes, ceiling, doors, furniture, linework and light
// fixtures. Everything here is GAMEPLAY_AUTHORED presentation built from the source meshes (read-only) and the
// offline-derived world data; no source mesh is modified, only hidden or given a new material.
import type { AppBase, Texture } from 'playcanvas';
import { Color, CULLFACE_BACK, CULLFACE_NONE, Entity, Layer, MeshInstance, StandardMaterial, Vec2 } from 'playcanvas';

import { SURFACE_RESTITUTION } from '../config/bounce';
import { ARENA_WALL_HEIGHT, DERIVED_GRID } from '../config/presentation';
import { worldTriangles } from '../physics/collisionWorld';
import { MeshBuilder } from '../render/meshBuilder';
import { createTexture } from '../render/textures';

import type { Doorway } from './doorways';
import type { RestroomMirrorLayout } from './restroomMirrors';
import { restroomMirrorLayouts } from './restroomMirrors';
import type { CampusRoom } from './roomIndex';

export type RestroomMirrorMount = RestroomMirrorLayout & { surface: Entity; material: StandardMaterial };

export type Vec2Tuple = [number, number];
export type DerivedWorld = {
    schema: number;
    status: string;
    wallHeight: number;
    ceilingHeight: number;
    arena: { outline: Vec2Tuple[]; center: Vec2Tuple };
    doorHeight: number;
    doors: {
        hinge: Vec2Tuple;
        closed: Vec2Tuple;
        open: Vec2Tuple;
        offset: number;
        thickness: number;
        authored?: true;
    }[];
    doorways: Doorway[];
    furniture: {
        type?: string;
        source?: string;
        center: Vec2Tuple;
        size: Vec2Tuple;
        yaw: number;
        height: number;
        collide: boolean;
    }[];
    partitions: [Vec2Tuple, Vec2Tuple][];
    lights: [number, number, number, number][];
    signs: { room: string; blade: SignMount; plaque: SignMount }[];
};

/** A point on the outside wall face; `yaw` turns local +X to the outward wall normal. */
export type SignMount = { x: number; z: number; yaw: number };

export const parseDerivedWorld = (value: unknown): DerivedWorld => {
    const world = value as DerivedWorld;
    if (!world || world.schema !== 1 || world.status !== 'GAMEPLAY_AUTHORED') {
        throw new Error('Derived world data has an unexpected schema; run npm run derive:world');
    }
    for (const key of ['doors', 'doorways', 'furniture', 'partitions', 'lights', 'signs'] as const) {
        if (!Array.isArray(world[key])) throw new Error(`Derived world data is missing ${key}`);
    }
    if (!Array.isArray(world.arena?.outline) || world.arena.outline.length < 3) {
        throw new Error('Derived world data has no arena outline');
    }
    return world;
};

type TextureRef = { texture: Texture; metres: number };
type MaterialOptions = {
    texture?: TextureRef;
    colour?: [number, number, number];
    gloss?: number;
    emissive?: [number, number, number];
    emissiveIntensity?: number;
    opacityMask?: Texture;
};

const makeMaterial = (name: string, options: MaterialOptions & { decal?: boolean }) => {
    const m = new StandardMaterial();
    m.name = name;
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = options.gloss ?? 0.25;
    m.cull = CULLFACE_NONE;
    m.diffuse = new Color(...(options.colour ?? [1, 1, 1]));
    if (options.texture) {
        m.diffuseMap = options.texture.texture;
        const tiling = 1 / options.texture.metres;
        m.diffuseMapTiling = new Vec2(tiling, tiling);
    }
    if (options.emissive) {
        m.emissive = new Color(...options.emissive);
        m.emissiveIntensity = options.emissiveIntensity ?? 1;
        m.diffuse = new Color(0, 0, 0);
        m.useLighting = false;
    }
    if (options.decal) {
        // Markings laid on the floor: biased toward the camera so they do not z-fight at a distance.
        m.depthBias = -2;
        m.slopeDepthBias = -2;
    }
    if (options.opacityMask) {
        m.opacityMap = options.opacityMask;
        m.opacityMapUv = 1;
        m.opacityMapChannel = 'r';
        m.alphaTest = 0.5;
    }
    m.update();
    return m;
};

const addMesh = (app: AppBase, parent: Entity, name: string, builder: MeshBuilder, m: StandardMaterial) => {
    if (builder.empty) return null;
    const entity = new Entity(name);
    entity.addComponent('render', {
        meshInstances: [new MeshInstance(builder.build(app.graphicsDevice), m)],
        castShadows: false
    });
    parent.addChild(entity);
    return entity;
};

/** Horizontal triangles copied from a source mesh at height `y`, facing up or down, with metric and mask UVs. */
const addHorizontal = (builder: MeshBuilder, triangles: [number, number, number][][], y: number, down: boolean) => {
    const maskUv = (x: number, z: number): [number, number] => [
        (x - DERIVED_GRID.x0) / DERIVED_GRID.width,
        // PlayCanvas samples V = 0 at the first image row; mask row 0 is z0 (north).
        (z - DERIVED_GRID.z0) / DERIVED_GRID.depth
    ];
    for (const triangle of triangles) {
        const ids = triangle.map(([x, , z]) => builder.vertex([x, y, z], [0, down ? -1 : 1, 0], [x, z], maskUv(x, z)));
        builder.triangle(ids[0], ids[1], ids[2]);
    }
};

const isHorizontalAt = (triangle: [number, number, number][], y: number) =>
    triangle.every((vertex) => Math.abs(vertex[1] - y) < 0.005);

const FLOOR_FINISHES: Record<string, { texture: string; colour: [number, number, number] }> = {
    classroom: { texture: 'wood', colour: [1, 1, 1] },
    hall: { texture: 'wood', colour: [1, 0.95, 0.9] },
    office: { texture: 'carpet', colour: [0.9, 0.95, 1.05] },
    meeting: { texture: 'carpet', colour: [0.85, 1, 0.9] },
    library: { texture: 'carpet', colour: [1.1, 0.95, 0.85] },
    creative: { texture: 'laminate', colour: [1, 0.95, 1.02] },
    room: { texture: 'laminate', colour: [1, 1, 1] },
    lab: { texture: 'tile', colour: [0.95, 1, 1] },
    service: { texture: 'tile', colour: [0.92, 0.92, 0.92] },
    restroom: { texture: 'tile', colour: [0.95, 1, 1.05] },
    dining: { texture: 'terrazzo', colour: [1.05, 1, 0.92] },
    public: { texture: 'terrazzo', colour: [1, 1, 1] },
    stair: { texture: 'terrazzo', colour: [0.9, 0.9, 0.9] },
    garden: { texture: 'carpet', colour: [0.62, 0.95, 0.5] }
};

/**
 * GAMEPLAY_AUTHORED location for the derived arena region. The name comes from the source room records
 * ("莲花球场扩音间", "灯光室" are the court's PA and lighting rooms); the polygon is the derived arena outline.
 */
export const arenaLocation = (world: DerivedWorld): CampusRoom => ({
    id: 'ARENA',
    name: '莲花球场',
    nameEnglish: 'Lotus Arena',
    kind: 'hall',
    kindLabel: '',
    hasRegion: true,
    geometryStatus: 'GAMEPLAY_AUTHORED',
    polygon: { outer: world.arena.outline, holes: [] }
});

export const buildDressing = (
    app: AppBase,
    campus: Entity,
    world: DerivedWorld,
    rooms: CampusRoom[],
    ceilingMask: Texture,
    authoredRooms: readonly string[] = []
) => {
    const device = app.graphicsDevice;
    const root = new Entity('GameplayAuthored_Dressing');
    campus.addChild(root);
    const mirrorLayer = new Layer({ name: 'Restroom_Mirror_Surfaces' });
    const worldLayer = app.scene.layers.getLayerByName('World');
    app.scene.layers.insert(mirrorLayer, worldLayer ? app.scene.layers.getOpaqueIndex(worldLayer) + 1 : 0);
    const textures = Object.fromEntries(
        ['terrazzo', 'wood', 'tile', 'carpet', 'ceiling', 'court', 'laminate', 'epoxy'].map((name, index) => [
            name,
            createTexture(device, name, 11 + index)
        ])
    ) as Record<string, TextureRef>;

    // Walls and wall tops: warm plaster paint (source meshes have no UVs).
    const plaster = makeMaterial('plaster', { colour: [0.9, 0.89, 0.86], gloss: 0.1 });
    // Source wall meshes keep back-face culling: their horizontal caps must not show their unlit undersides.
    const wallPaint = makeMaterial('wall-paint', { colour: [0.9, 0.89, 0.86], gloss: 0.1 });
    wallPaint.cull = CULLFACE_BACK;
    wallPaint.update();
    for (const name of ['Walls', 'Walls_Top']) {
        for (const instance of (campus.findByName(name) as Entity).render!.meshInstances) instance.material = wallPaint;
    }

    // Floors: the slab (corridors) and each source room patch get a planar-mapped finish by room kind.
    const slab = campus.findByName('Floor_Slab') as Entity;
    const slabTop = worldTriangles(slab).filter((triangle) => isHorizontalAt(triangle, 0));
    const floorBuilder = new MeshBuilder();
    addHorizontal(floorBuilder, slabTop, 0, false);
    addMesh(
        app,
        root,
        'Floor_Corridor',
        floorBuilder,
        // Glossy grey-blue epoxy on every corridor (the slab outside the room patches); room floors are unchanged.
        makeMaterial('floor-epoxy', { texture: textures.epoxy, gloss: 0.82 })
    );
    slab.render!.enabled = false;

    const kindOf = new Map(rooms.map((room) => [room.id, room.kind]));
    const byKind = new Map<string, MeshBuilder>();
    const roomsNode = campus.findByName('Rooms') as Entity;
    for (const child of roomsNode.children as Entity[]) {
        const id = child.name.replace(/^(Room|Space)_/, '');
        const kind = kindOf.get(id) ?? 'room';
        // Authored interiors lay their own floor.
        if (!child.render || authoredRooms.includes(id)) continue;
        const top = worldTriangles(child).filter((triangle) => isHorizontalAt(triangle, 0.02));
        if (!byKind.has(kind)) byKind.set(kind, new MeshBuilder());
        addHorizontal(byKind.get(kind)!, top, 0.02, false);
    }
    for (const [kind, builder] of byKind) {
        const finish = FLOOR_FINISHES[kind] ?? FLOOR_FINISHES.room;
        addMesh(
            app,
            root,
            `Floor_${kind}`,
            builder,
            makeMaterial(`floor-${kind}`, {
                texture: textures[finish.texture],
                colour: finish.colour,
                gloss: finish.texture === 'tile' || finish.texture === 'wood' ? 0.5 : 0.2
            })
        );
    }

    const court = campus.findByName('Arena_Court') as Entity;
    const courtBuilder = new MeshBuilder();
    addHorizontal(
        courtBuilder,
        worldTriangles(court).filter((triangle) => isHorizontalAt(triangle, 0.02)),
        0.021,
        false
    );
    addMesh(app, root, 'Floor_Court', courtBuilder, makeMaterial('court', { texture: textures.court, gloss: 0.6 }));
    court.render!.enabled = false;

    // Ceiling over the whole slab, cut away over the open-air arena and courtyards by the derived mask.
    const ceilingBuilder = new MeshBuilder();
    addHorizontal(ceilingBuilder, slabTop, world.ceilingHeight, true);
    addMesh(
        app,
        root,
        'Ceiling',
        ceilingBuilder,
        makeMaterial('ceiling', {
            texture: textures.ceiling,
            opacityMask: ceilingMask,
            gloss: 0.1
        })
    );

    // Tall perimeter wall around the open-air arena, standing on the source walls along the derived outline.
    const arenaWall = new MeshBuilder();
    const arenaCoping = new MeshBuilder();
    const { outline, center } = world.arena;
    const wallBottom = world.ceilingHeight - 0.05;
    outline.forEach(([ax, az], index) => {
        const [bx, bz] = outline[(index + 1) % outline.length];
        const length = Math.hypot(bx - ax, bz - az);
        if (length < 0.05) return;
        let nx = (az - bz) / length;
        let nz = (bx - ax) / length;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        if (nx * (mx - center[0]) + nz * (mz - center[1]) < 0) {
            nx = -nx;
            nz = -nz;
        }
        const yaw = Math.atan2(bz - az, bx - ax);
        // Centred slightly outside the outline so it caps the source wall tops; extended to close the joints.
        arenaWall.box(
            mx + nx * 0.12,
            wallBottom,
            mz + nz * 0.12,
            length + 0.35,
            0.35,
            ARENA_WALL_HEIGHT - wallBottom,
            yaw
        );
        arenaCoping.box(mx + nx * 0.12, ARENA_WALL_HEIGHT, mz + nz * 0.12, length + 0.5, 0.55, 0.35, yaw);
    });
    addMesh(app, root, 'Arena_PerimeterWall', arenaWall, plaster);
    addMesh(app, root, 'Arena_Coping', arenaCoping, makeMaterial('coping', { colour: [0.62, 0.64, 0.67], gloss: 0.3 }));
    const arenaWallBody = new Entity('GameplayAuthored_ArenaWallCollider');
    arenaWallBody.addComponent('collision', { type: 'mesh', render: { meshes: [arenaWall.build(device)] } });
    arenaWallBody.addComponent('rigidbody', { type: 'static', friction: 0, restitution: SURFACE_RESTITUTION.wall });
    root.addChild(arenaWallBody);

    // Doors from the swing linework: a lintel over the opening and an open leaf along the drawn swing.
    const lintels = new MeshBuilder();
    const leaves = new MeshBuilder();
    for (const door of world.doors) {
        const [hx, hz] = door.hinge;
        const [cx, cz] = door.closed;
        const width = Math.hypot(cx - hx, cz - hz);
        const yaw = Math.atan2(cz - hz, cx - hx);
        const nx = -Math.sin(yaw);
        const nz = Math.cos(yaw);
        // Authored doorways keep the source wall above the cut as their lintel.
        if (!door.authored)
            lintels.box(
                (hx + cx) / 2 + nx * door.offset,
                world.doorHeight,
                (hz + cz) / 2 + nz * door.offset,
                width + 0.02,
                door.thickness,
                world.wallHeight - world.doorHeight,
                yaw
            );
        const [ox, oz] = door.open;
        const leafLength = Math.hypot(ox - hx, oz - hz);
        leaves.box(
            (hx + ox) / 2,
            0.01,
            (hz + oz) / 2,
            leafLength - 0.02,
            0.04,
            world.doorHeight - 0.02,
            Math.atan2(oz - hz, ox - hx)
        );
    }
    addMesh(app, root, 'Door_Lintels', lintels, plaster);
    addMesh(
        app,
        root,
        'Door_Leaves',
        leaves,
        makeMaterial('door-leaf', { texture: textures.wood, colour: [0.85, 0.7, 0.55], gloss: 0.4 })
    );

    // Furniture: linework-derived outlines plus per-room layouts (see tools/deriveWorld.ts). Built per type.
    const tops = new MeshBuilder();
    const legs = new MeshBuilder();
    const blocks = new MeshBuilder();
    const seats = new MeshBuilder();
    const shelves = new MeshBuilder();
    const colliders = new MeshBuilder();
    const along = (x: number, z: number, yaw: number, u: number, v: number): [number, number] => [
        x + u * Math.cos(yaw) - v * Math.sin(yaw),
        z + u * Math.sin(yaw) + v * Math.cos(yaw)
    ];
    const table = (x: number, z: number, width: number, depth: number, height: number, yaw: number, top = 0.04) => {
        tops.box(x, height - top, z, width, depth, top, yaw);
        for (const [u, v] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1]
        ]) {
            const [lx, lz] = along(x, z, yaw, (u * (width - 0.1)) / 2, (v * (depth - 0.1)) / 2);
            legs.box(lx, 0, lz, 0.045, 0.045, height - top, yaw);
        }
    };
    for (const item of world.furniture) {
        const [x, z] = item.center;
        const [width, depth] = item.size;
        const type = item.type ?? (item.height <= 0.5 ? 'seat' : item.height < 0.8 ? 'table' : 'counter');
        switch (type) {
            case 'desk':
            case 'teacher-desk':
            case 'table':
                table(x, z, width, depth, item.height, item.yaw);
                if (type === 'teacher-desk')
                    blocks.box(x, 0.05, z, width - 0.12, depth - 0.12, item.height - 0.1, item.yaw);
                break;
            case 'lab-bench':
            case 'counter':
                blocks.box(x, 0, z, width, depth, item.height - 0.04, item.yaw);
                tops.box(x, item.height - 0.04, z, width + 0.04, depth + 0.04, 0.04, item.yaw);
                break;
            case 'chair': {
                table(x, z, width, depth, 0.45, item.yaw, 0.05);
                const [bx, bz] = along(x, z, item.yaw, -width / 2 + 0.02, 0);
                seats.box(bx, 0.45, bz, 0.03, depth, 0.42, item.yaw);
                break;
            }
            case 'stool':
                seats.box(x, item.height - 0.05, z, width, depth, 0.05, item.yaw);
                legs.box(x, 0, z, 0.06, 0.06, item.height - 0.05, item.yaw);
                break;
            case 'shelf':
                shelves.box(x, 0, z, width, depth, item.height, item.yaw, 5);
                for (let h = 0.4; h < item.height; h += 0.42)
                    tops.box(x, h, z, width + 0.02, depth + 0.02, 0.025, item.yaw);
                break;
            case 'bench':
                tops.box(x, item.height - 0.06, z, width, depth, 0.06, item.yaw);
                for (const u of [-1, 1]) {
                    const [lx, lz] = along(x, z, item.yaw, (u * (width - 0.2)) / 2, 0);
                    legs.box(lx, 0, lz, 0.06, depth - 0.05, item.height - 0.06, item.yaw);
                }
                break;
            default:
                seats.box(x, 0, z, width, depth, item.height, item.yaw);
        }
        if (item.collide) colliders.box(x, 0, z, width, depth, item.height, item.yaw);
    }
    const partitions = new MeshBuilder();
    for (const [[ax, az], [bx, bz]] of world.partitions) {
        partitions.box(
            (ax + bx) / 2,
            0.15,
            (az + bz) / 2,
            Math.hypot(bx - ax, bz - az),
            0.03,
            1.8,
            Math.atan2(bz - az, bx - ax)
        );
    }
    const laminate = makeMaterial('laminate', { texture: textures.laminate, gloss: 0.45 });
    addMesh(
        app,
        root,
        'Furniture_Tops',
        tops,
        makeMaterial('worktop', { texture: textures.wood, colour: [1.05, 1, 0.95], gloss: 0.5 })
    );
    addMesh(app, root, 'Furniture_Legs', legs, makeMaterial('metal', { colour: [0.25, 0.26, 0.28], gloss: 0.6 }));
    addMesh(app, root, 'Furniture_Blocks', blocks, laminate);
    addMesh(
        app,
        root,
        'Furniture_Shelves',
        shelves,
        makeMaterial('shelving', { texture: textures.wood, colour: [0.62, 0.55, 0.5] })
    );
    addMesh(
        app,
        root,
        'Furniture_Seats',
        seats,
        makeMaterial('fabric', { texture: textures.carpet, colour: [1.2, 1.35, 1.6] })
    );
    addMesh(
        app,
        root,
        'Restroom_Partitions',
        partitions,
        makeMaterial('partition', { colour: [0.72, 0.8, 0.84], gloss: 0.5 })
    );

    // Court and stair linework as thin floor markings.
    const markings = (name: string, width: number, y: number) => {
        const builder = new MeshBuilder();
        const source = campus.findByName(name) as Entity | null;
        for (const instance of source?.render?.meshInstances ?? []) {
            const positions: number[] = [];
            instance.mesh?.getPositions(positions);
            const transform = instance.node.getWorldTransform();
            const p = transform.data;
            for (let i = 0; i + 5 < positions.length; i += 6) {
                const ax = positions[i] + p[12];
                const az = positions[i + 2] + p[14];
                const bx = positions[i + 3] + p[12];
                const bz = positions[i + 5] + p[14];
                const length = Math.hypot(bx - ax, bz - az);
                if (length < 1e-4) continue;
                builder.box(
                    (ax + bx) / 2,
                    y,
                    (az + bz) / 2,
                    length + width,
                    width,
                    0.002,
                    Math.atan2(bz - az, bx - ax),
                    5
                );
            }
        }
        return builder;
    };
    addMesh(
        app,
        root,
        'Court_Lines',
        markings('Lines_Court', 0.06, 0.024),
        makeMaterial('court-lines', { colour: [0.97, 0.97, 0.95], gloss: 0.6, decal: true })
    );
    addMesh(
        app,
        root,
        'Stair_Lines',
        markings('Lines_Stairs', 0.025, 0.024),
        makeMaterial('stair-lines', { colour: [0.35, 0.36, 0.38], decal: true })
    );

    // Ceiling light fixtures (emissive panels); actual light comes from the pooled lights in atmosphere.ts.
    const panels = new MeshBuilder();
    for (const [x, z, height, kind] of world.lights) {
        void kind;
        panels.box(x, height - 0.03, z, 0.6, 0.6, 0.02, 0);
    }
    addMesh(
        app,
        root,
        'Light_Panels',
        panels,
        makeMaterial('light-panel', { emissive: [1, 0.97, 0.9], emissiveIntensity: 5 })
    );

    // GAMEPLAY_AUTHORED mirrors: one lightweight surface per restroom. The active in-world reflection camera
    // supplies a render texture only to the nearest mirror the player is facing.
    const mirrors: RestroomMirrorMount[] = restroomMirrorLayouts(rooms).map((mount) => {
        const [x, y, z] = mount.position;
        const halfWidth = mount.width / 2;
        const normalOffset = 0.018;
        const frontX = x + mount.normal[0] * normalOffset;
        const frontZ = z + mount.normal[2] * normalOffset;
        const frame = new MeshBuilder();
        const tangent: [number, number, number] = [Math.cos(mount.yaw), 0, Math.sin(mount.yaw)];
        for (const side of [-1, 1]) {
            frame.box(
                x + tangent[0] * side * (mount.width / 2 + 0.045),
                y + mount.height / 2,
                z + tangent[2] * side * (mount.width / 2 + 0.045),
                0.06,
                0.055,
                mount.height + 0.12,
                mount.yaw
            );
        }
        frame.box(x, y - 0.03, z, mount.width + 0.12, 0.055, 0.06, mount.yaw);
        frame.box(x, y + mount.height - 0.03, z, mount.width + 0.12, 0.055, 0.06, mount.yaw);
        addMesh(
            app,
            root,
            `Mirror_Frame_${mount.roomId}`,
            frame,
            makeMaterial(`mirror-frame-${mount.roomId}`, { colour: [0.14, 0.19, 0.21], gloss: 0.68 })
        );
        const mirror = new MeshBuilder();
        const left: [number, number, number] = [
            frontX - tangent[0] * halfWidth,
            y + 0.06,
            frontZ - tangent[2] * halfWidth
        ];
        const right: [number, number, number] = [
            frontX + tangent[0] * halfWidth,
            y + 0.06,
            frontZ + tangent[2] * halfWidth
        ];
        mirror.quad(
            [left, right, [right[0], y + mount.height - 0.06, right[2]], [left[0], y + mount.height - 0.06, left[2]]],
            mount.normal,
            // The quad's first edge is the bottom edge; reverse V for the render target's top-origin texture.
            [
                [0, 1],
                [1, 1],
                [1, 0],
                [0, 0]
            ]
        );
        const material = makeMaterial(`mirror-glass-${mount.roomId}`, { colour: [0.34, 0.43, 0.46], gloss: 0.98 });
        material.metalness = 0.72;
        material.update();
        const surface = addMesh(app, root, `Mirror_Surface_${mount.roomId}`, mirror, material)!;
        surface.render!.layers = [mirrorLayer.id];
        return { ...mount, surface, material };
    });

    // Static collision for solid furniture (tables, counters), one unrendered body.
    if (!colliders.empty) {
        const body = new Entity('GameplayAuthored_FurnitureColliders');
        body.addComponent('collision', { type: 'mesh', render: { meshes: [colliders.build(device)] } });
        body.addComponent('rigidbody', { type: 'static', friction: 0.5, restitution: SURFACE_RESTITUTION.furniture });
        root.addChild(body);
    }
    return {
        doors: world.doors.length,
        furniture: world.furniture.length,
        lights: world.lights.length,
        mirrors,
        mirrorLayer
    };
};
