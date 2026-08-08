/**
 * Test stub for N/runtime. Governance and feature checks default to
 * benign values; override per-test to exercise yield/feature-gated paths.
 */
module.exports = {
    getCurrentScript: function () {
        return {
            getRemainingUsage: function () { return 10000; },
            getParameter: function () { return null; },
            id: 'customscript_stub',
            deploymentId: 'customdeploy_stub',
        };
    },
    getCurrentUser: function () {
        return { id: -1, role: -1, location: -1 };
    },
    // Bin Management must be OFF (D-07 / T-0.1). Default reflects that.
    isFeatureInEffect: function () { return false; },
};
