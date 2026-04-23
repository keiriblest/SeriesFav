const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { ElectronBlocker } = require('@cliqz/adblocker-electron');
const fetch = require('cross-fetch');
const rules = require('./adshield/rules.json');

const APP_URL = 'https://keiriblest.github.io/SeriesFav/desktop.html';
const LOG_FILE = path.join(__dirname, 'adshield-debug.log');
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let blockedCount = 0;
let mainWin = null;
let playerWin = null;
let isReloading = false;
// URL pendiente de abrir en la ventana player (llega desde onBeforeRequest)
let pendingCinebyUrl = null;

function writeLog(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toLocaleTimeString()}] ${msg}\n`, 'utf8'); } catch (_) {}
}
writeLog('=== SeriesFav iniciado ===');

const adPatterns = rules.map(r => r.condition?.urlFilter).filter(Boolean).map(f => f.replace(/\*/g, ''));
function isAdUrl(url) { return adPatterns.some(p => url.includes(p)); }
function isCinebyUrl(url) { return typeof url === 'string' && url.includes('cineby.sc'); }

const ANTI_POPUP_CSS = `
div[class*="pop-up"],div[class*="popup"],div[id*="popup"],
div[class*="ad-layer"],div[class*="ad-overlay"],div[class*="interstitial"],
div[class*="preroll"],div[class*="pre-roll"],
.voe-blocker,#voe-blocker,div[class*="voe-ad"],div[id*="voe-ad"],
.jw-overlays > div:not([class*="jw-"]),
iframe[src*="ads."],iframe[src*="pop."],iframe[src*="track."],
iframe[src*="click."],iframe[id*="ad"],iframe[class*="ad"],
[style*="2147483647"]{
  display:none!important;visibility:hidden!important;
  pointer-events:none!important;opacity:0!important;
  height:0!important;width:0!important;
}`;

function loadScripts() {
  const read = n => { try { return fs.readFileSync(path.join(__dirname, 'adshield', n), 'utf8'); } catch { return null; } };
  return { content: read('content-electron.js'), voeCleaner: read('voe-ad-cleaner.js') };
}

function injectFrame(frame, scripts) {
  const guard = `if(window.__adshieldInjected)return;window.__adshieldInjected=true;`;
  frame.executeJavaScript(`(function(){if(document.__adshieldCss)return;document.__adshieldCss=true;var s=document.createElement('style');s.textContent=${JSON.stringify(ANTI_POPUP_CSS)};(document.head||document.documentElement).appendChild(s);})()`).catch(()=>{});
  if (scripts.content)    frame.executeJavaScript(`(function(){${guard}${scripts.content}})()`).catch(()=>{});
  if (scripts.voeCleaner) frame.executeJavaScript(`(function(){${guard}${scripts.voeCleaner}})()`).catch(()=>{});
}

function traverseFrames(frame, cb) {
  if (!frame) return;
  try { cb(frame); } catch (_) {}
  try { for (const c of (frame.frames || [])) traverseFrames(c, cb); } catch (_) {}
}

// ── Ventana player cineby ─────────────────────────────────────────────────────
function openCinebyWindow(url) {
  if (playerWin && !playerWin.isDestroyed()) {
    playerWin.loadURL(url);
    playerWin.focus();
    writeLog('[Cineby] Reutilizando ventana: ' + url);
    return;
  }

  playerWin = new BrowserWindow({
    width: 1280, height: 800,
    title: 'SeriesFav — Player',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:cineby',   // sesión limpia, sin huella de Electron
    }
  });

  const cSess = playerWin.webContents.session;
  cSess.setUserAgent(CHROME_UA);

  cSess.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, cb) => {
    const h = details.requestHeaders;
    h['User-Agent'] = CHROME_UA;
    if (details.url.includes('cineby.sc')) {
      h['Referer'] = 'https://www.cineby.sc/';
      h['Origin']  = 'https://www.cineby.sc';
    }
    cb({ requestHeaders: h });
  });

  cSess.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, cb) => {
    const h = details.responseHeaders || {};
    delete h['x-frame-options'];   delete h['X-Frame-Options'];
    delete h['content-security-policy']; delete h['Content-Security-Policy'];
    cb({ responseHeaders: h });
  });

  cSess.setPermissionRequestHandler((wc, p, cb) => cb(['media','mediaKeySystem','fullscreen'].includes(p)));

  playerWin.webContents.setWindowOpenHandler(({ url: u }) => { writeLog('[Cineby] Popup bloqueado: ' + u); return { action: 'deny' }; });
  playerWin.webContents.on('will-navigate', (e, u) => { if (!u.includes('cineby.sc')) { e.preventDefault(); writeLog('[Cineby] Nav externa bloqueada: ' + u); } });
  playerWin.webContents.on('did-fail-load', (_, code, desc) => writeLog('[Cineby] fail-load ' + code + ' ' + desc));
  playerWin.on('closed', () => { playerWin = null; });
  playerWin.setMenuBarVisibility(false);
  playerWin.loadURL(url);
  writeLog('[Cineby] Ventana abierta: ' + url);
}

// ── Configurar sesión principal ───────────────────────────────────────────────
function setupMainSession(sess) {
  sess.setUserAgent(CHROME_UA);

  // ★ CLAVE: onBeforeRequest es el primer punto de intercepción, ANTES del TCP.
  // Cuando SeriesFav pone cineby como iframe.src, este handler lo cancela
  // y guarda la URL para abrirla en la ventana player.
  sess.webRequest.onBeforeRequest({ urls: ['*://www.cineby.sc/*', '*://cineby.sc/*'] }, (details, cb) => {
    const url = details.url;
    writeLog('[Cineby] onBeforeRequest interceptado: ' + url);
    // Cancelar la petición en la sesión principal
    cb({ cancel: true });
    // Abrir en ventana player con sesión limpia (setImmediate para no bloquear el callback)
    setImmediate(() => openCinebyWindow(url));
  });

  sess.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, cb) => {
    const h = details.requestHeaders;
    h['User-Agent'] = CHROME_UA;
    const playerHosts = [
      { host: 'voe.sx',         ref: 'https://voe.sx/' },
      { host: 'goodstream',     ref: 'https://goodstream.uno/' },
      { host: 'vidhide',        ref: 'https://vidhide.com/' },
      { host: 'filemoon',       ref: 'https://filemoon.sx/' },
      { host: 'streamtape.com', ref: 'https://streamtape.com/' },
      { host: 'doodstream.com', ref: 'https://doodstream.com/' },
      { host: 'mixdrop.co',     ref: 'https://mixdrop.co/' },
    ];
    for (const p of playerHosts) {
      if (details.url.includes(p.host)) { if (!h['Referer']) h['Referer'] = p.ref; break; }
    }
    cb({ requestHeaders: h });
  });

  sess.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, cb) => {
    const url = details.url || '';
    const needsFix = ['voe.sx','goodstream','vidhide','filemoon','streamtape','doodstream','mixdrop'].some(h => url.includes(h));
    if (needsFix) {
      const h = details.responseHeaders || {};
      delete h['x-frame-options'];   delete h['X-Frame-Options'];
      delete h['content-security-policy']; delete h['Content-Security-Policy'];
      cb({ responseHeaders: h });
    } else {
      cb({ responseHeaders: details.responseHeaders });
    }
  });

  sess.setPermissionRequestHandler((wc, p, cb) => cb(['media','mediaKeySystem','fullscreen','geolocation','notifications'].includes(p)));
}

async function createWindow() {
  mainWin = new BrowserWindow({
    width: 1200, height: 800,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'adshield', 'preload.js')
    }
  });

  const sess = mainWin.webContents.session;
  const scripts = loadScripts();

  setupMainSession(sess);

  // F12
  mainWin.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWin.webContents.isDevToolsOpened()
        ? mainWin.webContents.closeDevTools()
        : mainWin.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Log AdShield desde renderer
  mainWin.webContents.on('console-message', (_, level, message, line, sourceId) => {
    if (message.includes('[AdShield]')) writeLog(`[${(sourceId||'').split('/').pop()}] ${message}`);
  });

  // Bloquear window.open — cineby podría intentar abrirse así también
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isCinebyUrl(url)) { setImmediate(() => openCinebyWindow(url)); return { action: 'deny' }; }
    writeLog('Popup bloqueado: ' + url);
    if (isAdUrl(url)) { blockedCount++; mainWin?.webContents.send('adshield-count-update', blockedCount); }
    return { action: 'deny' };
  });

  // will-navigate por si acaso
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (isCinebyUrl(url)) { e.preventDefault(); writeLog('[Cineby] will-navigate: ' + url); openCinebyWindow(url); }
  });

  // Inyección AdShield
  mainWin.webContents.on('dom-ready', () => {
    mainWin.webContents.insertCSS(ANTI_POPUP_CSS).catch(()=>{});
    if (scripts.content)    mainWin.webContents.executeJavaScript(scripts.content).catch(console.error);
    if (scripts.voeCleaner) mainWin.webContents.executeJavaScript(scripts.voeCleaner).catch(console.error);
  });

  mainWin.webContents.on('frame-created', (_, { frame }) => {
    frame.on('dom-ready', () => {
      const url = frame.url || '';
      if (isCinebyUrl(url)) {
        frame.executeJavaScript('document.open();document.write("");document.close();window.stop();').catch(()=>{});
        return;
      }
      if (url.startsWith('data:')) { frame.executeJavaScript('document.body&&(document.body.innerHTML="");window.stop&&window.stop();').catch(()=>{}); return; }
      if (!url || url === 'about:blank' || url.startsWith('chrome-')) return;
      injectFrame(frame, scripts);
    });
  });

  mainWin.webContents.on('did-finish-load', () => {
    traverseFrames(mainWin.webContents.mainFrame, f => {
      const url = f.url || '';
      if (!isCinebyUrl(url) && url && url !== 'about:blank' && !url.startsWith('data:') && !url.startsWith('chrome-'))
        injectFrame(f, scripts);
    });
  });

  setInterval(() => {
    if (!mainWin || mainWin.isDestroyed()) return;
    traverseFrames(mainWin.webContents.mainFrame, frame => {
      const url = frame.url || '';
      if (!url || url === 'about:blank' || url.startsWith('data:') || isCinebyUrl(url)) return;
      if (scripts.voeCleaner)
        frame.executeJavaScript(`(function(){if(!window.__adshieldVoeActive){window.__adshieldVoeActive=true;${scripts.voeCleaner}}})()`).catch(()=>{});
    });
  }, 4000);

  mainWin.webContents.on('did-fail-load', (_, code) => {
    if (code === -3 || isReloading) return;
    writeLog('did-fail-load: ' + code);
    isReloading = true;
    setTimeout(() => { mainWin?.webContents.loadURL(APP_URL).catch(()=>{}); isReloading = false; }, 1500);
  });

  mainWin.webContents.on('render-process-gone', (_, d) => {
    writeLog('render-process-gone: ' + d.reason);
    if (isReloading) return;
    isReloading = true;
    setTimeout(() => { mainWin?.webContents.loadURL(APP_URL).catch(()=>{}); isReloading = false; }, 2000);
  });

  mainWin.loadURL(APP_URL);
  mainWin.setMenuBarVisibility(false);

  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
    .then(blocker => {
      blocker.enableBlockingInSession(sess);
      blocker.on('request-blocked', () => { blockedCount++; mainWin?.webContents.send('adshield-count-update', blockedCount); });
      writeLog('Capa 1 (Cliqz) activada');
    })
    .catch(err => writeLog('Capa 1 no disponible: ' + err.message));
}

ipcMain.handle('adshield-get-count', () => blockedCount);
ipcMain.handle('adshield-reset-count', () => { blockedCount = 0; return 0; });
ipcMain.on('adshield-content-blocked', () => { blockedCount++; mainWin?.webContents.send('adshield-count-update', blockedCount); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
