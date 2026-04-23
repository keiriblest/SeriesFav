;(function () {
  'use strict';

  /**
   * VOE Ad Container Cleaner v2 — detección por atributo, sin getComputedStyle
   *
   * El div objetivo tiene SIEMPRE estas tres características en su atributo style:
   *   1. "2147483647"  → z-index máximo (único en toda la página)
   *   2. "fixed"       → posición fija
   *   3. Contiene al menos un <iframe> hijo (los slots de anuncio)
   *
   * Usamos querySelector('[style*="2147483647"]') para encontrarlo directamente
   * sin depender de getComputedStyle (que falla antes de que el elemento se pinte).
   */

  function nuke(el) {
    try {
      el.remove();
      window.adshieldElectron?.reportBlocked?.();
    } catch (_) {}
  }

  function isTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    var s = el.getAttribute('style') || '';
    return (
      s.indexOf('2147483647') !== -1 &&   // z-index máximo
      s.indexOf('fixed')      !== -1 &&   // position fixed
      el.querySelector('iframe') !== null  // contiene iframes de ad
    );
  }

  function scan() {
    // Busca directamente por el valor del atributo — O(elementos con style)
    document.querySelectorAll('[style*="2147483647"]').forEach(function (el) {
      if (isTarget(el)) nuke(el);
    });
  }

  // ── MutationObserver: reacciona en el mismo frame de animación ───────────────
  try {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        // Nodos nuevos añadidos al DOM
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (isTarget(node)) { nuke(node); return; }
          // Buscar dentro del subárbol insertado
          node.querySelectorAll && node.querySelectorAll('[style*="2147483647"]')
            .forEach(function (child) { if (isTarget(child)) nuke(child); });
        });
        // Cambio de atributo style en nodo existente (VOE lo modifica en caliente)
        if (m.type === 'attributes' && isTarget(m.target)) nuke(m.target);
      });
    }).observe(document.documentElement, {
      childList:       true,
      subtree:         true,
      attributes:      true,
      attributeFilter: ['style']
    });
  } catch (_) {}

  // ── Intervalo de seguridad (VOE a veces reinyecta tras el observer) ──────────
  setInterval(scan, 500);

  // ── Escaneo inicial ───────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  // ── Debug (visible en DevTools → consola del frame de VOE) ───────────────────
  console.log('[VOE-Cleaner] activo en:', window.location.href);

})();
