'use strict';

(() => {
  const POLL_MS = 40;
  const NAV_TIMEOUT_MS = 10000;
  const AFTER_PATH_MS = 90;
  const POST_STABLE_MS = 40;
  const MAX_LETTERS = 500;

  let cancelRequested = false;
  let exportRunning = false;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitUntil(predicate, intervalMs = POLL_MS, timeoutMs = NAV_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await sleep(intervalMs);
    }
    return false;
  }

  /**
   * After clicking prev/next: wait for URL change, brief paint, then two identical reads of body text
   * so we don’t snapshot stale content (faster than a fixed 1.4s delay).
   */
  async function waitAfterLetterNavigation(previousFp) {
    const pathOk = await waitUntil(() => currentFingerprint() !== previousFp, POLL_MS, NAV_TIMEOUT_MS);
    if (!pathOk) return false;
    await sleep(AFTER_PATH_MS);

    let prevSnap = null;
    const settled = await waitUntil(() => {
      const L = extractCurrentLetter();
      if (!L || !L.text) return false;
      if (prevSnap === L.text) return true;
      prevSnap = L.text;
      return false;
    }, POLL_MS, NAV_TIMEOUT_MS);

    if (!settled) return false;
    await sleep(POST_STABLE_MS);
    return true;
  }

  const SESSION_DISMISS_KEY = 'slowly-exp-dismissed';
  const ROOT_ID = 'slowly-letter-exporter-root';
  const CARD_ID = 'slowly-letter-exporter-card';
  const LAUNCHER_ID = 'slowly-exp-launcher';

  function expandCard() {
    document.getElementById(CARD_ID)?.classList.add('slowly-exp-card-visible');
  }

  function collapseCard() {
    document.getElementById(CARD_ID)?.classList.remove('slowly-exp-card-visible');
  }

  function toggleCard() {
    document.getElementById(CARD_ID)?.classList.toggle('slowly-exp-card-visible');
  }

  function closeWidget() {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    } catch (_) {
      /* ignore */
    }
    document.getElementById(ROOT_ID)?.remove();
  }

  function injectPanelStyles() {
    if (document.getElementById('slowly-exp-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'slowly-exp-panel-styles';
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 2147483645;
        pointer-events: none;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        color: #1a1a1a;
      }
      #${ROOT_ID} .slowly-exp-stack {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
        pointer-events: auto;
      }
      #${LAUNCHER_ID} {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        background: #c8a97e;
        color: #1a1a1a;
        font-size: 22px;
        line-height: 1;
        box-shadow: 0 4px 14px rgba(0,0,0,0.2);
        flex-shrink: 0;
      }
      #${LAUNCHER_ID}:hover { filter: brightness(1.06); }
      #${CARD_ID} {
        display: none;
        flex-direction: column;
        width: 280px;
        max-width: calc(100vw - 32px);
        max-height: min(520px, calc(100vh - 88px));
        box-sizing: border-box;
        background: #fafafa;
        border: 1px solid #ddd;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        overflow: hidden;
      }
      #${CARD_ID}.slowly-exp-card-visible {
        display: flex;
      }
      #${CARD_ID} .slowly-exp-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 10px 8px;
        background: #fff;
        border-bottom: 1px solid #eee;
        flex-shrink: 0;
      }
      #${CARD_ID} .slowly-exp-card-title {
        font-size: 13px;
        font-weight: 600;
        color: #2e3d4f;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${CARD_ID} .slowly-exp-card-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
      }
      #${CARD_ID} .slowly-exp-icon-btn {
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        border-radius: 6px;
        background: #eee;
        color: #333;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
      }
      #${CARD_ID} .slowly-exp-icon-btn:hover { background: #e0e0e0; }
      #${CARD_ID} .slowly-exp-scroll {
        overflow-y: auto;
        padding: 10px 12px 12px;
        flex: 1;
        min-height: 0;
      }
      #${CARD_ID} .slowly-exp-hint {
        font-size: 11px;
        color: #666;
        margin: 0 0 10px;
        line-height: 1.35;
      }
      #${CARD_ID} fieldset {
        border: 1px solid #ddd;
        border-radius: 6px;
        margin: 0 0 8px;
        padding: 6px 8px;
        background: #fff;
      }
      #${CARD_ID} legend {
        font-size: 11px;
        font-weight: 600;
        color: #555;
        padding: 0 4px;
      }
      #${CARD_ID} label.slowly-exp-opt {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 5px 0;
        cursor: pointer;
        line-height: 1.35;
        font-size: 12px;
      }
      #${CARD_ID} label.slowly-exp-opt input { margin-top: 2px; }
      #${CARD_ID} .slowly-exp-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 4px;
      }
      #${CARD_ID} button.slowly-exp-btn {
        flex: 1;
        min-width: 100px;
        padding: 8px 10px;
        border-radius: 6px;
        border: none;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      #${CARD_ID} button.slowly-exp-btn-primary {
        background: #c8a97e;
        color: #1a1a1a;
      }
      #${CARD_ID} button.slowly-exp-btn-primary:hover:not(:disabled) {
        filter: brightness(1.05);
      }
      #${CARD_ID} button.slowly-exp-btn-secondary {
        background: #e8e8e8;
        color: #333;
      }
      #${CARD_ID} button.slowly-exp-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      #${CARD_ID}-status {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 6px;
        background: #fff;
        border: 1px solid #e5e5e5;
        min-height: 40px;
        line-height: 1.4;
        color: #444;
        font-size: 11px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${CARD_ID}-status.slowly-exp-status-error {
        border-color: #e0a4a4;
        background: #fff5f5;
        color: #8b2e2e;
      }
      #${CARD_ID}-status.slowly-exp-status-done {
        border-color: #a8c9a8;
        background: #f4faf4;
        color: #2d5a2d;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getPanelOptions() {
    const card = document.getElementById(CARD_ID);
    if (!card) {
      return { format: 'docx', order: 'oldest', structure: 'continuous' };
    }
    const format =
      card.querySelector('input[name="slowly-exp-format"]:checked')?.value || 'docx';
    const order =
      card.querySelector('input[name="slowly-exp-order"]:checked')?.value || 'oldest';
    const structure =
      card.querySelector('input[name="slowly-exp-structure"]:checked')?.value || 'continuous';
    return {
      format,
      order,
      structure: format === 'docx' ? structure : 'continuous',
    };
  }

  function setPanelStatus(text, kind) {
    const el = document.getElementById(`${CARD_ID}-status`);
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('slowly-exp-status-error', 'slowly-exp-status-done');
    if (kind === 'error') el.classList.add('slowly-exp-status-error');
    else if (kind === 'done') el.classList.add('slowly-exp-status-done');
  }

  function setPanelBusy(busy) {
    const card = document.getElementById(CARD_ID);
    if (!card) return;
    const exp = card.querySelector('#slowly-exp-exportBtn');
    const can = card.querySelector('#slowly-exp-cancelBtn');
    if (exp) exp.disabled = busy;
    if (can) can.disabled = !busy;
    card.querySelectorAll('fieldset input').forEach((inp) => {
      inp.disabled = busy;
    });
  }

  function injectPermanentPanel() {
    try {
      if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') return;
    } catch (_) {
      /* ignore */
    }
    if (document.getElementById(ROOT_ID)) return;

    injectPanelStyles();

    function fieldsetBlock(legendText, name, options) {
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = legendText;
      fs.appendChild(lg);
      options.forEach((opt, i) => {
        const lab = document.createElement('label');
        lab.className = 'slowly-exp-opt';
        const inp = document.createElement('input');
        inp.type = 'radio';
        inp.name = name;
        inp.value = opt.value;
        if (i === 0) inp.checked = true;
        lab.appendChild(inp);
        lab.appendChild(document.createTextNode(' ' + opt.label));
        fs.appendChild(lab);
      });
      return fs;
    }

    const wrap = document.createElement('div');
    wrap.id = ROOT_ID;
    wrap.setAttribute('data-slowly-exporter', 'root');

    const stack = document.createElement('div');
    stack.className = 'slowly-exp-stack';

    const card = document.createElement('aside');
    card.id = CARD_ID;
    card.setAttribute('data-slowly-exporter', 'card');

    const head = document.createElement('div');
    head.className = 'slowly-exp-card-head';

    const title = document.createElement('span');
    title.className = 'slowly-exp-card-title';
    title.textContent = 'Slowly Letter Exporter';

    const actions = document.createElement('div');
    actions.className = 'slowly-exp-card-actions';

    const minBtn = document.createElement('button');
    minBtn.type = 'button';
    minBtn.className = 'slowly-exp-icon-btn';
    minBtn.title = 'Minimize';
    minBtn.setAttribute('aria-label', 'Minimize');
    minBtn.textContent = '−';
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      collapseCard();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'slowly-exp-icon-btn';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeWidget();
    });

    actions.appendChild(minBtn);
    actions.appendChild(closeBtn);
    head.appendChild(title);
    head.appendChild(actions);

    const scroll = document.createElement('div');
    scroll.className = 'slowly-exp-scroll';

    const hint = document.createElement('p');
    hint.className = 'slowly-exp-hint';
    hint.textContent =
      'Open a letter, choose options, export. Toolbar icon can reopen this panel if you closed it.';

    scroll.appendChild(hint);
    scroll.appendChild(
      fieldsetBlock('Format', 'slowly-exp-format', [
        { value: 'docx', label: 'DOCX' },
        { value: 'txt', label: 'TXT' },
        { value: 'md', label: 'Markdown (.md)' },
      ])
    );
    scroll.appendChild(
      fieldsetBlock('Order', 'slowly-exp-order', [
        { value: 'oldest', label: 'Oldest → Newest' },
        { value: 'newest', label: 'Newest → Oldest' },
      ])
    );
    scroll.appendChild(
      fieldsetBlock('Structure (DOCX only)', 'slowly-exp-structure', [
        { value: 'continuous', label: 'Continuous flow' },
        { value: 'pageBreak', label: 'Page break per letter' },
      ])
    );

    const row = document.createElement('div');
    row.className = 'slowly-exp-row';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.id = 'slowly-exp-exportBtn';
    exportBtn.className = 'slowly-exp-btn slowly-exp-btn-primary';
    exportBtn.textContent = 'Export Letters';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.id = 'slowly-exp-cancelBtn';
    cancelBtn.className = 'slowly-exp-btn slowly-exp-btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.disabled = true;

    exportBtn.addEventListener('click', () => startExportFromPanel());
    cancelBtn.addEventListener('click', () => {
      cancelRequested = true;
      setPanelStatus('Cancelling…');
    });

    row.appendChild(exportBtn);
    row.appendChild(cancelBtn);
    scroll.appendChild(row);

    const status = document.createElement('div');
    status.id = `${CARD_ID}-status`;
    status.setAttribute('role', 'status');
    status.textContent = 'Ready.';
    scroll.appendChild(status);

    card.appendChild(head);
    card.appendChild(scroll);

    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.id = LAUNCHER_ID;
    launcher.setAttribute('aria-label', 'Toggle Slowly Letter Exporter');
    launcher.textContent = '✉';
    launcher.title = 'Letter exporter';
    launcher.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCard();
    });

    stack.appendChild(card);
    stack.appendChild(launcher);
    wrap.appendChild(stack);

    const host = document.body || document.documentElement;
    host.appendChild(wrap);
  }

  function startExportFromPanel() {
    if (exportRunning) return;
    expandCard();
    exportRunning = true;
    cancelRequested = false;
    setPanelBusy(true);
    setPanelStatus('Starting…');
    runExport(getPanelOptions());
  }

  function postProgress(text) {
    setPanelStatus(text || '');
  }

  function postError(text) {
    setPanelStatus(text, 'error');
  }

  function postCancelled(text) {
    setPanelStatus(text || 'Cancelled.', 'error');
  }

  function postDone(payload) {
    chrome.runtime.sendMessage({ type: 'EXPORT_DONE', payload });
  }

  function currentFingerprint() {
    return location.pathname;
  }

  /** Prefer dialog / modal structure over brittle single-class selectors. */
  function findLetterBodyEl() {
    const dialog = document.querySelector('[role="dialog"]');
    const modalBody =
      document.querySelector('[class*="modal-body"]') ||
      (dialog && dialog.querySelector('[class*="modal-body"], article'));

    const pre =
      (modalBody && modalBody.querySelector('.pre-wrap')) ||
      (dialog && dialog.querySelector('.pre-wrap')) ||
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

  function findPrevNextLinks() {
    const scope =
      document.querySelector('[class*="friend-header"]') ||
      document.querySelector('header');
    const root = scope || document;
    const anchors = [...root.querySelectorAll('a[href]')];

    const hasLeft = (a) =>
      a.querySelector('.icon-chevron-left') ||
      a.querySelector('[class*="chevron-left"]');
    const hasRight = (a) =>
      a.querySelector('.icon-chevron-right') ||
      a.querySelector('[class*="chevron-right"]');

    let prev = anchors.find(hasLeft);
    let next = anchors.find(hasRight);

    if (!prev || !next) {
      const hdrLinks = [...document.querySelectorAll('[class*="friend-header"] a[href]')];
      if (!prev) prev = hdrLinks.find(hasLeft);
      if (!next) next = hdrLinks.find(hasRight);
    }

    return { prev: prev || null, next: next || null };
  }

  function extractCurrentLetter() {
    const body = findLetterBodyEl();
    if (!body) return null;

    const text = body.innerText.trim();
    if (!text) return null;

    const footer = findLetterFooter();
    let sender = '';
    let dateStr = '';

    if (footer) {
      const senderEl =
        footer.querySelector('.text-primary') ||
        footer.querySelector('[class*="text-primary"]') ||
        footer.querySelector('strong, b');
      sender = senderEl ? senderEl.innerText.trim() : '';

      const timeIso = footer.querySelector('time[datetime]');
      if (timeIso) {
        dateStr = timeIso.innerText.trim().split('\n')[0].trim() || timeIso.getAttribute('datetime').trim();
      }
      const pEl = footer.querySelector('p');
      if (!dateStr && pEl) {
        dateStr = pEl.innerText.trim().split('\n')[0].trim();
      }
      if (!dateStr) {
        const timeEl = footer.querySelector('time');
        if (timeEl) dateStr = timeEl.innerText.trim();
      }
    }

    const dateIso =
      footer?.querySelector('time[datetime]')?.getAttribute('datetime')?.trim() || '';

    return { sender, date: dateStr, dateIso, text, url: location.pathname };
  }

  function isLetterViewOpen() {
    const body = findLetterBodyEl();
    return !!(body && body.innerText.trim());
  }

  function getPrevLink() {
    return findPrevNextLinks().prev;
  }

  function getNextLink() {
    return findPrevNextLinks().next;
  }

  async function navigateToOldest() {
    let steps = 0;
    while (steps < MAX_LETTERS) {
      if (cancelRequested) return;
      const prev = getPrevLink();
      if (!prev) break;

      const before = currentFingerprint();
      prev.click();
      const moved = await waitAfterLetterNavigation(before);
      if (!moved) break;
      steps++;
    }
  }

  async function collectAllLetters() {
    const letters = [];
    const seenUrls = new Set();

    await navigateToOldest();
    if (cancelRequested) return letters;

    await sleep(POST_STABLE_MS);
    if (cancelRequested) return letters;

    let consecutiveFailures = 0;

    while (letters.length < MAX_LETTERS) {
      if (cancelRequested) return letters;

      const fp = currentFingerprint();

      if (!seenUrls.has(fp)) {
        seenUrls.add(fp);

        const letter = extractCurrentLetter();
        if (letter) {
          letters.push(letter);
          consecutiveFailures = 0;
          postProgress(`Collecting letter ${letters.length}…`);
        } else {
          consecutiveFailures++;
          if (consecutiveFailures >= 3) break;
        }
      }

      const next = getNextLink();
      if (!next) break;

      const before = currentFingerprint();
      next.click();
      const moved = await waitAfterLetterNavigation(before);
      if (!moved) break;
    }

    return letters;
  }

  /**
   * Parse footer date string to UTC ms. Slowly often shows locale dates Date.parse understands.
   */
  function parseLetterDateMs(letter) {
    const iso = (letter.dateIso || '').trim();
    if (iso) {
      const mIso = Date.parse(iso);
      if (!Number.isNaN(mIso)) return mIso;
    }

    const raw = (letter.date || '').trim();
    if (!raw) return null;

    let ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return ms;

    const paren = raw.match(/\(([^)]+)\)/);
    if (paren) {
      ms = Date.parse(paren[1].trim());
      if (!Number.isNaN(ms)) return ms;
    }

    const digitStart = raw.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})/);
    if (digitStart) {
      ms = Date.parse(digitStart[1]);
      if (!Number.isNaN(ms)) return ms;
    }

    return null;
  }

  /**
   * True chronological order (earliest letter first), independent of arrow navigation order.
   * Unparseable dates keep collection order via stable __idx tie-break.
   */
  function sortLettersChronologically(letters) {
    const tagged = letters.map((L, idx) => ({ ...L, __idx: idx }));
    tagged.sort((a, b) => {
      const ta = parseLetterDateMs(a);
      const tb = parseLetterDateMs(b);
      const aOk = ta != null;
      const bOk = tb != null;
      if (aOk && bOk && ta !== tb) return ta - tb;
      if (aOk && !bOk) return -1;
      if (!aOk && bOk) return 1;
      return a.__idx - b.__idx;
    });
    return tagged.map(({ __idx, ...rest }) => rest);
  }

  // ─── Filename ─────────────────────────────────────────────────────────────

  function sanitizeFilenameSegment(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const s = raw
      .replace(/[\\/:*?"<>|#\x00-\x1f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^\.+|\.+$/g, '');
    return s.slice(0, 120);
  }

  function buildExportFilename(letters, formatKey) {
    const parts = [...new Set(letters.map((l) => l.sender).filter(Boolean))]
      .map(sanitizeFilenameSegment)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const namesPart = parts.length ? parts.join('_') : 'Slowly';
    const datePart = new Date().toISOString().slice(0, 10);
    let base = `${namesPart}_Slowly_Letter_${datePart}`;
    if (base.length > 200) base = base.slice(0, 200).replace(/_+$/, '');
    const ext = formatKey === 'md' ? 'md' : formatKey === 'txt' ? 'txt' : 'docx';
    return `${base}.${ext}`;
  }

  // ─── TXT / Markdown ──────────────────────────────────────────────────────

  function buildTxt(letters) {
    const chunks = [];
    const rule = '─'.repeat(52);
    letters.forEach((letter, idx) => {
      if (idx > 0) chunks.push('', rule, '');
      chunks.push(`${letter.sender}  ·  ${letter.date}`, '', letter.text);
    });
    return chunks.join('\n');
  }

  function escapeMdHeadingFragment(s) {
    return String(s || '').replace(/\r?\n/g, ' ').replace(/#/g, '\\#').trim();
  }

  function buildMarkdown(letters) {
    const exported = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    let out = `# Slowly Letters\n\n_Exported ${exported} · ${letters.length} letter${letters.length !== 1 ? 's' : ''}_\n\n`;
    letters.forEach((letter, idx) => {
      const head = `${escapeMdHeadingFragment(letter.sender)} · ${escapeMdHeadingFragment(letter.date)}`;
      out += `## ${head}\n\n`;
      out += letter.text.replace(/\r\n/g, '\n');
      out += '\n\n';
      if (idx < letters.length - 1) out += '---\n\n';
    });
    return out;
  }

  // ─── DOCX ─────────────────────────────────────────────────────────────────

  function escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function letterBodyToWordParagraph(text) {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const runs = [];
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) runs.push('<w:r><w:br/></w:r>');
      const line = lines[i];
      if (line.length > 0) {
        runs.push(`<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`);
      }
    }
    return `<w:p>
        <w:pPr>
          <w:pStyle w:val="LetterBody"/>
          <w:spacing w:after="0" w:line="276" w:lineRule="auto"/>
        </w:pPr>
        ${runs.join('')}
      </w:p>`;
  }

  function pageBreakParagraph() {
    return `<w:p>
      <w:r><w:br w:type="page"/></w:r>
    </w:p>`;
  }

  function separatorParagraph() {
    return `<w:p>
          <w:pPr>
            <w:spacing w:before="480" w:after="0"/>
            <w:jc w:val="center"/>
            <w:pBdr>
              <w:bottom w:val="single" w:sz="4" w:space="1" w:color="D9C5A8"/>
            </w:pBdr>
          </w:pPr>
        </w:p>`;
  }

  function buildDocx(letters, structure) {
    const pageBreakBetween = structure === 'pageBreak';

    let bodyXml = '';

    bodyXml += `
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Title"/>
        <w:jc w:val="center"/>
        <w:spacing w:before="0" w:after="240"/>
      </w:pPr>
      <w:r><w:t xml:space="preserve">Slowly Letters</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Subtitle"/>
        <w:jc w:val="center"/>
        <w:spacing w:before="0" w:after="720"/>
      </w:pPr>
      <w:r><w:t xml:space="preserve">Exported ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · ${letters.length} letter${letters.length !== 1 ? 's' : ''}</w:t></w:r>
    </w:p>`;

    letters.forEach((letter, idx) => {
      const letterNum = idx + 1;

      bodyXml += `
      <w:p>
        <w:pPr>
          <w:pStyle w:val="LetterLabel"/>
          <w:spacing w:before="${idx === 0 ? '0' : pageBreakBetween ? '240' : '600'}" w:after="60"/>
        </w:pPr>
        <w:r><w:t xml:space="preserve">Letter ${letterNum} of ${letters.length}</w:t></w:r>
      </w:p>`;

      const headingText = escapeXml(`${letter.sender}  ·  ${letter.date}`);
      bodyXml += `
      <w:p>
        <w:pPr>
          <w:pStyle w:val="Heading1"/>
          <w:spacing w:before="60" w:after="120"/>
          <w:pBdr>
            <w:bottom w:val="single" w:sz="6" w:space="4" w:color="C8A97E"/>
          </w:pBdr>
        </w:pPr>
        <w:r><w:t xml:space="preserve">${headingText}</w:t></w:r>
      </w:p>`;

      bodyXml += `
      <w:p>
        <w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr>
      </w:p>`;

      bodyXml += letterBodyToWordParagraph(letter.text);

      const hasMore = idx < letters.length - 1;
      if (hasMore) {
        if (pageBreakBetween) {
          bodyXml += pageBreakParagraph();
        } else {
          bodyXml += separatorParagraph();
        }
      }
    });

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
  mc:Ignorable="w14 w15">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"
               w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">

  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="160" w:line="276" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
      <w:color w:val="2C2C2C"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="480" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
      <w:b/>
      <w:sz w:val="52"/>
      <w:szCs w:val="52"/>
      <w:color w:val="1A1A1A"/>
      <w:spacing w:val="40"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="80" w:after="480"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
      <w:i/>
      <w:sz w:val="22"/>
      <w:szCs w:val="22"/>
      <w:color w:val="888888"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="LetterLabel">
    <w:name w:val="LetterLabel"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="600" w:after="40"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
      <w:sz w:val="18"/>
      <w:szCs w:val="18"/>
      <w:color w:val="B08850"/>
      <w:caps/>
      <w:spacing w:val="60"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:outlineLvl w:val="0"/>
      <w:spacing w:before="80" w:after="160"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
      <w:b/>
      <w:sz w:val="30"/>
      <w:szCs w:val="30"/>
      <w:color w:val="2E3D4F"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="LetterBody">
    <w:name w:val="LetterBody"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="LetterBody"/>
    <w:pPr>
      <w:jc w:val="start"/>
      <w:spacing w:after="0" w:line="308" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
      <w:color w:val="2C2C2C"/>
    </w:rPr>
  </w:style>

</w:styles>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`;

    const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
</Relationships>`;

    return { documentXml, stylesXml, contentTypes, rootRels, wordRels };
  }

  function strToBytes(str) {
    return new TextEncoder().encode(str);
  }

  function u32le(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  }

  function u16le(n) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
  }

  function crc32(data) {
    const table =
      crc32.table ||
      (crc32.table = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          t[i] = c;
        }
        return t;
      })());
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concat(arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const a of arrays) {
      out.set(a, pos);
      pos += a.length;
    }
    return out;
  }

  function buildZip(files) {
    const localHeaders = [];
    const centralDirs = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = strToBytes(file.name);
      const data = file.data;
      const crc = crc32(data);
      const size = data.length;

      const lh = concat([
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        u16le(20),
        u16le(0),
        u16le(0),
        u16le(0),
        u16le(0),
        u32le(crc),
        u32le(size),
        u32le(size),
        u16le(nameBytes.length),
        u16le(0),
        nameBytes,
        data,
      ]);

      localHeaders.push(lh);

      const cd = concat([
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
        u16le(20),
        u16le(20),
        u16le(0),
        u16le(0),
        u16le(0),
        u16le(0),
        u32le(crc),
        u32le(size),
        u32le(size),
        u16le(nameBytes.length),
        u16le(0),
        u16le(0),
        u16le(0),
        u16le(0),
        u32le(0),
        u32le(offset),
        nameBytes,
      ]);

      centralDirs.push(cd);
      offset += lh.length;
    }

    const cdOffset = offset;
    const cdData = concat(centralDirs);
    const cdSize = cdData.length;
    const count = files.length;

    const eocd = concat([
      new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
      u16le(0),
      u16le(0),
      u16le(count),
      u16le(count),
      u32le(cdSize),
      u32le(cdOffset),
      u16le(0),
    ]);

    return concat([...localHeaders, cdData, eocd]);
  }

  function bytesToBase64(bytes) {
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function utf8ToBase64(str) {
    return bytesToBase64(strToBytes(str));
  }

  async function runExport(options) {
    cancelRequested = false;

    if (!isLetterViewOpen()) {
      postError('No letter view open. Open a letter on Slowly, then try again.');
      exportRunning = false;
      setPanelBusy(false);
      return;
    }

    try {
      postProgress('Finding thread start…');

      let letters = await collectAllLetters();

      if (cancelRequested) {
        postCancelled('Cancelled.');
        exportRunning = false;
        setPanelBusy(false);
        return;
      }

      if (!letters.length) {
        postError('No letters could be extracted.');
        exportRunning = false;
        setPanelBusy(false);
        return;
      }

      postProgress('Sorting by date…');
      letters = sortLettersChronologically(letters);

      /*
       * Chronological array: index 0 = earliest letter in the thread, last = most recent.
       * Oldest → Newest: export that order (conversation starts at top of document).
       * Newest → Oldest: reverse so the latest letter is first in the file.
       */
      if (options.order === 'newest') {
        letters = [...letters].reverse();
      }

      postProgress('Building file…');

      const filename = buildExportFilename(letters, options.format);
      let mimeType;
      let base64;

      if (options.format === 'txt') {
        mimeType = 'text/plain;charset=utf-8';
        base64 = utf8ToBase64(buildTxt(letters));
      } else if (options.format === 'md') {
        mimeType = 'text/markdown;charset=utf-8';
        base64 = utf8ToBase64(buildMarkdown(letters));
      } else {
        mimeType =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const { documentXml, stylesXml, contentTypes, rootRels, wordRels } = buildDocx(
          letters,
          options.structure || 'continuous'
        );
        const zipData = buildZip([
          { name: '[Content_Types].xml', data: strToBytes(contentTypes) },
          { name: '_rels/.rels', data: strToBytes(rootRels) },
          { name: 'word/document.xml', data: strToBytes(documentXml) },
          { name: 'word/styles.xml', data: strToBytes(stylesXml) },
          { name: 'word/_rels/document.xml.rels', data: strToBytes(wordRels) },
        ]);
        base64 = bytesToBase64(zipData);
      }

      postProgress('Saving file…');
      postDone({
        filename,
        mimeType,
        base64,
        count: letters.length,
      });
    } catch (e) {
      postError(e?.message || String(e));
      exportRunning = false;
      setPanelBusy(false);
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'FOCUS_EXPORT_PANEL' || msg?.type === 'SHOW_EXPORT_WIDGET') {
      try {
        sessionStorage.removeItem(SESSION_DISMISS_KEY);
      } catch (_) {
        /* ignore */
      }
      injectPermanentPanel();
      expandCard();
      const card = document.getElementById(CARD_ID);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        card.style.transition = 'box-shadow 0.35s ease';
        card.style.boxShadow = '0 0 0 3px #c8a97e';
        setTimeout(() => {
          card.style.boxShadow = '';
        }, 900);
      }
      return;
    }
    if (msg?.type === 'EXPORT_UI_DONE') {
      exportRunning = false;
      setPanelBusy(false);
      const n = msg.count ?? '?';
      setPanelStatus(`Finished: ${n} letter${n === 1 ? '' : 's'} exported`, 'done');
      return;
    }
    if (msg?.type === 'EXPORT_ERROR') {
      exportRunning = false;
      setPanelBusy(false);
      setPanelStatus(msg.text || 'Export failed.', 'error');
    }
  });

  /*
   * Slowly is an SPA: React often replaces large parts of the DOM and removes our panel.
   * Re-mount after route changes and DOM mutations; retry shortly after load.
   */
  let panelRepairTimer = null;

  function schedulePanelRepair() {
    try {
      if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') return;
    } catch (_) {
      /* ignore */
    }
    if (document.getElementById(ROOT_ID)) return;
    clearTimeout(panelRepairTimer);
    panelRepairTimer = setTimeout(() => injectPermanentPanel(), 250);
  }

  function hookHistoryForPanel() {
    const bump = () => {
      clearTimeout(panelRepairTimer);
      panelRepairTimer = setTimeout(() => injectPermanentPanel(), 120);
    };
    const wrap = (orig) =>
      function wrappedHistory() {
        const ret = orig.apply(this, arguments);
        bump();
        return ret;
      };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener('popstate', bump);
  }

  injectPermanentPanel();
  setTimeout(injectPermanentPanel, 400);
  setTimeout(injectPermanentPanel, 2000);

  hookHistoryForPanel();

  new MutationObserver(() => schedulePanelRepair()).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
