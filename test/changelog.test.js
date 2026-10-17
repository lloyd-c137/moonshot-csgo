import assert from 'node:assert/strict';
import test from 'node:test';

import { changelogHtml, RELEASES } from '../src/ui/changelog.ts';

test('the changelog lists one entry per version, newest first, each with notes', () => {
    assert.ok(RELEASES.length > 1);
    const parts = (v) => v.slice(1).split('.').map(Number);
    for (let i = 1; i < RELEASES.length; i++) {
        const [a, b] = [parts(RELEASES[i - 1].version), parts(RELEASES[i].version)];
        assert.ok(
            a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2]))),
            RELEASES[i].version
        );
        assert.ok(RELEASES[i - 1].date >= RELEASES[i].date);
    }
    for (const release of RELEASES) {
        assert.match(release.version, /^v\d+\.\d+\.\d+$/);
        assert.match(release.date, /^\d{4}\.\d{2}\.\d{2}$/);
        assert.ok(release.title && release.notes.length > 0);
    }
    const html = changelogHtml();
    assert.equal(html.match(/class="release-entry"/g).length, RELEASES.length);
    assert.equal(html.match(/data-current="true"/g).length, 1);
    assert.equal(html.match(/当前版本/g).length, 1);
    assert.ok(html.indexOf(RELEASES[0].version) < html.indexOf(RELEASES[1].version));
    assert.ok(
        !changelogHtml([{ version: 'v1.0.0', date: '2026.01.01', title: '<script>', notes: ['a&b'] }]).includes(
            '<script>'
        )
    );
});
