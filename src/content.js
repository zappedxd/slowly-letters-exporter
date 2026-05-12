import { exportToHtmlZip }  from './exporters/html.js';
import { exportToPdf }      from './exporters/pdf.js';
import { exportToDocx }     from './exporters/docx.js';
import { exportToMarkdown } from './exporters/markdown.js';
import { exportToTxt }      from './exporters/txt.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_MS        = 40;
const NAV_TIMEOUT_MS = 10_000;
const AFTER_PATH_MS  = 90;
const POST_STABLE_MS = 40;
const MAX_LETTERS    = 500;

const SESSION_DISMISS_KEY = 'slowly-exp-dismissed';
const ROOT_ID             = 'slowly-letter-exporter-root';
const CARD_ID             = 'slowly-letter-exporter-card';
const LAUNCHER_ID         = 'slowly-exp-launcher';

// ─── Mutable state ────────────────────────────────────────────────────────────

const assetCache    = new Map();
let isCancelled     = false;
let exportRunning   = false;
let panelRepairTimer = null;

// ─── 1. ADVANCED DATE PARSING ─────────────────────────────────────────────────

function parseFlexibleDate(dateRaw, timestampRaw) {
  if (timestampRaw) {
    const p = Date.parse(timestampRaw);
    if (!isNaN(p)) return p;
  }
  if (dateRaw) {
    const p = Date.parse(dateRaw.replace(/[()]/g, '').trim());
    if (!isNaN(p)) return p;
  }
  return Date.now();
}

// ─── 2. DOM EXTRACTION ────────────────────────────────────────────────────────

function getCurrentUserName() {
  // Look for the user's avatar in the header — the alt attribute contains the username
  const headerAvatar = document.querySelector('header img.rounded-circle[alt]');
  if (headerAvatar) {
    const username = headerAvatar.getAttribute('alt')?.trim();
    if (username && username.length > 2 && username.length < 30) {
      return username;
    }
  }
  
  // Fallback: Try to find avatar in top navigation
  const navAvatars = document.querySelectorAll('img[alt][src*="avatar"]');
  for (const avatar of navAvatars) {
    const username = avatar.getAttribute('alt')?.trim();
    if (username && username.length > 2 && username.length < 30 && 
        !['Logout', 'Settings', 'Profile'].includes(username)) {
      return username;
    }
  }
  
  return 'Me';
}

function findLetterBodyEl() {
  const dialog    = document.querySelector('[role="dialog"]');
  const modalBody =
    document.querySelector('[class*="modal-body"]') ||
    (dialog && dialog.querySelector('[class*="modal-body"], article'));

  const pre =
    (modalBody && modalBody.querySelector('.pre-wrap')) ||
    (dialog    && dialog.querySelector('.pre-wrap'))    ||
    document.querySelector('.modal-body .pre-wrap');

  if (pre && pre.innerText.trim()) return pre;
  return document.querySelector('.modal-body .pre-wrap');
}

function findLetterFooter() {
  const dialog = document.querySelector('[role="dialog"]');
  return (
    document.querySelector('.modal-footer') ||
    (dialog && dialog.querySelector('[class*="modal-footer"], footer'))
  );
}

function isLetterViewOpen() {
  const body = findLetterBodyEl();
  return !!(body && body.innerText.trim());
}

function extractCurrentLetter() {
  const body = findLetterBodyEl();
  if (!body) return null;

  const text = body.innerText.trim();
  if (!text) return null;

  const root    = body.closest('.letter') || body.closest('.modal-content') ||
                  document.querySelector('[role="dialog"]') || document.body;
  const footer  = findLetterFooter();
  const stampEl = root.querySelector('img.stamp') || root.querySelector('[class*="stamp"] img');
  const chopWrap = root.querySelector('.chop');
  const audioBtn = root.querySelector('.btn-audio') || root.querySelector('[class*="audio"]');

  let chopUrl = '';
  if (chopWrap) {
    const chopImg = chopWrap.querySelector('.chop-img');
    const match   = chopImg
      ? window.getComputedStyle(chopImg).backgroundImage.match(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/i)
      : null;
    chopUrl = match ? match[1] : '';
  }

  const senderEl =
    footer?.querySelector('.text-primary')        ||
    footer?.querySelector('[class*="text-primary"]') ||
    footer?.querySelector('strong, b');

  const timeIsoEl  = footer?.querySelector('time[datetime]');
  const dateIso    = timeIsoEl?.getAttribute('datetime')?.trim() || '';
  const rawDateStr = footer?.innerText || '';
  const timestamp  = parseFlexibleDate(rawDateStr, dateIso);

  const currentUser = getCurrentUserName();

  return {
    id: crypto.randomUUID(),
    sender: senderEl ? senderEl.innerText.trim() : 'Unknown',
    receiver: currentUser,
    timestamp,
    date:    timeIsoEl ? (timeIsoEl.innerText.trim().split('\n')[0].trim() || dateIso)
                       : (footer?.querySelector('p')?.innerText.trim().split('\n')[0].trim() || ''),
    dateIso,
    dateStr: new Date(timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    text,
    url:      location.pathname,
    stamp:    stampEl ? stampEl.src : '',
    chopUrl,
    chopCountry: chopWrap ? chopWrap.innerText.trim() : '',
    photos:  [...root.querySelectorAll('.slider img, [data-testid="photo-slider"] img')]
               .map(img => img.src).filter(src => !src.startsWith('data:')),
    audio: {
      url:      root.querySelector('a[href*="attachments/audio"]')?.href || '',
      duration: audioBtn ? audioBtn.innerText.trim() : '',
    },
    assets: { stampBytes: null, chopBytes: null, photoBytes: [], audioBytes: null },
  };
}

// ─── 3. NAVIGATION HELPERS ────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function currentFingerprint() { return location.pathname; }

async function waitUntil(predicate, intervalMs = POLL_MS, timeoutMs = NAV_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !isCancelled) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function findPrevNextLinks() {
  const scope = document.querySelector('[class*="friend-header"]') || document.querySelector('header');
  const root  = scope || document;

  const anchors   = [...root.querySelectorAll('a[href], button')];
  const hasLeft   = el => el.querySelector('.icon-chevron-left')  || el.querySelector('[class*="chevron-left"]');
  const hasRight  = el => el.querySelector('.icon-chevron-right') || el.querySelector('[class*="chevron-right"]');

  let prev = anchors.find(hasLeft);
  let next = anchors.find(hasRight);

  // Fallback wider search
  if (!prev || !next) {
    const wider = [...document.querySelectorAll('[class*="friend-header"] a[href]')];
    if (!prev) prev = wider.find(hasLeft);
    if (!next) next = wider.find(hasRight);
  }

  return { prev: prev || null, next: next || null };
}

async function waitAfterNav(oldPath) {
  const pathOk = await waitUntil(() => currentFingerprint() !== oldPath, POLL_MS, NAV_TIMEOUT_MS);
  if (!pathOk) return false;
  await sleep(AFTER_PATH_MS);

  let prevSnap = null;
  const settled = await waitUntil(() => {
    const letter = extractCurrentLetter();
    if (!letter || !letter.text) return false;
    if (prevSnap === letter.text) return true;
    prevSnap = letter.text;
    return false;
  }, POLL_MS, NAV_TIMEOUT_MS);

  if (!settled) return false;

  const header = document.querySelector('[class*="friend-header"]');
  if (header) {
    if (header.querySelector('.icon-mic'))
      await waitUntil(() => !!document.querySelector('a[href*="attachments/audio"]'), 100, 5000);
    if (header.querySelector('.icon-attachment-2'))
      await waitUntil(() => !!document.querySelector('.slider img'), 100, 5000);
  }

  await sleep(POST_STABLE_MS);
  return true;
}

// ─── 4. LETTER COLLECTION ─────────────────────────────────────────────────────

async function collectAllLetters() {
  const letters          = [];
  const seenUrls         = new Set();
  const parseFailedUrls  = [];

  // Rewind to thread start
  setPanelStatus('Finding thread start…', 'working');
  let steps = 0;
  while (steps < MAX_LETTERS && !isCancelled) {
    const { prev } = findPrevNextLinks();
    if (!prev) break;
    const before = currentFingerprint();
    prev.click();
    const moved = await waitAfterNav(before);
    if (!moved) {
      setPanelStatus('⚠️ Page navigation timed out while rewinding — starting collection from current position…', 'working');
      await new Promise(r => setTimeout(r, 2000));
      break;
    }
    steps++;
  }

  if (isCancelled) throw new Error('Export cancelled by user.');

  // Walk forward collecting
  let consecutiveFailures = 0;
  while (letters.length < MAX_LETTERS && !isCancelled) {
    const fp = currentFingerprint();

    if (!seenUrls.has(fp)) {
      seenUrls.add(fp);
      const letter = extractCurrentLetter();
      if (letter) {
        letters.push(letter);
        consecutiveFailures = 0;
        setPanelStatus(`Collected ${letters.length} letter${letters.length === 1 ? '' : 's'}…`, 'working');
      } else {
        consecutiveFailures++;
        parseFailedUrls.push(fp);
        if (consecutiveFailures >= 3) {
          setPanelStatus(
            `⚠️ Couldn't read ${consecutiveFailures} letters in a row — the page layout may have changed. Stopping collection early.\n\nProceeding with ${letters.length} letter${letters.length === 1 ? '' : 's'} collected so far…`,
            'working'
          );
          await new Promise(r => setTimeout(r, 2500));
          break;
        }
      }
    }

    const { next } = findPrevNextLinks();
    if (!next) break;

    const before = currentFingerprint();
    next.click();
    const moved = await waitAfterNav(before);
    if (!moved) {
      setPanelStatus(
        `⚠️ Navigation timed out after letter ${letters.length} — the page stopped responding.\n\nProceeding with what was collected so far…`,
        'working'
      );
      await new Promise(r => setTimeout(r, 2500));
      break;
    }
  }

  if (isCancelled) throw new Error('Export cancelled by user.');

  // Surface any individual parse failures (but don't block the export)
  if (parseFailedUrls.length > 0 && consecutiveFailures < 3) {
    setPanelStatus(
      `⚠️ ${parseFailedUrls.length} letter${parseFailedUrls.length === 1 ? '' : 's'} couldn't be read and were skipped.\n\nExport continuing with ${letters.length} letter${letters.length === 1 ? '' : 's'}…`,
      'working'
    );
    await new Promise(r => setTimeout(r, 2000));
  }

  return letters;
}

// ─── 5. ASSET PIPELINE ────────────────────────────────────────────────────────

const AUDIO_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

async function fetchAsset(url, isAudio = false) {
  if (!url) return { bytes: null, skipped: false };
  if (assetCache.has(url)) return { bytes: assetCache.get(url), skipped: false };
  try {
    const res = await fetch(url);

    // Check Content-Length header first to avoid a needless download
    if (isAudio) {
      const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
      if (contentLength > AUDIO_SIZE_LIMIT) {
        const mb = (contentLength / 1024 / 1024).toFixed(1);
        console.warn(`[Slowly Exporter] Audio skipped — ${mb} MB > 10 MB limit: ${url}`);
        return { bytes: null, skipped: true, mb };
      }
    }

    const bytes = new Uint8Array(await res.arrayBuffer());

    // Secondary guard in case Content-Length was absent
    if (isAudio && bytes.byteLength > AUDIO_SIZE_LIMIT) {
      const mb = (bytes.byteLength / 1024 / 1024).toFixed(1);
      console.warn(`[Slowly Exporter] Audio skipped after download — ${mb} MB > 10 MB limit: ${url}`);
      return { bytes: null, skipped: true, mb };
    }

    assetCache.set(url, bytes);
    return { bytes, skipped: false };
  } catch (err) {
    console.warn(`[Slowly Exporter] Failed to fetch asset: ${url}`, err);
    return { bytes: null, skipped: false, fetchError: true, url };
  }
}

async function hydrateAssets(letters) {
  setPanelStatus('Downloading stamps & photos…', 'working');
  const skippedAudio  = [];
  const failedAssets  = [];

  for (const l of letters) {
    if (isCancelled) throw new Error('Export cancelled during asset download.');

    const stampResult = await fetchAsset(l.stamp);
    l.assets.stampBytes = stampResult.bytes;
    if (stampResult.fetchError) failedAssets.push(`stamp for ${l.sender} (${l.dateStr})`);

    const chopResult = await fetchAsset(l.chopUrl);
    l.assets.chopBytes = chopResult.bytes;
    if (chopResult.fetchError) failedAssets.push(`chop image for ${l.sender} (${l.dateStr})`);

    for (const photo of l.photos) {
      const photoResult = await fetchAsset(photo);
      l.assets.photoBytes.push(photoResult.bytes);
      if (photoResult.fetchError) failedAssets.push(`photo in ${l.sender}'s letter (${l.dateStr})`);
    }

    const audioResult   = await fetchAsset(l.audio.url, true);
    l.assets.audioBytes = audioResult.bytes;
    if (audioResult.skipped) {
      skippedAudio.push({ sender: l.sender, date: l.dateStr, mb: audioResult.mb });
    } else if (audioResult.fetchError) {
      failedAssets.push(`audio in ${l.sender}'s letter (${l.dateStr})`);
    }
  }

  // Warn about oversized audio
  if (skippedAudio.length > 0) {
    const lines = skippedAudio.map(a => `• ${a.sender} (${a.date}) — ${a.mb} MB`).join('\n');
    setPanelStatus(
      `⚠️ ${skippedAudio.length} audio file${skippedAudio.length === 1 ? '' : 's'} skipped (> 10 MB):\n${lines}\n\nExport continuing…`,
      'working'
    );
    await new Promise(r => setTimeout(r, 2500));
  }

  // Warn about other download failures
  if (failedAssets.length > 0) {
    const lines = failedAssets.map(a => `• ${a}`).join('\n');
    setPanelStatus(
      `⚠️ ${failedAssets.length} asset${failedAssets.length === 1 ? '' : 's'} couldn't be downloaded (network error):\n${lines}\n\nExport continuing without them…`,
      'working'
    );
    await new Promise(r => setTimeout(r, 2500));
  }
}

// ─── 6. UI — STYLES ───────────────────────────────────────────────────────────

const WIDGET_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Special+Elite&display=swap');

  #${ROOT_ID} {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 2147483645;
    pointer-events: none;
    font-family: 'Lato', system-ui, -apple-system, sans-serif;
    font-size: 13px;
  }
  #${ROOT_ID} .sle-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    pointer-events: auto;
  }

  /* ── Launcher FAB ── */
  #${LAUNCHER_ID} {
    width: 50px; height: 50px;
    border-radius: 50%; border: none; cursor: pointer;
    background: #4a3520; color: #fdf6e3;
    font-size: 22px; line-height: 1;
    box-shadow: 0 4px 16px rgba(74,53,32,.45);
    flex-shrink: 0;
    transition: transform .15s, box-shadow .15s;
    display: flex; align-items: center; justify-content: center;
  }
  #${LAUNCHER_ID}:hover { transform: scale(1.06); box-shadow: 0 6px 20px rgba(74,53,32,.55); }

  /* ── Card Shell ── */
  #${CARD_ID} {
    display: none; flex-direction: column;
    width: 292px;
    max-width: calc(100vw - 32px);
    max-height: min(640px, calc(100vh - 80px));
    box-sizing: border-box;
    background: #fdf6e3;
    border-radius: 16px;
    border: 2.5px solid #c9a96e;
    box-shadow: 0 8px 32px rgba(74,53,32,.22);
    overflow: hidden;
  }
  #${CARD_ID}.sle-visible { display: flex; }

  /* ── Airmail stripes ── */
  .sle-airmail {
    height: 8px;
    background: repeating-linear-gradient(
      90deg,
      #c0392b 0px,  #c0392b 10px,
      #fdf6e3 10px, #fdf6e3 15px,
      #2471a3 15px, #2471a3 25px,
      #fdf6e3 25px, #fdf6e3 30px
    );
    flex-shrink: 0;
  }
  .sle-airmail-bottom {
    height: 8px;
    background: repeating-linear-gradient(
      90deg,
      #2471a3 0px,  #2471a3 10px,
      #fdf6e3 10px, #fdf6e3 15px,
      #c0392b 15px, #c0392b 25px,
      #fdf6e3 25px, #fdf6e3 30px
    );
    flex-shrink: 0;
  }

  /* ── Header ── */
  .sle-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px 8px;
    background: #f5ead0;
    border-bottom: 1px solid #e0c898;
    flex-shrink: 0;
  }
  .sle-title-group { display: flex; align-items: center; gap: 7px; }
  .sle-title-icon  { font-size: 17px; color: #7a5c2e; }
  .sle-title {
    font-family: 'Special Elite', 'Courier New', monospace;
    font-size: 13px; color: #3a2510; letter-spacing: .02em; white-space: nowrap;
  }
  .sle-head-actions { display: flex; gap: 3px; }
  .sle-icon-btn {
    width: 26px; height: 26px; border: none; border-radius: 6px;
    background: transparent; color: #7a5c2e;
    font-size: 17px; line-height: 1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .sle-icon-btn:hover { background: rgba(122,92,46,.12); }

  /* ── Scrollable body ── */
  .sle-scroll {
    overflow-y: auto; padding: 12px 12px 10px;
    flex: 1; min-height: 0;
    display: flex; flex-direction: column; gap: 11px;
  }

  /* ── Section labels ── */
  .sle-label {
    font-size: 10px; font-weight: 700; color: #9a7040;
    letter-spacing: .1em; text-transform: uppercase; margin-bottom: 5px;
  }

  /* ── Format tiles ── */
  .sle-fmt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .sle-fmt-tile {
    background: #fff9ed; border: 1.5px solid #d9b97a; border-radius: 9px;
    padding: 7px 9px; cursor: pointer; text-align: left;
    transition: border-color .12s, background .12s;
    display: flex; flex-direction: column; gap: 2px;
  }
  .sle-fmt-tile:hover { border-color: #b08040; background: #fdf3d8; }
  .sle-fmt-tile.sle-selected { border-color: #4a3520; background: #4a3520; }
  .sle-fmt-name { font-size: 12px; font-weight: 700; color: #3a2510; }
  .sle-fmt-tile.sle-selected .sle-fmt-name { color: #fdf6e3; }
  .sle-fmt-desc { font-size: 10px; color: #8c6d3f; line-height: 1.35; }
  .sle-fmt-tile.sle-selected .sle-fmt-desc { color: #d9b97a; }

  /* ── Order buttons ── */
  .sle-order-row { display: flex; gap: 6px; }
  .sle-order-btn {
    flex: 1; padding: 7px 6px; border-radius: 8px;
    border: 1.5px solid #d9b97a; background: #fff9ed;
    color: #3a2510; font-size: 11px; font-weight: 700;
    cursor: pointer; transition: all .12s; white-space: nowrap;
  }
  .sle-order-btn:hover { border-color: #b08040; background: #fdf3d8; }
  .sle-order-btn.sle-selected { background: #4a3520; color: #fdf6e3; border-color: #4a3520; }

  /* ── Page-break row ── */
  .sle-pb-row {
    display: flex; align-items: flex-start; gap: 7px;
    font-size: 11.5px; color: #5a3e1b; line-height: 1.4; cursor: pointer;
  }
  .sle-pb-row input[type="checkbox"] {
    margin-top: 2px; accent-color: #4a3520; flex-shrink: 0;
  }

  /* ── Warning banner (hidden once letter is open) ── */
  .sle-warning {
    display: flex; align-items: flex-start; gap: 8px;
    background: #fff4e0; border: 1.5px solid #e6a830;
    border-radius: 9px; padding: 8px 10px;
    font-size: 11px; color: #7a4f00; line-height: 1.45;
  }
  .sle-warning-icon { font-size: 15px; flex-shrink: 0; margin-top: 1px; }

  /* ── Status box ── */
  .sle-status {
    display: none; border-radius: 8px; padding: 7px 10px;
    font-size: 11px; line-height: 1.45; color: #555;
    background: #f5f0e8; border: 1px solid #d9c9aa;
    white-space: pre-wrap; word-break: break-word;
  }
  .sle-status[role="status"] { }
  .sle-status-working { background: #fef8e7; border-color: #e8c84a; color: #7a5a00; display: block !important; }
  .sle-status-error   { background: #fff2f2; border-color: #e0a4a4; color: #8b2e2e; display: block !important; }
  .sle-status-done    { background: #f3faf3; border-color: #a4cba4; color: #2d5a2d; display: block !important; }

  /* ── Action row ── */
  .sle-actions-row {
    display: flex; gap: 7px; flex-shrink: 0;
    padding: 10px 12px;
    background: #f5ead0;
    border-top: 1px solid #e0c898;
  }
  .sle-export-btn {
    flex: 1; padding: 10px; border-radius: 9px; border: none;
    background: #4a3520; color: #fdf6e3;
    font-family: 'Special Elite', 'Courier New', monospace;
    font-size: 12.5px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    transition: background .12s;
  }
  .sle-export-btn:hover:not(:disabled) { background: #362810; }
  .sle-export-btn:disabled { opacity: .5; cursor: not-allowed; }
  .sle-cancel-btn {
    padding: 10px 14px; border-radius: 9px;
    border: 1.5px solid #c9a96e; background: #fff9ed;
    color: #7a5c2e; font-size: 12px; font-weight: 700;
    cursor: pointer; transition: background .12s;
  }
  .sle-cancel-btn:hover:not(:disabled) { background: #f5e8cc; }
  .sle-cancel-btn:disabled { opacity: .5; cursor: not-allowed; }
`;

// ─── 7. UI — INJECTION ────────────────────────────────────────────────────────

function injectPanelStyles() {
  if (document.getElementById('sle-styles')) return;
  const style   = document.createElement('style');
  style.id      = 'sle-styles';
  style.textContent = WIDGET_CSS;
  (document.head || document.documentElement).appendChild(style);
}

function updateLetterWarning() {
  const banner = document.getElementById('sle-warning');
  if (!banner) return;
  banner.style.display = isLetterViewOpen() ? 'none' : 'flex';
}

function injectPermanentPanel() {
  try { if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') return; } catch (_) {}
  if (document.getElementById(ROOT_ID)) return;

  injectPanelStyles();

  // ── Root wrapper ────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.id    = ROOT_ID;
  wrap.setAttribute('data-slowly-exporter', 'root');

  const stack       = document.createElement('div');
  stack.className   = 'sle-stack';

  // ── Card ────────────────────────────────────────────────────────────────────
  const card = document.createElement('aside');
  card.id    = CARD_ID;
  card.setAttribute('data-slowly-exporter', 'card');

  // Top airmail stripe
  const stripeTop       = document.createElement('div');
  stripeTop.className   = 'sle-airmail';

  // Header
  const head            = document.createElement('div');
  head.className        = 'sle-head';

  const titleGroup      = document.createElement('div');
  titleGroup.className  = 'sle-title-group';
  const titleIcon       = document.createElement('span');
  titleIcon.className   = 'sle-title-icon';
  titleIcon.textContent = '✉';
  const titleText       = document.createElement('span');
  titleText.className   = 'sle-title';
  titleText.textContent = 'Slowly Letter Exporter';
  titleGroup.append(titleIcon, titleText);

  const headActions    = document.createElement('div');
  headActions.className = 'sle-head-actions';

  const minBtn = document.createElement('button');
  minBtn.type  = 'button';
  minBtn.className   = 'sle-icon-btn';
  minBtn.title       = 'Minimise';
  minBtn.setAttribute('aria-label', 'Minimise');
  minBtn.textContent = '−';
  minBtn.addEventListener('click', e => { e.stopPropagation(); collapseCard(); });

  const closeBtn       = document.createElement('button');
  closeBtn.type        = 'button';
  closeBtn.className   = 'sle-icon-btn';
  closeBtn.title       = 'Close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch (_) {}
    wrap.remove();
  });

  headActions.append(minBtn, closeBtn);
  head.append(titleGroup, headActions);

  // Scrollable body
  const scroll      = document.createElement('div');
  scroll.className  = 'sle-scroll';

  // ── Format section ──────────────────────────────────────────────────────────
  const fmtLabel        = document.createElement('div');
  fmtLabel.className    = 'sle-label';
  fmtLabel.textContent  = 'Format';

  const fmtGrid       = document.createElement('div');
  fmtGrid.className   = 'sle-fmt-grid';

  const formats = [
    { value: 'docx', name: 'Word (.docx)', desc: 'Stamps & photos embedded' },
    { value: 'pdf',  name: 'PDF',          desc: 'Print-ready with photos' },
    { value: 'txt',  name: 'Plain Text',   desc: 'Works everywhere' },
    { value: 'md',   name: 'Markdown',     desc: 'Great for notes & GitHub' },
    { value: 'html', name: 'HTML ZIP',     desc: 'Full fidelity with assets' },
  ];

  formats.forEach((fmt, i) => {
    const tile        = document.createElement('button');
    tile.type         = 'button';
    tile.className    = 'sle-fmt-tile' + (i === 0 ? ' sle-selected' : '');
    tile.dataset.fmt  = fmt.value;

    const nameEl         = document.createElement('span');
    nameEl.className     = 'sle-fmt-name';
    nameEl.textContent   = fmt.name;

    const descEl         = document.createElement('span');
    descEl.className     = 'sle-fmt-desc';
    descEl.textContent   = fmt.desc;

    tile.append(nameEl, descEl);

    tile.addEventListener('click', () => {
      fmtGrid.querySelectorAll('.sle-fmt-tile').forEach(t => t.classList.remove('sle-selected'));
      tile.classList.add('sle-selected');
      const pbRow = document.getElementById('sle-pb-row');
      if (pbRow) pbRow.style.display = (fmt.value === 'docx' || fmt.value === 'pdf') ? 'flex' : 'none';
    });

    fmtGrid.appendChild(tile);
  });

  // ── Order section ───────────────────────────────────────────────────────────
  const orderLabel        = document.createElement('div');
  orderLabel.className    = 'sle-label';
  orderLabel.textContent  = 'Order';

  const orderRow      = document.createElement('div');
  orderRow.className  = 'sle-order-row';

  [
    { value: 'oldest', label: 'Oldest → Newest' },
    { value: 'newest', label: 'Newest → Oldest' },
  ].forEach((opt, i) => {
    const btn           = document.createElement('button');
    btn.type            = 'button';
    btn.className       = 'sle-order-btn' + (i === 0 ? ' sle-selected' : '');
    btn.dataset.order   = opt.value;
    btn.textContent     = opt.label;
    btn.addEventListener('click', () => {
      orderRow.querySelectorAll('.sle-order-btn').forEach(b => b.classList.remove('sle-selected'));
      btn.classList.add('sle-selected');
    });
    orderRow.appendChild(btn);
  });

  // ── Page-break row (docx / pdf only) ────────────────────────────────────────
  const pbRow       = document.createElement('label');
  pbRow.className   = 'sle-pb-row';
  pbRow.id          = 'sle-pb-row';
  const pbCheck     = document.createElement('input');
  pbCheck.type      = 'checkbox';
  pbCheck.id        = 'sle-pagebreak';
  pbRow.append(pbCheck, 'Page break per letter (DOCX / PDF)');

  // ── Warning banner — only visible when no letter is open ────────────────────
  const warning        = document.createElement('div');
  warning.className    = 'sle-warning';
  warning.id           = 'sle-warning';
  warning.style.display = 'none';   // updated by updateLetterWarning()
  const warnIcon       = document.createElement('span');
  warnIcon.className   = 'sle-warning-icon';
  warnIcon.textContent = '⚠️';
  const warnText       = document.createElement('span');
  warnText.textContent = 'No letter is open. Open a letter in Slowly first, then export.';
  warning.append(warnIcon, warnText);

  // ── Status box ──────────────────────────────────────────────────────────────
  const status = document.createElement('div');
  status.id    = 'sle-status';
  status.className = 'sle-status';
  status.setAttribute('role', 'status');

  scroll.append(fmtLabel, fmtGrid, orderLabel, orderRow, pbRow, warning, status);

  // ── Action buttons ──────────────────────────────────────────────────────────
  const actionsRow      = document.createElement('div');
  actionsRow.className  = 'sle-actions-row';

  const exportBtn       = document.createElement('button');
  exportBtn.type        = 'button';
  exportBtn.id          = 'sle-exportBtn';
  exportBtn.className   = 'sle-export-btn';
  exportBtn.innerHTML   = '&#11123; Export Thread';
  exportBtn.addEventListener('click', () => startExportFromPanel());

  const cancelBtn       = document.createElement('button');
  cancelBtn.type        = 'button';
  cancelBtn.id          = 'sle-cancelBtn';
  cancelBtn.className   = 'sle-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.disabled    = true;
  cancelBtn.addEventListener('click', () => {
    isCancelled = true;
    setPanelStatus('Cancelling…', 'working');
  });

  actionsRow.append(exportBtn, cancelBtn);

  // Bottom airmail stripe
  const stripeBottom      = document.createElement('div');
  stripeBottom.className  = 'sle-airmail-bottom';

  // Assemble card
  card.append(stripeTop, head, scroll, actionsRow, stripeBottom);

  // ── Launcher FAB ────────────────────────────────────────────────────────────
  const launcher = document.createElement('button');
  launcher.type  = 'button';
  launcher.id    = LAUNCHER_ID;
  launcher.setAttribute('aria-label', 'Toggle Slowly Letter Exporter');
  launcher.textContent = '✉';
  launcher.title = 'Slowly Letter Exporter';
  launcher.addEventListener('click', e => {
    e.stopPropagation();
    toggleCard();
    updateLetterWarning();
  });

  stack.append(card, launcher);
  wrap.appendChild(stack);

  const host = document.body || document.documentElement;
  host.appendChild(wrap);

  updateLetterWarning();
}

// ─── 8. UI — STATE HELPERS ────────────────────────────────────────────────────

function expandCard()  { document.getElementById(CARD_ID)?.classList.add('sle-visible'); }
function collapseCard(){ document.getElementById(CARD_ID)?.classList.remove('sle-visible'); }
function toggleCard()  { document.getElementById(CARD_ID)?.classList.toggle('sle-visible'); }

function setPanelStatus(text, kind) {
  const el = document.getElementById('sle-status');
  if (!el) return;
  el.textContent  = text || '';
  el.className    = 'sle-status';
  if (kind === 'error')   el.classList.add('sle-status-error');
  else if (kind === 'done')    el.classList.add('sle-status-done');
  else if (kind === 'working') el.classList.add('sle-status-working');
}

function setPanelBusy(busy) {
  const card = document.getElementById(CARD_ID);
  if (!card) return;
  const exportBtn = card.querySelector('#sle-exportBtn');
  const cancelBtn = card.querySelector('#sle-cancelBtn');
  if (exportBtn) exportBtn.disabled = busy;
  if (cancelBtn) cancelBtn.disabled = !busy;
  card.querySelectorAll('.sle-fmt-tile, .sle-order-btn, #sle-pagebreak').forEach(el => {
    el.disabled = busy;
    el.style.pointerEvents = busy ? 'none' : '';
  });
}

function getPanelOptions() {
  const card = document.getElementById(CARD_ID);
  if (!card) return { format: 'docx', order: 'oldest', pageBreak: false };
  const format    = card.querySelector('.sle-fmt-tile.sle-selected')?.dataset.fmt   || 'docx';
  const order     = card.querySelector('.sle-order-btn.sle-selected')?.dataset.order || 'oldest';
  const pageBreak = !!(card.querySelector('#sle-pagebreak')?.checked);
  return { format, order, pageBreak };
}

// ─── 9. SPA LIFECYCLE / PANEL REPAIR ─────────────────────────────────────────

function schedulePanelRepair() {
  try { if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') return; } catch (_) {}
  if (document.getElementById(ROOT_ID)) return;
  clearTimeout(panelRepairTimer);
  panelRepairTimer = setTimeout(() => injectPermanentPanel(), 250);
}

function hookHistoryForPanel() {
  const bump = () => {
    clearTimeout(panelRepairTimer);
    panelRepairTimer = setTimeout(() => injectPermanentPanel(), 120);
  };
  const wrap = orig => function wrappedHistory() {
    const ret = orig.apply(this, arguments);
    bump();
    return ret;
  };
  history.pushState    = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
  window.addEventListener('popstate', bump);
}

// Boot
injectPermanentPanel();
setTimeout(injectPermanentPanel, 400);
setTimeout(injectPermanentPanel, 2000);
hookHistoryForPanel();

new MutationObserver(() => schedulePanelRepair()).observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// Also keep warning banner in sync as the user navigates letters
new MutationObserver(() => updateLetterWarning()).observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
});

// ─── 10. EXPORT ORCHESTRATION ─────────────────────────────────────────────────

function startExportFromPanel() {
  if (exportRunning) return;
  expandCard();
  updateLetterWarning();

  if (!isLetterViewOpen()) {
    setPanelStatus('No letter is open. Open a letter in Slowly first, then try again.', 'error');
    return;
  }

  exportRunning = true;
  isCancelled   = false;
  setPanelBusy(true);
  setPanelStatus('Starting…', 'working');
  runExportEngine(getPanelOptions());
}

async function runExportEngine({ format, order, pageBreak }) {
  try {
    let letters = await collectAllLetters();

    if (!letters.length) throw new Error('No letters could be extracted.');

    setPanelStatus('Sorting by date…', 'working');
    letters.sort((a, b) => b.timestamp - a.timestamp);          // always asc first
    if (order === 'newest') letters.reverse();

    await hydrateAssets(letters);

    setPanelStatus(`Formatting ${letters.length} letter${letters.length === 1 ? '' : 's'}…`, 'working');

    // --- Generate standardized base filename with both sender and receiver ---
    const receiver = letters[0]?.receiver || 'Me';
    const penpal = letters.find(l => l.sender && l.sender !== receiver)?.sender || 'Unknown';
    const safePenpal = penpal.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
    const safeReceiver = receiver.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
    const dateObj = new Date();
    const exportDate = `${String(dateObj.getDate()).padStart(2, '0')}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${dateObj.getFullYear()}`;
    const baseFilename = `Slowly_${safeReceiver}_${safePenpal}_${exportDate}`;
    // ------------------------------------------------

    let exportData;
    switch (format) {
      case 'html': exportData = await exportToHtmlZip(letters, receiver, baseFilename);          break;
      case 'pdf':  exportData = await exportToPdf(letters, receiver, pageBreak, baseFilename);   break;
      case 'docx': exportData = await exportToDocx(letters, receiver, pageBreak, baseFilename);  break;
      case 'md':   exportData = await exportToMarkdown(letters, receiver, baseFilename);         break;
      case 'txt':  exportData = await exportToTxt(letters, receiver, baseFilename);              break;
      default: throw new Error('Unknown format');
    }

    if (isCancelled) throw new Error('Export cancelled before finalising.');

    setPanelStatus('Saving file…', 'working');

    // Direct Blob download — no base64 encoding, no message bus, no serialization delay
    const blob      = new Blob([exportData.bytes], { type: exportData.mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor    = document.createElement('a');
    anchor.href     = objectUrl;
    anchor.download = exportData.filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Revoke after a short delay so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

    // Notify background.js so it can show the download shelf / badge (no payload needed)
    chrome.runtime.sendMessage({ type: 'EXPORT_DONE', payload: { count: letters.length } });

    // Success feedback arrives via EXPORT_UI_DONE from background.js
  } catch (err) {
    setPanelStatus(err.message || String(err), 'error');
    exportRunning = false;
    setPanelBusy(false);
  }
}

// ─── Soft reset — clears heap & re-injects a fresh panel ─────────────────────
// Called on successful export so the extension never freezes on leftover bytes.

function softReset() {
  assetCache.clear();           // let GC reclaim all downloaded Uint8Array data
  exportRunning = false;
  isCancelled   = false;
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById('sle-styles')?.remove();
  setTimeout(() => {
    injectPermanentPanel();
    expandCard();               // leave panel open so user sees the fresh state
  }, 150);
}

// ─── 11. CHROME MESSAGE LISTENER ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'FOCUS_EXPORT_PANEL' || msg?.type === 'SHOW_EXPORT_WIDGET') {
    try { sessionStorage.removeItem(SESSION_DISMISS_KEY); } catch (_) {}
    injectPermanentPanel();
    expandCard();
    updateLetterWarning();
    const card = document.getElementById(CARD_ID);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      card.style.transition = 'box-shadow .35s ease';
      card.style.boxShadow  = '0 0 0 3px #c8a97e';
      setTimeout(() => { card.style.boxShadow = ''; }, 900);
    }
    return;
  }

  if (msg?.type === 'EXPORT_UI_DONE') {
    const n = msg.count ?? '?';
    // Brief success flash, then soft-reset so the extension is fresh for next export
    setPanelBusy(false);
    setPanelStatus(`Done! ${n} letter${n === 1 ? '' : 's'} exported.`, 'done');
    setTimeout(softReset, 1800);
    return;
  }

  if (msg?.type === 'EXPORT_ERROR') {
    exportRunning = false;
    setPanelBusy(false);
    setPanelStatus(msg.text || 'Export failed.', 'error');
  }
});