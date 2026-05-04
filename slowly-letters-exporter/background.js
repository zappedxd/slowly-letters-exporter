'use strict';

function bytesFromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Downloads API expects a relative filename only — no paths or reserved chars. */
function sanitizeDownloadFilename(name) {
  if (!name || typeof name !== 'string') return 'slowly_export.docx';
  let base = name
    .replace(/[/\\]+/g, '_')
    .replace(/[|?*<>:"]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!base) base = 'slowly_export.docx';
  return base.slice(0, 180);
}

function sendExportError(text) {
  chrome.runtime.sendMessage({ type: 'EXPORT_ERROR', text });
}

function sendExportDone(count, filename) {
  chrome.runtime.sendMessage({ type: 'EXPORT_UI_DONE', count, filename });
}

/**
 * MV3 service workers can shut down right after onMessage; blob: URLs created there
 * are often invalidated before the download starts → ERR_FILE_NOT_FOUND.
 * Prefer data: URLs for moderately sized payloads; keep a strong Blob ref for large exports.
 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'EXPORT_DONE') return;

  const { filename, mimeType, base64, count } = msg.payload || {};
  if (!filename || !mimeType || base64 == null) {
    sendExportError('Invalid export payload.');
    return;
  }

  const safeName = sanitizeDownloadFilename(filename);
  /** ~12M chars base64 ≈ 9 MiB binary — data URLs work reliably for downloads here. */
  const MAX_BASE64_FOR_DATA_URL = 12 * 1024 * 1024;

  function runDownload(url, tearDown) {
    chrome.downloads.download(
      {
        url,
        filename: safeName,
        saveAs: false,
        conflictAction: 'uniquify',
      },
      () => {
        const err = chrome.runtime.lastError;
        if (typeof tearDown === 'function') tearDown();

        if (err) {
          if (url.startsWith('blob:') && base64.length <= MAX_BASE64_FOR_DATA_URL) {
            runDownload(`data:${mimeType};base64,${base64}`, null);
            return;
          }

          sendExportError(`Download failed: ${err.message}`);
          return;
        }

        sendExportDone(count, safeName);
      }
    );
  }

  if (base64.length <= MAX_BASE64_FOR_DATA_URL) {
    runDownload(`data:${mimeType};base64,${base64}`, null);
    return;
  }

  const bytes = bytesFromBase64(base64);
  const blob = new Blob([bytes], { type: mimeType });
  globalThis.__slowlyExporterKeepBlobAlive = blob;
  const blobUrl = URL.createObjectURL(blob);

  runDownload(blobUrl, () => {
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      globalThis.__slowlyExporterKeepBlobAlive = undefined;
    }, 120000);
  });
});
