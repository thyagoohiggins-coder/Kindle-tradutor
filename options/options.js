(() => {
  const $ = (id) => document.getElementById(id);

  function fill(s) {
    $('targetLanguage').value = s.targetLanguage;
    $('triggerButton').checked = s.trigger !== 'auto';
    $('triggerAuto').checked = s.trigger === 'auto';
    $('includeNote').checked = !!s.includeNote;
    $('includePageContext').checked = !!s.includePageContext;
    $('speechLang').value = s.speechLang;
    $('chatgptUrl').value = s.chatgptUrl;
    $('responseTimeout').value = Math.round(s.responseTimeoutMs / 1000);
    $('maxSelectionChars').value = s.maxSelectionChars;
  }

  async function load() {
    const stored = await chrome.storage.local.get('settings');
    fill(KT.mergeSettings(stored.settings));
  }

  async function save(e) {
    e.preventDefault();
    const settings = KT.mergeSettings({
      targetLanguage: $('targetLanguage').value.trim(),
      trigger: $('triggerAuto').checked ? 'auto' : 'button',
      includeNote: $('includeNote').checked,
      includePageContext: $('includePageContext').checked,
      speechLang: $('speechLang').value,
      chatgptUrl: $('chatgptUrl').value.trim(),
      responseTimeoutMs: Number($('responseTimeout').value) * 1000,
      maxSelectionChars: Number($('maxSelectionChars').value),
    });
    await chrome.storage.local.set({ settings });
    $('status').textContent = 'Salvo!';
    setTimeout(() => ($('status').textContent = ''), 2000);
  }

  function describe(report) {
    if (!report || !report.ok) return 'Falha no diagnóstico: ' + (report && report.error);
    const lines = ['Extensão v' + report.extensionVersion];
    if (!report.tabs.length) {
      lines.push('Nenhuma aba do Kindle Web aberta. Padrões monitorados:');
      lines.push(report.patterns.join('\n'));
      lines.push('Se o seu leitor está em outro endereço, copie a URL da aba e abra uma issue.');
      return lines.join('\n');
    }
    for (const tab of report.tabs) {
      lines.push('\nAba: ' + tab.url);
      for (const f of tab.frames) {
        if (f.error) {
          lines.push('  erro: ' + f.error);
          continue;
        }
        lines.push('  frame ' + f.frameId + ': ' + f.url);
        lines.push('    script da extensão ativo: ' + (f.contentScript ? 'sim' : 'NÃO (recarregue a página)'));
        lines.push('    imagem da página: ' + (f.pageImage ? f.pageImage.natural + ' (exibida ' + f.pageImage.client + ')' : 'não encontrada'));
        lines.push('    caixas de palavras: ' + f.wordBoxes + ' · retângulos de seleção agora: ' + f.selectionBoxes);
        lines.push('    texto HTML no frame: ' + f.textChars + ' caracteres · seleção de texto: "' + f.selectionText + '"');
      }
    }
    const anyImage = report.tabs.some((t) => t.frames.some((f) => f.pageImage));
    const anyScript = report.tabs.some((t) => t.frames.some((f) => f.contentScript));
    lines.push('');
    if (!anyScript) lines.push('→ O script não está rodando: recarregue a aba do Kindle (F5) depois de instalar/atualizar a extensão.');
    else if (anyImage) lines.push('→ Tudo pronto: arraste sobre o texto e clique em Traduzir.');
    else lines.push('→ Nenhuma imagem de página encontrada: a Amazon pode ter mudado o leitor. Use Alt+T para selecionar um retângulo (captura da aba).');
    return lines.join('\n');
  }

  $('diagnose').addEventListener('click', async () => {
    $('diagnosis').textContent = 'Verificando…';
    try {
      const report = await chrome.runtime.sendMessage({ type: KT.MSG.DIAGNOSE });
      $('diagnosis').textContent = describe(report);
    } catch (e) {
      $('diagnosis').textContent = 'Falha: ' + e;
    }
  });

  $('form').addEventListener('submit', save);
  load();
})();
