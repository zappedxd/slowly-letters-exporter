'use strict';

/**
 * Clicking the extension icon opens/expands the export panel in the active tab.
 */
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'SHOW_EXPORT_WIDGET' }, () => {
    void chrome.runtime.lastError; // suppress "no receiver" error if content script isn't ready
  });
});

/**
 * EXPORT_DONE — lightweight ping from content.js after it has already
 * triggered a direct Blob download in the page. No bytes travel through here.
 * We just send EXPORT_UI_DONE back so the panel shows the success state.
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'EXPORT_DONE') return;

  const count = msg.payload?.count ?? 0;

  // Send success feedback back to the content script in the same tab
  if (sender?.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, { type: 'EXPORT_UI_DONE', count }, () => {
      void chrome.runtime.lastError;
    });
  }
});