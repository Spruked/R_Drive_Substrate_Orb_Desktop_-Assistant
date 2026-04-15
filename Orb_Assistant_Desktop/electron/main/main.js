const { app, BrowserWindow, ipcMain, screen, protocol, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const {
  startOrb,
  sendCursorMove,
  queryOrb,
  researchOrb,
  speakOrb,
  listenOnce,
  setListening,
  getOrbStatus,
  setOrbState,
  serviceOrb,
  shutdownOrb,
  onOrbMessage,
} = require('./orb-bridge');

const instanceId = process.env.ORB_INSTANCE_ID || 'wsl';
const productName = process.env.ORB_PRODUCT_NAME || `Orb Assistant ${instanceId.toUpperCase()}`;
const appId = process.env.ORB_APP_ID || `com.orbassistant.${instanceId}`;
const localStateDirName =
  process.env.ORB_USER_DATA_DIR ||
  process.env.ORB_LOCAL_STATE_DIR ||
  (instanceId === 'wsl' ? '.orb-assistant' : `.orb-assistant-${instanceId}`);
const userDataPath = path.resolve(__dirname, '..', localStateDirName);
const singleInstanceEnabled = process.env.ORB_SINGLE_INSTANCE !== '0';

app.setName(productName);
app.setPath('userData', userDataPath);
if (process.platform === 'win32' && app.setAppUserModelId) {
  app.setAppUserModelId(appId);
}

function resolvePythonPath() {
  if (process.env.ORB_PYTHON_PATH) {
    return process.env.ORB_PYTHON_PATH;
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const candidates = [
      path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python313', 'python.exe'),
    ];
    const match = candidates.find((candidate) => fs.existsSync(candidate));
    if (match) {
      return match;
    }
  }
  return process.platform === 'linux' ? '/home/bryan/pro_prime_env/bin/python' : 'python';
}

const pythonPath = resolvePythonPath();
const skinIngestScript = path.join(__dirname, '../src/ingest_skin.py');
const singleInstanceLock = singleInstanceEnabled ? app.requestSingleInstanceLock() : true;
const IS_LINUX = process.platform === 'linux';

if (process.env.ORB_IGNORE_GPU_BLOCKLIST === '1') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}
if (process.env.ORB_ENABLE_GPU_RASTERIZATION === '1') {
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}
if (process.env.ORB_DISABLE_GPU_SANDBOX === '1') {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}
if (process.env.ORB_USE_GL) {
  app.commandLine.appendSwitch('use-gl', process.env.ORB_USE_GL);
}
if (process.env.ORB_USE_ANGLE) {
  app.commandLine.appendSwitch('use-angle', process.env.ORB_USE_ANGLE);
}

// Default NVIDIA-friendly GPU boosts unless explicitly disabled
if (process.platform === 'win32' && process.env.ORB_DISABLE_GPU_DEFAULTS !== '1') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
  app.commandLine.appendSwitch('enable-accelerated-video-encode');
  app.commandLine.appendSwitch('use-angle', 'd3d11');
  app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,UseSkiaRenderer,SurfaceControl');
}

if (!singleInstanceLock) {
  app.quit();
}

const orbWindows = new Map();
let dockStationWindow = null;
let orbMessageListenerAttached = false;
let topmostWatchdogInterval = null;
let desktopCursorInterval = null;
let currentOrbSkin = null;
let currentOrbSkinConfig = null;
let skinVaultDir = null;
let skinMetadataDir = null;
let tray = null;
let orbVisible = true;
let lastTopmostRefreshAt = 0;
let activeDisplayId = null;
const DOCK_TRANSITION_MS = 420;
const DOCK_ACK_MS = 90;
const DOCK_TRAVEL_MS = 220;
const DOCK_LOCK_MS = 110;
let dockTransitionActive = false;
let dockTransitionPending = new Set();
let dockTransitionTimeout = null;

function parsePositiveIntEnv(name, fallback, minValue = 1) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallback;
  }
  return parsed;
}

const TOPMOST_WATCHDOG_MS = parsePositiveIntEnv('ORB_TOPMOST_WATCHDOG_MS', 250, 50);
const TOPMOST_REFRESH_MS = parsePositiveIntEnv('ORB_TOPMOST_REFRESH_MS', 2500, 250);
const CURSOR_SAMPLE_MS = parsePositiveIntEnv('ORB_CURSOR_SAMPLE_MS', 16, 8);
const PRIMARY_DISPLAY_ONLY = process.env.ORB_PRIMARY_DISPLAY_ONLY === '1';

function isBrokenPipeError(error) {
  return Boolean(
    error &&
      (
        error.code === 'EPIPE' ||
        error.errno === 'EPIPE' ||
        /broken pipe/i.test(String(error.message || ''))
      )
  );
}

function canWriteToConsole(method) {
  const stream = method === 'warn' || method === 'error'
    ? process.stderr
    : process.stdout;

  return Boolean(
    stream &&
    typeof stream.write === 'function' &&
    !stream.destroyed &&
    stream.writable !== false
  );
}

function safeMainConsole(method, ...args) {
  if (!canWriteToConsole(method)) {
    return;
  }

  try {
    const fn = console[method] || console.log;
    fn(...args);
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  }
}

function installMainProcessPipeGuards() {
  const guard = (error) => {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  };

  if (process.stdout && typeof process.stdout.on === 'function') {
    process.stdout.on('error', guard);
  }

  if (process.stderr && typeof process.stderr.on === 'function') {
    process.stderr.on('error', guard);
  }

  process.on('uncaughtException', (error) => {
    if (isBrokenPipeError(error)) {
      return;
    }

    safeMainConsole('error', 'Uncaught exception in Electron main process:', error);
    app.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    if (isBrokenPipeError(reason)) {
      return;
    }

    safeMainConsole('error', 'Unhandled rejection in Electron main process:', reason);
  });
}

installMainProcessPipeGuards();

function logGpuStatus(stage) {
  try {
    safeMainConsole('log', `[GPU:${stage}]`, app.getGPUFeatureStatus());
  } catch (error) {
    safeMainConsole('warn', `[GPU:${stage}] failed to read GPU feature status:`, error.message);
  }
}

function getOrbWindows() {
  return Array.from(orbWindows.values()).filter((win) => win && !win.isDestroyed());
}

function forEachOrbWindow(callback) {
  getOrbWindows().forEach(callback);
}

function getPrimaryOrbWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  return orbWindows.get(primaryDisplay.id) || getOrbWindows()[0] || null;
}

function getWindowDisplayId(win) {
  return win && !win.isDestroyed() ? win.__orbDisplayId : null;
}

function getEventWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) || getPrimaryOrbWindow();
}

function ensureSkinVault() {
  if (skinVaultDir && skinMetadataDir) {
    return;
  }

  skinVaultDir = path.join(app.getPath('userData'), 'skins');
  skinMetadataDir = path.join(skinVaultDir, 'metadata');
  fs.mkdirSync(skinVaultDir, { recursive: true });
  fs.mkdirSync(skinMetadataDir, { recursive: true });
}

function registerSkinProtocol() {
  protocol.registerFileProtocol('orb-skin', (request, callback) => {
    try {
      ensureSkinVault();
      const relativePath = decodeURIComponent(request.url.replace('orb-skin://', ''));
      const resolvedPath = path.resolve(skinVaultDir, relativePath);

      if (!resolvedPath.startsWith(skinVaultDir)) {
        callback({ error: -10 });
        return;
      }

      callback(resolvedPath);
    } catch (error) {
      callback({ error: -2 });
    }
  });
}

function toSkinUrl(filename) {
  return filename ? `orb-skin://${encodeURIComponent(filename)}` : null;
}

function ingestSkinWithPython(sourcePath) {
  ensureSkinVault();

  return new Promise((resolve, reject) => {
    const proc = spawn(
      pythonPath,
      ['-u', skinIngestScript, '--source', sourcePath, '--skins-dir', skinVaultDir],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Skin ingest failed with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`Invalid ingest response: ${stdout.trim()}`));
      }
    });
  });
}

function ensureTopmost(forceRefresh = false) {
  const windows = getOrbWindows();
  if (!windows.length || !orbVisible) {
    return;
  }

  const now = Date.now();
  const shouldRefresh = forceRefresh || now - lastTopmostRefreshAt >= TOPMOST_REFRESH_MS;

  if (shouldRefresh) {
    windows.forEach((win) => {
      win.setAlwaysOnTop(false);
    });
    lastTopmostRefreshAt = now;
  }

  windows.forEach((win) => {
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (!win.isVisible() && orbVisible) {
      win.showInactive();
    }
    win.moveTop();
  });
}

function setOrbMousePassthroughForWindow(win, ignore, options) {
  if (!win || win.isDestroyed()) {
    return;
  }

  const shouldIgnore = Boolean(ignore);

  if (IS_LINUX) {
    const shouldBeFocusable = !shouldIgnore && orbVisible;
    if (win.isFocusable() !== shouldBeFocusable) {
      win.setFocusable(shouldBeFocusable);
    }
    if (!shouldBeFocusable) {
      win.blur();
    }
  }

  win.setIgnoreMouseEvents(shouldIgnore, shouldIgnore ? (options || { forward: true }) : undefined);
  ensureTopmost(!shouldIgnore);
}

function broadcastCursorPosition(cursor) {
  const windows = getOrbWindows();
  if (!windows.length || !orbVisible) {
    return;
  }

  const previousActiveDisplayId = activeDisplayId;

  const windowStates = windows.map((win) => {
    const bounds = win.getBounds();
    const containsCursor =
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height;

    const dx =
      cursor.x < bounds.x
        ? bounds.x - cursor.x
        : cursor.x > bounds.x + bounds.width
          ? cursor.x - (bounds.x + bounds.width)
          : 0;
    const dy =
      cursor.y < bounds.y
        ? bounds.y - cursor.y
        : cursor.y > bounds.y + bounds.height
          ? cursor.y - (bounds.y + bounds.height)
          : 0;
    const distanceToBounds = Math.hypot(dx, dy);

    return {
      win,
      bounds,
      containsCursor,
      distanceToBounds,
      displayId: getWindowDisplayId(win),
    };
  });

  let activeWindowState = windowStates.find((state) => state.containsCursor) || null;
  if (!activeWindowState) {
    activeWindowState = windowStates
      .slice()
      .sort((a, b) => a.distanceToBounds - b.distanceToBounds)[0] || null;
  }

  activeDisplayId = activeWindowState?.displayId ?? null;

  windowStates.forEach((state) => {
    const isActiveDisplay = activeWindowState && state.win === activeWindowState.win;

    if (!isActiveDisplay && previousActiveDisplayId !== activeDisplayId) {
      setOrbMousePassthroughForWindow(state.win, true, { forward: true });
    }

    state.win.webContents.send(
      'orb:position-update',
      isActiveDisplay
        ? {
            active: true,
            x: cursor.x - state.bounds.x,
            y: cursor.y - state.bounds.y,
          }
        : { active: false }
    );
  });
}

function sampleDesktopCursor() {
  if (!getOrbWindows().length || !orbVisible) {
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  sendCursorMove(cursor.x, cursor.y);
  broadcastCursorPosition(cursor);
}

function startWindowTracking() {
  if (topmostWatchdogInterval || desktopCursorInterval) {
    return;
  }

  ensureTopmost();
  sampleDesktopCursor();
  desktopCursorInterval = setInterval(sampleDesktopCursor, CURSOR_SAMPLE_MS);
  topmostWatchdogInterval = setInterval(() => ensureTopmost(false), TOPMOST_WATCHDOG_MS);
}

function stopWindowTracking() {
  if (topmostWatchdogInterval) {
    clearInterval(topmostWatchdogInterval);
    topmostWatchdogInterval = null;
  }

  if (desktopCursorInterval) {
    clearInterval(desktopCursorInterval);
    desktopCursorInterval = null;
  }
}

function createTrayIcon() {
  const trayIconPath = path.join(__dirname, '..', 'CALIOrb512.png');
  if (fs.existsSync(trayIconPath)) {
    const iconImage = nativeImage.createFromPath(trayIconPath);
    if (!iconImage.isEmpty()) {
      // Windows tray icons render best when explicitly sized small.
      return iconImage.resize({ width: 20, height: 20 });
    }
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <defs>
        <radialGradient id="g" cx="35%" cy="30%" r="65%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
          <stop offset="28%" stop-color="#67c6ff" stop-opacity="0.98" />
          <stop offset="100%" stop-color="#08111f" stop-opacity="1" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="23" fill="url(#g)" />
      <circle cx="24" cy="22" r="8" fill="#ffffff" fill-opacity="0.28" />
    </svg>
  `;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Talk to Orb',
      click: () => openDockStationWindow(),
    },
    {
      label: 'Open Dock Station',
      click: () => openDockStationWindow(),
    },
    { type: 'separator' },
    {
      label: orbVisible ? 'Dock Orb' : 'Launch Orb',
      click: () => toggleOrbVisibility(),
    },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(orbVisible ? `${productName}: Active` : `${productName}: Docked`);
}

function clearDockTransitionState() {
  dockTransitionActive = false;
  dockTransitionPending.clear();
  if (dockTransitionTimeout) {
    clearTimeout(dockTransitionTimeout);
    dockTransitionTimeout = null;
  }
}

function hideOrbImmediately() {
  const windows = getOrbWindows();
  if (!windows.length) {
    return;
  }

  orbVisible = false;
  stopWindowTracking();
  windows.forEach((win) => {
    setOrbMousePassthroughForWindow(win, true, { forward: true });
    win.webContents.send('orb:visibility-changed', { visible: false });
    win.hide();
  });
  if (dockStationWindow && !dockStationWindow.isDestroyed()) {
    dockStationWindow.webContents.send('orb:visibility-changed', { visible: false });
  }
  updateTrayMenu();
}

function beginDockTransition() {
  const windows = getOrbWindows();
  if (!windows.length) {
    hideOrbImmediately();
    return;
  }

  clearDockTransitionState();
  dockTransitionActive = true;
  dockTransitionPending = new Set(windows.map((win) => win.webContents.id));

  windows.forEach((win) => {
    win.webContents.send('orb:dock-transition', {
      phase: 'start',
      totalMs: DOCK_TRANSITION_MS,
      ackMs: DOCK_ACK_MS,
      travelMs: DOCK_TRAVEL_MS,
      lockMs: DOCK_LOCK_MS,
    });
  });

  dockTransitionTimeout = setTimeout(() => {
    clearDockTransitionState();
    hideOrbImmediately();
  }, DOCK_TRANSITION_MS + 380);
}

function completeDockTransitionForSender(webContentsId) {
  if (!dockTransitionActive) {
    return;
  }

  dockTransitionPending.delete(webContentsId);
  if (dockTransitionPending.size > 0) {
    return;
  }

  clearDockTransitionState();
  hideOrbImmediately();
}

function openDockStationWindow() {
  if (dockStationWindow && !dockStationWindow.isDestroyed()) {
    dockStationWindow.show();
    dockStationWindow.focus();
    return dockStationWindow;
  }

  dockStationWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: `${productName} - Dock Station`,
    backgroundColor: '#020712',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  dockStationWindow.loadFile(path.join(__dirname, '../src/ui/orb-dock-station.html'));

  dockStationWindow.once('ready-to-show', () => {
    if (!dockStationWindow || dockStationWindow.isDestroyed()) {
      return;
    }
    dockStationWindow.show();
    dockStationWindow.webContents.send('orb:visibility-changed', { visible: orbVisible });
  });

  dockStationWindow.on('closed', () => {
    dockStationWindow = null;
  });

  return dockStationWindow;
}

function showOrb() {
  const windows = getOrbWindows();
  if (!windows.length) {
    return;
  }

  if (dockTransitionActive) {
    windows.forEach((win) => {
      win.webContents.send('orb:dock-transition', { phase: 'cancel' });
    });
    clearDockTransitionState();
  }

  orbVisible = true;
  windows.forEach((win) => {
    win.showInactive();
    setOrbMousePassthroughForWindow(win, true, { forward: true });
    win.webContents.send('orb:visibility-changed', { visible: true });
  });
  if (dockStationWindow && !dockStationWindow.isDestroyed()) {
    dockStationWindow.webContents.send('orb:visibility-changed', { visible: true });
  }
  ensureTopmost(true);
  startWindowTracking();
  sampleDesktopCursor();
  updateTrayMenu();
}

function hideOrb({ immediate = false } = {}) {
  if (immediate || process.env.ORB_DISABLE_DOCK_TRANSITION === '1') {
    clearDockTransitionState();
    hideOrbImmediately();
    return;
  }

  if (dockTransitionActive) {
    return;
  }

  beginDockTransition();
}

function toggleOrbVisibility(forceVisible) {
  const nextVisible = typeof forceVisible === 'boolean' ? forceVisible : !orbVisible;
  if (nextVisible) {
    showOrb();
  } else {
    hideOrb();
  }
}

function createTray() {
  if (tray) {
    return;
  }

  tray = new Tray(createTrayIcon());
  tray.on('double-click', () => openDockStationWindow());
  tray.on('click', () => openDockStationWindow());
  updateTrayMenu();
}

function buildSearchUrl(query, mode = 'web') {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[a-z0-9-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  const encoded = encodeURIComponent(trimmed);
  if (mode === 'shopping') {
    return `https://www.google.com/search?tbm=shop&q=${encoded}`;
  }

  return `https://www.google.com/search?q=${encoded}`;
}

let startupGreetingDone = false;

function broadcastChatMessage(text, role = 'orb') {
  const targets = [...getOrbWindows()];
  if (dockStationWindow && !dockStationWindow.isDestroyed()) {
    targets.push(dockStationWindow);
  }
  const payload = { role, text, time: new Date().toTimeString().slice(0, 8) };
  targets.forEach((win) => {
    win.webContents.send('orb:chat-message', payload);
  });
}

function forwardOrbMessage(message) {
  const orbWindowsList = getOrbWindows();
  const targets = [...orbWindowsList];
  if (dockStationWindow && !dockStationWindow.isDestroyed()) {
    targets.push(dockStationWindow);
  }

  if (!targets.length) {
    return;
  }

  targets.forEach((win) => {
    win.webContents.send('orb:bridge-message', message);

    if (message.type === 'cognitive_pulse') {
      win.webContents.send('orb:cognitive-pulse', message.data);
    } else if (message.type === 'speech_pulse') {
      win.webContents.send('orb:speech-pulse', message);
    } else if (message.type === 'verbal_command') {
      win.webContents.send('orb:verbal-command', message);
    } else if (message.type === 'status_response') {
      win.webContents.send('orb:status-change', message.data);
    } else if (message.type === 'ready') {
      win.webContents.send('orb:status-change', {
        running: true,
        controller_status: 'ready',
      });
    } else if (message.type === 'hysteresis') {
      win.webContents.send('orb:hysteresis', message.data);
    }
  });

  if (message.type === 'verbal_command') {
    if (message.command === 'show_orb') {
      showOrb();
    } else if (message.command === 'dock_orb') {
      hideOrb();
    } else if (message.command === 'toggle_visibility') {
      toggleOrbVisibility();
    }
  }

  if (message.type === 'ready' && !startupGreetingDone) {
    startupGreetingDone = true;
    const greetingText = "Hello Bryan, I'm online and ready to assist.";
    speakOrb(greetingText, 'thoughtful_warm').catch(() => {});
    // Give the bridge a moment to initialize before showing the greeting
    setTimeout(() => broadcastChatMessage(greetingText, 'orb'), 800);
  }
}

function forwardOrbSkin() {
  const targets = getOrbWindows();
  if (dockStationWindow && !dockStationWindow.isDestroyed()) {
    targets.push(dockStationWindow);
  }

  targets.forEach((win) => {
    win.webContents.send('orb:skin-updated', {
      imageUrl: currentOrbSkin,
    });
  });
}

function forwardOrbSkinConfig() {
  const targets = getOrbWindows();
  if (dockStationWindow && !dockStationWindow.isDestroyed()) {
    targets.push(dockStationWindow);
  }
  targets.forEach((win) => {
    win.webContents.send('orb:skin-config-updated', currentOrbSkinConfig);
  });
}

// Watch orb mesh for skin apply requests written by the gallery
const MESH_SKIN_APPLY_PATH = path.join(
  process.env.ORB_SHARED_MESH_ROOT || path.join('R:', 'orb_mesh'),
  'tasks', 'broadcast', 'skin_apply_pending.json'
);
let meshSkinApplyMtime = null;
setInterval(() => {
  try {
    const stat = fs.statSync(MESH_SKIN_APPLY_PATH);
    if (meshSkinApplyMtime === null || stat.mtimeMs > meshSkinApplyMtime) {
      meshSkinApplyMtime = stat.mtimeMs;
      const raw = fs.readFileSync(MESH_SKIN_APPLY_PATH, 'utf8');
      const config = JSON.parse(raw);
      if (config && (config.colorScheme || config.name)) {
        currentOrbSkinConfig = config;
        forwardOrbSkinConfig();
        safeMainConsole('log', `[Skin] Applied from mesh: ${config.name || config.colorScheme}`);
      }
    }
  } catch (_e) {
    // File doesn't exist yet — that's expected until gallery writes one
  }
}, 2000);

function ensureOrbListeners() {
  if (orbMessageListenerAttached) {
    return;
  }

  onOrbMessage(forwardOrbMessage);
  orbMessageListenerAttached = true;
}

function createOrbWindowForDisplay(display) {
  const { x, y, width, height } = display.bounds;

  const orbWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: !IS_LINUX,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    ...(IS_LINUX ? { type: 'toolbar' } : {}),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  orbWindow.__orbDisplayId = display.id;
  orbWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  orbWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  orbWindow.loadFile(path.join(__dirname, '../src/orb-shell.html'));

  orbWindow.once('ready-to-show', () => {
    if (orbVisible) {
      orbWindow.showInactive();
    }
    setOrbMousePassthroughForWindow(orbWindow, true, { forward: true });
    orbWindow.setHasShadow(false);
    orbWindow.webContents.send('orb:visibility-changed', { visible: orbVisible });
    ensureTopmost(true);
    startWindowTracking();
    forwardOrbSkin();
    updateTrayMenu();
    sampleDesktopCursor();
  });

  orbWindow.on('blur', () => ensureTopmost(true));
  orbWindow.on('show', () => ensureTopmost(true));
  orbWindow.on('restore', () => ensureTopmost(true));
  orbWindow.on('focus', () => ensureTopmost(true));
  orbWindow.on('move', () => ensureTopmost(false));
  orbWindow.on('resize', () => ensureTopmost(false));

  orbWindow.on('closed', () => {
    orbWindows.delete(display.id);
    if (!getOrbWindows().length) {
      stopWindowTracking();
    }
  });

  orbWindows.set(display.id, orbWindow);
  return orbWindow;
}

function getTargetDisplays() {
  const displays = screen.getAllDisplays();
  if (!PRIMARY_DISPLAY_ONLY) {
    return displays;
  }

  const primary = screen.getPrimaryDisplay();
  return primary ? [primary] : displays.slice(0, 1);
}

function syncOrbWindowsToDisplays() {
  const displays = getTargetDisplays();
  const activeIds = new Set(displays.map((display) => display.id));

  displays.forEach((display) => {
    const existing = orbWindows.get(display.id);
    if (existing && !existing.isDestroyed()) {
      existing.__orbDisplayId = display.id;
      existing.setBounds(display.bounds);
      if (!orbVisible && existing.isVisible()) {
        existing.hide();
      }
      return;
    }

    createOrbWindowForDisplay(display);
  });

  for (const [displayId, win] of orbWindows.entries()) {
    if (!activeIds.has(displayId)) {
      orbWindows.delete(displayId);
      if (win && !win.isDestroyed()) {
        win.close();
      }
    }
  }

  if (!activeDisplayId || !activeIds.has(activeDisplayId)) {
    activeDisplayId = screen.getPrimaryDisplay().id;
  }
}

function createWindows() {
  syncOrbWindowsToDisplays();
  ensureOrbListeners();
  startOrb();
}

ipcMain.handle('orb:cursor-move', async (_event, x, y) => sendCursorMove(x, y));
ipcMain.handle('orb-query', async (_event, text) => queryOrb(text));
ipcMain.handle('orb:research', async (_event, query, domains = []) => researchOrb(query, domains));
ipcMain.handle('orb:service-control', async (_event, serviceId, action = 'status') => serviceOrb(serviceId, action));
ipcMain.handle('orb:speak', async (_event, text, emotion) => speakOrb(text, emotion));
ipcMain.handle('orb:open-search', async (_event, query, mode = 'web') => {
  const url = buildSearchUrl(query, mode);
  if (!url) {
    return { ok: false, error: 'Missing query' };
  }

  await shell.openExternal(url);
  return { ok: true, url, mode };
});
ipcMain.handle('orb:listen-once', async () => listenOnce());
ipcMain.handle('orb:set-listening', async (_event, enabled) => setListening(Boolean(enabled)));
ipcMain.handle('orb:get-status', async () => {
  try {
    return await getOrbStatus();
  } catch (error) {
    return {
      ready: false,
      pending: true,
      controller_status: 'starting',
      instance_id: instanceId,
      user_data_path: userDataPath,
      error: error?.message || String(error),
    };
  }
});
ipcMain.handle('orb:set-state', async (_event, setting, value) => setOrbState(setting, value));
ipcMain.handle('orb:dock-transition-complete', async (event) => {
  completeDockTransitionForSender(event.sender.id);
  return { ok: true };
});
ipcMain.handle('orb:get-visibility', async () => ({ visible: orbVisible }));
ipcMain.handle('orb:set-visibility', async (_event, visible) => {
  toggleOrbVisibility(Boolean(visible));
  return { visible: orbVisible };
});
ipcMain.handle('orb:set-skin', async (_event, imageUrl) => {
  const trimmed = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  currentOrbSkin = trimmed || null;
  forwardOrbSkin();
  return { ok: true, imageUrl: currentOrbSkin };
});
ipcMain.handle('orb:set-skin-config', async (_event, config) => {
  currentOrbSkinConfig = (config && typeof config === 'object') ? config : null;
  forwardOrbSkinConfig();
  return { ok: true, config: currentOrbSkinConfig };
});
ipcMain.handle('orb:ingest-skin', async (_event, sourcePath) => {
  const trimmed = typeof sourcePath === 'string' ? sourcePath.trim() : '';
  if (!trimmed) {
    return { ok: false, error: 'Missing source path' };
  }

  const metadata = await ingestSkinWithPython(trimmed);
  currentOrbSkin = toSkinUrl(metadata.filename);
  forwardOrbSkin();

  return {
    ok: true,
    imageUrl: currentOrbSkin,
    metadata,
  };
});
ipcMain.handle('window:minimize', async (event) => {
  const orbWindow = getEventWindow(event);
  if (orbWindow && !orbWindow.isDestroyed()) {
    orbWindow.minimize();
    return true;
  }
  return false;
});
ipcMain.handle('window:close', async () => {
  const windows = getOrbWindows();
  if (!windows.length) {
    return false;
  }

  windows.forEach((win) => win.close());
  return true;
});
ipcMain.handle('window:set-ignore-mouse-events', async (event, ignore, options) => {
  const orbWindow = getEventWindow(event);
  if (orbWindow && !orbWindow.isDestroyed()) {
    setOrbMousePassthroughForWindow(orbWindow, Boolean(ignore), options || undefined);
    return true;
  }
  return false;
});
ipcMain.handle('dock-station:open', async () => {
  openDockStationWindow();
  return { ok: true };
});

ipcMain.handle('orb:chat', async (_event, text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Empty message' };
  }
  broadcastChatMessage(trimmed, 'user');
  try {
    const result = await queryOrb(trimmed);
    const responseText =
      (result && (result.response || (result.data && (result.data.response || result.data.text)) || result.text)) || '';
    if (responseText) {
      broadcastChatMessage(responseText, 'orb');
      speakOrb(responseText, 'thoughtful_warm').catch(() => {});
    }
    return { ok: true, response: responseText };
  } catch (error) {
    broadcastChatMessage('Sorry Bryan, I ran into an issue with that.', 'orb');
    return { ok: false, error: error?.message || String(error) };
  }
});

app.on('ready', createWindows);

app.on('gpu-info-update', () => {
  logGpuStatus('gpu-info-update');
});

app.whenReady().then(() => {
  logGpuStatus('when-ready');
  ensureSkinVault();
  registerSkinProtocol();
  createTray();
  screen.on('display-metrics-changed', () => {
    syncOrbWindowsToDisplays();
    ensureTopmost(true);
    sampleDesktopCursor();
  });
  screen.on('display-added', () => {
    syncOrbWindowsToDisplays();
    ensureTopmost(true);
    sampleDesktopCursor();
  });
  screen.on('display-removed', () => {
    syncOrbWindowsToDisplays();
    ensureTopmost(true);
    sampleDesktopCursor();
  });
});

app.on('second-instance', () => {
  const primaryOrbWindow = getPrimaryOrbWindow();
  if (!primaryOrbWindow || primaryOrbWindow.isDestroyed()) {
    return;
  }

  showOrb();
  if (primaryOrbWindow.isMinimized()) {
    primaryOrbWindow.restore();
  }
  ensureTopmost(true);
});

app.on('browser-window-blur', () => {
  ensureTopmost(true);
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopWindowTracking();
  shutdownOrb();
});

app.on('activate', function () {
  if (!getOrbWindows().length) {
    createWindows();
  }
});
