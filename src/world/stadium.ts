// Builds the rebuilt 莲花球场 (GAMEPLAY_AUTHORED; layout in stadiumLayout.ts): red lower seats (the FF-01 seat rows,
// recoloured), a teal upper bowl stepping outward from the 4.8 m fascia, twelve lotus roof petals open over the court,
// floodlight bars and an out-leaning facade. Decoration only: every collider (floor, stands, the 10 m arena wall)
// is unchanged, so routes, the nav audit and the upper bowl's unreachability stay as they were.
import type { AppBase, Entity as EntityType, StandardMaterial as StandardMaterialType } from 'playcanvas';
import { Color, CULLFACE_NONE, Entity, MeshInstance, StandardMaterial } from 'playcanvas';

import { MeshBuilder } from '../render/meshBuilder';

import type { Point2 } from './stadiumLayout';
import {
    aisleDistance,
    angleOf,
    petalShape,
    ringRadii,
    spectatorSeats,
    STADIUM,
    tierHeight,
    tierRadius
} from './stadiumLayout';

type V3 = [number, number, number];

const material = (name: string, colour: V3, options: { gloss?: number; emissive?: V3 } = {}) => {
    const m = new StandardMaterial();
    m.name = name;
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = options.gloss ?? 0.25;
    m.cull = CULLFACE_NONE;
    m.diffuse = new Color(...colour);
    if (options.emissive) {
        m.emissive = new Color(...options.emissive);
        m.emissiveIntensity = 1;
    }
    m.update();
    return m;
};

/** A flat quad a-b-c-d (any winding; materials are double-sided). */
const quad = (builder: MeshBuilder, a: V3, b: V3, c: V3, d: V3) => {
    const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2];
    const vx = d[0] - a[0],
        vy = d[1] - a[1],
        vz = d[2] - a[2];
    let nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const normal: V3 = [nx, ny, nz];
    const i0 = builder.vertex(a, normal, [0, 0]);
    builder.vertex(b, normal, [1, 0]);
    builder.vertex(c, normal, [1, 1]);
    builder.vertex(d, normal, [0, 1]);
    builder.triangle(i0, i0 + 1, i0 + 2);
    builder.triangle(i0, i0 + 2, i0 + 3);
};

export const buildStadium = (
    app: AppBase,
    parent: EntityType,
    campusRoot: EntityType,
    arena: { outline: readonly Point2[]; center: Point2 }
) => {
    const root = new Entity('GameplayAuthored_LotusStadium');
    parent.addChild(root);
    const [cx, cz] = arena.center;
    const radii = ringRadii(arena.outline, arena.center);
    const n = radii.length;
    const at = (i: number, r: number, y: number): V3 => {
        const a = angleOf(i, n);
        return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    };

    const concrete = new MeshBuilder();
    const seatsTeal = new MeshBuilder();
    const aisle = new MeshBuilder();
    const roofLight = new MeshBuilder();
    const roofDark = new MeshBuilder();
    const ribs = new MeshBuilder();
    const facade = new MeshBuilder();
    const mullions = new MeshBuilder();
    const ribbon = new MeshBuilder();
    const floodlights = new MeshBuilder();
    const rail = new MeshBuilder();

    const { tiers, tierRise, tierRun } = STADIUM;
    const topTier = tiers - 1;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a0 = angleOf(i, n),
            a1 = angleOf(i + 1, n);
        const mid = (a0 + a1) / 2;
        const inAisle = aisleDistance(mid) < STADIUM.aisleHalfWidth / tierRadius(radii, i, 4);
        // LED ribbon on the fascia's inner face, just inside the outline.
        quad(
            ribbon,
            at(i, radii[i] - 0.02, STADIUM.ribbon.bottom),
            at(j, radii[j] - 0.02, STADIUM.ribbon.bottom),
            at(j, radii[j] - 0.02, STADIUM.ribbon.top),
            at(i, radii[i] - 0.02, STADIUM.ribbon.top)
        );
        // Glass-railed front edge of the upper bowl.
        quad(
            rail,
            at(i, radii[i] + STADIUM.setback - 0.1, STADIUM.fasciaTop),
            at(j, radii[j] + STADIUM.setback - 0.1, STADIUM.fasciaTop),
            at(j, radii[j] + STADIUM.setback - 0.1, STADIUM.fasciaTop + 1.05),
            at(i, radii[i] + STADIUM.setback - 0.1, STADIUM.fasciaTop + 1.05)
        );
        // Deck between the outline and the first tier.
        quad(
            concrete,
            at(i, radii[i], STADIUM.fasciaTop),
            at(j, radii[j], STADIUM.fasciaTop),
            at(j, tierRadius(radii, j, 0), STADIUM.fasciaTop),
            at(i, tierRadius(radii, i, 0), STADIUM.fasciaTop)
        );
        for (let k = 0; k < tiers; k++) {
            const y = tierHeight(k);
            const r0i = tierRadius(radii, i, k),
                r0j = tierRadius(radii, j, k);
            const r1i = r0i + tierRun,
                r1j = r0j + tierRun;
            // Tread and riser.
            quad(inAisle ? aisle : concrete, at(i, r0i, y), at(j, r0j, y), at(j, r1j, y), at(i, r1i, y));
            quad(concrete, at(i, r1i, y), at(j, r1j, y), at(j, r1j, y + tierRise), at(i, r1i, y + tierRise));
            if (inAisle) continue;
            // Seats along the tread: a seat pan and a back, teal.
            const arc = ((r0i + r0j) / 2) * (a1 - a0);
            const count = Math.max(1, Math.floor(arc / STADIUM.seatPitch));
            for (let s = 0; s < count; s++) {
                const t = (s + 0.5) / count;
                const angle = a0 + (a1 - a0) * t;
                const r = r0i + (r0j - r0i) * t + tierRun * 0.45;
                const x = cx + Math.cos(angle) * r,
                    z = cz + Math.sin(angle) * r;
                // One block per seat (pan and back read as one at stadium distances; halves the vertex count).
                seatsTeal.box(x, y + 0.02, z, 0.46, 0.4, 0.48, angle + Math.PI / 2, 5);
            }
        }
        // Back wall above the top tier.
        const backI = tierRadius(radii, i, topTier) + tierRun,
            backJ = tierRadius(radii, j, topTier) + tierRun;
        const backY = tierHeight(topTier) + tierRise;
        quad(concrete, at(i, backI, backY), at(j, backJ, backY), at(j, backJ, backY + 1.4), at(i, backI, backY + 1.4));
        // Roof petal: from the inner edge over the court down to a scalloped outer edge beyond the top tier.
        const innerI = radii[i] - STADIUM.roofInnerInset,
            innerJ = radii[j] - STADIUM.roofInnerInset;
        const outerI = backI + STADIUM.roofOverhang + STADIUM.petalBulge * petalShape(a0),
            outerJ = backJ + STADIUM.roofOverhang + STADIUM.petalBulge * petalShape(a1);
        const petal = Math.floor((mid / (Math.PI * 2)) * STADIUM.petals);
        const roof = petal % 2 ? roofDark : roofLight;
        // Slight gap at each petal join so the twelve leaves read separately.
        const join = aisleDistance(mid) < 0.012;
        if (!join) {
            quad(
                roof,
                at(i, innerI, STADIUM.roofInnerHeight),
                at(j, innerJ, STADIUM.roofInnerHeight),
                at(j, outerJ, STADIUM.roofOuterHeight),
                at(i, outerI, STADIUM.roofOuterHeight)
            );
            // Facade petal, leaning outward as it rises from the building roof to the roof edge.
            const footI = backI - 1.5,
                footJ = backJ - 1.5;
            quad(
                facade,
                at(i, footI, STADIUM.facadeBottom),
                at(j, footJ, STADIUM.facadeBottom),
                at(j, outerJ - 0.4, STADIUM.roofOuterHeight - 0.6),
                at(i, outerI - 0.4, STADIUM.roofOuterHeight - 0.6)
            );
        }
        // Ribs: radial at every fourth sample, heavier at petal joins; floodlight bars along the inner edge.
        if (i % 4 === 0 || join) {
            const [x0, , z0] = at(i, innerI, 0),
                [x1, , z1] = at(i, outerI, 0);
            const length = Math.hypot(x1 - x0, z1 - z0);
            const steps = 6;
            const w = join ? 0.32 : 0.16;
            for (let s = 0; s < steps; s++) {
                const t = (s + 0.5) / steps;
                const r = innerI + (outerI - innerI) * t;
                const y = STADIUM.roofInnerHeight + (STADIUM.roofOuterHeight - STADIUM.roofInnerHeight) * t - 0.25;
                const [x, , z] = at(i, r, 0);
                // Width runs radially (yaw = the sample's angle).
                ribs.box(x, y, z, length / steps + 0.05, w, w, mid);
            }
        }
        if (i % 2 === 0) {
            const [x, , z] = at(i, innerI + 0.6, 0);
            floodlights.box(x, STADIUM.roofInnerHeight - 0.55, z, 1.1, 0.35, 0.18, mid + Math.PI / 2);
        }
        // Facade mullions at petal joins.
        if (join) {
            const footI = backI - 1.5;
            const [fx, , fz] = at(i, footI, 0);
            const [tx, , tz] = at(i, outerI - 0.4, 0);
            const segs = 8;
            for (let s = 0; s < segs; s++) {
                const t = (s + 0.5) / segs;
                const y = STADIUM.facadeBottom + (STADIUM.roofOuterHeight - 0.6 - STADIUM.facadeBottom) * t - 0.9;
                mullions.box(fx + (tx - fx) * t, y, fz + (tz - fz) * t, 0.5, 0.5, 1.9, mid);
            }
        }
    }

    const meshes: [string, MeshBuilder, StandardMaterialType][] = [
        ['Stadium_Concrete', concrete, material('stadium-concrete', [0.62, 0.63, 0.64], { gloss: 0.15 })],
        ['Stadium_Aisles', aisle, material('stadium-aisle', [0.48, 0.5, 0.52], { gloss: 0.15 })],
        ['Stadium_UpperSeats', seatsTeal, material('stadium-seat-teal', [0.13, 0.55, 0.55], { gloss: 0.45 })],
        ['Stadium_RoofLight', roofLight, material('stadium-roof-light', [0.72, 0.74, 0.74], { gloss: 0.35 })],
        ['Stadium_RoofDark', roofDark, material('stadium-roof-dark', [0.64, 0.67, 0.68], { gloss: 0.35 })],
        ['Stadium_RoofRibs', ribs, material('stadium-ribs', [0.85, 0.86, 0.83], { gloss: 0.3 })],
        ['Stadium_Facade', facade, material('stadium-facade', [0.66, 0.66, 0.62], { gloss: 0.2 })],
        ['Stadium_Mullions', mullions, material('stadium-mullion', [0.58, 0.6, 0.59], { gloss: 0.2 })],
        ['Stadium_Rail', rail, material('stadium-rail', [0.55, 0.72, 0.78], { gloss: 0.8 })],
        [
            'Stadium_LedRibbon',
            ribbon,
            material('stadium-ribbon', [0.1, 0.25, 0.75], { emissive: [0.18, 0.42, 1], gloss: 0.6 })
        ],
        [
            'Stadium_Floodlights',
            floodlights,
            material('stadium-floodlight', [0.9, 0.9, 0.85], { emissive: [1, 0.97, 0.88] })
        ]
    ];
    const entities = new Map<string, EntityType>();
    for (const [name, builder, m] of meshes) {
        if (builder.empty) continue;
        const entity = new Entity(name);
        entity.addComponent('render', {
            meshInstances: [new MeshInstance(builder.build(app.graphicsDevice), m)],
            castShadows: false
        });
        root.addChild(entity);
        entities.set(name, entity);
    }

    // Lower bowl: the FF-01 seat rows become red (the photographed lower tier), the stand base stays concrete.
    const seatRed = material('stadium-seat-red', [0.72, 0.13, 0.12], { gloss: 0.45 });
    for (let row = 0; row < 8; row++) {
        const node = campusRoot.findByName(`Arena_Seats_Row${String(row).padStart(2, '0')}`) as EntityType | null;
        for (const instance of node?.render?.meshInstances ?? []) instance.material = seatRed;
    }

    return {
        root,
        /** Emissive parts that the blackout dims (LED ribbon and floodlights). */
        lights: [entities.get('Stadium_LedRibbon'), entities.get('Stadium_Floodlights')].filter(
            (entity): entity is EntityType => !!entity
        ),
        seats: spectatorSeats(radii, arena.center)
    };
};
