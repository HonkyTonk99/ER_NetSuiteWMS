/**
 * Test stub for N/cache. get() invokes the provided loader (cache-miss path)
 * so cache-backed getters can be tested without a NetSuite account.
 */
module.exports = {
    getCache: function () {
        return {
            get: function (options) {
                if (options && typeof options.loader === 'function') {
                    return options.loader();
                }
                return null;
            },
            put: function () {},
            remove: function () {},
        };
    },
    Scope: {
        PRIVATE: 'PRIVATE',
        PROTECTED: 'PROTECTED',
        PUBLIC: 'PUBLIC',
    },
};
