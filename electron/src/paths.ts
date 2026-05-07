import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

const BACKEND_DIR_NAME = 'backend';
const BINARY_NAME = process.platform === 'win32' ? 'bonsai.exe' : 'bonsai';

export function backendBinaryPath(): string {
  const override = process.env.BONSAI_BACKEND_DIR;
  if (override) {
    return path.resolve(override, BINARY_NAME);
  }

  if (app.isPackaged) {
    return path.join(process.resourcesPath, BACKEND_DIR_NAME, BINARY_NAME);
  }

  const dev = path.resolve(
    __dirname,
    '..',
    '..',
    'packaging',
    'dist',
    'bonsai-dir',
    BINARY_NAME,
  );
  return dev;
}

export function backendLogPath(): string {
  const dir = app.getPath('logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'backend.log');
}
