// Issuer helpers shared by the browser and the Node.js test suite.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BadgeUtils = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    function getEntityName(entry) {
        return typeof entry?.entity?.name === 'string' ? entry.entity.name.trim() : '';
    }

    function getBadgeIssuer(badge) {
        const entities = Array.isArray(badge?.issuer?.entities) ? badge.issuer.entities : [];
        const primary = entities.find(entry => entry?.primary && getEntityName(entry));
        if (primary) return getEntityName(primary);

        const firstNamed = entities.find(entry => getEntityName(entry));
        if (firstNamed) return getEntityName(firstNamed);

        return typeof badge?.badge_template?.issuer_org_name === 'string'
            ? badge.badge_template.issuer_org_name.trim()
            : '';
    }

    function collectIssuerNames(badges, selectedIssuers = []) {
        const issuerNames = Array.isArray(badges) ? badges.map(getBadgeIssuer) : [];
        const preservedNames = Array.isArray(selectedIssuers) ? selectedIssuers : [];
        return [...new Set([...issuerNames, ...preservedNames].filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
    }

    function matchesIssuerFilter(badge, selectedIssuers) {
        if (!Array.isArray(selectedIssuers) || selectedIssuers.length === 0) return true;
        return selectedIssuers.includes(getBadgeIssuer(badge));
    }

    function shouldClearIssuerFilter(previousBatchKey, nextBatchKey) {
        return Boolean(previousBatchKey && previousBatchKey !== nextBatchKey);
    }

    // Splits a list into consecutive chunks of at most `size` items, preserving order.
    function chunkList(items, size) {
        if (!Array.isArray(items) || items.length === 0) return [];
        const step = Math.max(1, Math.floor(size) || 0);
        const chunks = [];
        for (let i = 0; i < items.length; i += step) {
            chunks.push(items.slice(i, i + step));
        }
        return chunks;
    }

    return {
        getBadgeIssuer,
        collectIssuerNames,
        matchesIssuerFilter,
        shouldClearIssuerFilter,
        chunkList,
    };
}));
