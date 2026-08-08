#!/usr/bin/env node
/**
 * CI guard for CLAUDE.md invariant #13 (D-07 / AD-16 / T-2.7):
 * NetSuite has no bins, so bin constructs must never appear in WMS code.
 *
 * Scans src/ *.js only and fails the build on any match. Deliberately precise
 * so it does NOT flag legitimate code:
 *   - `BIN_TRANSFER` is a valid WMS scan-event type (underscore) and is allowed;
 *     only the NetSuite `record.Type.BIN_TRANSFER` / 'bintransfer' record type is banned.
 *   - `runtime.isFeatureInEffect(...)` is required by T-0.1 to CONFIRM Bin
 *     Management is OFF, so feature checks are NOT banned.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

const FORBIDDEN = [
    { re: /binnumber/i, why: "'binnumber' — NetSuite has no bin dimension (invariant #13)" },
    { re: /record\.Type\.BIN_TRANSFER/, why: "record.Type.BIN_TRANSFER — Bin Transfer record type does not exist under D-07" },
    { re: /['"]bintransfer['"]/i, why: "'bintransfer' record type string — banned under D-07" },
    { re: /issueinventorynumber/i, why: "'issueinventorynumber' with bins — the F-19 pattern; use the ledger adapter (T-2.7)" },
];

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

if (!fs.existsSync(SRC)) {
    console.log('guard: no src/ directory yet — nothing to scan.');
    process.exit(0);
}

const violations = [];
for (const file of walk(SRC)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
        for (const rule of FORBIDDEN) {
            if (rule.re.test(line)) {
                violations.push({ file: path.relative(path.join(__dirname, '..'), file), line: i + 1, why: rule.why, text: line.trim() });
            }
        }
    });
}

if (violations.length) {
    console.error('\nForbidden bin constructs found in src/ (CLAUDE.md invariant #13, D-07):\n');
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}  ${v.why}`);
        console.error(`      > ${v.text}`);
    }
    console.error(`\n${violations.length} violation(s). NetSuite has no bins — bin movements post nothing.\n`);
    process.exit(1);
}

console.log('guard: no forbidden bin constructs found in src/.');
process.exit(0);
