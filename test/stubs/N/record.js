/**
 * Test stub for N/record. Returns a chainable fake record so pure logic that
 * happens to touch a record can be exercised without a NetSuite account.
 * Override methods per-test with jest spies where behaviour matters.
 */
function fakeRecord() {
    return {
        setValue: function () { return this; },
        getValue: function () { return undefined; },
        setText: function () { return this; },
        getText: function () { return undefined; },
        getSublistValue: function () { return undefined; },
        setSublistValue: function () { return this; },
        getLineCount: function () { return 0; },
        selectNewLine: function () { return this; },
        selectLine: function () { return this; },
        commitLine: function () { return this; },
        getSubrecord: function () { return fakeRecord(); },
        removeSubrecord: function () { return this; },
        save: function () { return 1; },
    };
}

module.exports = {
    create: function () { return fakeRecord(); },
    load: function () { return fakeRecord(); },
    copy: function () { return fakeRecord(); },
    transform: function () { return fakeRecord(); },
    submitFields: function () { return 1; },
    delete: function () { return 1; },
    Type: {},
};
