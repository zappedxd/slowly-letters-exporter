import { exportToHtmlZip } from './exporters/html.js';
import { exportToPdf } from './exporters/pdf.js';
import { exportToDocx } from './exporters/docx.js';
import { exportToMarkdown } from './exporters/markdown.js';
import { exportToTxt } from './exporters/txt.js';

const assetCache = new Map();
const MAX_LETTERS = 500;
let isCancelled = false;

// --- 1. ADVANCED DATE PARSING UTILITY ---
function parseFlexibleDate(dateRaw, timestampRaw) {
  if (timestampRaw) {
    const parsed = Date.parse(timestampRaw);
    if (!isNaN(parsed)) return parsed;
  }
  if (dateRaw) {
    const cleanStr = dateRaw.replace(/[\(\)]/g, '').trim();
    const parsed = Date.parse(cleanStr);
    if (!isNaN(parsed)) return parsed;
  }
  return Date.now();
}

// --- 2. ROBUST DOM EXTRACTION ---
function extractCurrentLetter() {
  const body = document.querySelector('.modal-body .pre-wrap') 
            || document.querySelector('.letter-body') 
            || document.querySelector('[role="document"]');
  if (!body) return null;

  const root = body.closest('.letter') 
            || body.closest('.modal-content') 
            || document.querySelector('[role="dialog"]') 
            || document.body;
            
  const footer = root.querySelector('.modal-footer') || root.querySelector('.letter-footer');
  const stampEl = root.querySelector('img.stamp') || root.querySelector('[class*="stamp"] img');
  const chopWrap = root.querySelector('.chop');
  const audioBtn = root.querySelector('.btn-audio') || root.querySelector('[class*="audio"]');
  
  let chopUrl = '';
  if (chopWrap) {
    const chopImg = chopWrap.querySelector('.chop-img');
    const match = chopImg ? window.getComputedStyle(chopImg).backgroundImage.match(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/i) : null;
    chopUrl = match ? match[1] : '';
  }

  const rawDateStr = footer?.innerText || '';
  const timestampRaw = footer?.querySelector('time[datetime]')?.getAttribute('datetime');
  const timestamp = parseFlexibleDate(rawDateStr, timestampRaw);

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
    photos: [...root.querySelectorAll('.slider img, [data-testid="photo-slider"] img')].map(img => img.src).filter(src => !src.startsWith('data:')),
    audio: {
      url: root.querySelector('a[href*="attachments/audio"]')?.href || '',
      duration: audioBtn ? audioBtn.innerText.trim() : ''
    },
    assets: { stampBytes: null, chopBytes: null, photoBytes: [], audioBytes: null }
  };
}

// --- 3. TRAVERSAL LOGIC ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitUntil(predicate, intervalMs = 40, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !isCancelled) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function findArrows() {
  const anchors = [...document.querySelectorAll('a[href], button')];
  return {
    prev: anchors.find(a => a.querySelector('.icon-chevron-left') || a.className.includes('chevron-left')),
    next: anchors.find(a => a.querySelector('.icon-chevron-right') || a.className.includes('chevron-right'))
  };
}

async function waitAfterNav(oldPath) {
  const pathOk = await waitUntil(() => window.location.pathname !== oldPath, 40, 10000);
  if (!pathOk) return false;
  await sleep(90);

  let prevSnap = null;
  const settled = await waitUntil(() => {
    const body = document.querySelector('.modal-body .pre-wrap') || document.querySelector('.letter-body');
    if (!body) return false;
    const text = body.innerText.trim();
    if (prevSnap === text && text.length > 0) return true;
    prevSnap = text;
    return false;
  }, 40, 10000);

  if (!settled) return false;

  const header = document.querySelector('.friend-header');
  if (header) {
    if (header.querySelector('.icon-mic')) {
      await waitUntil(() => !!document.querySelector('a[href*="attachments/audio"]'), 100, 5000);
    }
    if (header.querySelector('.icon-attachment-2')) {
      await waitUntil(() => !!document.querySelector('.slider img'), 100, 5000);
    }
  }

  await sleep(40);
  return true;
}

async function collectAllLetters() {
  const letters = [];
  const seenUrls = new Set();

  updateWidgetStatus('Rewinding to thread start...', 'working');
  let steps = 0;
  
  while (steps < MAX_LETTERS && !isCancelled) {
    const { prev } = findArrows();
    if (!prev) break;
    
    const oldPath = window.location.pathname;
    prev.click();
    const moved = await waitAfterNav(oldPath);
    if (!moved) break;
    steps++;
  }

  let consecutiveFailures = 0;
  while (letters.length < MAX_LETTERS && !isCancelled) {
    const fp = window.location.pathname;
    
    if (!seenUrls.has(fp)) {
      seenUrls.add(fp);
      const letter = extractCurrentLetter();
      if (letter) {
        letters.push(letter);
        consecutiveFailures = 0;
        updateWidgetStatus('Collected letter ' + letters.length + '...', 'working');
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
  
  if (isCancelled) throw new Error("Export cancelled by user.");
  return letters;
}

// --- 4. ASSET PIPELINE ---
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
  updateWidgetStatus('Downloading images and stamps...', 'working');
  for (const l of letters) {
    if (isCancelled) throw new Error("Export cancelled during asset download.");
    l.assets.stampBytes = await fetchAsset(l.stamp);
    l.assets.chopBytes = await fetchAsset(l.chopUrl);
    for (const photo of l.photos) l.assets.photoBytes.push(await fetchAsset(photo));
    l.assets.audioBytes = await fetchAsset(l.audio.url);
  }
}

// --- 5. BATCH 3: FLOATING UI & SPA LIFECYCLE ---

const WIDGET_HTML = `
  <div id="slowly-exporter-launcher">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
  </div>
  <div id="slowly-exporter-panel" class="hidden">
    <div class="se-header">
      <h3>Slowly Exporter</h3>
      <div class="se-controls">
        <button id="se-min-btn">−</button>
        <button id="se-close-btn">×</button>
      </div>
    </div>
    <div class="se-body">
      <div class="se-form-group">
        <label>Format</label>
        <select id="se-format">
          <option value="docx">Word (.docx)</option>
          <option value="pdf">PDF</option>
          <option value="md">Markdown</option>
          <option value="txt">Plain Text</option>
          <option value="html">HTML ZIP</option>
        </select>
      </div>
      
      <div class="se-form-group">
        <label>Order</label>
        <select id="se-order">
          <option value="asc">Oldest → Newest</option>
          <option value="desc">Newest → Oldest</option>
        </select>
      </div>

      <label class="se-checkbox">
        <input type="checkbox" id="se-pagebreak"> Page break per letter
      </label>

      <div class="se-actions">
        <button id="se-start-btn">Export Thread</button>
        <button id="se-cancel-btn" disabled>Cancel</button>
      </div>
      <div id="se-status" class="se-status-idle">Ready</div>
    </div>
  </div>
`;

// Responsive Dark/Light minimal CSS Theme with MAX Specificity
const WIDGET_CSS = `
  #slowly-exporter-wrapper {
    --se-bg: #ffffff;
    --se-text: #334155;
    --se-text-muted: #64748b;
    --se-header-bg: #f8fafc;
    --se-border: #e2e8f0;
    --se-input-bg: #ffffff;
    --se-input-border: #cbd5e1;
    --se-btn-primary: #3b82f6; 
    --se-btn-text: #ffffff;
    --se-btn-danger: #ef4444;
    --se-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);
    
    --se-st-idle-bg: #f1f5f9; --se-st-idle-txt: #64748b;
    --se-st-work-bg: #fef3c7; --se-st-work-txt: #92400e;
    --se-st-err-bg: #fee2e2; --se-st-err-txt: #991b1b;
    --se-st-succ-bg: #dcfce7; --se-st-succ-txt: #166534;

    position: fixed !important; bottom: 24px !important; right: 24px !important; z-index: 999999 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif !important;
    color: var(--se-text) !important;
  }

  @media (prefers-color-scheme: dark) {
    #slowly-exporter-wrapper {
      --se-bg: #1e293b;
      --se-text: #f8fafc;
      --se-text-muted: #94a3b8;
      --se-header-bg: #0f172a;
      --se-border: #334155;
      --se-input-bg: #0f172a;
      --se-input-border: #475569;
      --se-btn-primary: #3b82f6;
      --se-btn-danger: #ef4444;
      --se-shadow: 0 10px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.5);

      --se-st-idle-bg: #334155; --se-st-idle-txt: #cbd5e1;
      --se-st-work-bg: #451a03; --se-st-work-txt: #fde68a;
      --se-st-err-bg: #450a0a; --se-st-err-txt: #fca5a5;
      --se-st-succ-bg: #052e16; --se-st-succ-txt: #86efac;
    }
  }

  #slowly-exporter-wrapper * { box-sizing: border-box !important; }

  #slowly-exporter-launcher {
    width: 52px !important; height: 52px !important; border-radius: 26px !important; 
    background: var(--se-btn-primary) !important; color: var(--se-btn-text) !important;
    display: flex !important; align-items: center !important; justify-content: center !important; 
    cursor: pointer !important; box-shadow: var(--se-shadow) !important; transition: transform 0.2s !important;
  }
  #slowly-exporter-launcher:hover { transform: scale(1.05) !important; }
  
  #slowly-exporter-panel {
    width: 300px !important; background: var(--se-bg) !important; border-radius: 12px !important; 
    box-shadow: var(--se-shadow) !important; border: 1px solid var(--se-border) !important;
    overflow: hidden !important; display: flex !important; flex-direction: column !important; 
    position: absolute !important; bottom: 70px !important; right: 0 !important;
  }
  #slowly-exporter-panel.hidden { display: none !important; }
  
  #slowly-exporter-wrapper .se-header {
    background: var(--se-header-bg) !important; padding: 12px 16px !important; 
    display: flex !important; justify-content: space-between !important;
    align-items: center !important; border-bottom: 1px solid var(--se-border) !important;
  }
  #slowly-exporter-wrapper .se-header h3 { 
    margin: 0 !important; font-size: 15px !important; font-weight: 600 !important; color: var(--se-text) !important; 
  }
  
  #slowly-exporter-wrapper .se-controls button {
    background: none !important; border: none !important; font-size: 18px !important; cursor: pointer !important; 
    color: var(--se-text-muted) !important; padding: 0 4px !important; border-radius: 4px !important;
  }
  #slowly-exporter-wrapper .se-controls button:hover { background: var(--se-border) !important; color: var(--se-text) !important; }
  
  #slowly-exporter-wrapper .se-body { 
    padding: 16px !important; display: flex !important; flex-direction: column !important; gap: 14px !important; 
  }
  
  #slowly-exporter-wrapper .se-form-group { 
    display: flex !important; justify-content: space-between !important; align-items: center !important; 
  }
  #slowly-exporter-wrapper label { 
    font-size: 13px !important; font-weight: 500 !important; color: var(--se-text-muted) !important; 
  }
  #slowly-exporter-wrapper select { 
    padding: 6px 8px !important; border-radius: 6px !important; border: 1px solid var(--se-input-border) !important; 
    background: var(--se-input-bg) !important; color: var(--se-text) !important; outline: none !important; font-size: 13px !important;
  }
  
  #slowly-exporter-wrapper .se-checkbox { 
    font-size: 13px !important; color: var(--se-text-muted) !important; display: flex !important; align-items: center !important; gap: 8px !important; cursor: pointer !important;
  }
  
  #slowly-exporter-wrapper .se-actions { display: flex !important; gap: 8px !important; margin-top: 4px !important; }
  #slowly-exporter-wrapper .se-actions button {
    flex: 1 !important; padding: 10px !important; border: none !important; border-radius: 6px !important; cursor: pointer !important; 
    font-weight: 600 !important; font-size: 13px !important; transition: opacity 0.2s !important; color: var(--se-btn-text) !important;
  }
  #se-start-btn { background: var(--se-btn-primary) !important; }
  #se-cancel-btn { background: var(--se-btn-danger) !important; }
  #slowly-exporter-wrapper .se-actions button:disabled { opacity: 0.5 !important; cursor: not-allowed !important; }
  
  #se-status { 
    font-size: 12px !important; padding: 8px !important; border-radius: 6px !important; text-align: center !important; font-weight: 500 !important; 
  }
  .se-status-idle { background: var(--se-st-idle-bg) !important; color: var(--se-st-idle-txt) !important; }
  .se-status-working { background: var(--se-st-work-bg) !important; color: var(--se-st-work-txt) !important; }
  .se-status-error { background: var(--se-st-err-bg) !important; color: var(--se-st-err-txt) !important; }
  .se-status-success { background: var(--se-st-succ-bg) !important; color: var(--se-st-succ-txt) !important; }
`;

function updateWidgetStatus(text, state) {
  if (!state) { state = 'idle'; }
  const statusEl = document.getElementById('se-status');
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.className = 'se-status-' + state; 
  }
}

function lockWidget(locked) {
  const formatEl = document.getElementById('se-format');
  const orderEl = document.getElementById('se-order');
  const pbEl = document.getElementById('se-pagebreak');
  const startBtn = document.getElementById('se-start-btn');
  const cancelBtn = document.getElementById('se-cancel-btn');

  if(formatEl) formatEl.disabled = locked;
  if(orderEl) orderEl.disabled = locked;
  if(pbEl) pbEl.disabled = locked;
  if(startBtn) startBtn.disabled = locked;
  if(cancelBtn) cancelBtn.disabled = !locked;
}

function injectUI() {
  if (document.getElementById('slowly-exporter-wrapper') || sessionStorage.getItem('se_closed') === 'true') return;

  const wrapper = document.createElement('div');
  wrapper.id = 'slowly-exporter-wrapper';
  
  // FIX: Inject <style> safely into our own wrapper to prevent React <head> DOMExceptions
  wrapper.innerHTML = '<style>' + WIDGET_CSS + '</style>' + WIDGET_HTML;

  try {
    document.body.appendChild(wrapper);
  } catch (err) {
    console.error("Slowly Exporter: Failed to inject UI", err);
    return;
  }

  // Widget State Logic
  const panel = document.getElementById('slowly-exporter-panel');
  const launcher = document.getElementById('slowly-exporter-launcher');
  
  if (launcher && panel) {
    launcher.addEventListener('click', () => panel.classList.toggle('hidden'));
  }

  const minBtn = document.getElementById('se-min-btn');
  if(minBtn) minBtn.addEventListener('click', () => panel.classList.add('hidden'));

  const closeBtn = document.getElementById('se-close-btn');
  if(closeBtn) closeBtn.addEventListener('click', () => {
    wrapper.remove();
    sessionStorage.setItem('se_closed', 'true');
  });

  // Export Logic Connection
  const startBtn = document.getElementById('se-start-btn');
  if(startBtn) {
    startBtn.addEventListener('click', () => {
      const format = document.getElementById('se-format').value;
      const order = document.getElementById('se-order').value;
      const pbEl = document.getElementById('se-pagebreak');
      const pageBreak = pbEl ? pbEl.checked : false;
      
      isCancelled = false;
      lockWidget(true);
      updateWidgetStatus('Initializing...', 'working');
      runExportEngine(format, order, pageBreak);
    });
  }

  const cancelBtn = document.getElementById('se-cancel-btn');
  if(cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      isCancelled = true;
      updateWidgetStatus('Cancelling...', 'working');
    });
  }
}

// Safer MutationObserver initialization
const observer = new MutationObserver(() => {
  if (document.body && !document.getElementById('slowly-exporter-wrapper') && sessionStorage.getItem('se_closed') !== 'true') {
    injectUI();
  }
});

// Initialize UI carefully
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectUI();
    observer.observe(document.body, { childList: true, subtree: true });
  });
} else {
  injectUI();
  observer.observe(document.body, { childList: true, subtree: true });
}

// --- 6. ORCHESTRATION ---
async function runExportEngine(format, order, pageBreak) {
  try {
    let letters = await collectAllLetters();

    if (!letters.length) throw new Error("No letters found on the screen.");
    
    updateWidgetStatus('Applying chronological sort...', 'working');
    
    letters.sort((a, b) => {
      return order === 'asc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
    });

    await hydrateAssets(letters);

    updateWidgetStatus('Formatting ' + letters.length + ' letters...', 'working'); 
    
    let exportData;
    switch (format) {
      case 'html': exportData = await exportToHtmlZip(letters); break;
      case 'pdf': exportData = await exportToPdf(letters, pageBreak); break;
      case 'docx': exportData = await exportToDocx(letters, pageBreak); break;
      case 'md': exportData = await exportToMarkdown(letters); break;
      case 'txt': exportData = await exportToTxt(letters); break;
      default: throw new Error("Unknown format.");
    }

    if (isCancelled) throw new Error("Export cancelled before finalizing.");

    updateWidgetStatus('Finalizing download...', 'working');

    let binary = '';
    for (let i = 0; i < exportData.bytes.byteLength; i++) {
        binary += String.fromCharCode(exportData.bytes[i]);
    }

    // Send payload to background.js for reliable download handling
    chrome.runtime.sendMessage({ 
      type: 'EXPORT_DONE', 
      payload: {
        filename: exportData.filename,
        mimeType: exportData.mimeType,
        base64: btoa(binary),
        count: letters.length
      }
    });

    updateWidgetStatus('Success! Saved ' + letters.length + ' letter(s).', 'success'); 
  } catch (err) {
    updateWidgetStatus(err.message, 'error');
  } finally {
    lockWidget(false);
  }
}