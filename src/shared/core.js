/*
 * Kindle Tradutor – código compartilhado entre service worker, content scripts e testes.
 * Padrão UMD simples: em Node vira module.exports, no navegador vira globalThis.KT.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MSG = Object.freeze({
    TRANSLATE: 'kt:translate', // kindle -> background (texto)
    TRANSLATE_IMAGE: 'kt:translate-image', // kindle -> background (recorte da página)
    CAPTURE_TAB: 'kt:capture-tab', // kindle -> background (captura da aba visível)
    DIAGNOSE: 'kt:diagnose', // opções -> background -> frames do Kindle
    TRANSLATE_SELECTION: 'kt:translate-selection', // background -> kindle (menu de contexto)
    PROGRESS: 'kt:progress', // chatgpt -> background -> kindle
    GET_SETTINGS: 'kt:get-settings', // qualquer -> background
    OPEN_CHATGPT: 'kt:open-chatgpt', // kindle -> background
    CHATGPT_PING: 'kt:chatgpt-ping', // background -> chatgpt
    CHATGPT_ASK: 'kt:chatgpt-ask', // background -> chatgpt
  });

  const DEFAULT_SETTINGS = Object.freeze({
    targetLanguage: 'Português (Brasil)',
    speechLang: 'en-US',
    chatgptUrl: 'https://chatgpt.com/?temporary-chat=true',
    trigger: 'button', // 'button' | 'auto'
    includeNote: true,
    includePageContext: true, // envia a página inteira junto com o recorte (imagem)
    maxSelectionChars: 1500,
    responseTimeoutMs: 120000,
    maxTurnsPerChat: 40,
  });

  const ERROR_MESSAGES = Object.freeze({
    LOGIN: 'Você precisa estar logado no ChatGPT. Abra a aba do ChatGPT, faça login e tente de novo.',
    CHALLENGE: 'O ChatGPT está pedindo uma verificação (Cloudflare). Abra a aba do ChatGPT, conclua a verificação e tente de novo.',
    NO_COMPOSER: 'Não encontrei a caixa de mensagem do ChatGPT. Abra a aba do ChatGPT e verifique se a página carregou.',
    TIMEOUT: 'O ChatGPT demorou demais para responder. Tente de novo.',
    LIMIT: 'O ChatGPT informou que você atingiu o limite de mensagens. Aguarde um pouco ou troque de modelo na aba do ChatGPT.',
    EMPTY: 'O ChatGPT devolveu uma resposta vazia.',
    UPLOAD: 'Não consegui anexar a imagem do trecho no ChatGPT. Verifique se a sua conta aceita envio de imagens e tente de novo.',
    CAPTURE: 'Não consegui capturar a imagem da página do Kindle.',
    NO_SELECTION: 'Nenhum trecho selecionado. Arraste sobre o texto do livro, ou use Alt+T e desenhe um retângulo.',
    TAB: 'Não consegui abrir ou alcançar a aba do ChatGPT.',
    TOO_LONG: 'Seleção longa demais. Selecione um trecho menor.',
    UNKNOWN: 'Algo deu errado ao traduzir.',
  });

  function normalizeWhitespace(text) {
    return String(text == null ? '' : text)
      .replace(/ /g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  function quote(text) {
    // Aspas angulares evitam conflito com as aspas do próprio trecho.
    return '«' + normalizeWhitespace(text).replace(/[«»]/g, '"') + '»';
  }

  function buildPrompt(opts) {
    const text = normalizeWhitespace(opts.text);
    const context = normalizeWhitespace(opts.context || '');
    const targetLanguage = opts.targetLanguage || DEFAULT_SETTINGS.targetLanguage;
    const includeNote = opts.includeNote !== false;
    if (!text) throw new Error('buildPrompt: text is required');

    const lines = [];
    lines.push(
      'You are a translation assistant embedded in an e-book reader. ' +
        'Reply with ONLY one JSON object: no markdown, no code fences, no commentary before or after it.'
    );
    lines.push('');
    lines.push('Target language: ' + targetLanguage);
    lines.push('Selected text: ' + quote(text));
    if (context && context !== text) {
      lines.push('Surrounding context (only to disambiguate; do NOT translate it): ' + quote(context));
    }
    lines.push('');
    lines.push('Return exactly this JSON shape:');
    lines.push(
      '{"translation": "natural translation of the selected text into the target language, as it reads in its context", ' +
        '"chunks": [{"source": "a segment of the selected text", "target": "translation of that segment"}], ' +
        '"note": ' +
        (includeNote
          ? '"if the selection contains an idiom, phrasal verb, slang or a construction a language learner may not know, explain it briefly in the target language (1 or 2 sentences); otherwise an empty string"}'
          : '""}')
    );
    lines.push('');
    lines.push(
      'Rules: the chunks must cover the whole selected text, in order, split into meaningful units ' +
        '(keep idioms, phrasal verbs and fixed expressions together as one chunk); ' +
        'for a single word or a very short phrase use exactly one chunk; ' +
        'keep the original register, including slang and profanity; ' +
        'preserve names; use valid JSON with double quotes and escape quotes inside strings.'
    );
    return lines.join('\n');
  }

  function buildImagePrompt(opts) {
    const targetLanguage = (opts && opts.targetLanguage) || DEFAULT_SETTINGS.targetLanguage;
    const includeNote = !opts || opts.includeNote !== false;
    const hasContext = !opts || opts.hasContext !== false;
    const lines = [];
    lines.push(
      'You are a translation assistant embedded in an e-book reader. The attached image shows a passage the reader selected. ' +
        'Reply with ONLY one JSON object: no markdown, no code fences, no commentary before or after it.'
    );
    lines.push('');
    lines.push(
      hasContext
        ? 'Image layout: the TOP part shows, in black on white, exactly the words the reader selected. The BOTTOM part shows the whole page for context, with the selected words outlined in red. Translate ONLY the selected words; use the page just to understand them.'
        : 'Image layout: it shows, in black on white, exactly the words the reader selected.'
    );
    lines.push('Target language: ' + targetLanguage);
    lines.push('');
    lines.push('Return exactly this JSON shape:');
    lines.push(
      '{"source": "the selected words transcribed exactly as written in the image (same language as the book)", ' +
        '"translation": "natural translation of the selected words into the target language, as they read in context", ' +
        '"chunks": [{"source": "a segment of the selected words", "target": "translation of that segment"}], ' +
        '"note": ' +
        (includeNote
          ? '"if the selection contains an idiom, phrasal verb, slang or a construction a language learner may not know, explain it briefly in the target language (1 or 2 sentences); otherwise an empty string"}'
          : '""}')
    );
    lines.push('');
    lines.push(
      'Rules: the chunks must cover the whole selected text, in order, split into meaningful units ' +
        '(keep idioms, phrasal verbs and fixed expressions together as one chunk); ' +
        'for a single word or a very short phrase use exactly one chunk; ' +
        'keep the original register, including slang and profanity; preserve names; ' +
        'if the selection starts or ends in the middle of a sentence, still translate only the selected words; ' +
        'use valid JSON with double quotes and escape quotes inside strings.'
    );
    return lines.join('\n');
  }

  // Hash curto e estável (FNV-1a 32 bits) para chaves de cache de imagens.
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8) + '-' + str.length.toString(36);
  }

  function stripFences(raw) {
    let s = String(raw == null ? '' : raw).replace(/^﻿/, '').trim();
    const fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    return s;
  }

  // Encontra o primeiro objeto JSON balanceado dentro de um texto livre.
  function extractJsonObject(text) {
    const s = String(text);
    const start = s.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    // Fechamento ausente: tenta do primeiro '{' ao último '}'.
    const end = s.lastIndexOf('}');
    return end > start ? s.slice(start, end + 1) : null;
  }

  function tryParse(candidate) {
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // Aspas tipográficas que alguns modelos inserem fora das strings.
      try {
        return JSON.parse(candidate.replace(/[“”]/g, '"'));
      } catch (_2) {
        return null;
      }
    }
  }

  function normalizeChunks(chunks) {
    if (!Array.isArray(chunks)) return [];
    const out = [];
    for (const c of chunks) {
      if (!c) continue;
      let source;
      let target;
      if (Array.isArray(c)) {
        source = c[0];
        target = c[1];
      } else if (typeof c === 'object') {
        source = c.source != null ? c.source : c.en != null ? c.en : c.original;
        target = c.target != null ? c.target : c.pt != null ? c.pt : c.translation;
      }
      source = normalizeWhitespace(source);
      target = normalizeWhitespace(target);
      if (source && target) out.push({ source, target });
    }
    return out;
  }

  /**
   * Converte a resposta bruta do ChatGPT em {translation, chunks, note, parsed}.
   * Nunca lança por formato ruim: se não houver JSON, usa o texto como tradução.
   */
  function parseResponse(raw) {
    const text = stripFences(raw);
    if (!text) throw new Error('EMPTY');
    const data = tryParse(text) || tryParse(extractJsonObject(text));
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const translation = normalizeWhitespace(data.translation || data.traducao || data.tradução || '');
      const chunks = normalizeChunks(data.chunks || data.segments || data.parts);
      const note = normalizeWhitespace(data.note || data.notes || data.explanation || data.nota || '');
      const source = normalizeWhitespace(data.source || data.original || data.transcription || '');
      if (translation || chunks.length) {
        return {
          source,
          translation: translation || chunks.map((c) => c.target).join(' '),
          chunks,
          note,
          parsed: true,
        };
      }
    }
    return { source: '', translation: normalizeWhitespace(text), chunks: [], note: '', parsed: false };
  }

  function cacheKey(text, targetLanguage) {
    return 'cache:' + (targetLanguage || '') + '|' + normalizeWhitespace(text).toLowerCase();
  }

  function errorMessage(code) {
    return ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN;
  }

  function mergeSettings(stored) {
    const out = Object.assign({}, DEFAULT_SETTINGS);
    if (stored && typeof stored === 'object') {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (stored[key] !== undefined && stored[key] !== null && stored[key] !== '') out[key] = stored[key];
      }
    }
    out.maxSelectionChars = Number(out.maxSelectionChars) || DEFAULT_SETTINGS.maxSelectionChars;
    out.responseTimeoutMs = Number(out.responseTimeoutMs) || DEFAULT_SETTINGS.responseTimeoutMs;
    out.maxTurnsPerChat = Number(out.maxTurnsPerChat) || DEFAULT_SETTINGS.maxTurnsPerChat;
    out.trigger = out.trigger === 'auto' ? 'auto' : 'button';
    out.includeNote = out.includeNote !== false && out.includeNote !== 'false';
    out.includePageContext = out.includePageContext !== false && out.includePageContext !== 'false';
    return out;
  }

  /**
   * Recorta uma janela de contexto ao redor do trecho selecionado.
   */
  function windowContext(blockText, selectedText, maxChars) {
    const block = normalizeWhitespace(blockText);
    const sel = normalizeWhitespace(selectedText);
    const limit = maxChars || 600;
    if (!block) return '';
    if (block.length <= limit) return block;
    const idx = block.toLowerCase().indexOf(sel.toLowerCase());
    if (idx < 0) return block.slice(0, limit);
    const spare = Math.max(0, limit - sel.length);
    let start = Math.max(0, idx - Math.floor(spare / 2));
    let end = Math.min(block.length, idx + sel.length + Math.ceil(spare / 2));
    if (start > 0) {
      const sp = block.indexOf(' ', start);
      if (sp > 0 && sp < idx) start = sp + 1;
    }
    if (end < block.length) {
      const sp = block.lastIndexOf(' ', end);
      if (sp > idx + sel.length) end = sp;
    }
    return (start > 0 ? '…' : '') + block.slice(start, end) + (end < block.length ? '…' : '');
  }

  return {
    MSG,
    DEFAULT_SETTINGS,
    ERROR_MESSAGES,
    normalizeWhitespace,
    buildPrompt,
    buildImagePrompt,
    hashString,
    parseResponse,
    extractJsonObject,
    cacheKey,
    errorMessage,
    mergeSettings,
    windowContext,
  };
});
