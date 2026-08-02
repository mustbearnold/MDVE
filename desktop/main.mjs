import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, dialog } from 'electron';

const HOST = '127.0.0.1';
const READY_TIMEOUT_MS = 15_000;

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

let mainWindow;
let serverOrigin;

function presentWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  app.focus({ steal: true });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error('Could not allocate a loopback port for MDVE'));
      });
    });
  });
}

async function waitForReady(origin) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/_mdve/ready`);
      if (response.ok) return;
      lastError = new Error(`MDVE readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`MDVE server did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function startServer() {
  const appPath = app.getAppPath();
  const packageRoot = basename(appPath) === 'desktop' ? resolve(appPath, '..') : appPath;
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const port = await availablePort();
  const token = randomBytes(32).toString('hex');
  serverOrigin = `http://${HOST}:${port}`;

  process.env.MDVE_AUTH_REQUIRED = '1';
  process.env.MDVE_BOOTSTRAP_TOKEN = token;
  process.env.MDVE_HOST = HOST;
  process.env.MDVE_PORT = String(port);
  process.env.MDVE_VERSION = packageJson.version;
  process.env.MDVE_WEB_DIST = join(packageRoot, 'dist', 'web');

  await import(pathToFileURL(join(packageRoot, 'dist', 'server', 'index.js')).href);
  await waitForReady(serverOrigin);
  return `${serverOrigin}/_auth/bootstrap?token=${token}`;
}

async function createWindow() {
  if (!serverOrigin) {
    const bootstrapUrl = await startServer();
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 980,
      minHeight: 640,
      show: true,
      backgroundColor: '#0b0f14',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.once('ready-to-show', presentWindow);
    await mainWindow.loadURL(bootstrapUrl);
    presentWindow();
  } else if (!mainWindow) {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 980,
      minHeight: 640,
      show: true,
      backgroundColor: '#0b0f14',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.once('ready-to-show', presentWindow);
    await mainWindow.loadURL(serverOrigin);
    presentWindow();
  }
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    presentWindow();
  });

  app.whenReady().then(createWindow).catch((error) => {
    console.error(error);
    dialog.showErrorBox('MDVE could not start', error instanceof Error ? error.message : String(error));
    app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow) void createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
