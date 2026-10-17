import assert from 'node:assert/strict';
import test from 'node:test';

import { originAllowed, requestOriginAllowed } from '../server/originPolicy.ts';

const allowed = 'moonshot-csgo.pages.dev,*.moonshot-csgo.pages.dev';

test('same-origin reads may omit Origin while write requests still require an allowed origin', () => {
    assert.equal(requestOriginAllowed(new Request('https://moonshot-csgo.pages.dev/api/leaderboard'), allowed), true);
    assert.equal(requestOriginAllowed(new Request('https://moonshot-csgo.pages.dev/api/signin', { method: 'POST' }), allowed), false);
    assert.equal(
        requestOriginAllowed(
            new Request('https://moonshot-csgo.pages.dev/api/leaderboard', {
                headers: { Origin: 'https://attacker.example' }
            }),
            allowed
        ),
        false
    );
    assert.equal(
        requestOriginAllowed(
            new Request('https://moonshot-csgo.pages.dev/api/signin', {
                method: 'POST',
                headers: { Origin: 'https://moonshot-csgo.pages.dev' }
            }),
            allowed
        ),
        true
    );
    assert.equal(originAllowed(null, allowed), false);
});
