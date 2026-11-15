(() => {
  const $ = (id) => document.getElementById(id);

  function fill(s) {
    $('targetLanguage').value = s.targetLanguage;
    $('triggerButton').checked = s.trigger !== 'auto';
    $('triggerAuto').checked = s.trigger === 'auto';
    $('includeNote').checked = !!s.includeNote;
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
      speechLang: $('speechLang').value,
      chatgptUrl: $('chatgptUrl').value.trim(),
      responseTimeoutMs: Number($('responseTimeout').value) * 1000,
      maxSelectionChars: Number($('maxSelectionChars').value),
    });
    await chrome.storage.local.set({ settings });
    $('status').textContent = 'Salvo!';
    setTimeout(() => ($('status').textContent = ''), 2000);
  }

  $('form').addEventListener('submit', save);
  load();
})();
