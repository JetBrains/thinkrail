#!/usr/bin/env node
// Copy the PyInstaller bonsai-dir/ bundle into electron/resources/backend/
// so electron-builder can pick it up via `extraResources`.
//
// Source can be overridden with BONSAI_BACKEND_DIR (e.g. for CI).
// Default: ../packaging/dist/bonsai-dir relative to this script's package.

const fs = require('node:fs');
const path = require('node:path');

const PKG_DIR = path.resolve(__dirname, '..');
const DEFAULT_SRC = path.resolve(PKG_DIR, '..', 'packaging', 'dist', 'bonsai-dir');
const SRC = process.env.BONSAI_BACKEND_DIR
  ? path.resolve(process.env.BONSAI_BACKEND_DIR)
  : DEFAULT_SRC;
const DEST = path.resolve(PKG_DIR, 'resources', 'backend');

if (!fs.existsSync(SRC)) {
  console.error(`stage-backend: source not found: ${SRC}`);
  console.error(
    `Run 'pyinstaller bonsai.spec' in packaging/ first, or set BONSAI_BACKEND_DIR.`,
  );
  process.exit(1);
}

console.log(`stage-backend: ${SRC} -> ${DEST}`);
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true, dereference: true });
console.log('stage-backend: done');
