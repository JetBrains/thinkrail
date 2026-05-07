import { app } from 'electron';

// electron-updater is only loaded for packaged builds. In dev it's a no-op.
// macOS auto-update requires a code-signed app: without signing,
// checkForUpdatesAndNotify() throws "Could not get code signature for running
// application" on every launch. Until signing is wired up we skip the call
// entirely on darwin to keep the log clean. Linux AppImage and Windows NSIS
// work unsigned.

export function initAutoUpdate(): void {
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') return;

  let autoUpdater: typeof import('electron-updater').autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('electron-updater not available:', err);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.warn('Auto-update error:', err);
  });
  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version, '— will install on quit');
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.warn('checkForUpdatesAndNotify failed:', err);
  });
}
