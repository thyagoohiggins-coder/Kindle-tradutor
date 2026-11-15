/*
 * Kindle Tradutor – roda em cada frame do Kindle Web.
 *
 * O leitor atual do Kindle Web não coloca o texto do livro no DOM: cada página é uma imagem
 * (.kg-full-page-img img) coberta por caixas invisíveis de palavras (.kg-client-dictionary).
 * Ao arrastar, o Kindle só cria retângulos (.kg-selection). Por isso este script:
 *   1) usa a seleção de texto normal quando ela existe (livros/leitores com HTML);
 *   2) senão, recorta a imagem da página pelos retângulos de seleção e manda a imagem
 *      ao ChatGPT, que transcreve e traduz;
 *   3) se nem isso der, oferece seleção por retângulo (Alt+T) e captura da aba.
 */
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
    .kt-speak { flex: none; width: 26px; height: 26px; border: 0; background: transparent; cursor: pointer; padding: 0; margin-top: 1px; }
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
    .kt-spin { flex: none; width: 18px; height: 18px; border: 3px solid #cfe6ee; border-top-color: #1f8bb8; border-radius: 50%; animation: kt-rot .8s linear infinite; }
    @keyframes kt-rot { to { transform: rotate(360deg); } }
    .kt-error { color: #a33; font-size: 14px; padding-right: 30px; }
    .kt-actions { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
    .kt-btn { border: 1px solid #1f8bb8; background: #fff; color: #1f8bb8; border-radius: 4px; padding: 6px 10px; font: 600 13px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; cursor: pointer; }
    .kt-btn.kt-primary { background: #1f8bb8; color: #fff; }
    .kt-selected { margin-top: 6px; color: #888; font-size: 13px; font-style: italic; }
    .kt-selected img { display: block; max-width: 100%; max-height: 90px; margin-top: 4px; border: 1px solid #ddd; }
    .kt-area { position: fixed; inset: 0; z-index: 2147483645; cursor: crosshair; background: rgba(0,0,0,.08); display: none; }
    .kt-area.kt-show { display: block; }
    .kt-area-rect { position: absolute; border: 2px dashed #1f8bb8; background: rgba(31,139,184,.15); display: none; }
    .kt-area-hint { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); background: #1f8bb8; color: #fff; padding: 6px 12px; border-radius: 999px; font: 600 13px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  `;

  const ICON_TRANSLATE =
    '<svg viewBox="0 0 24 24"><path d="M12.9 15l-2.6-2.6.03-.03A17.6 17.6 0 0 0 14 5.9h3V4h-7V2H8v2H1v1.9h11.2A15.8 15.8 0 0 1 9 11.3 15.6 15.6 0 0 1 6.9 8.3H4.9a17.6 17.6 0 0 0 2.6 4.1L2.4 17.4 3.8 18.8 9 13.6l3.2 3.2.7-1.8zM18.5 10h-2L12 22h2l1.1-3h4.8l1.1 3h2l-4.5-12zm-2.6 7l1.6-4.3 1.6 4.3h-3.2z"/></svg>';
  const ICON_SPEAKER =
    '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"/></svg>';

  const SEL = {
    pageImage: '.kg-full-page-img img, .kg-full-page-img canvas',
    selection: '.kg-selection',
    word: '.kg-client-dictionary',
  };

  let settings = KT.mergeSettings(null);
  let host, shadow, bubble, card, area, areaRect;
  let lastSelection = null; // snapshot
  let activeRequest = null;
  let timer = null;
  let requestSeq = 0;

  // ---- documento onde a interface é montada (o topo, quando acessível) ----
  function uiDocument() {
    try {
      if (window.frameElement && window.top && window.top.document && window.top.document.body) return window.top.document;
    } catch (_) {
      /* iframe de outra origem */
    }
    return document;
  }

  function frameOffset() {
    try {
      if (uiDocument() !== document && window.frameElement) {
        const r = window.frameElement.getBoundingClientRect();
        return { x: r.left, y: r.top };
      }
    } catch (_) {
      /* ignore */
    }
    return { x: 0, y: 0 };
  }

  function toUiRect(rect) {
    if (!rect) return null;
    const o = frameOffset();
    return { left: rect.left + o.x, right: rect.right + o.x, top: rect.top + o.y, bottom: rect.bottom + o.y, width: rect.width, height: rect.height };
  }

  function ensureUI() {
    const doc = uiDocument();
    if (host && host.isConnected && host.ownerDocument === doc) return;
    host = doc.createElement('div');
    host.className = 'kt-host';
    host.setAttribute('data-kt', '1');
    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    bubble = doc.createElement('button');
    bubble.type = 'button';
    bubble.className = 'kt-bubble';
    bubble.setAttribute('data-kt-role', 'bubble');
    bubble.innerHTML = ICON_TRANSLATE + '<span>Traduzir</span>';
    bubble.addEventListener('pointerdown', (e) => e.preventDefault());
    bubble.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (lastSelection) startTranslation(lastSelection);
    });
    shadow.appendChild(bubble);

    card = doc.createElement('div');
    card.className = 'kt-card';
    card.setAttribute('data-kt-role', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Tradução');
    shadow.appendChild(card);

    (doc.body || doc.documentElement).appendChild(host);

    // Fechar ao clicar fora, também quando a interface está no documento de cima.
    if (doc !== document) {
      doc.addEventListener('pointerdown', onOutsidePointerDown, true);
      doc.addEventListener('keydown', onEscape, true);
    }
  }

  function isInsideHost(node) {
    if (!node || !host) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && (el === host || host.contains(el)));
  }

  function fromOurUi(e) {
    return isInsideHost(e.target) || (host && e.composedPath && e.composedPath().includes(host));
  }

  // ---- detecção do que foi selecionado ----
  function pageImage() {
    const el = document.querySelector(SEL.pageImage);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 10 ? el : null;
  }

  function textSnapshot() {
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
    return { kind: 'text', text, rect: plainRect(rect), context: extractContext(range, text), ts: Date.now() };
  }

  function plainRect(r) {
    return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null;
  }

  function unionRect(rects) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const x of rects) {
      l = Math.min(l, x.left);
      t = Math.min(t, x.top);
      r = Math.max(r, x.right);
      b = Math.max(b, x.bottom);
    }
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  }

  function imageSnapshot(elements) {
    const rects = [];
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) rects.push(plainRect(r));
    }
    if (!rects.length) return null;
    return { kind: 'image', rects, rect: unionRect(rects), ts: Date.now() };
  }

  function kindleSelectionSnapshot() {
    if (!pageImage()) return null;
    return imageSnapshot(document.querySelectorAll(SEL.selection));
  }

  function detectSelection() {
    return textSnapshot() || kindleSelectionSnapshot();
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

  // ---- montagem da imagem enviada ao ChatGPT ----
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('imagem não carregou'));
      img.src = src;
    });
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // Tons de cinza; inverte páginas escuras; pinta de branco o que está fora dos retângulos.
  function normalizeForReading(ctx, w, h) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = luma;
      if (d[i + 3] > 0) {
        sum += luma;
        n++;
      }
    }
    const dark = n > 0 && sum / n < 128;
    for (let i = 0; i < d.length; i += 4) {
      const luma = dark ? 255 - d[i] : d[i];
      const a = d[i + 3] / 255;
      const v = luma * a + 255 * (1 - a);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * source: elemento desenhável (img/canvas) ou Image carregada.
   * scale: pixels da fonte por pixel CSS; rects e pageBox em pixels CSS relativos à fonte.
   */
  function compose(source, scale, rects, pageBox, includeContext) {
    // Cada retângulo de seleção (uma linha, no Kindle) vira uma faixa própria, empilhada em
    // ordem de leitura. Assim uma seleção que atravessa linhas ou colunas não arrasta a
    // página inteira para o recorte.
    const pad = 4;
    const strips = rects
      .map((r) => {
        const left = Math.max(0, r.left - pad);
        const top = Math.max(0, r.top - pad);
        return { left, top, width: Math.min(pageBox.width, r.right + pad) - left, height: Math.min(pageBox.height, r.bottom + pad) - top };
      })
      .filter((s) => s.width > 2 && s.height > 2);
    if (!strips.length) throw new Error('seleção fora da página');

    const widest = Math.max.apply(null, strips.map((s) => s.width));
    // Recorte legível: amplia seleções pequenas até ~1100px de largura (máx. 3x).
    const zoom = Math.max(1, Math.min(3, 1100 / (widest * scale)));
    const gap = 10;
    const cropW = widest * scale * zoom;
    const cropH = strips.reduce((acc, s) => acc + s.height * scale * zoom, 0) + gap * (strips.length - 1);
    const crop = makeCanvas(cropW, cropH);
    const cctx = crop.getContext('2d');
    cctx.imageSmoothingQuality = 'high';
    let y = 0;
    for (const s of strips) {
      cctx.drawImage(source, (pageBox.left + s.left) * scale, (pageBox.top + s.top) * scale, s.width * scale, s.height * scale, 0, y, s.width * scale * zoom, s.height * scale * zoom);
      y += s.height * scale * zoom + gap;
    }
    normalizeForReading(cctx, crop.width, crop.height); // lança SecurityError se a imagem for de outra origem

    let ctxCanvas = null;
    if (includeContext) {
      const maxW = 1000;
      const k = Math.min(1, maxW / (pageBox.width * scale));
      ctxCanvas = makeCanvas(pageBox.width * scale * k, pageBox.height * scale * k);
      const x = ctxCanvas.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(source, pageBox.left * scale, pageBox.top * scale, pageBox.width * scale, pageBox.height * scale, 0, 0, ctxCanvas.width, ctxCanvas.height);
      x.fillStyle = 'rgba(255, 230, 0, 0.28)';
      x.strokeStyle = '#e53935';
      x.lineWidth = 3;
      for (const r of rects) {
        x.fillRect(r.left * scale * k, r.top * scale * k, r.width * scale * k, r.height * scale * k);
        x.strokeRect(r.left * scale * k - 1.5, r.top * scale * k - 1.5, r.width * scale * k + 3, r.height * scale * k + 3);
      }
    }

    const margin = 16;
    const label = 26;
    const width = Math.max(crop.width, ctxCanvas ? ctxCanvas.width : 0) + margin * 2;
    const height = margin + label + crop.height + (ctxCanvas ? margin + label + ctxCanvas.height : 0) + margin;
    const out = makeCanvas(width, height);
    const o = out.getContext('2d');
    o.fillStyle = '#fff';
    o.fillRect(0, 0, out.width, out.height);
    o.fillStyle = '#333';
    o.font = 'bold 16px Arial, sans-serif';
    o.fillText('SELECTED TEXT:', margin, margin + 17);
    o.drawImage(crop, margin, margin + label);
    if (ctxCanvas) {
      const y = margin + label + crop.height + margin;
      o.fillStyle = '#ddd';
      o.fillRect(margin, y - margin / 2, width - margin * 2, 1);
      o.fillStyle = '#333';
      o.fillText('FULL PAGE FOR CONTEXT (selection outlined in red):', margin, y + 17);
      o.drawImage(ctxCanvas, margin, y + label);
    }
    return { dataUrl: out.toDataURL('image/jpeg', 0.88), width: out.width, height: out.height, hasContext: !!ctxCanvas };
  }

  async function buildCaptureImage(snap) {
    const img = pageImage();
    const includeContext = settings.includePageContext !== false;
    if (img && snap.source !== 'screen') {
      try {
        const box = img.getBoundingClientRect();
        const natural = img.naturalWidth || img.width;
        const scale = natural && box.width ? natural / box.width : 1;
        const rects = snap.rects.map((r) => ({ left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top, width: r.width, height: r.height }));
        const pageBox = { left: 0, top: 0, width: box.width, height: box.height };
        return compose(img, scale, rects, pageBox, includeContext);
      } catch (err) {
        console.warn('[Kindle Tradutor] não consegui recortar a imagem da página, usando captura da aba:', err);
      }
    }
    // Captura da aba visível (pixels do dispositivo), em coordenadas do documento de cima.
    const resp = await chrome.runtime.sendMessage({ type: KT.MSG.CAPTURE_TAB });
    if (!resp || !resp.ok) throw Object.assign(new Error(KT.errorMessage('CAPTURE')), { code: 'CAPTURE' });
    const shot = await loadImage(resp.dataUrl);
    const o = frameOffset();
    let topW = window.innerWidth;
    try {
      topW = window.top.innerWidth;
    } catch (_) {
      /* ignore */
    }
    const scale = shot.width / topW;
    const rects = snap.rects.map((r) => ({ left: r.left + o.x, top: r.top + o.y, right: r.right + o.x, bottom: r.bottom + o.y, width: r.width, height: r.height }));
    const pageBox = { left: o.x, top: o.y, width: Math.min(window.innerWidth, shot.width / scale - o.x), height: Math.min(window.innerHeight, shot.height / scale - o.y) };
    const relRects = rects.map((r) => ({ left: r.left - pageBox.left, top: r.top - pageBox.top, right: r.right - pageBox.left, bottom: r.bottom - pageBox.top, width: r.width, height: r.height }));
    return compose(shot, scale, relRects, pageBox, includeContext);
  }

  // ---- seleção por retângulo (Alt+T sem seleção) ----
  function ensureArea() {
    if (area && area.isConnected) return;
    area = document.createElement('div');
    area.className = 'kt-area';
    area.innerHTML = '<div class="kt-area-hint">Arraste um retângulo sobre o trecho (Esc cancela)</div>';
    areaRect = document.createElement('div');
    areaRect.className = 'kt-area-rect';
    area.appendChild(areaRect);
    const style = document.createElement('style');
    style.textContent = CSS;
    const root = document.createElement('div');
    root.className = 'kt-area-host';
    const sh = root.attachShadow({ mode: 'open' });
    sh.appendChild(style);
    sh.appendChild(area);
    (document.body || document.documentElement).appendChild(root);

    let start = null;
    area.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY };
      areaRect.style.display = 'block';
      areaRect.style.left = start.x + 'px';
      areaRect.style.top = start.y + 'px';
      areaRect.style.width = '0px';
      areaRect.style.height = '0px';
      area.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    area.addEventListener('pointermove', (e) => {
      if (!start) return;
      const l = Math.min(start.x, e.clientX), t = Math.min(start.y, e.clientY);
      areaRect.style.left = l + 'px';
      areaRect.style.top = t + 'px';
      areaRect.style.width = Math.abs(e.clientX - start.x) + 'px';
      areaRect.style.height = Math.abs(e.clientY - start.y) + 'px';
    });
    area.addEventListener('pointerup', (e) => {
      if (!start) return;
      const r = { left: Math.min(start.x, e.clientX), top: Math.min(start.y, e.clientY), right: Math.max(start.x, e.clientX), bottom: Math.max(start.y, e.clientY) };
      r.width = r.right - r.left;
      r.height = r.bottom - r.top;
      start = null;
      hideArea();
      if (r.width < 8 || r.height < 8) return;
      const img = pageImage();
      let source = 'screen';
      if (img) {
        const b = img.getBoundingClientRect();
        if (r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) source = 'page';
      }
      const snap = { kind: 'image', rects: [r], rect: r, source, ts: Date.now() };
      lastSelection = snap;
      startTranslation(snap);
    });
  }

  function showArea() {
    ensureArea();
    area.classList.add('kt-show');
    areaRect.style.display = 'none';
  }

  function hideArea() {
    if (area) area.classList.remove('kt-show');
  }

  // ---- interface ----
  function placeNear(el, rect, below) {
    const win = el.ownerDocument.defaultView || window;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
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
    placeNear(bubble, toUiRect(snap.rect), false);
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

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function bindClose() {
    card.querySelector('.kt-close').addEventListener('click', hideCard);
  }

  function renderLoading(req, label) {
    ensureUI();
    hideBubble();
    card.innerHTML =
      '<button class="kt-close" type="button" aria-label="Fechar">×</button>' +
      '<div class="kt-status"><span class="kt-spin"></span><span class="kt-status-text">' + esc(label) + '</span></div>' +
      (req.text ? '<div class="kt-selected">' + esc(req.text) + '</div>' : '');
    bindClose();
    card.classList.add('kt-show');
    placeNear(card, toUiRect(req.rect), true);
  }

  function renderResult(req, result, meta) {
    ensureUI();
    const chunks = result.chunks || [];
    const source = req.text || result.source || '';
    let html = '<button class="kt-close" type="button" aria-label="Fechar">×</button>';
    html += '<div class="kt-head"><button class="kt-speak" type="button" aria-label="Ouvir o trecho original" title="Ouvir">' + ICON_SPEAKER + '</button>';
    html += '<div class="kt-translation">' + esc(result.translation) + '</div></div>';
    html += '<ul class="kt-chunks">';
    if (chunks.length) {
      for (const c of chunks) {
        html += '<li class="kt-chunk"><span class="kt-arrow">↳</span><span><span class="kt-src">' + esc(c.source) + '</span><span class="kt-sep">|</span><span class="kt-tgt">' + esc(c.target) + '</span></span></li>';
      }
    } else if (source) {
      html += '<li class="kt-chunk"><span class="kt-arrow">↳</span><span><span class="kt-src">' + esc(source) + '</span></span></li>';
    }
    html += '</ul>';
    if (result.note) html += '<div class="kt-note">' + esc(result.note) + '</div>';
    if (req.kind === 'image' && result.source) html += '<div class="kt-selected">Trecho lido: ' + esc(result.source) + '</div>';
    const secs = meta.cached ? 'do cache' : (meta.elapsedMs / 1000).toFixed(1).replace('.', ',') + ' s';
    html += '<div class="kt-foot"><span>ChatGPT · ' + secs + (result.parsed ? '' : ' · resposta sem formato') + '</span><span>Kindle Tradutor</span></div>';
    card.innerHTML = html;
    bindClose();
    card.querySelector('.kt-speak').addEventListener('click', () => speak(source));
    card.classList.add('kt-show');
    placeNear(card, toUiRect(req.rect), true);
  }

  function renderError(req, resp) {
    ensureUI();
    const code = resp && resp.code;
    let html = '<button class="kt-close" type="button" aria-label="Fechar">×</button>';
    html += '<div class="kt-error">' + esc((resp && resp.error) || KT.errorMessage('UNKNOWN')) + '</div>';
    html += '<div class="kt-actions">';
    if (code !== 'TOO_LONG' && code !== 'NO_SELECTION') html += '<button class="kt-btn kt-primary" data-act="retry" type="button">Tentar de novo</button>';
    if (['LOGIN', 'CHALLENGE', 'NO_COMPOSER', 'TIMEOUT', 'LIMIT', 'TAB', 'UPLOAD', 'UNKNOWN'].includes(code))
      html += '<button class="kt-btn" data-act="open" type="button">Abrir ChatGPT</button>';
    if (['CAPTURE', 'NO_SELECTION', 'UPLOAD'].includes(code)) html += '<button class="kt-btn" data-act="area" type="button">Selecionar área</button>';
    html += '</div>';
    card.innerHTML = html;
    bindClose();
    const retry = card.querySelector('[data-act="retry"]');
    if (retry) retry.addEventListener('click', () => startTranslation(req));
    const open = card.querySelector('[data-act="open"]');
    if (open) open.addEventListener('click', () => chrome.runtime.sendMessage({ type: KT.MSG.OPEN_CHATGPT }).catch(() => {}));
    const areaBtn = card.querySelector('[data-act="area"]');
    if (areaBtn)
      areaBtn.addEventListener('click', () => {
        hideCard();
        showArea();
      });
    card.classList.add('kt-show');
    placeNear(card, toUiRect(req.rect), true);
  }

  function speak(text) {
    try {
      const synth = window.speechSynthesis;
      if (!synth || !text) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = settings.speechLang || 'en-US';
      u.rate = 0.95;
      synth.speak(u);
    } catch (_) {
      /* sem TTS */
    }
  }

  // ---- fluxo principal ----
  async function startTranslation(snap) {
    const req = {
      id: 'kt-' + Date.now() + '-' + ++requestSeq,
      kind: snap.kind,
      text: snap.kind === 'text' ? snap.text : '',
      context: snap.context || '',
      rects: snap.rects,
      source: snap.source,
      rect: snap.rect,
      startedAt: Date.now(),
    };
    activeRequest = req;
    let resp;
    try {
      let message;
      if (req.kind === 'image') {
        renderLoading(req, 'Capturando o trecho…');
        const capture = await buildCaptureImage(req);
        if (!activeRequest || activeRequest.id !== req.id) return;
        req.image = capture.dataUrl;
        renderLoading(req, 'Lendo e traduzindo com o ChatGPT…');
        message = { type: KT.MSG.TRANSLATE_IMAGE, requestId: req.id, image: capture.dataUrl, hasContext: capture.hasContext };
      } else {
        renderLoading(req, 'Traduzindo com o ChatGPT…');
        message = { type: KT.MSG.TRANSLATE, requestId: req.id, text: req.text, context: req.context };
      }
      resp = await chrome.runtime.sendMessage(message);
    } catch (err) {
      resp = {
        ok: false,
        code: (err && err.code) || 'UNKNOWN',
        error: err && err.code ? err.message : 'Não consegui falar com a extensão. Recarregue a página do Kindle. (' + ((err && err.message) || err) + ')',
      };
    }
    if (!activeRequest || activeRequest.id !== req.id) return;
    if (resp && resp.ok) renderResult(req, resp.result, resp);
    else renderError(req, resp || { code: 'UNKNOWN' });
  }

  function onProgress(msg) {
    if (!activeRequest || msg.requestId !== activeRequest.id || !card) return;
    const el = card.querySelector('.kt-status-text');
    if (!el) return;
    const secs = Math.round((msg.elapsedMs || Date.now() - activeRequest.startedAt) / 1000);
    const label = msg.stage === 'answering' ? 'ChatGPT respondendo…' : msg.stage === 'uploading' ? 'Enviando a imagem ao ChatGPT…' : 'Traduzindo com o ChatGPT…';
    el.textContent = label + ' ' + secs + ' s';
  }

  function onSelectionEnd() {
    const now = detectSelection();
    const snap = now || (lastSelection && lastSelection.kind === 'text' && Date.now() - lastSelection.ts < 1500 ? lastSelection : null);
    if (!snap) {
      hideBubble();
      return;
    }
    lastSelection = snap;
    if (settings.trigger === 'auto') startTranslation(snap);
    else showBubble(snap);
  }

  function scheduleSelectionEnd(e) {
    if (e && fromOurUi(e)) return;
    clearTimeout(timer);
    timer = setTimeout(onSelectionEnd, 80);
  }

  function onOutsidePointerDown(e) {
    if (fromOurUi(e)) return;
    hideBubble();
    if (card && card.classList.contains('kt-show')) hideCard();
  }

  function onEscape(e) {
    if (e.key === 'Escape') {
      hideBubble();
      hideCard();
      hideArea();
    }
  }

  function translateNow(textFromMenu) {
    const text = KT.normalizeWhitespace(textFromMenu);
    if (text) {
      const t = textSnapshot();
      startTranslation({ kind: 'text', text, context: t && t.text === text ? t.context : '', rect: t ? t.rect : lastSelection ? lastSelection.rect : null });
      return true;
    }
    const snap = detectSelection() || (lastSelection && Date.now() - lastSelection.ts < 60000 ? lastSelection : null);
    if (snap) {
      startTranslation(snap);
      return true;
    }
    showArea();
    return false;
  }

  // ---- eventos ----
  document.addEventListener('selectionchange', () => {
    const snap = textSnapshot();
    if (snap) lastSelection = snap;
  });
  for (const ev of ['pointerup', 'mouseup', 'touchend']) document.addEventListener(ev, scheduleSelectionEnd, true);
  document.addEventListener(
    'dblclick',
    (e) => {
      if (fromOurUi(e)) return;
      const word = e.target && e.target.closest ? e.target.closest(SEL.word) : null;
      if (!word || textSnapshot()) return;
      const snap = imageSnapshot([word]);
      if (!snap) return;
      clearTimeout(timer);
      lastSelection = snap;
      if (settings.trigger === 'auto') startTranslation(snap);
      else showBubble(snap);
    },
    true
  );
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
      if (e.key === 'Escape') onEscape(e);
      else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        translateNow('');
      }
    },
    true
  );
  document.addEventListener('pointerdown', onOutsidePointerDown, true);
  window.addEventListener('resize', () => {
    if (card && card.classList.contains('kt-show') && activeRequest) placeNear(card, toUiRect(activeRequest.rect), true);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === KT.MSG.PROGRESS) {
      onProgress(msg);
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === KT.MSG.TRANSLATE_SELECTION) {
      sendResponse({ ok: translateNow(msg.text) });
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
  chrome.storage.onChanged.addListener((changes, area_) => {
    if (area_ === 'local' && changes.settings) applySettings(changes.settings.newValue);
  });
  applySettings(null);
  chrome.runtime
    .sendMessage({ type: KT.MSG.GET_SETTINGS })
    .then((s) => applySettings(s))
    .catch(() => {});

  console.info('[Kindle Tradutor] ativo em', location.href.slice(0, 80), window.frameElement ? '(iframe)' : '(topo)');
})();
