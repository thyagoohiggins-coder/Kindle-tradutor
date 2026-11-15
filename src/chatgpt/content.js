/* Kindle Tradutor – opera a interface web do ChatGPT (sem API). */
(() => {
  'use strict';
  if (window.__ktChatgptLoaded) return;
  window.__ktChatgptLoaded = true;

  // Identifica esta instância do script: após renavegar a aba, o background espera
  // até falar com uma instância nova (e não com a página antiga prestes a descarregar).
  const INSTANCE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const SEL = {
    composer: [
      '#prompt-textarea',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-virtualkeyboard]',
      'textarea[data-id="root"]',
      'form textarea',
    ],
    send: [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Enviar prompt"]',
      'button[aria-label="Enviar mensagem"]',
      'form button[type="submit"]',
    ],
    stop: [
      'button[data-testid="stop-button"]',
      'button[data-testid="composer-stop-button"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Parar transmissão"]',
      'button[aria-label="Parar de gerar"]',
    ],
    login: [
      '[data-testid="login-button"]',
      '[data-testid="welcome-login-button"]',
      '[data-testid="mobile-login-button"]',
      'a[href^="/auth/login"]',
      'a[href*="auth.openai.com"]',
    ],
    assistant: '[data-message-author-role="assistant"]',
    fileInput: ['input[type="file"][accept*="image"]', 'input[type="file"][multiple]', 'input[type="file"]'],
    attachment: [
      'form img[alt*="Uploaded" i]',
      'form img[alt*="Imagem" i]',
      'form img[src^="blob:"]',
      'form [data-testid*="attachment" i]',
      'form button[aria-label*="Remove" i]',
      'form button[aria-label*="Remover" i]',
    ],
  };

  const LIMIT_RE = /(reached (our|your|the) (message )?limit|limite de mensagens|atingiu (o|seu) limite|usage cap|too many requests)/i;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function query(list, root) {
    const scope = root || document;
    for (const s of list) {
      const el = scope.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isChallengePage() {
    return (
      /just a moment|um momento|verify you are human|attention required/i.test(document.title) ||
      !!document.querySelector('#challenge-form, #challenge-running, #cf-challenge-running, .cf-turnstile, #challenge-stage')
    );
  }

  function status() {
    if (isChallengePage()) return 'challenge';
    const composer = query(SEL.composer);
    if (composer && isVisible(composer)) return 'ready';
    const login = query(SEL.login);
    if (login && isVisible(login)) return 'login';
    return 'loading';
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function composerText(el) {
    return (el.tagName === 'TEXTAREA' ? el.value : el.innerText || el.textContent || '').trim();
  }

  async function insertPrompt(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      setNativeValue(el, text);
      return;
    }
    // Editor ProseMirror: seleciona todo o conteúdo e insere via execCommand (o editor reconhece).
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (_) {
      ok = false;
    }
    await sleep(50);
    const probe = text.slice(0, 40);
    if (!ok || !composerText(el).includes(probe)) {
      // Fallback: escreve parágrafos diretamente e avisa o editor.
      el.innerHTML = '';
      for (const line of text.split('\n')) {
        const p = document.createElement('p');
        if (line) p.textContent = line;
        else p.appendChild(document.createElement('br'));
        el.appendChild(p);
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      await sleep(50);
    }
  }

  async function pressSend(composer, waitMs) {
    const deadline = Date.now() + (waitMs || 4000);
    while (Date.now() < deadline) {
      const btn = query(SEL.send);
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        btn.click();
        return 'click';
      }
      await sleep(100);
    }
    // Fallback: Enter no editor.
    const ev = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    composer.dispatchEvent(new KeyboardEvent('keydown', ev));
    composer.dispatchEvent(new KeyboardEvent('keypress', ev));
    composer.dispatchEvent(new KeyboardEvent('keyup', ev));
    return 'enter';
  }

  function assistantNodes() {
    return Array.from(document.querySelectorAll(SEL.assistant));
  }

  function extractText(node) {
    const codes = node.querySelectorAll('pre code');
    if (codes.length) return Array.from(codes).map((c) => c.innerText || c.textContent).join('\n').trim();
    return (node.innerText || node.textContent || '').trim();
  }

  function pageShowsLimit() {
    const alerts = document.querySelectorAll('[role="alert"], [role="status"], [data-testid*="error"], .text-token-text-error');
    for (const a of alerts) if (LIMIT_RE.test(a.textContent || '')) return true;
    return false;
  }

  function reportProgress(startedAt, stage) {
    try {
      chrome.runtime.sendMessage({ type: KT.MSG.PROGRESS, elapsedMs: Date.now() - startedAt, stage }).catch(() => {});
    } catch (_) {
      /* extensão recarregada */
    }
  }

  function composerForm(composer) {
    return composer.closest('form') || document;
  }

  function attachmentCount(composer) {
    const form = composerForm(composer);
    let n = 0;
    for (const sel of SEL.attachment) n += form.querySelectorAll(sel.replace(/^form /, '')).length;
    return n;
  }

  async function dataUrlToFile(dataUrl, name) {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: blob.type || 'image/png' });
  }

  async function waitFor(predicate, timeoutMs, stepMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = predicate();
      if (v) return v;
      await sleep(stepMs || 100);
    }
    return null;
  }

  // Anexa uma imagem ao compositor: primeiro simulando "colar", depois pelo input de arquivo.
  async function attachImage(composer, dataUrl) {
    const file = await dataUrlToFile(dataUrl, 'kindle-trecho.' + (dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png'));
    const before = attachmentCount(composer);
    const dt = new DataTransfer();
    dt.items.add(file);

    composer.focus();
    try {
      composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (_) {
      /* navegador sem ClipboardEvent construível */
    }
    if (await waitFor(() => attachmentCount(composer) > before, 2500)) return 'paste';

    const input = query(SEL.fileInput, composerForm(composer)) || query(SEL.fileInput);
    if (input) {
      try {
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {
        /* input protegido */
      }
      if (await waitFor(() => attachmentCount(composer) > before, 4000)) return 'input';
    }
    return null;
  }

  async function ask(prompt, timeoutMs, image) {
    const startedAt = Date.now();
    const composer = query(SEL.composer);
    if (!composer) return { ok: false, code: status() === 'login' ? 'LOGIN' : 'NO_COMPOSER' };

    const before = assistantNodes();
    const lastBefore = before[before.length - 1] || null;

    if (image) {
      const how = await attachImage(composer, image);
      if (!how) return { ok: false, code: 'UPLOAD', detail: 'não consegui anexar a imagem ao ChatGPT' };
      reportProgress(startedAt, 'uploading');
    }

    await insertPrompt(composer, prompt);
    if (!composerText(composer).includes(prompt.slice(0, 40))) {
      return { ok: false, code: 'NO_COMPOSER', detail: 'não consegui escrever no editor' };
    }
    // Com imagem, o botão de enviar só habilita quando o upload termina.
    const how = await pressSend(composer, image ? 45000 : 4000);
    if (image && how === 'enter' && attachmentCount(composer) > 0 && composerText(composer).includes(prompt.slice(0, 40))) {
      // O Enter não enviou: provavelmente o upload ainda não terminou.
      await sleep(1500);
      if (composerText(composer).includes(prompt.slice(0, 40))) return { ok: false, code: 'UPLOAD', detail: 'o upload da imagem não terminou' };
    }

    let lastText = '';
    let stableSince = 0;
    let lastProgress = 0;
    let sawStop = false;
    const deadline = startedAt + (timeoutMs || 120000);

    while (Date.now() < deadline) {
      await sleep(250);
      if (Date.now() - lastProgress > 3000) {
        lastProgress = Date.now();
        reportProgress(startedAt, sawStop || lastText ? 'answering' : 'waiting');
      }
      if (pageShowsLimit()) return { ok: false, code: 'LIMIT' };

      const streaming = !!query(SEL.stop);
      if (streaming) sawStop = true;

      const nodes = assistantNodes();
      const node = nodes[nodes.length - 1];
      if (!node || node === lastBefore) continue;
      const text = extractText(node);
      if (LIMIT_RE.test(text) && text.length < 400) return { ok: false, code: 'LIMIT' };

      if (text && text === lastText && !streaming) {
        if (!stableSince) stableSince = Date.now();
        else if (Date.now() - stableSince >= 800) return { ok: true, text, elapsedMs: Date.now() - startedAt };
      } else {
        lastText = text;
        stableSince = 0;
      }
    }
    return { ok: false, code: 'TIMEOUT' };
  }

  let busy = false;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === KT.MSG.CHATGPT_PING) {
      sendResponse({ ok: true, status: status(), busy, instanceId: INSTANCE_ID });
      return false;
    }
    if (msg.type === KT.MSG.CHATGPT_ASK) {
      if (busy) {
        sendResponse({ ok: false, code: 'UNKNOWN', detail: 'já existe um pedido em andamento' });
        return false;
      }
      busy = true;
      ask(String(msg.prompt || ''), Number(msg.timeoutMs) || 120000, typeof msg.image === 'string' ? msg.image : null)
        .then(sendResponse, (err) => sendResponse({ ok: false, code: 'UNKNOWN', detail: String((err && err.message) || err) }))
        .finally(() => {
          busy = false;
        });
      return true;
    }
    return false;
  });
})();
