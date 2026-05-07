import { app, BrowserWindow, dialog, shell } from 'electron';
import { startBackend, BackendHandle } from './backend';
import { importShellEnv } from './shellEnv';
import { initAutoUpdate } from './updater';

// Run before app.whenReady() so any code path that reads process.env
// (paths.ts, ports.ts, credentials.ts, the spawned backend) sees the user's
// real shell env, not the stripped launchd env.
importShellEnv();

let mainWindow: BrowserWindow | null = null;
let backend: BackendHandle | null = null;
let shuttingDown = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap).catch(handleFatal);
}

async function bootstrap(): Promise<void> {
  try {
    backend = await startBackend();
  } catch (err) {
    handleFatal(err);
    return;
  }

  backend.onExit((info) => {
    if (info.expected || shuttingDown) return;
    shuttingDown = true;
    const detail =
      `Exit code: ${info.code ?? 'n/a'}` +
      (info.signal ? ` (signal ${info.signal})` : '') +
      `\nLogs: ${info.logPath}`;
    if (app.isReady()) {
      dialog.showErrorBox('Bonsai backend stopped unexpectedly', detail);
    } else {
      console.error('Bonsai backend stopped unexpectedly:', detail);
    }
    app.exit(1);
  });

  createWindow(backend.url);
  initAutoUpdate();
}

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Bonsai',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (!openUrl.startsWith('http://127.0.0.1:')) {
      shell.openExternal(openUrl);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.loadURL(url).catch(() => {
    // BrowserWindow retries via did-fail-load — handled below
  });

  mainWindow.webContents.on('did-fail-load', (_e, _code, _desc, validatedUrl) => {
    if (shuttingDown) return;
    setTimeout(() => {
      mainWindow?.loadURL(validatedUrl).catch(() => {
        /* try again on next did-fail-load */
      });
    }, 500);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async (event) => {
  if (shuttingDown || !backend) return;
  shuttingDown = true;
  event.preventDefault();
  try {
    await backend.shutdown();
  } finally {
    backend = null;
    app.quit();
  }
});

function handleFatal(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Bonsai failed to start:', message);
  if (app.isReady()) {
    dialog.showErrorBox('Bonsai failed to start', message);
  }
  app.exit(1);
}

