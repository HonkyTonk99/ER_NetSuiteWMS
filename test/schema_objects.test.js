/**
 * Phase 1 G1 gate: SDF objects <-> data model (docs/03).
 * No NetSuite account. Reads the committed src/Objects/*.xml as text and asserts
 * every record this project's data model defines exists with its load-bearing
 * fields and the right concurrency setting. This catches a record or field that
 * was specified in docs/03 but never authored (or renamed and left dangling)
 * BEFORE the sandbox deploy (Phase 14) ever runs.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'Objects');

function xml(scriptid) {
    const p = path.join(dir, `${scriptid}.xml`);
    expect(fs.existsSync(p)).toBe(true);
    return fs.readFileSync(p, 'utf8');
}

// record scriptid -> { fields: [...], optimisticLock?: true }
const RECORDS = {
    customrecord_wms_scan_event: {
        fields: ['custrecord_se_type', 'custrecord_se_sku', 'custrecord_se_qty', 'custrecord_se_location', 'custrecord_se_status'],
    },
    customrecord_wms_config: {
        fields: ['custrecord_cfg_key', 'custrecord_cfg_value', 'custrecord_cfg_location'],
    },
    customrecord_wms_bin: {
        fields: ['custrecord_wb_location', 'custrecord_wb_type', 'custrecord_wb_policy', 'custrecord_wb_zone', 'custrecord_wb_pick_sequence', 'custrecord_wb_blocked', 'custrecord_wb_active'],
    },
    customrecord_wms_bin_state: {
        fields: ['custrecord_bs_bin', 'custrecord_bs_location', 'custrecord_bs_item', 'custrecord_bs_lot', 'custrecord_bs_qty', 'custrecord_bs_version'],
        optimisticLock: true,
    },
    customrecord_wms_bin_policy: {
        fields: ['custrecord_bp_single_sku', 'custrecord_bp_single_batch', 'custrecord_bp_allow_direct_pick', 'custrecord_bp_replen_target', 'custrecord_bp_allow_putaway', 'custrecord_bp_available_for_fulfilment'],
    },
    customrecord_wms_serial_state: {
        fields: ['custrecord_ss_item', 'custrecord_ss_serial', 'custrecord_ss_bin', 'custrecord_ss_location', 'custrecord_ss_status', 'custrecord_ss_generation', 'custrecord_ss_version'],
        optimisticLock: true,
    },
    customrecord_wms_exception: {
        fields: ['custrecord_exc_source_event', 'custrecord_exc_location', 'custrecord_exc_type', 'custrecord_exc_severity', 'custrecord_exc_status'],
    },
    customrecord_wms_operator: {
        fields: ['custrecord_op_code', 'custrecord_op_employee', 'custrecord_op_pin_hash', 'custrecord_op_active', 'custrecord_op_role', 'custrecord_op_tier', 'custrecord_op_access_level', 'custrecord_op_allowed_locations'],
    },
    customrecord_wms_metric_snapshot: {
        fields: ['custrecord_ms_location', 'custrecord_ms_interval_start', 'custrecord_ms_interval_end', 'custrecord_ms_lines_picked', 'custrecord_ms_units_picked', 'custrecord_ms_scans_total'],
    },
};

describe('Phase 1 - SDF record objects exist and match the data model', () => {
    Object.entries(RECORDS).forEach(([scriptid, spec]) => {
        describe(scriptid, () => {
            const content = xml(scriptid);

            test('declares the record type', () => {
                expect(content).toContain(`<customrecordtype scriptid="${scriptid}">`);
                expect(content).toContain('<recordname>');
            });

            test.each(spec.fields)('has field %s', (field) => {
                expect(content).toContain(`scriptid="${field}"`);
            });

            if (spec.optimisticLock) {
                test('enables optimistic locking (concurrency-sensitive)', () => {
                    expect(content).toContain('<enableoptimisticlocking>T</enableoptimisticlocking>');
                });
            }
        });
    });

    test('every authored record field carries a declared fieldtype and label', () => {
        Object.keys(RECORDS).forEach((scriptid) => {
            const content = xml(scriptid);
            const fieldCount = (content.match(/<customrecordcustomfield /g) || []).length;
            const typeCount = (content.match(/<fieldtype>/g) || []).length;
            const labelCount = (content.match(/<label>/g) || []).length;
            expect(typeCount).toBe(fieldCount);
            expect(labelCount).toBe(fieldCount);
        });
    });
});
