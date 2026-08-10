#!/usr/bin/env node
/*
 * guard-carveout-imports.js — enforces the D-23 boundary in CI.
 *
 * D-23 (2026-08-10) carves EXACTLY THREE tasks out of the T-0.3 register gate so
 * their pure logic can be built and unit-tested before the register closes:
 *
 *     T-6.1   wave clustering        -> wms_lib_clustering.js
 *     T-2.3b  bin policy evaluation  -> wms_lib_bin_policy.js
 *     T-2.6   event handler registry -> wms_lib_event_registry.js
 *
 * The carve-out is NOT "pure logic" as a judgement call. The boundary is
 * mechanical and this script IS the boundary: a carved-out file may not import
 * ANY `N/` module — no N/record, N/search, N/runtime, N/cache, not even N/error.
 * A file that needs a SuiteScript module is, by definition, outside the carve-out
 * and stays held until the register closes. Enforcing it here means the gate
 * holds without anyone having to remember it, and "planning only, no code" stays
 * intact everywhere else by construction.
 *
 * THIS LIST IS THE PRECEDENT BOUNDARY. D-23 grants exactly these three files and
 * creates no precedent — a fourth file joining the carve-out requires a new
 * sponsor ruling (a new D-number), which is a deliberate edit to this array, not
 * a file quietly dropped into a watched directory. Do not add a path here without
 * one.
 *
 * The files do not exist yet (Pass 2 builds them). Until then this guard reports
 * them as pending and passes — but it is in place BEFORE the first line is
 * written, so the boundary can never be crossed by accident.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// The complete, closed set of carved-out files. See header — a fourth entry
// needs a new D-ruling, not just a code change.
const CARVED_OUT = [
    'src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_clustering.js',     // T-6.1
    'src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_bin_policy.js',     // T-2.3b
    'src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_event_registry.js', // T-2.6
];

// Matches an `N/...` module reference inside a quoted string — the form it takes
// in both AMD define([...]) dependency arrays and require('N/...') calls.
const N_IMPORT = /['"]N\/[\w/]+['"]/g;

const failures = [];
let present = 0;

for (const rel of CARVED_OUT) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
        continue; // not yet built — the guard is armed and waiting
    }
    present += 1;
    const source = fs.readFileSync(abs, 'utf8');
    const hits = source.match(N_IMPORT);
    if (hits) {
        const unique = Array.from(new Set(hits.map((h) => h.replace(/['"]/g, ''))));
        failures.push({ rel, modules: unique });
    }
}

if (failures.length > 0) {
    console.error('\nguard [D-23 carve-out]: forbidden N/ import(s) in a carved-out file.');
    console.error('A carved-out module must be pure — it may import NO SuiteScript module.');
    console.error('If it genuinely needs one, it is outside the carve-out and stays held');
    console.error('until the T-0.3 register closes (D-23).\n');
    for (const f of failures) {
        console.error(`    ${f.rel}`);
        console.error(`        imports: ${f.modules.join(', ')}`);
    }
    console.error('');
    process.exit(1);
}

console.log(
    `guard [D-23 carve-out]: ${present}/${CARVED_OUT.length} carved-out file(s) present, ` +
        'none import any N/ module. Boundary intact.'
);
process.exit(0);
