import { spawn, ChildProcess, execFile } from 'node:child_process';
import { app } from 'electron';
import * as fs from 'node:fs';
import { backendBinaryPath, backendLogPath } from './paths';
import { reserveFreePort, waitForPort } from './ports';
import { resolveAnthropicApiKey } from './credentials';

export interface BackendExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  expected: boolean;
  logPath: string;
}

export interface BackendHandle {
  port: number;
  url: string;
  shutdown: () => Promise<void>;
  onExit: (cb: (info: BackendExitInfo) => void) => void;
}

const SHUTDOWN_GRACE_MS = 5_000;

export async function startBackend(): Promise<BackendHandle> {
  const binary = backendBinaryPath();
  if (!fs.existsSync(binary)) {
    throw new Error(
      `Backend binary not found at ${binary}. ` +
        `Run 'pyinstaller bonsai.spec' in packaging/ first, ` +
        `or set BONSAI_BACKEND_DIR to point at an existing bonsai-dir/.`,
    );
  }

  const reserved = await reserveFreePort();
  const port = reserved.port;
  const logPath = backendLogPath();
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(
    `\n[${new Date().toISOString()}] Starting backend ${binary} on port ${port}\n`,
  );

  // Resolve Anthropic credentials in the Electron main process before spawning.
  // The unsigned PyInstaller-bundled backend can't reliably read the macOS
  // Keychain when launched from Finder/dock, and Finder-launched Electron has
  // no shell env. See credentials.ts for the full resolution order.
  const apiKey = resolveAnthropicApiKey();
  logStream.write(
    `[${new Date().toISOString()}] ANTHROPIC_API_KEY ${apiKey ? 'resolved' : 'NOT FOUND'} (forwarded to backend env)\n`,
  );

  // Release the port immediately before spawn so the window where another
  // process can grab it is microseconds rather than the millis spent above.
  await reserved.release();

  const child = spawn(
    binary,
    ['--port', String(port), '--host', '127.0.0.1', '--no-browser'],
    {
      cwd: app.getPath('userData'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
      },
      detached: false,
    },
  );

  child.stdout?.pipe(logStream, { end: false });
  child.stderr?.pipe(logStream, { end: false });

  let exited = false;
  let exitCode: number | null = null;
  let shuttingDown = false;
  let exitListener: ((info: BackendExitInfo) => void) | null = null;

  child.once('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    logStream.write(
      `[${new Date().toISOString()}] Backend exited code=${code} signal=${signal}\n`,
    );
    if (exitListener) {
      exitListener({ code, signal, expected: shuttingDown, logPath });
    }
  });

  try {
    await waitForPort(port);
  } catch (err) {
    if (!exited) await killChild(child);
    throw new Error(
      `Backend did not become ready: ${(err as Error).message}. ` +
        `Check logs at ${logPath}.${exitCode !== null ? ` (exit code: ${exitCode})` : ''}`,
    );
  }

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    shutdown: async () => {
      shuttingDown = true;
      await stopBackend(child, logStream);
    },
    onExit: (cb) => {
      exitListener = cb;
      if (exited) cb({ code: exitCode, signal: null, expected: shuttingDown, logPath });
    },
  };
}

async function stopBackend(
  child: ChildProcess,
  logStream: fs.WriteStream,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    logStream.end();
    return;
  }

  try {
    await killChild(child);
  } finally {
    logStream.end();
  }
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, SHUTDOWN_GRACE_MS);

    child.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });

    if (process.platform === 'win32' && child.pid) {
      execFile('taskkill', ['/pid', String(child.pid), '/f', '/t'], () => {
        // exit handler resolves; if it doesn't fire the timer above will
      });
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        // child already gone
      }
    }
  });
}
