/*
 * Testes ponta a ponta: extensão real carregada no Chromium, contra um leitor Kindle
 * simulado (texto dentro de iframe) e uma página do ChatGPT simulada com a mesma
 * estrutura de DOM (editor ProseMirror, botão de enviar/parar, mensagens do assistente).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { startServer, launchWithExtension, saveOptions, selectElement, ui, waitForPage } = require('./helpers');

let server, base, context, extensionId, tmp, worker;

test.before(async () => {
  ({ server, base } = await startServer());
  ({ context, extensionId, tmp, worker } = await launchWithExtension());
});

// Cada teste parte das mesmas opções (ChatGPT simulado em modo JSON, botão "Traduzir").
test.beforeEach(async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=json`, trigger: 'button', responseTimeout: 120 });
});

test.after(async () => {
  if (context) await context.close();
  if (server) server.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

async function openReader() {
  const page = await context.newPage();
  await page.goto(`${base}/kindle/reader.html`);
  const frame = page.frames().find((f) => f.url().endsWith('/kindle/book.html'));
  await frame.waitForSelector('html[data-kt-ready]', { state: 'attached' });
  await page.waitForSelector('html[data-kt-ready]', { state: 'attached' });
  return { page, frame };
}

function chatgptPage() {
  return waitForPage(context, (p) => p.url().startsWith(`${base}/chatgpt/`));
}

test('seleção dentro do iframe mostra o botão Traduzir e o cartão com tradução, divisão e nota', async () => {
  const { page, frame } = await openReader();
  const { bubble, card } = ui(frame);

  await selectElement(frame, '#s3'); // "on the table"
  await bubble.waitFor({ state: 'visible' });
  assert.equal(await bubble.innerText(), 'Traduzir');
  await bubble.click();

  // Estado de carregamento aparece imediatamente.
  await card.waitFor({ state: 'visible' });
  assert.match(await card.innerText(), /Traduzindo com o ChatGPT/);
  assert.equal(await bubble.isVisible(), false, 'botão some quando o cartão abre');

  // A aba do ChatGPT é aberta em segundo plano e recebe o prompt.
  const gpt = await chatgptPage();
  await gpt.waitForFunction(() => window.__mock && window.__mock.sentPrompts.length === 1);
  const prompt = await gpt.evaluate(() => window.__mock.sentPrompts[0]);
  assert.match(prompt, /Selected text: «on the table»/);
  assert.match(prompt, /Surrounding context.*nuclear power/);
  assert.match(prompt, /Target language: Português \(Brasil\)/);
  assert.notEqual(context.pages()[context.pages().length - 1], undefined);

  // Resultado renderizado no cartão.
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), 'em pauta');
  assert.deepEqual(await card.locator('.kt-src').allInnerTexts(), ['on the table']);
  assert.deepEqual(await card.locator('.kt-tgt').allInnerTexts(), ['em pauta']);
  assert.match(await card.locator('.kt-note').innerText(), /Literalmente "em cima da mesa"/);
  assert.match(await card.locator('.kt-foot').innerText(), /ChatGPT · \d+,\d s/);
  assert.ok(await card.locator('.kt-speak').isVisible(), 'botão de ouvir presente');
  await page.waitForTimeout(300);
  assert.equal(await bubble.isVisible(), false, 'botão continua escondido depois do clique nele');

  // A aba do ChatGPT foi aberta em segundo plano (não é a aba ativa); a do Kindle continua ativa.
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const gptTab = tabs.find((t) => t.url.includes('/chatgpt/'));
  const kindleTab = tabs.find((t) => t.url.endsWith('/kindle/reader.html'));
  assert.equal(gptTab.active, false);
  assert.equal(kindleTab.active, true);

  // Fechar com o ×.
  await card.locator('.kt-close').click();
  assert.equal(await card.isVisible(), false);
  await page.close();
});

test('segunda tradução do mesmo trecho vem do cache sem nova mensagem ao ChatGPT', async () => {
  const { page, frame } = await openReader();
  const { bubble, card } = ui(frame);
  const gpt = await chatgptPage();
  const before = await gpt.evaluate(() => window.__mock.sentPrompts.length);

  await selectElement(frame, '#s3');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), 'em pauta');
  assert.match(await card.locator('.kt-foot').innerText(), /do cache/);
  assert.equal(await gpt.evaluate(() => window.__mock.sentPrompts.length), before);
  await page.close();
});

test('trechos diferentes reaproveitam a mesma aba/conversa do ChatGPT e várias partes são listadas', async () => {
  const { page, frame } = await openReader();
  const { bubble, card } = ui(frame);
  const gpt = await chatgptPage();
  const before = await gpt.evaluate(() => window.__mock.sentPrompts.length);

  await selectElement(frame, '#s4'); // "nor was it a disease either"
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), 'nem tampouco era uma doença');
  assert.deepEqual(await card.locator('.kt-src').allInnerTexts(), ['nor... either', 'was it', 'a disease']);
  assert.deepEqual(await card.locator('.kt-tgt').allInnerTexts(), ['nem... tampouco', 'era', 'uma doença']);
  assert.equal(await card.locator('.kt-note').count(), 0, 'sem nota quando o JSON traz note vazio');

  const pages = context.pages().filter((p) => p.url().startsWith(`${base}/chatgpt/`));
  assert.equal(pages.length, 1, 'uma única aba do ChatGPT');
  assert.equal(await gpt.evaluate(() => window.__mock.sentPrompts.length), before + 1);
  assert.equal(await gpt.evaluate(() => document.querySelectorAll('[data-message-author-role="user"]').length), before + 1);
  await page.close();
});

test('clicar fora fecha o balão e o cartão; Escape também fecha', async () => {
  const { page, frame } = await openReader();
  const { bubble, card } = ui(frame);
  await selectElement(frame, '#s1');
  await bubble.waitFor({ state: 'visible' });
  await frame.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 })));
  await bubble.waitFor({ state: 'hidden' });

  await selectElement(frame, '#s1');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  await frame.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await card.waitFor({ state: 'hidden' });
  await page.close();
});

test('modo automático traduz ao soltar a seleção, sem botão; Alt+T também traduz', async () => {
  await saveOptions(context, extensionId, { trigger: 'auto' });
  const { page, frame } = await openReader();
  const { bubble, card } = ui(frame);
  await frame.waitForSelector('html[data-kt-trigger="auto"]', { state: 'attached' });

  await selectElement(frame, '#s2'); // "Watch out for that one, though."
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await bubble.isVisible(), false);
  assert.equal(await card.locator('.kt-translation').innerText(), 'Mas tome cuidado com aquela ali.');
  assert.equal(await card.locator('.kt-chunk').count(), 3);

  await saveOptions(context, extensionId, { trigger: 'button' });
  await frame.waitForSelector('html[data-kt-trigger="button"]', { state: 'attached' });
  await frame.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

  // Alt+T com uma seleção ativa.
  await frame.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#s3'));
    const s = document.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  });
  await frame.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', altKey: true, bubbles: true })));
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), 'em pauta');
  await page.close();
});

test('página sem iframe (texto no documento principal) também funciona', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/kindle/plain.html`);
  await page.waitForSelector('html[data-kt-ready]', { state: 'attached' });
  const { bubble, card } = ui(page.mainFrame());
  await selectElement(page.mainFrame(), '#s1');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), 'para começo de conversa');
  assert.match(await card.locator('.kt-note').innerText(), /ponto ou motivo mais importante/);
  await page.close();
});

test('resposta em cerca de código e resposta com texto em volta são interpretadas', async () => {
  for (const [mode, selector, expected] of [
    ['fenced', '#p1', 'I stand there staring'],
    ['prose', '#p2', '“Reid, you okay'],
  ]) {
    await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=${mode}` });
    const { page, frame } = await openReader();
    const { bubble, card } = ui(frame);
    await selectElement(frame, selector);
    await bubble.waitFor({ state: 'visible' });
    await bubble.click();
    await card.locator('.kt-translation').waitFor({ timeout: 20000 });
    const t = await card.locator('.kt-translation').innerText();
    assert.ok(t.startsWith('[pt] ' + expected), `${mode}: tradução inesperada: ${t}`);
    assert.doesNotMatch(await card.locator('.kt-foot').innerText(), /sem formato/);
    const gpt = await chatgptPage();
    assert.equal(new URL(gpt.url()).searchParams.get('mode'), mode, 'aba do ChatGPT foi renavegada para a nova URL');
    await page.close();
  }
});

test('resposta sem JSON vira tradução em texto puro, marcada como "sem formato"', async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=plain` });
  const { page, frame } = await openReader();
  const { bubble, card } = ui(frame);
  await selectElement(frame, '#p3');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.match(await card.locator('.kt-translation').innerText(), /^\[pt\] I shake my head/);
  assert.match(await card.locator('.kt-foot').innerText(), /sem formato/);
  await page.close();
});

test('ChatGPT deslogado: cartão mostra erro de login com botão para abrir o ChatGPT', async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=loggedout` });
  const { page, frame } = await openReader();
  const { bubble, card } = ui(frame);
  await selectElement(frame, '#p4');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-error').waitFor({ timeout: 20000 });
  assert.match(await card.locator('.kt-error').innerText(), /logado no ChatGPT/);
  assert.ok(await card.locator('[data-act="open"]').isVisible());
  assert.ok(await card.locator('[data-act="retry"]').isVisible());

  // "Abrir ChatGPT" traz a aba para frente.
  await card.locator('[data-act="open"]').click();
  await worker.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && tab.url.includes('/chatgpt/')) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('aba do ChatGPT não ficou ativa');
  });
  await page.close();
});

test('limite de mensagens do ChatGPT vira erro LIMIT', async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=limit` });
  const { page, frame } = await openReader();
  const { bubble, card } = ui(frame);
  await selectElement(frame, '#p5');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-error').waitFor({ timeout: 20000 });
  assert.match(await card.locator('.kt-error').innerText(), /limite de mensagens/);
  await page.close();
});

test('ChatGPT que nunca responde: erro de tempo esgotado respeita o limite configurado', async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=json&delay=60000`, responseTimeout: 15 });
  const { page, frame } = await openReader();
  const { bubble, card } = ui(frame);
  await selectElement(frame, '#p6');
  await bubble.waitFor({ state: 'visible' });
  const t0 = Date.now();
  await bubble.click();
  // Enquanto espera, o cartão mostra o progresso em segundos.
  await card.locator('.kt-status-text').filter({ hasText: /\d+ s/ }).waitFor({ timeout: 15000 });
  await card.locator('.kt-error').waitFor({ timeout: 30000 });
  const elapsed = Date.now() - t0;
  assert.match(await card.locator('.kt-error').innerText(), /demorou demais/);
  assert.ok(elapsed >= 14000 && elapsed < 28000, `tempo até o erro: ${elapsed}ms`);
  await page.close();
});
