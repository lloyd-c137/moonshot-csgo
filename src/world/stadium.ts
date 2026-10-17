// Builds the rebuilt 莲花球场 (GAMEPLAY_AUTHORED; layout in stadiumLayout.ts) after the owner's interior photo
// (2026-10-17): a blue court on a green apron ringed by low blue/white boards; one continuous light-grey bowl with blue
// seat blocks rising from a low banner-clad parapet, three stair aisles per petal and a railed cross-aisle walkway;
// a band of white glazed panels between columns under twelve lotus roof petals open over the court; an out-leaning
// facade outside. Decoration only: every collider (floor, stands, the 10 m arena wall) is unchanged, so routes, the
// nav audit and the bowl's unreachability stay as they were.
import type { AppBase, Entity as EntityType, StandardMaterial as StandardMaterialType } from 'playcanvas';
import { Color, CULLFACE_BACK, CULLFACE_NONE, Entity, MeshInstance, StandardMaterial } from 'playcanvas';

import { MeshBuilder } from '../render/meshBuilder';

import type { Point2 } from './stadiumLayout';
import {
    aisleDistance,
    angleOf,
    COURT_SURROUND,
    courtSurroundPath,
    inSurroundGap,
    netHeightAt,
    petalJoinDistance,
    petalShape,
    ringRadii,
    spectatorSeats,
    STADIUM,
    tierHeight,
    TENNIS,
    tennisLines,
    tierRadius
} from './stadiumLayout';

type V3 = [number, number, number];

const material = (name: string, colour: V3, options: { gloss?: number; emissive?: V3; oneSided?: boolean } = {}) => {
    const m = new StandardMaterial();
    m.name = name;
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = options.gloss ?? 0.25;
    m.cull = options.oneSided ? CULLFACE_BACK : CULLFACE_NONE;
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
    const seatsGrey = new MeshBuilder();
    const seatsBlue = new MeshBuilder();
    const aisle = new MeshBuilder();
    const roofLight = new MeshBuilder();
    const roofDark = new MeshBuilder();
    const ribs = new MeshBuilder();
    const facade = new MeshBuilder();
    const mullions = new MeshBuilder();
    const bannerBlue = new MeshBuilder();
    const bannerWhite = new MeshBuilder();
    const glazing = new MeshBuilder();
    const columns = new MeshBuilder();
    const floodlights = new MeshBuilder();
    const rail = new MeshBuilder();

    const { tiers, tierRise, tierRun, walkwayTier } = STADIUM;
    const topTier = tiers - 1;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a0 = angleOf(i, n),
            a1 = angleOf(i + 1, n);
        const mid = (a0 + a1) / 2;
        const petal = Math.floor((mid / (Math.PI * 2)) * STADIUM.petals);
        const inAisle = (k: number) => aisleDistance(mid) < STADIUM.aisleHalfWidth / tierRadius(radii, i, k);
        // Banner boards on the parapet's inner face: blue and white panels, as round the photographed bowl.
        quad(
            Math.floor(i / 3) % 2 ? bannerWhite : bannerBlue,
            at(i, radii[i] - 0.02, STADIUM.ribbon.bottom),
            at(j, radii[j] - 0.02, STADIUM.ribbon.bottom),
            at(j, radii[j] - 0.02, STADIUM.ribbon.top),
            at(i, radii[i] - 0.02, STADIUM.ribbon.top)
        );
        // Parapet cap between the outline and the first tier.
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
            const walkway = k === walkwayTier;
            const run = tierRun + (walkway ? STADIUM.walkwayExtra : 0);
            const r1i = r0i + run,
                r1j = r0j + run;
            // Tread and riser (stairs in the aisles are a lighter grey).
            quad(inAisle(k) && !walkway ? aisle : concrete, at(i, r0i, y), at(j, r0j, y), at(j, r1j, y), at(i, r1i, y));
            quad(concrete, at(i, r1i, y), at(j, r1j, y), at(j, r1j, y + tierRise), at(i, r1i, y + tierRise));
            if (walkway) {
                // The cross-aisle walkway: no seats, a glass rail along its front edge.
                quad(
                    rail,
                    at(i, r0i + 0.05, y),
                    at(j, r0j + 0.05, y),
                    at(j, r0j + 0.05, y + 1.05),
                    at(i, r0i + 0.05, y + 1.05)
                );
                continue;
            }
            if (inAisle(k)) continue;
            // Seats: light grey, with blue blocks high in every third petal (the photo's blue sections).
            const builder = k > walkwayTier + 3 && petal % 3 === 1 ? seatsBlue : seatsGrey;
            const arc = ((r0i + r0j) / 2) * (a1 - a0);
            const count = Math.max(1, Math.floor(arc / STADIUM.seatPitch));
            for (let s = 0; s < count; s++) {
                const t = (s + 0.5) / count;
                const angle = a0 + (a1 - a0) * t;
                const r = r0i + (r0j - r0i) * t + tierRun * 0.45;
                // One block per seat (pan and back read as one at stadium distances).
                builder.box(
                    cx + Math.cos(angle) * r,
                    y + 0.02,
                    cz + Math.sin(angle) * r,
                    0.46,
                    0.4,
                    0.46,
                    angle + Math.PI / 2,
                    5
                );
            }
        }
        // Glazed band above the top tier: white panels between columns, under the roof.
        const backI = tierRadius(radii, i, topTier) + tierRun,
            backJ = tierRadius(radii, j, topTier) + tierRun;
        const backY = tierHeight(topTier) + tierRise;
        quad(concrete, at(i, backI, backY), at(j, backJ, backY), at(j, backJ, backY + 0.5), at(i, backI, backY + 0.5));
        quad(
            glazing,
            at(i, backI, backY + 0.5),
            at(j, backJ, backY + 0.5),
            at(j, backJ, backY + STADIUM.glazingHeight),
            at(i, backI, backY + STADIUM.glazingHeight)
        );
        if (i % 2 === 0) {
            const [x, , z] = at(i, backI - 0.15, 0);
            columns.box(x, backY, z, 0.5, 0.5, STADIUM.roofOuterHeight - backY, mid);
        }
        // Roof petal: from the inner edge over the court down to a scalloped outer edge beyond the glazing.
        const innerI = radii[i] - STADIUM.roofInnerInset,
            innerJ = radii[j] - STADIUM.roofInnerInset;
        const outerI = backI + STADIUM.roofOverhang + STADIUM.petalBulge * petalShape(a0),
            outerJ = backJ + STADIUM.roofOverhang + STADIUM.petalBulge * petalShape(a1);
        const roof = petal % 2 ? roofDark : roofLight;
        // Slight gap at each petal join so the twelve leaves read separately.
        const join = petalJoinDistance(mid) < 0.012;
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
                // Wound so the visible (front) side faces outward, away from the court.
                at(i, footI, STADIUM.facadeBottom),
                at(i, outerI - 0.4, STADIUM.roofOuterHeight - 0.6),
                at(j, outerJ - 0.4, STADIUM.roofOuterHeight - 0.6),
                at(j, footJ, STADIUM.facadeBottom)
            );
        }
        // Ribs: radial at every second sample, heavier at petal joins; floodlight bars along the inner edge.
        if (i % 2 === 0 || join) {
            const [x0, , z0] = at(i, innerI, 0),
                [x1, , z1] = at(i, outerI, 0);
            const length = Math.hypot(x1 - x0, z1 - z0);
            const steps = 6;
            const w = join ? 0.45 : 0.24;
            for (let s = 0; s < steps; s++) {
                const t = (s + 0.5) / steps;
                const r = innerI + (outerI - innerI) * t;
                const y = STADIUM.roofInnerHeight + (STADIUM.roofOuterHeight - STADIUM.roofInnerHeight) * t - 0.25;
                const [x, , z] = at(i, r, 0);
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

    // Court level: a green apron round the (blue) court, ringed by low blue and white boards with four walk-throughs.
    const apron = new MeshBuilder();
    const boardBlue = new MeshBuilder();
    const boardWhite = new MeshBuilder();
    const path = courtSurroundPath();
    {
        const { x0, x1, z0, z1 } = COURT_SURROUND;
        const y = 0.012;
        const centre: V3 = [(x0 + x1) / 2, y, (z0 + z1) / 2];
        for (let p = 0; p < path.length; p++) {
            const [ax, az] = path[p],
                [bx, bz] = path[(p + 1) % path.length];
            apron.vertex(centre, [0, 1, 0], [0, 0]);
            apron.vertex([ax, y, az], [0, 1, 0], [0, 0]);
            apron.vertex([bx, y, bz], [0, 1, 0], [0, 0]);
            const base = apron.positions.length / 3 - 3;
            apron.triangle(base, base + 1, base + 2);
        }
        let travelled = 0;
        for (let p = 0; p < path.length; p++) {
            const [ax, az] = path[p],
                [bx, bz] = path[(p + 1) % path.length];
            const length = Math.hypot(bx - ax, bz - az);
            const mx = (ax + bx) / 2,
                mz = (az + bz) / 2;
            travelled += length;
            if (inSurroundGap(mx, mz)) continue;
            const builder = Math.floor(travelled / 2) % 2 ? boardWhite : boardBlue;
            builder.box(mx, 0, mz, length + 0.02, 0.12, COURT_SURROUND.boardHeight, Math.atan2(bz - az, bx - ax));
        }
    }

    // The tennis court: ITF lines over the blue surface (the FF-01 court linework is hidden), the net and its posts.
    const lines = new MeshBuilder();
    for (const [x0, z0, x1, z1] of tennisLines())
        quad(lines, [x0, 0.026, z0], [x1, 0.026, z0], [x1, 0.026, z1], [x0, 0.026, z1]);
    const net = new MeshBuilder();
    const netTape = new MeshBuilder();
    const posts = new MeshBuilder();
    const netCollider = new MeshBuilder();
    {
        const half = TENNIS.doublesHalfWidth + TENNIS.postOffset;
        const steps = 16;
        for (let s = 0; s < steps; s++) {
            const xa = TENNIS.centerX - half + (2 * half * s) / steps,
                xb = TENNIS.centerX - half + (2 * half * (s + 1)) / steps;
            const ha = netHeightAt(xa) - 0.06,
                hb = netHeightAt(xb) - 0.06;
            quad(net, [xa, 0, TENNIS.netZ], [xb, 0, TENNIS.netZ], [xb, hb, TENNIS.netZ], [xa, ha, TENNIS.netZ]);
            // White headband along the top.
            netTape.box((xa + xb) / 2, (ha + hb) / 2, TENNIS.netZ, xb - xa + 0.01, 0.03, 0.06, 0);
        }
        netTape.box(TENNIS.centerX, 0, TENNIS.netZ, 0.05, 0.035, TENNIS.centreHeight, 0);
        for (const side of [-1, 1])
            posts.box(TENNIS.centerX + side * half, 0, TENNIS.netZ, 0.09, 0.09, TENNIS.postHeight + 0.03, 0);
        netCollider.box(TENNIS.centerX, 0, TENNIS.netZ, 2 * half, 0.06, TENNIS.postHeight, 0);
    }
    campusRoot.findByName('Court_Lines')?.destroy();
    const netBody = new Entity('GameplayAuthored_TennisNetCollider');
    netBody.addComponent('collision', { type: 'mesh', render: { meshes: [netCollider.build(app.graphicsDevice)] } });
    // Discs (and players) are stopped by the net; it gives little bounce.
    netBody.addComponent('rigidbody', { type: 'static', friction: 0.6, restitution: 0.15 });
    root.addChild(netBody);

    const meshes: [string, MeshBuilder, StandardMaterialType][] = [
        ['Tennis_Lines', lines, material('tennis-lines', [0.97, 0.97, 0.95], { gloss: 0.6 })],
        ['Tennis_Net', net, material('tennis-net', [0.08, 0.1, 0.12], { gloss: 0.2 })],
        ['Tennis_NetTape', netTape, material('tennis-net-tape', [0.96, 0.96, 0.94], { gloss: 0.5 })],
        ['Tennis_Posts', posts, material('tennis-posts', [0.15, 0.32, 0.22], { gloss: 0.5 })],
        ['Stadium_Concrete', concrete, material('stadium-concrete', [0.7, 0.71, 0.72], { gloss: 0.15 })],
        ['Stadium_Aisles', aisle, material('stadium-aisle', [0.82, 0.83, 0.84], { gloss: 0.15 })],
        ['Stadium_SeatsGrey', seatsGrey, material('stadium-seat-grey', [0.8, 0.82, 0.84], { gloss: 0.4 })],
        ['Stadium_SeatsBlue', seatsBlue, material('stadium-seat-blue', [0.16, 0.3, 0.72], { gloss: 0.45 })],
        ['Stadium_RoofLight', roofLight, material('stadium-roof-light', [0.6, 0.63, 0.64], { gloss: 0.35 })],
        ['Stadium_RoofDark', roofDark, material('stadium-roof-dark', [0.52, 0.56, 0.57], { gloss: 0.35 })],
        ['Stadium_RoofRibs', ribs, material('stadium-ribs', [0.93, 0.94, 0.91], { gloss: 0.3 })],
        // The facade faces outward only: from inside the bowl you see the roof's underside, not a wall.
        ['Stadium_Facade', facade, material('stadium-facade', [0.66, 0.66, 0.62], { gloss: 0.2, oneSided: true })],
        ['Stadium_Mullions', mullions, material('stadium-mullion', [0.58, 0.6, 0.59], { gloss: 0.2 })],
        ['Stadium_Rail', rail, material('stadium-rail', [0.62, 0.76, 0.82], { gloss: 0.8 })],
        [
            'Stadium_Glazing',
            glazing,
            material('stadium-glazing', [0.88, 0.92, 0.95], { gloss: 0.7, emissive: [0.32, 0.34, 0.36] })
        ],
        ['Stadium_Columns', columns, material('stadium-column', [0.6, 0.62, 0.63], { gloss: 0.2 })],
        [
            'Stadium_BannerBlue',
            bannerBlue,
            material('stadium-banner-blue', [0.12, 0.3, 0.78], { emissive: [0.04, 0.1, 0.3] })
        ],
        [
            'Stadium_BannerWhite',
            bannerWhite,
            material('stadium-banner-white', [0.92, 0.94, 0.96], { emissive: [0.25, 0.26, 0.28] })
        ],
        ['Stadium_Apron', apron, material('stadium-apron', [0.36, 0.6, 0.36], { gloss: 0.35 })],
        ['Stadium_BoardsBlue', boardBlue, material('stadium-board-blue', [0.14, 0.32, 0.8], { gloss: 0.5 })],
        ['Stadium_BoardsWhite', boardWhite, material('stadium-board-white', [0.93, 0.94, 0.96], { gloss: 0.5 })],
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

    // Lower stands: the FF-01 seat rows take the bowl's light grey.
    const seatGrey = material('stadium-seat-grey-lower', [0.8, 0.82, 0.84], { gloss: 0.4 });
    for (let row = 0; row < 8; row++) {
        const node = campusRoot.findByName(`Arena_Seats_Row${String(row).padStart(2, '0')}`) as EntityType | null;
        for (const instance of node?.render?.meshInstances ?? []) instance.material = seatGrey;
    }

    return {
        root,
        /** Emissive parts that the blackout dims (banners and floodlights). */
        lights: ['Stadium_BannerBlue', 'Stadium_BannerWhite', 'Stadium_Floodlights']
            .map((name) => entities.get(name))
            .filter((entity): entity is EntityType => !!entity),
        seats: spectatorSeats(radii, arena.center)
    };
};
