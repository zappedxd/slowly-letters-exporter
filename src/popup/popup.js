document.getElementById('exportBtn').addEventListener('click', async () => {
  const scope = document.querySelector('input[name="scope"]:checked').value;
  const format = document.querySelector('input[name="format"]:checked').value;
  const statusEl = document.getElementById('status');
  const btn = document.getElementById('exportBtn');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url.includes('slowly.app')) {
    statusEl.textContent = 'Please open a Slowly tab first.';
    return;
  }

  // Lock the UI
  btn.disabled = true;
  document.querySelectorAll('input').forEach(i => i.disabled = true);
  statusEl.textContent = 'Initializing...';
  
  chrome.tabs.sendMessage(tab.id, { type: 'START_EXPORT', scope, format });
});

chrome.runtime.onMessage.addListener((msg) => {
  const statusEl = document.getElementById('status');
  const btn = document.getElementById('exportBtn');

  // Listen for live updates from content.js
  if (msg.type === 'EXPORT_PROGRESS') {
    statusEl.textContent = msg.text;
  }
  
  if (msg.type === 'EXPORT_UI_DONE') {
    statusEl.textContent = `Success! Saved ${msg.count} letter(s).`;
    btn.disabled = false;
    document.querySelectorAll('input').forEach(i => i.disabled = false);
  }
  
  if (msg.type === 'EXPORT_ERROR') {
    statusEl.textContent = `Error: ${msg.text}`;
    btn.disabled = false;
    document.querySelectorAll('input').forEach(i => i.disabled = false);
  }
});