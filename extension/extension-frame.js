(async function initSgwExtensionFrame() {
  const frame = document.getElementById('sgwFrame');
  const settingsBox = document.getElementById('settings');
  const originInput = document.getElementById('originInput');
  const toggleBtn = document.getElementById('toggleSettingsBtn');
  const saveBtn = document.getElementById('saveOriginBtn');
  const sidePanelBtn = document.getElementById('openSidePanelBtn');

  let defaultOrigin = 'http://localhost:3000';
  try {
    const cfgRes = await fetch(chrome.runtime.getURL('config.json'));
    const cfg = await cfgRes.json();
    if (cfg && cfg.sgwServerOrigin) defaultOrigin = cfg.sgwServerOrigin;
  } catch {}

  function sanitizeExtensionOrigin(raw) {
    try {
      const parsed = new URL(String(raw || '').trim());
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocal)) {
        return parsed.origin;
      }
    } catch {}
    return defaultOrigin;
  }

  const applyOrigin = (origin) => {
    const clean = sanitizeExtensionOrigin(origin);
    if (originInput) originInput.value = clean;
    if (frame) frame.src = `${clean}/extension.html`;
  };

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(['sgwServerOrigin'], (res) => {
      applyOrigin(res.sgwServerOrigin || defaultOrigin);
    });
  } else {
    applyOrigin(defaultOrigin);
  }

  toggleBtn?.addEventListener('click', () => {
    settingsBox?.classList.toggle('open');
  });

  saveBtn?.addEventListener('click', () => {
    const next = sanitizeExtensionOrigin(originInput?.value || defaultOrigin);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ sgwServerOrigin: next }, () => {
        applyOrigin(next);
        settingsBox?.classList.remove('open');
      });
    } else {
      applyOrigin(next);
      settingsBox?.classList.remove('open');
    }
  });

  sidePanelBtn?.addEventListener('click', async () => {
    try {
      if (chrome.sidePanel && chrome.tabs) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.windowId) {
          await chrome.sidePanel.open({ windowId: tab.windowId });
          window.close();
        }
      }
    } catch {}
  });
})();
