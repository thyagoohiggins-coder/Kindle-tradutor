/*
 * Copia a extensão para um diretório temporário com o manifesto apontando para
 * as páginas simuladas (Kindle e ChatGPT) servidas em http://127.0.0.1.
 * Uso: node scripts/build-test-extension.js <dir-de-saida>
 */
const fs = require('fs');
const path = require('path');

function buildTestExtension(outDir) {
  const root = path.join(__dirname, '..');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of ['src', 'options', 'icons']) {
    fs.cpSync(path.join(root, entry), path.join(outDir, entry), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const kindle = ['http://127.0.0.1/kindle/*', 'http://localhost/kindle/*'];
  const chatgpt = ['http://127.0.0.1/chatgpt/*', 'http://localhost/chatgpt/*'];
  manifest.name += ' (teste)';
  manifest.host_permissions = kindle.concat(chatgpt);
  manifest.content_scripts[0].matches = kindle;
  manifest.content_scripts[1].matches = chatgpt;
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return outDir;
}

module.exports = { buildTestExtension };

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, '..', 'test', 'e2e', '.build', 'extension');
  console.log(buildTestExtension(path.resolve(out)));
}
