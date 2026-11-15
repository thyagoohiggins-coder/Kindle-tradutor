const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const { buildTestExtension } = require('../../scripts/build-test-extension');

const FIXTURES = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = path.normalize(path.join(FIXTURES, url.pathname));
    if (!file.startsWith(FIXTURES)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function launchWithExtension() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-e2e-'));
  const extDir = buildTestExtension(path.join(tmp, 'extension'));
  const userDataDir = path.join(tmp, 'profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  return { context, extensionId, tmp, worker };
}

async function saveOptions(context, extensionId, values) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  await page.waitForFunction(() => document.getElementById('chatgptUrl').value !== '');
  if (values.chatgptUrl !== undefined) await page.fill('#chatgptUrl', values.chatgptUrl);
  if (values.trigger) await page.check(values.trigger === 'auto' ? '#triggerAuto' : '#triggerButton');
  if (values.targetLanguage !== undefined) await page.fill('#targetLanguage', values.targetLanguage);
  if (values.includeNote !== undefined) await page.setChecked('#includeNote', values.includeNote);
  if (values.includePageContext !== undefined) await page.setChecked('#includePageContext', values.includePageContext);
  if (values.responseTimeout !== undefined) await page.fill('#responseTimeout', String(values.responseTimeout));
  await page.click('#save');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Salvo!');
  await page.close();
}

/** Seleciona o conteúdo de um elemento dentro de um frame e simula o fim do gesto do mouse. */
async function selectElement(frame, selector) {
  const box = await frame.locator(selector).boundingBox();
  await frame.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = document.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selector);
  const page = frame.page();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // mouseup direto no documento do frame (sem mousedown, para não desfazer a seleção programática)
  await frame.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
}

/** A interface é montada no documento de cima quando o iframe é da mesma origem. */
function ui(frameOrPage) {
  const page = typeof frameOrPage.page === 'function' ? frameOrPage.page() : frameOrPage;
  const bubble = page.locator('.kt-host button[data-kt-role="bubble"]');
  const card = page.locator('.kt-host [data-kt-role="card"]');
  return { bubble, card };
}

/** Arrasta o mouse sobre as palavras de `text` no Kindle simulado (página como imagem). */
async function dragOverWords(frame, text) {
  const page = frame.page();
  const frameBox = await page.locator('iframe').first().boundingBox().catch(() => null);
  const off = frameBox ? { x: frameBox.x, y: frameBox.y } : { x: 0, y: 0 };
  const words = text.split(' ');
  const first = await frame.evaluate((t) => { const b = window.__kindleMock.boxFor(t); return b && { x: b.x, y: b.y, w: b.width, h: b.height }; }, words[0]);
  const range = await frame.evaluate((t) => window.__kindleMock.rangeFor(t), text);
  if (!first || !range) throw new Error('texto não encontrado no mock: ' + text);
  const last = await frame.evaluate((i) => { const b = document.querySelectorAll('.kg-client-dictionary')[i].getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, range[1]);
  await page.mouse.move(off.x + first.x + 2, off.y + first.y + first.h / 2);
  await page.mouse.down();
  await page.mouse.move(off.x + first.x + first.w / 2, off.y + first.y + first.h / 2, { steps: 3 });
  await page.mouse.move(off.x + last.x + last.w - 2, off.y + last.y + last.h / 2, { steps: 8 });
  await page.mouse.up();
}

/** Lê a imagem recebida pelo ChatGPT simulado: dimensões e fração de pixels escuros no topo. */
async function inspectImage(gptPage, index) {
  return gptPage.evaluate(async (i) => {
    const rec = window.__mock.images[i];
    if (!rec) return null;
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = rec.dataUrl; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const scan = (y0, y1) => {
      const d = x.getImageData(0, y0, c.width, y1 - y0).data;
      let dark = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k] < 100) dark++;
      return dark / (d.length / 4);
    };
    return { width: img.naturalWidth, height: img.naturalHeight, type: rec.type, via: rec.via, darkTop: scan(0, Math.min(300, c.height)), darkAll: scan(0, c.height) };
  }, index);
}

async function waitForPage(context, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = context.pages().find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('page not found');
}

module.exports = { startServer, launchWithExtension, saveOptions, selectElement, ui, waitForPage, dragOverWords, inspectImage };
