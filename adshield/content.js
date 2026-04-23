(function () {
  'use strict';

  // 1. Bloquear window.open (popups)
  const _open = window.open.bind(window);
  window.open = function (url, name, features) {
    if (!url || url === '' || url === 'about:blank') return null;
    const blocked = [
      /doubleclick/, /googlesyndication/, /exoclick/, /popads/,
      /adnxs/, /outbrain/, /taboola/, /juicyads/, /trafficjunky/,
      /traffichunt/, /propellerads/, /popcash/, /hilltopads/,
      /advertserve/, /bidvertiser/, /revcontent/, /mgid/,
      /adcash/, /adsterra/, /clickadu/, /valueclick/,
    ];
    if (blocked.some(r => r.test(url))) {
      chrome.runtime.sendMessage({ type: 'BLOCKED' });
      return null;
    }
    return null; // bloquear TODOS los window.open desde reproductores
  };

  // 2. Proteger location contra redirecciones
  if (window.self !== window.top) {
    // Estamos dentro de un iframe
    const safeHref = window.location.href;
    let _blocked = false;

    const blockNav = (e) => {
      if (_blocked) return;
      const target = e.target || e.srcElement;
      if (target && target.tagName === 'A') {
        const href = target.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
          const isSameDomain = href.includes(window.location.hostname);
          if (!isSameDomain) {
            e.preventDefault();
            e.stopImmediatePropagation();
            chrome.runtime.sendMessage({ type: 'BLOCKED' });
          }
        }
      }
    };
    document.addEventListener('click', blockNav, true);
  }

  // 3. Evitar que el iframe robe el foco y dispare popunders
  window.addEventListener('blur', () => {
    setTimeout(() => window.focus(), 80);
  });

  // 4. Interceptar visibilitychange (truco popunder)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Intentar volver al foco
      setTimeout(() => { try { window.focus(); } catch(e){} }, 150);
    }
  });

  // 5. Detectar y eliminar overlays trampa (clickjacking sobre el iframe)
  const removeAdOverlays = () => {
    const suspects = document.querySelectorAll(
      'div[style*="position:fixed"], div[style*="position: fixed"],' +
      'div[style*="z-index:9"], div[style*="z-index: 9"]'
    );
    suspects.forEach(el => {
      const z = parseInt(getComputedStyle(el).zIndex, 10);
      const rect = el.getBoundingClientRect();
      const coversScreen = rect.width > window.innerWidth * 0.8 &&
                           rect.height > window.innerHeight * 0.8;
      if (z > 9000 && coversScreen) {
        el.remove();
        chrome.runtime.sendMessage({ type: 'BLOCKED' });
      }
    });
  };

  // Observar el DOM para nuevos overlays inyectados dinámicamente
  const observer = new MutationObserver(removeAdOverlays);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Limpiar al cargar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeAdOverlays);
  } else {
    removeAdOverlays();
  }
})();
