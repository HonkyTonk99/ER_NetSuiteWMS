#!/usr/bin/env node
/**
 * CI guard for CLAUDE.md invariant #13 (D-07 / AD-16 / T-2.7): NetSuite has no
 * bins, so bin constructs must never leak into WMS code — OR into the planning
 * docs, where an identifier reads as a build instruction, not commentary.
 *
 * Three scopes:
 *   1. src/ *.js            — hard fail on NetSuite bin code identifiers.
 *   2. docs/ + tasks/ *.md  — TIER 1 hard fail on NetSuite code identifiers
 *                             (no exemptions, no markers — a bare identifier in a
 *                             planning doc is a build instruction; write the concept
 *                             in prose, e.g. "the NetSuite bin-number field").
 *   3. docs/ + tasks/ *.md  — TIER 2 warn-only: conceptual terms printed for review
 *                             each pass, never blocking.
 *
 * NOTE — the WMS `BIN_TRANSFER` scan-event enum (uppercase, underscore) is a
 * legitimate WMS event type and is UNRELATED to the NetSuite `bintransfer` record.
 * The Tier-1 patterns are written to NOT match it (`/bintransfer/i` has no
 * underscore; the enum has one). Do not "fix" the enum.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DOC_DIRS = ['docs', 'tasks'].map((d) => path.join(ROOT, d));

// NetSuite bin code identifiers — banned in code AND in planning-doc prose.
const CODE_IDENTIFIERS = [
    { re: /binnumber/i, why: "'binnumber' — the NetSuite bin-number field does not exist under D-07 (write it in prose)" },
    { re: /bintransfer/i, why: "'bintransfer' — the NetSuite bin-transfer record does not exist under D-07 (the WMS BIN_TRANSFER event enum, with underscore, is fine)" },
    { re: /record\.Type\.BIN_TRANSFER/, why: 'record.Type.BIN_TRANSFER — NetSuite Bin Transfer record type does not exist under D-07' },
    { re: /custrecord_[a-z_]*bin_?number/i, why: 'a custrecord bin-number field — no bin dimension exists under D-07' },
    { re: /issueinventorynumber/i, why: "'issueinventorynumber' with bins — the F-19 pattern; use the ledger adapter (T-2.7)" },
];

// Tier 2: conceptual terms — warn only, printed for review, never blocking.
const CONCEPTUAL = [
    /Bin Management/i,
    /Bin Transfer/, // the phrase (space); the BIN_TRANSFER enum has an underscore and is not matched
    /\bserial/i,
    /five-tier/i,
    /capability model/i,
    /dependency graph/i,
    /compare-and-set/i,
];

function walk(dir, ext) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full, ext));
        else if (entry.isFile() && entry.name.endsWith(ext)) out.push(full);
    }
    return out;
}

const rel = (f) => path.relative(ROOT, f);
const hardFails = [];
const warnings = [];

// Scope 1: src/ *.js
for (const file of walk(SRC, '.js')) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        for (const rule of CODE_IDENTIFIERS) {
            if (rule.re.test(line)) hardFails.push({ scope: 'src', file: rel(file), line: i + 1, why: rule.why, text: line.trim() });
        }
    });
}

// Scopes 2 & 3: docs/ + tasks/ *.md
for (const dir of DOC_DIRS) {
    for (const file of walk(dir, '.md')) {
        fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
            for (const rule of CODE_IDENTIFIERS) {
                if (rule.re.test(line)) hardFails.push({ scope: 'doc(T1)', file: rel(file), line: i + 1, why: rule.why, text: line.trim() });
            }
            for (const re of CONCEPTUAL) {
                if (re.test(line)) warnings.push({ file: rel(file), line: i + 1, term: (line.match(re) || [''])[0], text: line.trim() });
            }
        });
    }
}

// Tier 2 — warn only, printed, never blocks.
if (warnings.length) {
    console.log(`\nguard [Tier 2, warn-only]: ${warnings.length} conceptual-term mention(s) in docs/tasks — review, do not gate:`);
    const byTerm = {};
    for (const w of warnings) byTerm[w.term.toLowerCase()] = (byTerm[w.term.toLowerCase()] || 0) + 1;
    for (const [term, n] of Object.entries(byTerm).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${term}`);
}

// Tier 1 + src — hard fail.
if (hardFails.length) {
    console.error('\nForbidden NetSuite bin code identifiers (invariant #13, D-07) — HARD FAIL:\n');
    for (const v of hardFails) {
        console.error(`  [${v.scope}] ${v.file}:${v.line}  ${v.why}`);
        console.error(`      > ${v.text}`);
    }
    console.error(`\n${hardFails.length} violation(s). A bin identifier in code or a planning doc is a build instruction — write the concept in prose.\n`);
    process.exit(1);
}

console.log('guard: no forbidden bin identifiers in src/, docs/ or tasks/.');
process.exit(0);
