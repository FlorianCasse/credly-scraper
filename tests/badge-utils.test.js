const { test } = require('node:test');
const assert = require('node:assert');

test('getBadgeIssuer prefers the named primary issuer entity', () => {
    let badgeUtils = {};
    try { badgeUtils = require('../badge-utils'); } catch { /* asserted below */ }
    assert.strictEqual(typeof badgeUtils.getBadgeIssuer, 'function');

    const { getBadgeIssuer } = badgeUtils;
    const badge = {
        issuer: {
            entities: [
                { primary: false, entity: { name: 'Secondary issuer' } },
                { primary: true, entity: { name: 'Primary issuer' } },
            ],
        },
        badge_template: { issuer_org_name: 'Legacy issuer' },
    };

    assert.strictEqual(getBadgeIssuer(badge), 'Primary issuer');
});

test('getBadgeIssuer falls back to the first named issuer entity', () => {
    const { getBadgeIssuer } = require('../badge-utils');
    const badge = {
        issuer: {
            entities: [
                { primary: true, entity: { name: '   ' } },
                { entity: { name: 'First named issuer' } },
                { entity: { name: 'Later issuer' } },
            ],
        },
    };

    assert.strictEqual(getBadgeIssuer(badge), 'First named issuer');
});

test('getBadgeIssuer falls back to the legacy badge template issuer', () => {
    const { getBadgeIssuer } = require('../badge-utils');
    const badge = {
        issuer: { entities: [{ entity: {} }] },
        badge_template: { issuer_org_name: 'Legacy issuer' },
    };

    assert.strictEqual(getBadgeIssuer(badge), 'Legacy issuer');
});

test('getBadgeIssuer returns an empty string for missing or malformed badge data', () => {
    const { getBadgeIssuer } = require('../badge-utils');
    const malformedBadges = [
        null,
        undefined,
        {},
        { issuer: null },
        { issuer: { entities: 'not-an-array' } },
        { issuer: { entities: [null, {}, { entity: { name: 42 } }] } },
        { badge_template: { issuer_org_name: 42 } },
    ];

    for (const badge of malformedBadges) {
        assert.strictEqual(getBadgeIssuer(badge), '');
    }
});

test('collectIssuerNames removes duplicates and sorts issuer names', () => {
    const badgeUtils = require('../badge-utils');
    assert.strictEqual(typeof badgeUtils.collectIssuerNames, 'function');
    const { collectIssuerNames } = badgeUtils;
    const badges = [
        { issuer: { entities: [{ entity: { name: 'Red Hat' } }] } },
        { issuer: { entities: [{ entity: { name: 'AWS' } }] } },
        { badge_template: { issuer_org_name: 'Red Hat' } },
        { issuer: { entities: [{ entity: { name: '  AWS  ' } }] } },
        null,
    ];

    assert.deepStrictEqual(collectIssuerNames(badges), ['AWS', 'Red Hat']);
});

test('collectIssuerNames preserves selected names missing from refreshed raw badges', () => {
    const { collectIssuerNames } = require('../badge-utils');
    const badges = [
        { issuer: { entities: [{ entity: { name: 'AWS' } }] } },
    ];

    assert.deepStrictEqual(
        collectIssuerNames(badges, ['Red Hat', 'AWS']),
        ['AWS', 'Red Hat']
    );
});

test('matchesIssuerFilter includes every badge when no issuers are selected', () => {
    const badgeUtils = require('../badge-utils');
    assert.strictEqual(typeof badgeUtils.matchesIssuerFilter, 'function');

    const badge = { issuer: { entities: [{ entity: { name: 'Red Hat' } }] } };
    assert.strictEqual(badgeUtils.matchesIssuerFilter(badge, []), true);
    assert.strictEqual(badgeUtils.matchesIssuerFilter(null, []), true);
});

test('matchesIssuerFilter accepts badges from any selected issuer', () => {
    const { matchesIssuerFilter } = require('../badge-utils');
    const selected = ['AWS', 'Red Hat'];
    const awsBadge = { issuer: { entities: [{ entity: { name: 'AWS' } }] } };
    const redHatBadge = { issuer: { entities: [{ entity: { name: 'Red Hat' } }] } };
    const microsoftBadge = { issuer: { entities: [{ entity: { name: 'Microsoft' } }] } };

    assert.strictEqual(matchesIssuerFilter(awsBadge, selected), true);
    assert.strictEqual(matchesIssuerFilter(redHatBadge, selected), true);
    assert.strictEqual(matchesIssuerFilter(microsoftBadge, selected), false);
});

test('matchesIssuerFilter rejects unknown selected issuers', () => {
    const { matchesIssuerFilter } = require('../badge-utils');
    const badge = { issuer: { entities: [{ entity: { name: 'Red Hat' } }] } };

    assert.strictEqual(matchesIssuerFilter(badge, ['Unknown issuer']), false);
    assert.strictEqual(matchesIssuerFilter(null, ['Unknown issuer']), false);
});

test('shouldClearIssuerFilter clears options only when a populated batch changes', () => {
    const badgeUtils = require('../badge-utils');
    assert.strictEqual(typeof badgeUtils.shouldClearIssuerFilter, 'function');

    assert.strictEqual(badgeUtils.shouldClearIssuerFilter('batch-a', 'batch-b'), true);
    assert.strictEqual(badgeUtils.shouldClearIssuerFilter('batch-a', 'batch-a'), false);
    assert.strictEqual(badgeUtils.shouldClearIssuerFilter('', 'batch-b'), false);
});
