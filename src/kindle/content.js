/* Kindle Tradutor – roda em cada frame do Kindle Web: captura a seleção e mostra o cartão. */
(() => {
  'use strict';
  if (window.__ktKindleLoaded) return;
  window.__ktKindleLoaded = true;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .kt-bubble {
      position: fixed; z-index: 2147483646; display: none; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 999px; border: 0; cursor: pointer;
      background: #1f8bb8; color: #fff; font: 600 13px/1.2 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,.35); user-select: none; -webkit-user-select: none;
    }
    .kt-bubble.kt-show { display: inline-flex; }
    .kt-bubble svg { width: 14px; height: 14px; fill: currentColor; }
    .kt-card {
      position: fixed; z-index: 2147483647; display: none; width: min(440px, calc(100vw - 24px));
      max-height: min(70vh, 520px); overflow: auto; background: #fff; color: #222;
      border: 1px solid #c9e3ec; border-radius: 6px; box-shadow: 0 8px 28px rgba(0,0,0,.35);
      font: 15px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 14px 16px 12px; user-select: text; -webkit-user-select: text;
    }
    .kt-card.kt-show { display: block; }
    .kt-close {
      position: absolute; top: 0; right: 0; width: 38px; height: 38px; border: 0; cursor: pointer;
      background: #e9eef0; color: #8a9499; font-size: 22px; line-height: 38px; text-align: center; border-radius: 0 6px 0 6px;
    }
    .kt-close:hover { color: #444; }
    .kt-head { display: flex; align-items: flex-start; gap: 8px; padding-right: 34px; }
    .kt-speak {
      flex: none; width: 26px; height: 26px; border: 0; background: transparent; cursor: pointer; padding: 0; margin-top: 1px;
    }
    .kt-speak svg { width: 24px; height: 24px; fill: #c0392b; }
    .kt-translation { font-weight: 700; font-size: 19px; line-height: 1.3; color: #111; }
    .kt-chunks { margin: 10px 0 0; padding: 0; list-style: none; }
    .kt-chunk { display: flex; align-items: baseline; gap: 8px; margin: 6px 0 0 4px; font-size: 16px; }
    .kt-arrow { flex: none; color: #b8c2c7; font-size: 15px; }
    .kt-src { color: #3a9bbd; font-weight: 600; }
    .kt-sep { color: #b8c2c7; margin: 0 6px; }
    .kt-tgt { color: #2b7f9e; font-weight: 600; }
    .kt-note { margin: 8px 0 0 30px; color: #7a8388; font-size: 14px; line-height: 1.45; }
    .kt-foot { margin-top: 10px; display: flex; justify-content: space-between; color: #a0a8ac; font-size: 11px; }
    .kt-status { display: flex; align-items: center; gap: 10px; color: #555; font-size: 15px; padding-right: 30px; }
    .kt-spin {
      flex: none; width: 18px; height: 18px; border: 3px solid #cfe6ee; border-top-color: #1f8bb8; border-radius: 50%;
      animation: kt-rot .8s linear infinite;
    }
    @keyframes kt-rot { to { transform: rotate(360deg); } }
    .kt-error { color: #a33; font-size: 14px; padding-right: 30px; }
    .kt-actions { margin-top: 10px; display: flex; gap: 8px; }
    .kt-btn {
      border: 1px solid #1f8bb8; background: #fff; color: #1f8bb8; border-radius: 4px; padding: 6px 10px;
      font: 600 13px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; cursor: pointer;
    }
    .kt-btn.kt-primary { background: #1f8bb8; color: #fff; }
    .kt-selected { margin-top: 6px; color: #888; font-size: 13px; font-style: italic; }
  `;

  const ICON_TRANSLATE =
    '<svg viewBox="0 0 24 24"><path d="M12.9 15l-2.6-2.6.03-.03A17.6 17.6 0 0 0 14 5.9h3V4h-7V2H8v2H1v1.9h11.2A15.8 15.8 0 0 1 9 11.3 15.6 15.6 0 0 1 6.9 8.3H4.9a17.6 17.6 0 0 0 2.6 4.1L2.4 17.4 3.8 18.8 9 13.6l3.2 3.2.7-1.8zM18.5 10h-2L12 22h2l1.1-3h4.8l1.1 3h2l-4.5-12zm-2.6 7l1.6-4.3 1.6 4.3h-3.2z"/></svg>';
  const ICON_SPEAKER =
    '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"/></svg>';

  let settings = KT.mergeSettings(null);
  let host, shadow, bubble, card;
  let lastSelection = null; // { text, rect, context, ts }
  let activeRequest = null; // { id, text, rect, startedAt }
  let timer = null;

  function ensureUI() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'kt-host';
    host.setAttribute('data-kt', '1');
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'kt-bubble';
    bubble.setAttribute('data-kt-role', 'bubble');
    bubble.innerHTML = ICON_TRANSLATE + '<span>Traduzir</span>';
    bubble.addEventListener('pointerdown', (e) => e.preventDefault()); // não desfaz a seleção
    bubble.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (lastSelection) startTranslation(lastSelection);
    });
    shadow.appendChild(bubble);

    card = document.createElement('div');
    card.className = 'kt-card';
    card.setAttribute('data-kt-role', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Tradução');
    shadow.appendChild(card);

    (document.body || document.documentElement).appendChild(host);
  }

  function isInsideHost(node) {
    if (!node || !host) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && (el === host || host.contains(el)));
  }

  function selectionSnapshot() {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    if (isInsideHost(sel.anchorNode) || isInsideHost(sel.focusNode)) return null;
    const text = KT.normalizeWhitespace(sel.toString());
    if (!text) return null;
    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      const rects = range.getClientRects();
      if (rects.length) rect = rects[rects.length - 1];
    }
    return {
      text,
      rect: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height } : null,
      context: extractContext(range, text),
      ts: Date.now(),
    };
  }

  function extractContext(range, text) {
    try {
      let node = range.commonAncestorContainer;
      if (node.nodeType !== 1) node = node.parentElement;
      const blockTags = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'TD', 'BODY', 'MAIN', 'ASIDE']);
      let el = node;
      let hops = 0;
      while (el && hops < 12) {
        const display = el.ownerDocument.defaultView ? el.ownerDocument.defaultView.getComputedStyle(el).display : 'block';
        const isBlock = blockTags.has(el.tagName) || /block|list-item|table-cell|flex|grid/.test(display);
        const txt = KT.normalizeWhitespace(el.innerText || el.textContent);
        if (isBlock && txt.length >= text.length + 20) return KT.windowContext(txt, text, 600);
        if (el.tagName === 'BODY') break;
        el = el.parentElement;
        hops++;
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  function placeNear(el, rect, below) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    el.style.left = '0px';
    el.style.top = '0px';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rect ? rect.left + rect.width / 2 - w / 2 : vw / 2 - w / 2;
    left = Math.max(8, Math.min(vw - w - 8, left));
    let top;
    if (!rect) top = Math.max(8, vh / 2 - h / 2);
    else if (below) {
      top = rect.bottom + 10;
      if (top + h > vh - 8) top = rect.top - h - 10;
      if (top < 8) top = Math.max(8, vh - h - 8);
    } else {
      top = rect.top - h - 10;
      if (top < 8) top = rect.bottom + 10;
      if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    }
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function showBubble(snap) {
    ensureUI();
    bubble.classList.add('kt-show');
    placeNear(bubble, snap.rect, false);
  }

  function hideBubble() {
    if (bubble) bubble.classList.remove('kt-show');
  }

  function hideCard() {
    if (card) card.classList.remove('kt-show');
    activeRequest = null;
    try {
      window.speechSynthesis && window.speechSynthesis.cancel();
    } catch (_) {
      /* ignore */
    }
  }

  function onSelectionEnd() {
    const now = selectionSnapshot();
    const snap = now || (lastSelection && Date.now() - lastSelection.ts < 1500 ? lastSelection : null);
    if (!snap) {
      hideBubble();
      return;
    }
    lastSelection = snap;
    if (settings.trigger === 'auto') startTranslation(snap);
    else showBubble(snap);
  }

  function scheduleSelectionEnd(e) {
    // Gestos sobre a própria interface (balão/cartão) não contam como nova seleção.
    if (e && (isInsideHost(e.target) || (host && e.composedPath && e.composedPath().includes(host)))) return;
    clearTimeout(timer);
    timer = setTimeout(onSelectionEnd, 80);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function renderLoading(req) {
    ensureUI();
    hideBubble();
    card.innerHTML =
      '<button class="kt-close" type="button" aria-label="Fechar">×</button>' +
      '<div class="kt-status"><span class="kt-spin"></span><span class="kt-status-text">Traduzindo com o ChatGPT…</span></div>' +
      '<div class="kt-selected">' + esc(req.text) + '</div>';
    bindClose();
    card.classList.add('kt-show');
    placeNear(card, req.rect, true);
  }

  function renderResult(req, result, meta) {
    ensureUI();
    const chunks = result.chunks || [];
    let html = '<button class="kt-close" type="button" aria-label="Fechar">×</button>';
    html += '<div class="kt-head"><button class="kt-speak" type="button" aria-label="Ouvir o trecho original" title="Ouvir">' + ICON_SPEAKER + '</button>';
    html += '<div class="kt-translation">' + esc(result.translation) + '</div></div>';
    if (chunks.length) {
      html += '<ul class="kt-chunks">';
      for (const c of chunks) {
        html +=
          '<li class="kt-chunk"><span class="kt-arrow">↳</span><span><span class="kt-src">' +
          esc(c.source) +
          '</span><span class="kt-sep">|</span><span class="kt-tgt">' +
          esc(c.target) +
          '</span></span></li>';
      }
      html += '</ul>';
    } else {
      html += '<ul class="kt-chunks"><li class="kt-chunk"><span class="kt-arrow">↳</span><span><span class="kt-src">' + esc(req.text) + '</span></span></li></ul>';
    }
    if (result.note) html += '<div class="kt-note">' + esc(result.note) + '</div>';
    const secs = meta.cached ? 'do cache' : (meta.elapsedMs / 1000).toFixed(1).replace('.', ',') + ' s';
    html += '<div class="kt-foot"><span>ChatGPT · ' + secs + (result.parsed ? '' : ' · resposta sem formato') + '</span><span>Kindle Tradutor</span></div>';
    card.innerHTML = html;
    bindClose();
    card.querySelector('.kt-speak').addEventListener('click', () => speak(req.text));
    card.classList.add('kt-show');
    placeNear(card, req.rect, true);
  }

  function renderError(req, resp) {
    ensureUI();
    const code = resp && resp.code;
    let html = '<button class="kt-close" type="button" aria-label="Fechar">×</button>';
    html += '<div class="kt-error">' + esc((resp && resp.error) || KT.errorMessage('UNKNOWN')) + '</div>';
    html += '<div class="kt-actions">';
    if (code !== 'TOO_LONG') html += '<button class="kt-btn kt-primary" data-act="retry" type="button">Tentar de novo</button>';
    if (['LOGIN', 'CHALLENGE', 'NO_COMPOSER', 'TIMEOUT', 'LIMIT', 'TAB', 'UNKNOWN'].includes(code))
      html += '<button class="kt-btn" data-act="open" type="button">Abrir ChatGPT</button>';
    html += '</div>';
    card.innerHTML = html;
    bindClose();
    const retry = card.querySelector('[data-act="retry"]');
    if (retry) retry.addEventListener('click', () => startTranslation(req));
    const open = card.querySelector('[data-act="open"]');
    if (open) open.addEventListener('click', () => chrome.runtime.sendMessage({ type: KT.MSG.OPEN_CHATGPT }).catch(() => {}));
    card.classList.add('kt-show');
    placeNear(card, req.rect, true);
  }

  function bindClose() {
    card.querySelector('.kt-close').addEventListener('click', hideCard);
  }

  function speak(text) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = settings.speechLang || 'en-US';
      u.rate = 0.95;
      synth.speak(u);
    } catch (_) {
      /* sem TTS */
    }
  }

  let requestSeq = 0;

  async function startTranslation(snap) {
    const req = {
      id: 'kt-' + Date.now() + '-' + ++requestSeq,
      text: snap.text,
      context: snap.context || '',
      rect: snap.rect,
      startedAt: Date.now(),
    };
    activeRequest = req;
    renderLoading(req);
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: KT.MSG.TRANSLATE, requestId: req.id, text: req.text, context: req.context });
    } catch (err) {
      resp = { ok: false, code: 'UNKNOWN', error: 'Não consegui falar com a extensão. Recarregue a página do Kindle. (' + ((err && err.message) || err) + ')' };
    }
    if (!activeRequest || activeRequest.id !== req.id) return; // usuário fechou ou pediu outra
    if (resp && resp.ok) renderResult(req, resp.result, resp);
    else renderError(req, resp);
  }

  function onProgress(msg) {
    if (!activeRequest || msg.requestId !== activeRequest.id || !card) return;
    const el = card.querySelector('.kt-status-text');
    if (!el) return;
    const secs = Math.round((msg.elapsedMs || Date.now() - activeRequest.startedAt) / 1000);
    el.textContent = (msg.stage === 'answering' ? 'ChatGPT respondendo…' : 'Traduzindo com o ChatGPT…') + ' ' + secs + ' s';
  }

  // ---- eventos ----
  document.addEventListener('selectionchange', () => {
    const snap = selectionSnapshot();
    if (snap) lastSelection = snap;
  });
  for (const ev of ['pointerup', 'mouseup', 'touchend']) document.addEventListener(ev, scheduleSelectionEnd, true);
  document.addEventListener(
    'keyup',
    (e) => {
      if (e.shiftKey || e.key === 'Shift') scheduleSelectionEnd(e);
    },
    true
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        hideBubble();
        hideCard();
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 't' || e.key === 'T')) {
        const snap = selectionSnapshot() || lastSelection;
        if (snap) {
          e.preventDefault();
          startTranslation(snap);
        }
      }
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (isInsideHost(e.target) || (e.composedPath && e.composedPath().includes(host))) return;
      hideBubble();
      if (card && card.classList.contains('kt-show')) hideCard();
    },
    true
  );
  window.addEventListener('resize', () => {
    if (card && card.classList.contains('kt-show') && activeRequest) placeNear(card, activeRequest.rect, true);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === KT.MSG.PROGRESS) {
      onProgress(msg);
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === KT.MSG.TRANSLATE_SELECTION) {
      const snap = selectionSnapshot() || lastSelection;
      const text = KT.normalizeWhitespace(msg.text) || (snap && snap.text);
      if (text) startTranslation({ text, context: snap && snap.text === text ? snap.context : '', rect: snap ? snap.rect : null });
      sendResponse({ ok: !!text });
      return false;
    }
    return false;
  });

  // Content scripts rodam em um mundo isolado; atributos no <html> ficam visíveis
  // para a página e para os testes (estado de prontidão e modo de disparo).
  function applySettings(next) {
    settings = KT.mergeSettings(next);
    document.documentElement.setAttribute('data-kt-ready', '1');
    document.documentElement.setAttribute('data-kt-trigger', settings.trigger);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) applySettings(changes.settings.newValue);
  });
  applySettings(null);
  chrome.runtime
    .sendMessage({ type: KT.MSG.GET_SETTINGS })
    .then((s) => applySettings(s))
    .catch(() => {});
})();
