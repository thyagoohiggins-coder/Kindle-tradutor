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

function ui(frame) {
  const bubble = frame.locator('#kt-host button[data-kt-role="bubble"]');
  const card = frame.locator('#kt-host [data-kt-role="card"]');
  return { bubble, card };
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

module.exports = { startServer, launchWithExtension, saveOptions, selectElement, ui, waitForPage };
