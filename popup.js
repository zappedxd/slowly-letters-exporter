'use strict';

document.getElementById('focusBtn').addEventListener('click', async () => {
  const hint = document.getElementById('hint');
  hint.textContent = '';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    hint.textContent = 'No active tab.';
    return;
  }
  try {
    const u = tab.url ? new URL(tab.url) : null;
    const ok = u && u.protocol === 'https:' && u.hostname.endsWith('.slowly.app');
    if (!ok) {
      hint.textContent = 'Open a Slowly tab (https://…slowly.app) first.';
      return;
    }
  } catch {
    hint.textContent = 'Open a Slowly tab first.';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'SHOW_EXPORT_WIDGET' }, () => {
    void chrome.runtime.lastError;
    window.close();
  });
});
