import { exportToHtmlZip } from './exporters/html.js';
import { exportToPdf } from './exporters/pdf.js';
import { exportToDocx } from './exporters/docx.js';
import { exportToMarkdown } from './exporters/markdown.js';
import { exportToTxt } from './exporters/txt.js';

const assetCache = new Map();
const MAX_LETTERS = 500;

// --- 1. DOM EXTRACTION ---
function extractCurrentLetter() {
  const body = document.querySelector('.modal-body .pre-wrap');
  if (!body) return null;

  const root = body.closest('.letter') || document.querySelector('[role="dialog"]') || document.body;
  const footer = root.querySelector('.modal-footer');
  const stampEl = root.querySelector('img.stamp');
  const chopWrap = root.querySelector('.chop');
  const audioBtn = root.querySelector('.btn-audio');
  
  let chopUrl = '';
  if (chopWrap) {
    const chopImg = chopWrap.querySelector('.chop-img');
    const match = chopImg ? window.getComputedStyle(chopImg).backgroundImage.match(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/i) : null;
    chopUrl = match ? match[1] : '';
  }

  const timestampRaw = footer?.querySelector('time[datetime]')?.getAttribute('datetime');
  const timestamp = timestampRaw ? Date.parse(timestampRaw) : Date.now();

  return {
    id: crypto.randomUUID(),
    sender: footer?.querySelector('.text-primary')?.innerText.trim() || 'Unknown',
    receiver: 'Me',
    timestamp,
    dateStr: new Date(timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    text: body.innerText.trim(),
    stamp: stampEl ? stampEl.src : '',
    chopUrl,
    chopCountry: chopWrap ? chopWrap.innerText.trim() : '',
    photos: [...root.querySelectorAll('.slider img')].map(img => img.src).filter(src => !src.startsWith('data:')),
    audio: {
      url: root.querySelector('a[href*="attachments/audio"]')?.href || '',
      duration: audioBtn ? audioBtn.innerText.trim() : ''
    },
    assets: { stampBytes: null, chopBytes: null, photoBytes: [], audioBytes: null }
  };
}

// --- 2. TRAVERSAL LOGIC ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitUntil(predicate, intervalMs = 40, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function findArrows() {
  const anchors = [...document.querySelectorAll('a[href]')];
  return {
    prev: anchors.find(a => a.querySelector('.icon-chevron-left') || a.querySelector('[class*="chevron-left"]')),
    next: anchors.find(a => a.querySelector('.icon-chevron-right') || a.querySelector('[class*="chevron-right"]'))
  };
}

async function waitAfterNav(oldPath) {
  // 1. Wait for URL change
  const pathOk = await waitUntil(() => window.location.pathname !== oldPath, 40, 10000);
  if (!pathOk) return false;
  await sleep(90);

  // 2. Wait for text to stabilize
  let prevSnap = null;
  const settled = await waitUntil(() => {
    const body = document.querySelector('.modal-body .pre-wrap');
    if (!body) return false;
    const text = body.innerText.trim();
    if (prevSnap === text && text.length > 0) return true;
    prevSnap = text;
    return false;
  }, 40, 10000);

  if (!settled) return false;

  // 3. The Magic Fix: Check the header for attachment icons and WAIT for them to load
  const header = document.querySelector('.friend-header');
  if (header) {
    const hasAudio = !!header.querySelector('.icon-mic');
    const hasPhotos = !!header.querySelector('.icon-attachment-2');

    if (hasAudio) {
      // Wait up to 5 seconds specifically for the audio download link to appear in the DOM
      await waitUntil(() => !!document.querySelector('a[href*="attachments/audio"]'), 100, 5000);
    }

    if (hasPhotos) {
      // Wait up to 5 seconds specifically for the photo slider images to appear
      await waitUntil(() => !!document.querySelector('.slider img'), 100, 5000);
    }
  }

  await sleep(40);
  return true;
}
async function collectAllLetters() {
  const letters = [];
  const seenUrls = new Set();

  // 1. Rewind to the oldest letter
  chrome.runtime.sendMessage({ type: 'EXPORT_PROGRESS', text: 'Rewinding to the oldest letter...' });
  let steps = 0;
  while (steps < MAX_LETTERS) {
    const { prev } = findArrows();
    if (!prev) break;
    
    const oldPath = window.location.pathname;
    prev.click();
    const moved = await waitAfterNav(oldPath);
    if (!moved) break;
    steps++;
  }

  // 2. Read forward until the newest letter
  let consecutiveFailures = 0;
  while (letters.length < MAX_LETTERS) {
    const fp = window.location.pathname;
    
    if (!seenUrls.has(fp)) {
      seenUrls.add(fp);
      const letter = extractCurrentLetter();
      if (letter) {
        letters.push(letter);
        consecutiveFailures = 0;
        chrome.runtime.sendMessage({ type: 'EXPORT_PROGRESS', text: `Collected letter ${letters.length}...` });
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) break;
      }
    }

    const { next } = findArrows();
    if (!next) break;

    const oldPath = window.location.pathname;
    next.click();
    const moved = await waitAfterNav(oldPath);
    if (!moved) break;
  }
  
  return letters;
}

// --- 3. ASSET PIPELINE ---
async function fetchAsset(url) {
  if (!url) return null;
  if (assetCache.has(url)) return assetCache.get(url);
  try {
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assetCache.set(url, bytes);
    return bytes;
  } catch (e) {
    return null;
  }
}

async function hydrateAssets(letters) {
  chrome.runtime.sendMessage({ type: 'EXPORT_PROGRESS', text: 'Downloading images and stamps...' });
  for (const l of letters) {
    l.assets.stampBytes = await fetchAsset(l.stamp);
    l.assets.chopBytes = await fetchAsset(l.chopUrl);
    for (const photo of l.photos) l.assets.photoBytes.push(await fetchAsset(photo));
    l.assets.audioBytes = await fetchAsset(l.audio.url);
  }
}

// --- 4. ORCHESTRATION ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'START_EXPORT') return;

  (async () => {
    try {
      let letters = [];
      if (msg.scope === 'current') {
        const letter = extractCurrentLetter();
        if (letter) letters.push(letter);
      } else {
        letters = await collectAllLetters();
      }

      if (!letters.length) throw new Error("No letters found on the screen.");
      
      await hydrateAssets(letters);

      chrome.runtime.sendMessage({ type: 'EXPORT_PROGRESS', text: `Formatting ${letters.length} letters...` });
      
      let exportData;
      switch (msg.format) {
        case 'html': exportData = await exportToHtmlZip(letters); break;
        case 'pdf': exportData = await exportToPdf(letters); break;
        case 'docx': exportData = await exportToDocx(letters); break;
        case 'md': exportData = await exportToMarkdown(letters); break;
        case 'txt': exportData = await exportToTxt(letters); break;
        default: throw new Error("Unknown format.");
      }

      chrome.runtime.sendMessage({ type: 'EXPORT_PROGRESS', text: 'Finalizing download...' });

      let binary = '';
      for (let i = 0; i < exportData.bytes.byteLength; i++) {
          binary += String.fromCharCode(exportData.bytes[i]);
      }

      chrome.runtime.sendMessage({ 
        type: 'EXPORT_DONE', 
        payload: {
          filename: exportData.filename,
          mimeType: exportData.mimeType,
          base64: btoa(binary),
          count: letters.length
        }
      });
    } catch (err) {
      chrome.runtime.sendMessage({ type: 'EXPORT_ERROR', text: err.message });
    }
  })();
});