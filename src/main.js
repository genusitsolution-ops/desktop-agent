/**
 * RemoteConnect Agent — Main Process (main.js)
 * ──────────────────────────────────────────────
 * Electron main process:
 *  - Shows login/session UI in a window
 *  - Polls server for RC events
 *  - Executes mouse/keyboard at OS level via robotjs
 *  - Lives in system tray when minimized
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, screen } = require('electron');
const path   = require('path');
const fetch  = require('node-fetch');

// ── Try loading robotjs for OS-level input ──
let robot = null;
try {
  robot = require('robotjs');
  robot.setMouseDelay(0);
  robot.setKeyboardDelay(0);
} catch (e) {
  console.warn('[Agent] robotjs not available:', e.message);
}

// ── Config ──
const SERVER_URL    = 'https://www.genusitsolution.com/remoteconnect';
const POLL_INTERVAL = 80;   // ms
const MOVE_THROTTLE = 33;   // ms (30fps mouse moves)

// ── State ──
let mainWindow   = null;
let tray         = null;
let pollTimer    = null;
let sessionId    = null;
let guestId      = 'agent';
let rcEnabled    = false;
let lastMoveTs   = 0;
let screenW      = 1920;
let screenH      = 1080;

// ── Web key → robotjs key map ──
const KEY_MAP = {
  'Enter':      'enter',
  'Backspace':  'backspace',
  'Delete':     'delete',
  'Tab':        'tab',
  'Escape':     'escape',
  'ArrowUp':    'up',
  'ArrowDown':  'down',
  'ArrowLeft':  'left',
  'ArrowRight': 'right',
  'Home':       'home',
  'End':        'end',
  'PageUp':     'pageup',
  'PageDown':   'pagedown',
  'Insert':     'insert',
  'CapsLock':   'caps_lock',
  ' ':          'space',
  'Shift':      'shift',
  'Control':    'control',
  'Alt':        'alt',
  'Meta':       'command',
  'F1':'f1','F2':'f2','F3':'f3','F4':'f4',
  'F5':'f5','F6':'f6','F7':'f7','F8':'f8',
  'F9':'f9','F10':'f10','F11':'f11','F12':'f12',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RC EVENT EXECUTOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function executeRC(evt) {
  if (!rcEnabled || !robot) return;

  const rc  = evt.rc;
  const ax  = Math.round((evt.x || 0) * screenW);
  const ay  = Math.round((evt.y || 0) * screenH);
  const btn = evt.button || 0;

  try {
    switch (rc) {
      case 'mousemove': {
        const now = Date.now();
        if (now - lastMoveTs < MOVE_THROTTLE) return;
        lastMoveTs = now;
        robot.moveMouse(ax, ay);
        break;
      }
      case 'mousedown':
        robot.moveMouse(ax, ay);
        robot.mouseToggle('down', btn === 2 ? 'right' : btn === 1 ? 'middle' : 'left');
        break;
      case 'mouseup':
        robot.mouseToggle('up', btn === 2 ? 'right' : btn === 1 ? 'middle' : 'left');
        break;
      case 'click':
        robot.moveMouse(ax, ay);
        robot.mouseClick('left');
        break;
      case 'dblclick':
        robot.moveMouse(ax, ay);
        robot.mouseClick('left', true);   // double click
        break;
      case 'contextmenu':
        robot.moveMouse(ax, ay);
        robot.mouseClick('right');
        break;
      case 'wheel': {
        const dy = evt.deltaY || 0;
        const dx = evt.deltaX || 0;
        robot.moveMouse(ax, ay);
        if (dy) robot.scrollMouse(0, dy > 0 ? -3 : 3);
        if (dx) robot.scrollMouse(dx > 0 ? -3 : 3, 0);
        break;
      }
      case 'keydown':
        handleKey(evt);
        break;
      case 'keyup':
        // robotjs handles modifiers via keyToggle
        handleKeyUp(evt);
        break;
    }
  } catch (e) {
    console.error('[RC] Error executing', rc, e.message);
  }
}

function handleKey(evt) {
  const key  = evt.key  || '';
  const ctrl  = !!evt.ctrl;
  const shift = !!evt.shift;
  const alt   = !!evt.alt;
  const meta  = !!evt.meta;

  let rKey = KEY_MAP[key];
  if (!rKey) {
    if (key.length === 1) rKey = key.toLowerCase();
    else rKey = key.toLowerCase();
  }

  if (!rKey) return;

  const modifiers = [];
  if (ctrl)  modifiers.push('control');
  if (shift) modifiers.push('shift');
  if (alt)   modifiers.push('alt');
  if (meta)  modifiers.push('command');

  if (modifiers.length > 0) {
    robot.keyTap(rKey, modifiers);
  } else {
    robot.keyTap(rKey);
  }
}

function handleKeyUp(evt) {
  // For modifier keys themselves, toggle them up
  const modMap = { 'Shift':'shift', 'Control':'control', 'Alt':'alt', 'Meta':'command' };
  const m = modMap[evt.key];
  if (m) robot.keyToggle(m, 'up');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POLLING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function pollEvents() {
  if (!sessionId || !rcEnabled) return;
  try {
    const resp = await fetch(`${SERVER_URL}/api/rc_agent_poll.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${sessionId}&guest_id=${guestId}`,
      timeout: 4000,
    });
    if (!resp.ok) return;
    const data = await resp.json();
    for (const evtStr of (data.events || [])) {
      try {
        const evt = typeof evtStr === 'string' ? JSON.parse(evtStr) : evtStr;
        executeRC(evt);
      } catch (_) {}
    }
    // Report back to renderer
    mainWindow?.webContents.send('agent-status', { connected: true, eventsProcessed: data.count || 0 });
  } catch (e) {
    mainWindow?.webContents.send('agent-status', { connected: false, error: e.message });
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollEvents, POLL_INTERVAL);
  console.log('[Agent] Polling started for session', sessionId);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IPC from renderer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ipcMain.on('set-session', (e, data) => {
  sessionId = data.sessionId;
  guestId   = data.guestId || 'agent';
  const sz  = screen.getPrimaryDisplay().size;
  screenW   = sz.width;
  screenH   = sz.height;
  console.log('[Agent] Session set:', sessionId, 'Screen:', screenW, 'x', screenH);
});

ipcMain.on('rc-enable', () => {
  rcEnabled = true;
  startPolling();
  tray?.setToolTip('RemoteConnect Agent — RC Active 🔴');
  console.log('[Agent] RC enabled');
});

ipcMain.on('rc-disable', () => {
  rcEnabled = false;
  stopPolling();
  tray?.setToolTip('RemoteConnect Agent — Connected');
  console.log('[Agent] RC disabled');
});

ipcMain.on('open-session-browser', (e, url) => {
  shell.openExternal(url);
});

ipcMain.handle('get-server-url', () => SERVER_URL);
ipcMain.handle('robot-available', () => !!robot);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WINDOW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  420,
    height: 580,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0f1e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '../assets/icon.ico'),
    title: 'RemoteConnect Agent',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'ui.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.center();
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();   // minimize to tray instead of closing
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRAY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createTray() {
  // Use a simple 16x16 icon (we'll generate it from the asset)
  const iconPath = path.join(__dirname, '../assets/tray.ico');
  try {
    tray = new Tray(iconPath);
  } catch (_) {
    tray = new Tray(nativeImage.createEmpty());
  }

  tray.setToolTip('RemoteConnect Agent');
  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => { mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Quit Agent', click: () => { stopPolling(); app.exit(0); } },
  ]));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APP LIFECYCLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {});   // keep running in tray
app.on('before-quit', () => { stopPolling(); });
