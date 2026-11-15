/* Kindle Tradutor – service worker: fila de pedidos, aba do ChatGPT e cache. */
importScripts('shared/core.js');

const state = {
  chatgptTabId: null,
  chatgptTabUrl: null, // URL configurada quando a aba foi aberta
  turns: 0,
  queue: Promise.resolve(),
  current: null, // { requestId, tabId, frameId }
};

const MENU_ID = 'kt-translate-selection';

chrome.runtime.onInstalled.addListener(() => {
  const manifest = chrome.runtime.getManifest();
  const kindlePatterns = manifest.content_scripts[0].matches;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Traduzir seleção com ChatGPT',
      contexts: ['selection'],
      documentUrlPatterns: kindlePatterns,
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
  chrome.tabs
    .sendMessage(tab.id, { type: KT.MSG.TRANSLATE_SELECTION, text: info.selectionText || '' }, { frameId: info.frameId || 0 })
    .catch(() => {});
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.chatgptTabId) {
    state.chatgptTabId = null;
    state.turns = 0;
  }
});

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return KT.mergeSettings(stored.settings);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  switch (msg.type) {
    case KT.MSG.GET_SETTINGS:
      getSettings().then(sendResponse, () => sendResponse(KT.mergeSettings(null)));
      return true;

    case KT.MSG.TRANSLATE: {
      const job = () => translate(msg, sender);
      const promise = enqueue(job);
      promise.then(sendResponse, (err) => sendResponse(toErrorResponse(err)));
      return true;
    }

    case KT.MSG.PROGRESS: {
      // Vindo do content script do ChatGPT: repassa para quem pediu.
      if (sender.tab && sender.tab.id === state.chatgptTabId && state.current) {
        const { tabId, frameId, requestId } = state.current;
        chrome.tabs
          .sendMessage(tabId, { type: KT.MSG.PROGRESS, requestId, elapsedMs: msg.elapsedMs, stage: msg.stage }, { frameId })
          .catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }

    case KT.MSG.OPEN_CHATGPT:
      openChatgptTabForUser().then(() => sendResponse({ ok: true }), (e) => sendResponse(toErrorResponse(e)));
      return true;

    default:
      return false;
  }
});

function enqueue(job) {
  const run = state.queue.then(job, job);
  state.queue = run.catch(() => {});
  return run;
}

class KTError extends Error {
  constructor(code, detail) {
    super(KT.errorMessage(code) + (detail ? ' (' + detail + ')' : ''));
    this.code = code;
  }
}

function toErrorResponse(err) {
  const code = (err && err.code) || 'UNKNOWN';
  return { ok: false, code, error: (err && err.message) || KT.errorMessage(code) };
}

async function translate(msg, sender) {
  const started = Date.now();
  const settings = await getSettings();
  const text = KT.normalizeWhitespace(msg.text);
  if (!text) throw new KTError('UNKNOWN', 'seleção vazia');
  if (text.length > settings.maxSelectionChars) throw new KTError('TOO_LONG');

  const key = KT.cacheKey(text, settings.targetLanguage);
  const cached = await readCache(key);
  if (cached) return { ok: true, result: cached, cached: true, elapsedMs: 0 };

  state.current = { requestId: msg.requestId, tabId: sender.tab ? sender.tab.id : null, frameId: sender.frameId || 0 };
  try {
    const prompt = KT.buildPrompt({
      text,
      context: msg.context,
      targetLanguage: settings.targetLanguage,
      includeNote: settings.includeNote,
    });
    const tabId = await ensureChatgptTab(settings);
    const reply = await chrome.tabs.sendMessage(tabId, {
      type: KT.MSG.CHATGPT_ASK,
      prompt,
      timeoutMs: settings.responseTimeoutMs,
    });
    if (!reply || !reply.ok) throw new KTError((reply && reply.code) || 'UNKNOWN', reply && reply.detail);
    state.turns += 1;
    const result = KT.parseResponse(reply.text);
    await writeCache(key, result);
    return { ok: true, result, cached: false, elapsedMs: Date.now() - started };
  } finally {
    state.current = null;
  }
}

async function tabExists(tabId) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch (_) {
    return null;
  }
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch (_) {
    return false;
  }
}

async function ensureChatgptTab(settings) {
  let tab = await tabExists(state.chatgptTabId);
  const configuredChanged = state.chatgptTabUrl !== settings.chatgptUrl;
  const tooManyTurns = state.turns >= settings.maxTurnsPerChat;

  let previousInstance = null;
  if (tab && (!sameOrigin(tab.url || tab.pendingUrl || '', settings.chatgptUrl) || configuredChanged || tooManyTurns)) {
    // Reaproveita a aba, mas navega de novo para a URL configurada (chat novo).
    const prev = await pingChatgpt(tab.id);
    previousInstance = prev ? prev.instanceId : null;
    tab = await chrome.tabs.update(tab.id, { url: settings.chatgptUrl });
    state.turns = 0;
  }
  if (!tab) {
    tab = await chrome.tabs.create({ url: settings.chatgptUrl, active: false });
    state.turns = 0;
  }
  state.chatgptTabId = tab.id;
  state.chatgptTabUrl = settings.chatgptUrl;

  await waitForChatgptReady(tab.id, 45000, previousInstance);
  return tab.id;
}

async function pingChatgpt(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: KT.MSG.CHATGPT_PING });
    return reply && reply.ok ? reply : null;
  } catch (_) {
    return null; // content script ainda não injetado (ou página descarregando)
  }
}

async function waitForChatgptReady(tabId, timeoutMs, previousInstance) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'loading';
  while (Date.now() < deadline) {
    const reply = await pingChatgpt(tabId);
    if (reply && (!previousInstance || reply.instanceId !== previousInstance)) {
      lastStatus = reply.status;
      if (reply.status === 'ready') return;
      if (reply.status === 'login') throw new KTError('LOGIN');
      if (reply.status === 'challenge') throw new KTError('CHALLENGE');
    }
    await sleep(400);
  }
  if (!(await tabExists(tabId))) throw new KTError('TAB');
  throw new KTError('NO_COMPOSER', 'estado: ' + lastStatus);
}

async function openChatgptTabForUser() {
  const settings = await getSettings();
  const tab = await tabExists(state.chatgptTabId);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return;
  }
  const created = await chrome.tabs.create({ url: settings.chatgptUrl, active: true });
  state.chatgptTabId = created.id;
  state.chatgptTabUrl = settings.chatgptUrl;
  state.turns = 0;
}

async function readCache(key) {
  try {
    const area = chrome.storage.session || chrome.storage.local;
    const data = await area.get(key);
    return data[key] || null;
  } catch (_) {
    return null;
  }
}

async function writeCache(key, value) {
  try {
    const area = chrome.storage.session || chrome.storage.local;
    await area.set({ [key]: value });
  } catch (_) {
    /* cache é opcional */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
