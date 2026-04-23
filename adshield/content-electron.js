;(function () {
  'use strict';

  // ── CSS ───────────────────────────────────────────────────────────────────────
  (function injectCSS() {
    if (document.__adshieldCssContent) return;
    document.__adshieldCssContent = true;
    const s = document.createElement('style');
    s.textContent = `
div[style*="position: fixed"][style*="top: 0"],
div[style*="position:fixed"][style*="top:0"],
div[style*="z-index: 2147483647"], div[style*="z-index:2147483647"],
div[style*="z-index: 999999"],     div[style*="z-index:999999"],
div[style*="z-index: 99999"],      div[style*="z-index:99999"],
div[style*="z-index: 9999"],       div[style*="z-index:9999"],
[style*="2147483647"],
.voe-blocker, #voe-blocker,
div[class*="voe-ad"],   div[id*="voe-ad"],
div[class*="pop-up"],   div[class*="popup"],   div[id*="popup"],
div[id*="overlay-ad"],  div[class*="ad-overlay"], div[class*="ad-layer"],
div[class*="preroll"],  div[class*="pre-roll"], div[class*="interstitial"],
.jw-overlays > div:not([class*="jw-"]),
iframe[src*="ads."], iframe[src*="pop."], iframe[src*="track."],
iframe[id*="ad"], iframe[class*="ad"] {
  display: none !important; visibility: hidden !important;
  pointer-events: none !important; opacity: 0 !important;
  height: 0 !important; width: 0 !important;
}`;
    (document.head || document.documentElement).appendChild(s);
  })();

  // ── Coordenadas del último clic ───────────────────────────────────────────────
  let lastClickX = 0, lastClickY = 0;
  let lastDownTarget = null;

  document.addEventListener('mousedown', (e) => { lastDownTarget = e.target; }, true);
  document.addEventListener('click',     (e) => { lastClickX = e.clientX; lastClickY = e.clientY; }, true);

  // ═══════════════════════════════════════════════════════════════════════════════
  // DEBUG — logs automáticos en consola, sin necesidad de pegar nada
  // Abre DevTools → selecciona el frame del player → pestaña Console
  // ═══════════════════════════════════════════════════════════════════════════════
  console.log('%c[AdShield DEBUG] Script activo en: ' + window.location.href,
    'background:#1a1a2e;color:#e94560;font-weight:bold;padding:2px 6px;border-radius:3px');

  document.addEventListener('click', (e) => {
    const t = e.target;
    console.group('%c[AdShield] CLIC detectado', 'color:#f5a623;font-weight:bold');
    console.log('Tag:    ', t.tagName);
    console.log('ID:     ', t.id     || '(vacío)');
    console.log('Class:  ', t.className || '(vacío)');
    console.log('Style:  ', t.getAttribute('style') || '(sin style)');
    console.log('onclick:', t.getAttribute('onclick') || '(sin onclick)');
    console.log('href:   ', t.getAttribute('href')   || '(sin href)');
    console.log('z-index:', getComputedStyle(t).zIndex);
    console.log('cursor: ', getComputedStyle(t).cursor);
    console.log('pos:    ', getComputedStyle(t).position);
    console.log('size:   ', t.getBoundingClientRect().width.toFixed(0),
                        'x', t.getBoundingClientRect().height.toFixed(0));
    console.groupEnd();
  }, true);
  // ═══════════════════════════════════════════════════════════════════════════════

  // ── Overlay visual de alto z-index ────────────────────────────────────────────
  const isAdOverlay = (el) => {
    try {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      const z = parseInt(cs.zIndex, 10);
      if (isNaN(z) || z < 500) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width  < window.innerWidth  * 0.25) return false;
      if (rect.height < window.innerHeight * 0.25) return false;
      const tag = el.tagName.toLowerCase();
      if (['video', 'iframe', 'audio'].includes(tag)) return false;
      const id  = (el.id  || '').toLowerCase();
      const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
      const safe = ['player', 'video', 'jwplayer', 'jw-', 'content',
                    'modal', 'header', 'nav', 'menu', 'seriesfav'];
      if (safe.some(w => id.includes(w) || cls.includes(w))) return false;
      return true;
    } catch { return false; }
  };

  const isClickInterceptor = (el) => {
    try {
      if (!el || el.nodeType !== 1) return false;
      const tag = el.tagName.toLowerCase();
      if (['video', 'iframe', 'audio', 'button', 'input'].includes(tag)) return false;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width  < window.innerWidth  * 0.3) return false;
      if (rect.height < window.innerHeight * 0.3) return false;
      return true;
    } catch { return false; }
  };

  const disableAndRemove = (el) => {
    try {
      el.style.setProperty('pointer-events', 'none',   'important');
      el.style.setProperty('display',        'none',   'important');
      el.style.setProperty('visibility',     'hidden', 'important');
    } catch (_) {}
    window.adshieldElectron?.reportBlocked?.();
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 60);
  };

  // ── window.open ───────────────────────────────────────────────────────────────
  window.open = function (url) {
    console.log('%c[AdShield] window.open interceptado → URL: ' + url,
      'background:#e94560;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px');
    window.adshieldElectron?.reportBlocked?.();

    try {
      let el = lastDownTarget;
      for (let i = 0; i < 8 && el && el !== document.body; i++) {
        if (isClickInterceptor(el) || isAdOverlay(el)) { disableAndRemove(el); break; }
        el = el.parentElement;
      }
    } catch (_) {}

    setTimeout(() => {
      try {
        document.querySelectorAll('video').forEach(v => {
          if (v.paused && v.readyState >= 2) {
            console.log('[AdShield] Intentando play() en <video>', v);
            v.play().catch(err => console.warn('[AdShield] play() falló:', err));
          }
        });
        const below = document.elementFromPoint(lastClickX, lastClickY);
        if (below && below !== document.body && below !== document.documentElement) {
          console.log('[AdShield] Click reenviado a:', below.tagName, below.id, below.className);
          below.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true,
            clientX: lastClickX, clientY: lastClickY, button: 0
          }));
        }
      } catch (_) {}
    }, 0);

    const fakeHref = (typeof url === 'string' && url.startsWith('http')) ? url : 'about:blank';
    const fakeWin  = {
      closed: false, name: '', opener: window,
      close:            () => { fakeWin.closed = true; },
      focus:            () => {}, blur:        () => {},
      stop:             () => {}, postMessage: () => {},
      print:            () => {}, dispatchEvent: () => false,
      addEventListener: () => {}, removeEventListener: () => {},
      location: { href: fakeHref, origin: 'null',
        assign: () => {}, replace: () => {}, reload: () => {},
        toString: () => fakeHref },
      document: { readyState: 'complete',
        write: () => {}, writeln: () => {}, close: () => {}, open: () => {} },
      history: { back: () => {}, forward: () => {}, go: () => {} }
    };
    return fakeWin;
  };

  // ── MutationObserver ──────────────────────────────────────────────────────────
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (isAdOverlay(node)) { disableAndRemove(node); continue; }
        node.querySelectorAll?.('*').forEach(child => {
          if (isAdOverlay(child)) disableAndRemove(child);
        });
      }
      if (m.type === 'attributes' && m.target?.nodeType === 1) {
        if (isAdOverlay(m.target)) disableAndRemove(m.target);
      }
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['style', 'class']
  });

  // ── Limpieza periódica ────────────────────────────────────────────────────────
  const scanOverlays = () =>
    document.querySelectorAll('*').forEach(el => { if (isAdOverlay(el)) disableAndRemove(el); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanOverlays);
  } else { scanOverlays(); }
  setInterval(scanOverlays, 1500);

  // ── Bloquear navegación externa en iframes ────────────────────────────────────
  if (window.self !== window.top) {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a) {
        const href = a.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript') &&
            !href.includes(window.location.hostname)) {
          e.preventDefault();
          window.adshieldElectron?.reportBlocked?.();
        }
      }
    }, true);
  }

})();
