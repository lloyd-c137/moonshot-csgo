// Builds the rebuilt 莲花球场 (GAMEPLAY_AUTHORED; layout in stadiumLayout.ts) after the owner's interior photo
// (2026-10-17): a blue court on a green apron ringed by low blue/white boards; one continuous light-grey bowl with blue
// seat blocks rising from a low banner-clad parapet, three stair aisles per petal and a railed cross-aisle walkway;
// a band of white glazed panels between columns under twelve lotus roof petals open over the court; an out-leaning
// facade outside. The bowl is walkable: two stand stairs lead up from the court and every aisle is a stair; the
// colliders for all of it live in world/arenaAccess.ts (added by physics/collisionWorld).
import type { AppBase, Entity as EntityType, StandardMaterial as StandardMaterialType } from 'playcanvas';
import { Color, CULLFACE_BACK, CULLFACE_NONE, Entity, MeshInstance, StandardMaterial, Texture } from 'playcanvas';

import { MeshBuilder } from '../render/meshBuilder';

import { aisleAngles, aisleTreads, ARENA_ACCESS, standStair, tierRadiusAt } from './arenaAccess';
import type { Point2 } from './stadiumLayout';
import {
    aisleDistance,
    angleOf,
    COURT_SURROUND,
    courtSurroundPath,
    inSurroundGap,
    intersectRadius,
    netHeightAt,
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

/** "莲花球场" and gate numbers 1–12 in red, one 4 × 3 atlas; only the letters draw (alpha-tested). */
const letteringMaterial = (app: AppBase) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 768;
    const g = canvas.getContext('2d')!;
    for (let p = 0; p < 12; p++) {
        const x = (p % 4) * 256,
            y = Math.floor(p / 4) * 256;
        g.fillStyle = '#c8282d';
        g.textAlign = 'center';
        g.font = '700 34px "PingFang SC", "Microsoft YaHei", sans-serif';
        g.fillText('莲花球场', x + 128, y + 52);
        g.font = '600 18px Arial, sans-serif';
        g.fillText('LOTUS COURT', x + 128, y + 78);
        g.font = '800 140px Arial, sans-serif';
        g.fillText(String(p + 1), x + 128, y + 220);
    }
    const texture = new Texture(app.graphicsDevice, {
        name: 'stadium-lettering',
        width: 1024,
        height: 768,
        mipmaps: true
    });
    texture.setSource(canvas);
    const m = material('stadium-lettering', [1, 1, 1], { gloss: 0.18 });
    m.diffuseMap = texture;
    m.opacityMap = texture;
    m.opacityMapChannel = 'a';
    m.alphaTest = 0.4;
    m.update();
    return m;
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
    const petalLight = new MeshBuilder();
    const petalDark = new MeshBuilder();
    const shellBase = new MeshBuilder();
    const roofUnder = new MeshBuilder();
    const fascia = new MeshBuilder();
    const lettering = new MeshBuilder();
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
            // Tread and riser (the aisle stairs are drawn over them at their exact angles, below).
            quad(concrete, at(i, r0i, y), at(j, r0j, y), at(j, r1j, y), at(i, r1i, y));
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
            // Seats: light grey, with blue blocks high in every third petal (the photo's blue sections).
            const builder = k > walkwayTier + 3 && petal % 3 === 1 ? seatsBlue : seatsGrey;
            const arc = ((r0i + r0j) / 2) * (a1 - a0);
            const count = Math.max(1, Math.floor(arc / STADIUM.seatPitch));
            for (let s = 0; s < count; s++) {
                const t = (s + 0.5) / count;
                const angle = a0 + (a1 - a0) * t;
                const r = r0i + (r0j - r0i) * t + tierRun * 0.45;
                // Keep the aisle stairs clear (seat half width included).
                if (aisleDistance(angle) < (ARENA_ACCESS.aisleHalfWidth + 0.25) / r) continue;
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
        if (i % 2 === 0) {
            const [x, , z] = at(i, radii[i] - STADIUM.roofInnerInset + 0.6, 0);
            floodlights.box(x, STADIUM.roofInnerHeight - 0.55, z, 1.1, 0.35, 0.18, mid + Math.PI / 2);
        }
    }

    // Outer shell, after the owner's model (stadium-shell.mjs) and the 2026-10-17 photos: twelve separate, flat,
    // inverted-trapezoid concrete petals leaning out over a recessed base, with deep gaps between them; a folded roof
    // plate on each with a thick fascia; "莲花球场" and the gate number in red on every petal.
    const sampleAt = (values: readonly number[], a: number) => {
        const f = ((((a / (Math.PI * 2)) % 1) + 1) % 1) * n;
        const i0 = Math.floor(f) % n,
            i1 = (i0 + 1) % n;
        return values[i0] + (values[i1] - values[i0]) * (f - Math.floor(f));
    };
    const back = radii.map((_, i) => tierRadius(radii, i, topTier) + tierRun);
    const polar = (a: number, r: number, y: number): V3 => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    const solid = (builder: MeshBuilder, face: V3[], offset: V3) => {
        const backFace = face.map(([x, y, z]) => [x + offset[0], y + offset[1], z + offset[2]] as V3);
        quad(builder, face[0], face[1], face[2], face[3]);
        quad(builder, backFace[3], backFace[2], backFace[1], backFace[0]);
        for (let k = 0; k < 4; k++) {
            const l = (k + 1) % 4;
            quad(builder, face[k], backFace[k], backFace[l], face[l]);
        }
    };
    const { shell } = STADIUM;
    const half = Math.PI / STADIUM.petals;
    for (let p = 0; p < STADIUM.petals; p++) {
        const a = (p + 0.5) * 2 * half;
        const backR = sampleAt(back, a);
        const footR = backR + shell.footOut,
            topR = footR + shell.lean;
        const [a0, a1] = [a - half * shell.footSpread, a + half * shell.footSpread];
        const [t0, t1] = [a - half * shell.topSpread, a + half * shell.topSpread];
        // The petal: a flat slab leaning outward (outer face front, 0.6 m thick toward the court).
        const face: V3[] = [
            polar(a0, footR, shell.footHeight),
            polar(a1, footR, shell.footHeight),
            polar(t1, topR, shell.topHeight),
            polar(t0, topR, shell.topHeight)
        ];
        const inward: V3 = [-Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6];
        solid(p % 2 ? petalDark : petalLight, face, inward);
        // Lettering low on the outer face: a quad just proud of it, mapped to this petal's cell of the atlas.
        {
            const along = (lo: number, hi: number, t: number) => lo + (hi - lo) * t;
            const height = (y: number) => (y - shell.footHeight) / (shell.topHeight - shell.footHeight);
            const at2 = (s: number, y: number): V3 => {
                const t = height(y);
                const r = along(footR, topR, t) + 0.03;
                const spread = along(shell.footSpread, shell.topSpread, t);
                return polar(a + half * spread * s, r, y);
            };
            const [y0, y1] = [shell.footHeight + 1.6, shell.footHeight + 4.4];
            const cell = p % 12;
            const [cu, cv] = [(cell % 4) / 4, Math.floor(cell / 4) / 3];
            // The petal's own outward normal (leaning out and down), so the label shades exactly like the panel.
            const rise = shell.topHeight - shell.footHeight;
            const length = Math.hypot(rise, shell.lean);
            const n0: V3 = [(Math.cos(a) * rise) / length, -shell.lean / length, (Math.sin(a) * rise) / length];
            // Seen from outside, increasing angle runs right to left: the atlas u runs the other way.
            const corners: [V3, [number, number]][] = [
                [at2(-0.32, y0), [cu + 1 / 4, cv + 1 / 3]],
                [at2(0.32, y0), [cu, cv + 1 / 3]],
                [at2(0.32, y1), [cu, cv]],
                [at2(-0.32, y1), [cu + 1 / 4, cv]]
            ];
            const i0 = lettering.vertex(corners[0][0], n0, corners[0][1]);
            for (const [pos, uv] of corners.slice(1)) lettering.vertex(pos, n0, uv);
            lettering.triangle(i0, i0 + 1, i0 + 2);
            lettering.triangle(i0, i0 + 2, i0 + 3);
        }
        // Recessed base under the petal: a dark glazed wall on the building roof, and two concrete legs.
        const baseR = backR + 0.15;
        quad(
            shellBase,
            polar(a - half * 0.98, baseR, STADIUM.facadeBottom),
            polar(a + half * 0.98, baseR, STADIUM.facadeBottom),
            polar(a + half * 0.98, baseR, shell.footHeight + 0.2),
            polar(a - half * 0.98, baseR, shell.footHeight + 0.2)
        );
        for (const sgn of [-1, 1]) {
            const angle = a + sgn * half * shell.footSpread * 0.85;
            const [x, , z] = polar(angle, footR - 0.2, 0);
            columns.box(x, STADIUM.facadeBottom, z, 0.9, 0.9, shell.footHeight - STADIUM.facadeBottom + 0.3, angle);
        }
        // Folded roof plate: inner edge over the bowl, outer edge on the petal top, a ridge down the middle.
        const innerR = sampleAt(radii, a) - STADIUM.roofInnerInset;
        const roofOut = topR + 0.4;
        const ri0 = polar(a - half * 0.84, innerR, STADIUM.roofInnerHeight),
            ri1 = polar(a + half * 0.84, innerR, STADIUM.roofInnerHeight),
            ro1 = polar(t1 + half * 0.03, roofOut, shell.topHeight + 0.5),
            ro0 = polar(t0 - half * 0.03, roofOut, shell.topHeight + 0.5);
        const ridgeIn = polar(a, innerR, STADIUM.roofInnerHeight + shell.ridge),
            ridgeOut = polar(a, roofOut, shell.topHeight + 0.5 + shell.ridge);
        const roofBuilder = p % 2 ? roofDark : roofLight;
        quad(roofBuilder, ri0, ridgeIn, ridgeOut, ro0);
        quad(roofBuilder, ridgeIn, ri1, ro1, ridgeOut);
        // Underside and the thick fascia along the outer edge.
        const drop = (v: V3): V3 => [v[0], v[1] - shell.fascia, v[2]];
        quad(roofUnder, drop(ri0), drop(ri1), drop(ro1), drop(ro0));
        quad(fascia, ro0, ridgeOut, drop(ridgeOut), drop(ro0));
        quad(fascia, ridgeOut, ro1, drop(ro1), drop(ridgeOut));
        quad(fascia, ri0, ro0, drop(ro0), drop(ri0));
        quad(fascia, ro1, ri1, drop(ri1), drop(ro1));
        // Radial ribs under the roof plate, as in the photo's underside.
        for (let k = 1; k < 6; k++) {
            const angle = a - half * 0.8 + ((half * 1.6) / 6) * k;
            const [x0, , z0] = polar(angle, innerR, 0),
                [x1, , z1] = polar(angle, roofOut - 0.5, 0);
            const length = Math.hypot(x1 - x0, z1 - z0);
            const y = (STADIUM.roofInnerHeight + shell.topHeight + 0.5) / 2 - shell.fascia - 0.15;
            ribs.box((x0 + x1) / 2, y, (z0 + z1) / 2, length, 0.22, 0.3, angle);
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
        ['Stadium_RoofLight', roofLight, material('stadium-roof-light', [0.72, 0.74, 0.74], { gloss: 0.4 })],
        ['Stadium_RoofDark', roofDark, material('stadium-roof-dark', [0.66, 0.69, 0.69], { gloss: 0.4 })],
        ['Stadium_RoofRibs', ribs, material('stadium-ribs', [0.93, 0.94, 0.91], { gloss: 0.3 })],
        // The facade faces outward only: from inside the bowl you see the roof's underside, not a wall.
        ['Stadium_PetalLight', petalLight, material('stadium-petal-light', [0.72, 0.72, 0.68], { gloss: 0.18 })],
        ['Stadium_PetalDark', petalDark, material('stadium-petal-dark', [0.66, 0.66, 0.62], { gloss: 0.18 })],
        ['Stadium_ShellBase', shellBase, material('stadium-shell-base', [0.24, 0.3, 0.32], { gloss: 0.7 })],
        ['Stadium_RoofUnder', roofUnder, material('stadium-roof-under', [0.78, 0.8, 0.8], { gloss: 0.2 })],
        ['Stadium_Fascia', fascia, material('stadium-fascia', [0.74, 0.76, 0.77], { gloss: 0.3 })],
        ['Stadium_Lettering', lettering, letteringMaterial(app)],
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

    // Aisle stairs at their exact angles: two light-grey half steps per tier (their colliders are the ramps through
    // these nosings, physics/collisionWorld), and a slim handrail post line down each one.
    for (const angle of aisleAngles()) {
        const width = ARENA_ACCESS.aisleHalfWidth * 2;
        for (const tread of aisleTreads(radii, angle).slice(1)) {
            const base =
                Math.floor((tread.y - STADIUM.fasciaTop) / STADIUM.tierRise + 1e-6) * STADIUM.tierRise +
                STADIUM.fasciaTop;
            const rise = Math.max(0.012, tread.y - base + 0.012);
            const r = (tread.r0 + tread.r1) / 2;
            aisle.box(
                cx + Math.cos(angle) * r,
                base,
                cz + Math.sin(angle) * r,
                tread.r1 - tread.r0,
                width,
                rise,
                angle,
                5
            );
        }
    }
    // Court-level stand stairs (west and east), from the floor over the seat rows to the parapet.
    const stairMesh = new MeshBuilder();
    const railMaterial = material('stand-stair-rail', [0.55, 0.58, 0.62], { gloss: 0.6 });
    for (const side of ['west', 'east'] as const) {
        const angle = side === 'west' ? Math.PI : 0;
        const wall = intersectRadius(arena.outline, arena.center, angle);
        const stair = standStair(side, arena.center, wall, tierRadiusAt(radii, angle, 0));
        for (const step of stair.steps) {
            const x0 = Math.min(step.x0, step.x1),
                x1 = Math.max(step.x0, step.x1);
            stairMesh.box((x0 + x1) / 2, 0, stair.z, x1 - x0 + 0.01, stair.width, step.y, 0, 6);
        }
        // Landing across the parapet onto the first tier, and side stringers with a top rail.
        const lx0 = Math.min(stair.topX, stair.landingX),
            lx1 = Math.max(stair.topX, stair.landingX);
        stairMesh.box((lx0 + lx1) / 2, STADIUM.fasciaTop - 0.25, stair.z, lx1 - lx0, stair.width, 0.27, 0, 6);
        for (const dz of [-1, 1]) {
            const z = stair.z + (dz * (stair.width + 0.08)) / 2;
            const run = Math.abs(stair.topX - stair.footX);
            const slope = Math.atan2(STADIUM.fasciaTop, run);
            const length = Math.hypot(run, STADIUM.fasciaTop);
            const mx = (stair.footX + stair.topX) / 2;
            const rail = new Entity(`GameplayAuthored_StandStairRail_${side}_${dz}`);
            rail.addComponent('render', { type: 'box', material: railMaterial, castShadows: false });
            rail.setLocalScale(length, 0.05, 0.05);
            rail.setPosition(mx, STADIUM.fasciaTop / 2 + 0.95, z);
            rail.setEulerAngles(0, 0, ((side === 'west' ? -1 : 1) * (slope * 180)) / Math.PI);
            root.addChild(rail);
        }
    }
    const stairEntity = new Entity('GameplayAuthored_StandStairs');
    stairEntity.addComponent('render', {
        meshInstances: [
            new MeshInstance(
                stairMesh.build(app.graphicsDevice),
                material('stand-stair', [0.86, 0.87, 0.88], { gloss: 0.2 })
            )
        ],
        castShadows: true
    });
    root.addChild(stairEntity);

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
