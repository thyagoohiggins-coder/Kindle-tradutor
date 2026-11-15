/*
 * Testes ponta a ponta: extensão real carregada no Chromium contra
 *  - um Kindle Web simulado como o atual (página renderizada como IMAGEM, caixas de palavras
 *    sem texto e retângulos .kg-selection criados ao arrastar), dentro de um iframe;
 *  - um Kindle com texto HTML (caminho por texto);
 *  - um ChatGPT simulado com a mesma estrutura de DOM (editor ProseMirror, anexos por
 *    "colar"/input de arquivo, botão enviar/parar, mensagens do assistente transmitidas aos poucos).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, launchWithExtension, saveOptions, selectElement, ui, waitForPage, dragOverWords, inspectImage } = require('./helpers');

let server, base, context, extensionId, tmp, worker;
const OUT = process.env.KT_E2E_OUT || path.join(__dirname, '.build');

test.before(async () => {
  ({ server, base } = await startServer());
  ({ context, extensionId, tmp, worker } = await launchWithExtension());
  fs.mkdirSync(OUT, { recursive: true });
});

test.after(async () => {
  if (context) await context.close();
  if (server) server.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

// Cada teste parte das mesmas opções (ChatGPT simulado em modo JSON, botão "Traduzir").
test.beforeEach(async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=json`, trigger: 'button', responseTimeout: 120, includePageContext: true });
});

async function openImageReader() {
  const page = await context.newPage();
  await page.goto(`${base}/kindle/reader.html`);
  const frame = page.frames().find((f) => f.url().endsWith('/kindle/book.html'));
  await frame.waitForSelector('html[data-kt-ready]', { state: 'attached' });
  await frame.waitForFunction(() => { const i = document.querySelector('.kg-full-page-img img'); return i && i.complete && i.naturalWidth > 0; });
  return { page, frame };
}

async function openTextReader() {
  const page = await context.newPage();
  await page.goto(`${base}/kindle/reader-text.html`);
  const frame = page.frames().find((f) => f.url().endsWith('/kindle/book-text.html'));
  await frame.waitForSelector('html[data-kt-ready]', { state: 'attached' });
  return { page, frame };
}

function chatgptPage() {
  return waitForPage(context, (p) => p.url().startsWith(`${base}/chatgpt/`));
}

// ---------- Kindle atual: página como imagem ----------

test('arrastar sobre a página-imagem cria .kg-selection, mostra Traduzir e envia o recorte como imagem ao ChatGPT', async () => {
  const { page, frame } = await openImageReader();
  const { bubble, card } = ui(page);

  await dragOverWords(frame, 'nor was it a disease either');
  assert.ok((await frame.evaluate(() => window.__kindleMock.selectionCount())) >= 1, 'o leitor simulado criou retângulos de seleção');
  assert.equal(await frame.evaluate(() => String(document.getSelection())), '', 'não existe seleção de texto no DOM, como no Kindle real');

  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.waitFor({ state: 'visible' });
  assert.match(await card.innerText(), /Capturando o trecho|Lendo e traduzindo/);

  const gpt = await chatgptPage();
  await gpt.waitForFunction(() => window.__mock.sentPrompts.length === 1);
  const prompt = await gpt.evaluate(() => window.__mock.sentPrompts[0]);
  assert.match(prompt, /attached image/);
  assert.match(prompt, /BOTTOM part shows the whole page/);
  assert.match(prompt, /Target language: Português \(Brasil\)/);
  assert.equal(await gpt.evaluate(() => window.__mock.imagesPerPrompt[0]), 1, 'uma imagem anexada à mensagem');

  const info = await inspectImage(gpt, 0);
  fs.writeFileSync(path.join(OUT, 'capture-drag.jpg'), Buffer.from((await gpt.evaluate(() => window.__mock.images[0].dataUrl)).split(',')[1], 'base64'));
  assert.equal(info.type, 'image/jpeg');
  assert.ok(info.width >= 900 && info.width <= 1140, `largura do recorte ampliado: ${info.width}`);
  assert.ok(info.height > 600 && info.height < 1400, `imagem composta (faixas do recorte + página de contexto): ${info.height}`);
  assert.ok(info.darkTop > 0.01 && info.darkTop < 0.4, `topo tem texto preto sobre branco (fração escura ${info.darkTop.toFixed(3)})`);
  assert.ok(info.darkAll > 0.3, `página de contexto escura incluída (fração escura ${info.darkAll.toFixed(3)})`);

  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), 'nem tampouco era uma doença');
  assert.deepEqual(await card.locator('.kt-src').allInnerTexts(), ['nor... either', 'was it', 'a disease']);
  assert.match(await card.locator('.kt-selected').innerText(), /Trecho lido: nor was it a disease either/);

  // Aba do ChatGPT aberta em segundo plano; a do Kindle continua ativa.
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  assert.equal(tabs.find((t) => t.url.includes('/chatgpt/')).active, false);
  assert.equal(tabs.find((t) => t.url.endsWith('/kindle/reader.html')).active, true);
  await page.close();
});

test('a mesma seleção de novo vem do cache (mesma imagem, sem nova mensagem)', async () => {
  const { page, frame } = await openImageReader();
  const { bubble, card } = ui(page);
  const gpt = await chatgptPage();
  const before = await gpt.evaluate(() => window.__mock.sentPrompts.length);
  await dragOverWords(frame, 'nor was it a disease either');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.match(await card.locator('.kt-foot').innerText(), /do cache/);
  assert.equal(await gpt.evaluate(() => window.__mock.sentPrompts.length), before);
  await page.close();
});

test('duplo clique em uma palavra (caixa sem texto) traduz só aquela palavra', async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=json&imageText=chick` });
  const { page, frame } = await openImageReader();
  const { bubble, card } = ui(page);
  const box = await frame.evaluate(() => { const b = window.__kindleMock.boxFor('chick?”'); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const fb = await page.locator('iframe').boundingBox();
  await page.mouse.dblclick(fb.x + box.x + box.w / 2, fb.y + box.y + box.h / 2);
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  const gpt = await chatgptPage();
  await gpt.waitForFunction((n) => window.__mock.images.length >= n, 1);
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), '[pt] chick');
  const info = await inspectImage(gpt, (await gpt.evaluate(() => window.__mock.images.length)) - 1);
  fs.writeFileSync(path.join(OUT, 'capture-word.jpg'), Buffer.from((await gpt.evaluate(() => window.__mock.images[window.__mock.images.length - 1].dataUrl)).split(',')[1], 'base64'));
  assert.ok(info.darkTop > 0.005, 'recorte da palavra tem tinta');
  await page.close();
});

test('Alt+T sem seleção abre o modo de retângulo; arrastar um retângulo traduz a área', async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=json&imageText=on the table`, includePageContext: false });
  const { page, frame } = await openImageReader();
  const { card } = ui(page);
  await frame.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', altKey: true, bubbles: true })));
  const overlay = frame.locator('.kt-area-host .kt-area');
  await overlay.waitFor({ state: 'visible' });
  const box = await frame.evaluate(() => { const b = window.__kindleMock.boxFor('nuclear'); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const fb = await page.locator('iframe').boundingBox();
  await page.mouse.move(fb.x + box.x - 10, fb.y + box.y - 6);
  await page.mouse.down();
  await page.mouse.move(fb.x + box.x + 260, fb.y + box.y + box.h + 6, { steps: 6 });
  await page.mouse.up();
  await overlay.waitFor({ state: 'hidden' });
  const gpt = await chatgptPage();
  await gpt.waitForFunction(() => /Image layout: it shows/.test(window.__mock.sentPrompts[window.__mock.sentPrompts.length - 1] || ''));
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), 'em pauta');
  const info = await inspectImage(gpt, (await gpt.evaluate(() => window.__mock.images.length)) - 1);
  fs.writeFileSync(path.join(OUT, 'capture-area.jpg'), Buffer.from((await gpt.evaluate(() => window.__mock.images[window.__mock.images.length - 1].dataUrl)).split(',')[1], 'base64'));
  assert.ok(info.height < 400, `sem página de contexto a imagem é só o recorte (${info.height}px)`);
  assert.ok(info.darkAll < 0.3, 'recorte normalizado: preto sobre branco');
  await page.close();
});

test('se o ChatGPT não aceita o anexo, o cartão mostra erro de upload com "Selecionar área"', async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=noupload` });
  const { page, frame } = await openImageReader();
  const { bubble, card } = ui(page);
  await dragOverWords(frame, 'Watch out for that one, though.');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-error').waitFor({ timeout: 30000 });
  assert.match(await card.locator('.kt-error').innerText(), /anexar a imagem/);
  assert.ok(await card.locator('[data-act="area"]').isVisible());
  await page.close();
});

test('modo automático: soltar o arrasto já traduz, sem botão', async () => {
  await saveOptions(context, extensionId, { trigger: 'auto', chatgptUrl: `${base}/chatgpt/?mode=json&imageText=I have no idea.` });
  const { page, frame } = await openImageReader();
  const { bubble, card } = ui(page);
  await frame.waitForSelector('html[data-kt-trigger="auto"]', { state: 'attached' });
  await dragOverWords(frame, 'I have no idea.');
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await bubble.isVisible(), false);
  assert.equal(await card.locator('.kt-translation').innerText(), 'Não faço ideia.');
  await page.close();
});

test('diagnóstico pela página de opções enxerga a aba do Kindle, o script e a imagem da página', async () => {
  const { page } = await openImageReader();
  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opts.click('#diagnose');
  await opts.waitForFunction(() => /Aba:/.test(document.getElementById('diagnosis').textContent));
  const text = await opts.locator('#diagnosis').innerText();
  assert.match(text, /script da extensão ativo: sim/);
  assert.match(text, /imagem da página: 2200x1240/);
  assert.match(text, /Tudo pronto/);
  await opts.close();
  await page.close();
});

// ---------- Leitores com texto HTML (caminho por texto) ----------

test('texto HTML dentro de iframe: seleção normal mostra o botão e traduz com contexto', async () => {
  const { page, frame } = await openTextReader();
  const { bubble, card } = ui(page);
  await selectElement(frame, '#s3'); // "on the table"
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  const gpt = await chatgptPage();
  await gpt.waitForFunction(() => /Selected text: «on the table»/.test(window.__mock.sentPrompts[window.__mock.sentPrompts.length - 1] || ''));
  const prompt = await gpt.evaluate(() => window.__mock.sentPrompts[window.__mock.sentPrompts.length - 1]);
  assert.match(prompt, /Surrounding context.*nuclear power/);
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), 'em pauta');
  assert.match(await card.locator('.kt-note').innerText(), /Literalmente "em cima da mesa"/);
  await page.waitForTimeout(300);
  assert.equal(await bubble.isVisible(), false, 'botão continua escondido depois do clique nele');
  await card.locator('.kt-close').click();
  assert.equal(await card.isVisible(), false);
  await page.close();
});

test('texto HTML no documento principal: Escape e clique fora fecham; cache por texto', async () => {
  const page = await context.newPage();
  await page.goto(`${base}/kindle/plain.html`);
  await page.waitForSelector('html[data-kt-ready]', { state: 'attached' });
  const { bubble, card } = ui(page);
  await selectElement(page.mainFrame(), '#s1');
  await bubble.waitFor({ state: 'visible' });
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 })));
  await bubble.waitFor({ state: 'hidden' });

  await selectElement(page.mainFrame(), '#s1');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('.kt-translation').innerText(), 'para começo de conversa');
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await card.waitFor({ state: 'hidden' });

  await selectElement(page.mainFrame(), '#s1');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-translation').waitFor({ timeout: 20000 });
  assert.match(await card.locator('.kt-foot').innerText(), /do cache/);
  await page.close();
});

test('respostas em cerca de código, com texto em volta e sem JSON são interpretadas', async () => {
  for (const [mode, selector, expected, raw] of [
    ['fenced', '#p1', '[pt] I stand there staring', false],
    ['prose', '#p2', '[pt] “Reid, you okay', false],
    ['plain', '#p3', '[pt] I shake my head', true],
  ]) {
    await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=${mode}` });
    const { page, frame } = await openTextReader();
    const { bubble, card } = ui(page);
    await selectElement(frame, selector);
    await bubble.waitFor({ state: 'visible' });
    await bubble.click();
    await card.locator('.kt-translation').waitFor({ timeout: 20000 });
    const t = await card.locator('.kt-translation').innerText();
    assert.ok(t.startsWith(expected), `${mode}: tradução inesperada: ${t}`);
    const foot = await card.locator('.kt-foot').innerText();
    if (raw) assert.match(foot, /sem formato/);
    else assert.doesNotMatch(foot, /sem formato/);
    const gpt = await chatgptPage();
    assert.equal(new URL(gpt.url()).searchParams.get('mode'), mode, 'aba do ChatGPT foi renavegada para a nova URL');
    await page.close();
  }
});

test('ChatGPT deslogado: erro de login com botão para abrir o ChatGPT (que traz a aba para frente)', async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=loggedout` });
  const { page, frame } = await openImageReader();
  const { bubble, card } = ui(page);
  await dragOverWords(frame, 'Atlas smirks.');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-error').waitFor({ timeout: 20000 });
  assert.match(await card.locator('.kt-error').innerText(), /logado no ChatGPT/);
  assert.ok(await card.locator('[data-act="retry"]').isVisible());
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
  const { page, frame } = await openTextReader();
  const { bubble, card } = ui(page);
  await selectElement(frame, '#p5');
  await bubble.waitFor({ state: 'visible' });
  await bubble.click();
  await card.locator('.kt-error').waitFor({ timeout: 20000 });
  assert.match(await card.locator('.kt-error').innerText(), /limite de mensagens/);
  await page.close();
});

test('ChatGPT que nunca responde: erro de tempo esgotado respeita o limite configurado e mostra progresso', async () => {
  await saveOptions(context, extensionId, { chatgptUrl: `${base}/chatgpt/?mode=json&delay=60000`, responseTimeout: 15 });
  const { page, frame } = await openTextReader();
  const { bubble, card } = ui(page);
  await selectElement(frame, '#p6');
  await bubble.waitFor({ state: 'visible' });
  const t0 = Date.now();
  await bubble.click();
  await card.locator('.kt-status-text').filter({ hasText: /\d+ s/ }).waitFor({ timeout: 15000 });
  await card.locator('.kt-error').waitFor({ timeout: 30000 });
  const elapsed = Date.now() - t0;
  assert.match(await card.locator('.kt-error').innerText(), /demorou demais/);
  assert.ok(elapsed >= 14000 && elapsed < 28000, `tempo até o erro: ${elapsed}ms`);
  await page.close();
});
