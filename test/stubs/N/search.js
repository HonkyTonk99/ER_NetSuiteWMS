/**
 * Test stub for N/search. Returns empty result sets by default. Override with
 * jest spies when a test needs specific rows.
 *
 * Reminder: searches are banned on the ingestion success path (CLAUDE.md
 * invariant #3 / AD-04). This stub exists for the commit/reporting paths that
 * legitimately search.
 */
function fakeResultSet() {
    return {
        each: function () {},
        getRange: function () { return []; },
        run: function () { return fakeResultSet(); },
    };
}

module.exports = {
    create: function () { return fakeResultSet(); },
    load: function () { return fakeResultSet(); },
    lookupFields: function () { return {}; },
    Type: {},
    Operator: {},
    Summary: {},
};
