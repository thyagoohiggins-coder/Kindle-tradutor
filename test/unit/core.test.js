const test = require('node:test');
const assert = require('node:assert/strict');
const KT = require('../../src/shared/core.js');

test('buildPrompt inclui trecho, contexto, idioma e pede JSON puro', () => {
  const p = KT.buildPrompt({
    text: 'nor was it a disease either',
    context: 'It was not a head injury, nor was it a disease either.',
    targetLanguage: 'Português (Brasil)',
  });
  assert.match(p, /Target language: Português \(Brasil\)/);
  assert.match(p, /Selected text: «nor was it a disease either»/);
  assert.match(p, /Surrounding context .*«It was not a head injury, nor was it a disease either\.»/);
  assert.match(p, /ONLY one JSON object/);
  assert.match(p, /"translation"/);
  assert.match(p, /"chunks"/);
  assert.match(p, /"note"/);
});

test('buildPrompt normaliza quebras de linha e omite contexto igual ao trecho', () => {
  const p = KT.buildPrompt({ text: 'on   the\n table', context: 'on the table' });
  assert.match(p, /Selected text: «on the table»/);
  assert.doesNotMatch(p, /Surrounding context/);
});

test('buildPrompt sem nota pede note vazio', () => {
  const p = KT.buildPrompt({ text: 'hello', includeNote: false });
  assert.match(p, /"note": ""\}/);
  assert.doesNotMatch(p, /language learner/);
});

test('buildPrompt rejeita texto vazio', () => {
  assert.throws(() => KT.buildPrompt({ text: '   ' }));
});

test('parseResponse lê JSON puro', () => {
  const r = KT.parseResponse(
    '{"translation":"em pauta","chunks":[{"source":"on the table","target":"em pauta"}],"note":"Literalmente \\"em cima da mesa\\"."}'
  );
  assert.equal(r.parsed, true);
  assert.equal(r.translation, 'em pauta');
  assert.deepEqual(r.chunks, [{ source: 'on the table', target: 'em pauta' }]);
  assert.equal(r.note, 'Literalmente "em cima da mesa".');
});

test('parseResponse aceita JSON dentro de cerca de código', () => {
  const r = KT.parseResponse('Claro! Aqui está:\n```json\n{"translation": "para começo de conversa", "chunks": [], "note": ""}\n```');
  assert.equal(r.parsed, true);
  assert.equal(r.translation, 'para começo de conversa');
  assert.deepEqual(r.chunks, []);
});

test('parseResponse acha o objeto no meio de texto livre', () => {
  const r = KT.parseResponse('Segue a tradução: {"translation":"nem tampouco era uma doença","chunks":[["nor... either","nem... tampouco"],{"source":"was it","target":"era"}],"note":""} espero ter ajudado');
  assert.equal(r.parsed, true);
  assert.equal(r.translation, 'nem tampouco era uma doença');
  assert.deepEqual(r.chunks, [
    { source: 'nor... either', target: 'nem... tampouco' },
    { source: 'was it', target: 'era' },
  ]);
});

test('parseResponse lida com chaves dentro de strings', () => {
  const r = KT.parseResponse('{"translation":"use {x} aqui","chunks":[{"source":"{x}","target":"{x}"}],"note":"chaves } { no texto"}');
  assert.equal(r.translation, 'use {x} aqui');
  assert.equal(r.note, 'chaves } { no texto');
});

test('parseResponse descarta chunks inválidos e sintetiza tradução ausente', () => {
  const r = KT.parseResponse('{"chunks":[{"source":"I have","target":"Eu não tenho"},{"source":"","target":"x"},null,{"source":"no idea","target":"ideia"}]}');
  assert.equal(r.translation, 'Eu não tenho ideia');
  assert.equal(r.chunks.length, 2);
});

test('parseResponse cai para texto puro quando não há JSON', () => {
  const r = KT.parseResponse('em pauta');
  assert.equal(r.parsed, false);
  assert.equal(r.translation, 'em pauta');
  assert.deepEqual(r.chunks, []);
});

test('parseResponse lança em resposta vazia', () => {
  assert.throws(() => KT.parseResponse('   '), /EMPTY/);
});

test('extractJsonObject retorna null sem chaves', () => {
  assert.equal(KT.extractJsonObject('nada aqui'), null);
});

test('mergeSettings aplica padrões e saneia valores', () => {
  const s = KT.mergeSettings({ trigger: 'weird', responseTimeoutMs: 'abc', includeNote: 'false', chatgptUrl: '' });
  assert.equal(s.trigger, 'button');
  assert.equal(s.responseTimeoutMs, KT.DEFAULT_SETTINGS.responseTimeoutMs);
  assert.equal(s.includeNote, false);
  assert.equal(s.chatgptUrl, KT.DEFAULT_SETTINGS.chatgptUrl);
  assert.equal(KT.mergeSettings(null).targetLanguage, 'Português (Brasil)');
});

test('cacheKey ignora caixa e espaços', () => {
  assert.equal(KT.cacheKey('On  the Table', 'pt'), KT.cacheKey('on the table', 'pt'));
  assert.notEqual(KT.cacheKey('on the table', 'pt'), KT.cacheKey('on the table', 'es'));
});

test('windowContext recorta ao redor da seleção e mantém blocos curtos inteiros', () => {
  const short = 'A short paragraph with the phrase inside.';
  assert.equal(KT.windowContext(short, 'the phrase', 600), short);
  const long = 'word '.repeat(200) + 'TARGET PHRASE ' + 'tail '.repeat(200);
  const ctx = KT.windowContext(long, 'target phrase', 120);
  assert.ok(ctx.length <= 130, 'contexto deve respeitar o limite');
  assert.match(ctx, /TARGET PHRASE/);
  assert.ok(ctx.startsWith('…') && ctx.endsWith('…'));
});

test('errorMessage tem texto para códigos conhecidos e fallback', () => {
  assert.match(KT.errorMessage('LOGIN'), /logado/);
  assert.equal(KT.errorMessage('???'), KT.ERROR_MESSAGES.UNKNOWN);
});

test('buildImagePrompt descreve o layout da imagem e pede source + JSON', () => {
  const p = KT.buildImagePrompt({ targetLanguage: 'Português (Brasil)', hasContext: true });
  assert.match(p, /attached image/);
  assert.match(p, /TOP part/);
  assert.match(p, /BOTTOM part/);
  assert.match(p, /"source"/);
  assert.match(p, /Target language: Português \(Brasil\)/);
  const noCtx = KT.buildImagePrompt({ hasContext: false, includeNote: false });
  assert.doesNotMatch(noCtx, /BOTTOM part/);
  assert.match(noCtx, /"note": ""\}/);
});

test('hashString é estável e distingue conteúdos', () => {
  assert.equal(KT.hashString('data:image/png;base64,AAAA'), KT.hashString('data:image/png;base64,AAAA'));
  assert.notEqual(KT.hashString('data:image/png;base64,AAAA'), KT.hashString('data:image/png;base64,AAAB'));
  assert.match(KT.hashString('x'), /^[0-9a-f]{8}-[0-9a-z]+$/);
});

test('parseResponse devolve o campo source quando presente', () => {
  const r = KT.parseResponse('{"source":"on the table","translation":"em pauta","chunks":[],"note":""}');
  assert.equal(r.source, 'on the table');
  assert.equal(KT.parseResponse('{"translation":"x"}').source, '');
  assert.equal(KT.parseResponse('texto puro').source, '');
});

test('mergeSettings mantém includePageContext por padrão e aceita desligar', () => {
  assert.equal(KT.mergeSettings(null).includePageContext, true);
  assert.equal(KT.mergeSettings({ includePageContext: false }).includePageContext, false);
});
