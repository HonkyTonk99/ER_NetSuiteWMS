/**
 * Test stub for N/error.
 * Mirrors error.create({ name, message }) — returns an Error carrying the
 * machine-readable name the WMS branches on (CLAUDE.md error convention).
 */
module.exports = {
    create: function (options) {
        options = options || {};
        var e = new Error(options.message || '');
        e.name = options.name || 'ERROR';
        e.message = options.message || '';
        return e;
    },
};
