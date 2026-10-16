import assert from 'node:assert/strict';
import test from 'node:test';

import { PATROL_ROUTE } from '../src/config/patrol.ts';
import { inTeacherView, PATROL_SECONDS, TEACHER, teacherAt } from '../src/gameplay/teacher.ts';

test('纪老师 patrols the loop continuously, on the route, and repeats each lap', () => {
    assert.ok(PATROL_ROUTE.length >= 6);
    assert.ok(PATROL_SECONDS > 60 && PATROL_SECONDS < 300, `${PATROL_SECONDS}`);
    const start = teacherAt(0);
    assert.deepEqual([start.x, start.z], [...PATROL_ROUTE[0]]);
    const lap = teacherAt(PATROL_SECONDS * 1000 * 3 + 12_345);
    const same = teacherAt(12_345);
    assert.ok(Math.abs(lap.x - same.x) < 1e-6 && Math.abs(lap.z - same.z) < 1e-6);
    // Never jumps: at most walking speed between samples 100 ms apart.
    let previous = teacherAt(0);
    for (let ms = 100; ms < PATROL_SECONDS * 1000; ms += 100) {
        const next = teacherAt(ms);
        assert.ok(Math.hypot(next.x - previous.x, next.z - previous.z) <= TEACHER.speed * 0.1 + 1e-6, `at ${ms}`);
        previous = next;
    }
});

test('his watch is a circle around him: any direction within range, nothing beyond', () => {
    const teacher = { x: 0, z: 0, yaw: 0, walking: true };
    assert.equal(inTeacherView(teacher, 0, -8), true, 'ahead');
    assert.equal(inTeacherView(teacher, 0, 8), true, 'behind too');
    assert.equal(inTeacherView(teacher, -6, 6), true);
    assert.equal(inTeacherView(teacher, TEACHER.range + 0.5, 0), false, 'too far');
});
