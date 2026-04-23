document.addEventListener('DOMContentLoaded', () => {
  const countEl = document.getElementById('count');
  const resetBtn = document.getElementById('resetBtn');
  const toggle = document.getElementById('toggleEnabled');

  // Obtener contador del background
  chrome.runtime.sendMessage({ type: 'GET_COUNT' }, (res) => {
    if (res && res.count !== undefined) {
      countEl.textContent = res.count.toLocaleString('es');
    }
  });

  // Estado del toggle
  chrome.storage.local.get(['enabled'], (res) => {
    toggle.checked = res.enabled !== false;
  });

  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: toggle.checked });
  });

  resetBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_COUNT' }, () => {
      countEl.textContent = '0';
    });
  });
});
