import assert from 'node:assert/strict';
import test from 'node:test';

import { DISC } from '../src/gameplay/frisbee.ts';
import { NOVA_PROFILE, NOVA_SEGMENTS } from '../src/render/novaDisc.ts';

// Geometry only (the mesh and label need a graphics device): the lathe must match the disc's size and face outward.
test('the golden NOVA DISC lathe has the game disc radius, sits on y = 0 and faces outward', async () => {
    const { novaDiscGeometry } = await import('../src/render/novaDisc.ts');
    const { positions, uvs, indices } = novaDiscGeometry(DISC.radius, NOVA_SEGMENTS);
    const count = positions.length / 3;
    assert.equal(count, (NOVA_SEGMENTS + 1) * NOVA_PROFILE.length);
    assert.equal(uvs.length, count * 2);
    let maxR = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
        const [x, y, z] = positions.slice(i * 3, i * 3 + 3);
        maxR = Math.max(maxR, Math.hypot(x, z));
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    assert.ok(Math.abs(maxR - DISC.radius) < 1e-9);
    assert.ok(Math.abs(minY) < 1e-9);
    assert.ok(maxY > 0.02 && maxY < 0.035, `thickness ${maxY}`);
    const p = (k) => positions.slice(k * 3, k * 3 + 3);
    const centre = [0, maxY / 2, 0];
    for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [p(indices[t]), p(indices[t + 1]), p(indices[t + 2])];
        const u = b.map((v, k) => v - a[k]);
        const v = c.map((w, k) => w - a[k]);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (Math.hypot(...n) < 1e-12) continue; // degenerate fan triangles at the axis
        const mid = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3 - centre[k]);
        assert.ok(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0, `triangle ${t / 3} faces inward`);
    }
});
