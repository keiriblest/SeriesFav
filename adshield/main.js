const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');
const { ElectronBlocker } = require('@cliqz/adblocker-electron');
const fetch = require('cross-fetch');
const rules = require('./adshield/rules.json');

const APP_URL  = 'https://keiriblest.github.io/SeriesFav/desktop.html';
const LOG_FILE = path.join(__dirname, 'adshield-debug.log');

let blockedCount = 0;
let mainWin      = null;
let isReloading  = false;

function writeLog(msg) {
  try {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (_) {}
}
writeLog('=== AdShield iniciado ===');

const adPatterns = rules
  .map(r => r.condition.urlFilter).filter(Boolean).map(f => f.replace(/\*/g, ''));
function isAdUrl(url) { return adPatterns.some(p => url.includes(p)); }

const ANTI_POPUP_CSS = `
div[class*="pop-up"], div[class*="popup"], div[id*="popup"],
div[class*="overlay"][style*="z-index"],
div[class*="ad-layer"], div[class*="ad-overlay"],
div[class*="interstitial"], div[class*="advertisement"],
div[class*="preroll"], div[class*="pre-roll"],
.voe-blocker, #voe-blocker, div[class*="voe-ad"], div[id*="voe-ad"],
.jw-overlays > div:not([class*="jw-"]),
iframe[src*="ads."], iframe[src*="pop."], iframe[src*="track."],
iframe[src*="click."], iframe[id*="ad"], iframe[class*="ad"],
[style*="2147483647"] {
  display: none !important; visibility: hidden !important;
  pointer-events: none !important; opacity: 0 !important;
  height: 0 !important; width: 0 !important;
}`;

const INJECT_CSS_JS = `
(function(){
  if(document.__adshieldCss) return; document.__adshieldCss = true;
  var s = document.createElement('style');
  s.textContent = ${JSON.stringify(ANTI_POPUP_CSS)};
  (document.head || document.documentElement).appendChild(s);
})();`;

function loadScripts() {
  const read = (name) => {
    try { return fs.readFileSync(path.join(__dirname, 'adshield', name), 'utf8'); }
    catch (e) { writeLog('ERROR: no se encontro ' + name); return null; }
  };
  return { content: read('content-electron.js'), voeCleaner: read('voe-ad-cleaner.js') };
}

// Inyecta CSS + scripts en un frame. La guard __adshieldInjected evita doble
// ejecucion en el MISMO contexto de documento (se resetea con cada navegacion).
function injectFrame(frame, scripts) {
  const guard = `if(window.__adshieldInjected) return; window.__adshieldInjected = true;`;
  frame.executeJavaScript(INJECT_CSS_JS).catch(() => {});
  if (scripts.content)
    frame.executeJavaScript(`(function(){${guard}${scripts.content}})();`).catch(() => {});
  if (scripts.voeCleaner)
    frame.executeJavaScript(`(function(){${guard}${scripts.voeCleaner}})();`).catch(() => {});
}

function traverseFrames(frame, cb) {
  if (!frame) return;
  try { cb(frame); } catch (_) {}
  try { for (const c of (frame.frames || [])) traverseFrames(c, cb); } catch (_) {}
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

  const sess    = mainWin.webContents.session;
  const scripts = loadScripts();

  // ── F12: abrir/cerrar DevTools ────────────────────────────────────────────
  mainWin.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWin.webContents.isDevToolsOpened()
        ? mainWin.webContents.closeDevTools()
        : mainWin.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // ── Log de mensajes del renderer ──────────────────────────────────────────
  mainWin.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (message.includes('[AdShield]')) {
      const src = sourceId ? sourceId.split('/').pop() : '';
      writeLog(`[${src}] ${message}`);
    }
  });

  // ── CAPA 2: Bloquear window.open ──────────────────────────────────────────
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    writeLog('setWindowOpenHandler bloqueado: ' + url);
    if (isAdUrl(url)) { blockedCount++; mainWin?.webContents.send('adshield-count-update', blockedCount); }
    return { action: 'deny' };
  });

  // ── CAPA 3: Frame principal ───────────────────────────────────────────────
  mainWin.webContents.on('dom-ready', () => {
    mainWin.webContents.insertCSS(ANTI_POPUP_CSS).catch(() => {});
    if (scripts.content)    mainWin.webContents.executeJavaScript(scripts.content).catch(console.error);
    if (scripts.voeCleaner) mainWin.webContents.executeJavaScript(scripts.voeCleaner).catch(console.error);
  });

  // ── CAPA 4: Iframes — .on en lugar de .once para re-inyectar en cada ──────
  // navegacion del frame (el log mostro que los frames arrancan como
  // about:blank y LUEGO navegan al player URL, por eso .once fallaba:
  // solo inyectaba en el about:blank inicial, nunca en el player real).
  mainWin.webContents.on('frame-created', (event, { frame }) => {

    frame.on('dom-ready', () => {
      const url = frame.url || '';

      // ── Bloquear truco PDF popunder ────────────────────────────────────────
      // Estos hosts crean iframes con data:application/pdf para abrir una
      // ventana externa saltandose window.open. Los vaciamos y paramos.
      if (url.startsWith('data:')) {
        writeLog('BLOQUEADO frame data: ' + url.substring(0, 80));
        frame.executeJavaScript('document.body && (document.body.innerHTML=""); window.stop && window.stop();').catch(() => {});
        return;
      }

      // Ignorar frames vacios o internos
      if (!url || url === 'about:blank' || url.startsWith('chrome-')) return;

      writeLog('frame inyectado: ' + url);
      injectFrame(frame, scripts);
    });
  });

  // ── CAPA 5: Traversal completo al terminar la carga ───────────────────────
  mainWin.webContents.on('did-finish-load', () => {
    traverseFrames(mainWin.webContents.mainFrame, f => {
      const url = f.url || '';
      if (url && url !== 'about:blank' && !url.startsWith('data:') && !url.startsWith('chrome-'))
        injectFrame(f, scripts);
    });
  });

  // ── Red de seguridad: re-inyectar en frames cada 4 s ─────────────────────
  setInterval(() => {
    if (!mainWin || mainWin.isDestroyed()) return;
    traverseFrames(mainWin.webContents.mainFrame, (frame) => {
      const url = frame.url || '';
      if (!url || url === 'about:blank' || url.startsWith('data:')) return;
      if (scripts.voeCleaner)
        frame.executeJavaScript(
          `(function(){ if(!window.__adshieldVoeActive){ window.__adshieldVoeActive=true; ${scripts.voeCleaner} } })()`
        ).catch(() => {});
    });
  }, 4000);

  // ── Recuperacion ante fallos ──────────────────────────────────────────────
  mainWin.webContents.on('did-fail-load', (_, code) => {
    if (code === -3 || isReloading) return;
    writeLog('did-fail-load: ' + code);
    isReloading = true;
    setTimeout(() => { mainWin?.webContents.loadURL(APP_URL).catch(() => {}); isReloading = false; }, 1500);
  });

  mainWin.webContents.on('render-process-gone', (_, d) => {
    writeLog('render-process-gone: ' + d.reason);
    if (isReloading) return;
    isReloading = true;
    setTimeout(() => { mainWin?.webContents.loadURL(APP_URL).catch(() => {}); isReloading = false; }, 2000);
  });

  // ── Carga la pagina PRIMERO ───────────────────────────────────────────────
  mainWin.loadURL(APP_URL);
  mainWin.setMenuBarVisibility(false);

  // ── CAPA 1: Cliqz en paralelo ─────────────────────────────────────────────
  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
    .then(blocker => {
      blocker.enableBlockingInSession(sess);
      blocker.on('request-blocked', () => {
        blockedCount++;
        mainWin?.webContents.send('adshield-count-update', blockedCount);
      });
      writeLog('Capa 1 (Cliqz) activada');
    })
    .catch(err => writeLog('Capa 1 no disponible: ' + err.message));

  // ── IPC ───────────────────────────────────────────────────────────────────
  ipcMain.handle('adshield-get-count',   () => blockedCount);
  ipcMain.handle('adshield-reset-count', () => { blockedCount = 0; return 0; });
  ipcMain.on('adshield-content-blocked', () => {
    blockedCount++;
    mainWin?.webContents.send('adshield-count-update', blockedCount);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
