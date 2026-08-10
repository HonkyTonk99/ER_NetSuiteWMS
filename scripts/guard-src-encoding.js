#!/usr/bin/env node
/*
 * guard-src-encoding.js — keeps src/ free of the byte-level defects that reached
 * a source file in Pass 2 (a NUL byte used as a delimiter, and a U+FFFF sort
 * sentinel). Both were fixed by hand; this makes the boundary a CONTROL, not a
 * memory — the same reasoning as guard-carveout-imports and guard-forbidden-tokens.
 *
 * Rule: a text file under src/ may contain only
 *   - printable ASCII (0x20..0x7E), and
 *   - tab (0x09) and newline (0x0A).
 * Anything else fails the build:
 *   - other control characters (including NUL 0x00, CR 0x0D, DEL 0x7F), and
 *   - any non-ASCII byte (>= 0x80).
 *
 * Known-binary asset extensions are skipped (a NetSuite File Cabinet may hold
 * images/fonts later); if you add one, list it here deliberately.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

// Binary assets that are legitimately not ASCII text. Empty for now — added
// deliberately, never by default, so a stray binary can't slip in unnoticed.
const BINARY_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf',
    '.woff', '.woff2', '.ttf', '.eot', '.zip',
]);

const ALLOWED_CONTROL = new Set([0x09, 0x0a]); // tab, newline

function walk(dir, out) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (entry.isFile()) {
            out.push(full);
        }
    });
    return out;
}

function scan(file) {
    const buf = fs.readFileSync(file);
    const bad = [];
    let line = 1;
    for (let i = 0; i < buf.length; i += 1) {
        const b = buf[i];
        if (b === 0x0a) { line += 1; }
        const printable = b >= 0x20 && b <= 0x7e;
        if (printable || ALLOWED_CONTROL.has(b)) { continue; }
        bad.push({ offset: i, line: line, byte: b });
        if (bad.length >= 10) { break; } // enough to locate the problem
    }
    return bad;
}

if (!fs.existsSync(SRC_ROOT)) {
    console.log('guard [src-encoding]: no src/ directory — nothing to scan.');
    process.exit(0);
}

const files = walk(SRC_ROOT, []);
let scanned = 0;
let skipped = 0;
const failures = [];

files.forEach((file) => {
    if (BINARY_EXTS.has(path.extname(file).toLowerCase())) {
        skipped += 1;
        return;
    }
    scanned += 1;
    const bad = scan(file);
    if (bad.length > 0) {
        failures.push({ file: path.relative(REPO_ROOT, file), bad: bad });
    }
});

if (failures.length > 0) {
    console.error('\nguard [src-encoding]: forbidden byte(s) in src/ text file(s).');
    console.error('Allowed: printable ASCII, tab and newline only — no NUL/CR/DEL,');
    console.error('no other control chars, no non-ASCII bytes.\n');
    failures.forEach((f) => {
        console.error(`    ${f.file}`);
        f.bad.forEach((h) => {
            console.error(`        line ${h.line}, offset ${h.offset}: 0x${h.byte.toString(16).padStart(2, '0')}`);
        });
    });
    console.error('');
    process.exit(1);
}

console.log(
    `guard [src-encoding]: ${scanned} text file(s) clean (printable ASCII + tab/newline)` +
        (skipped > 0 ? `, ${skipped} binary asset(s) skipped.` : '.')
);
process.exit(0);
