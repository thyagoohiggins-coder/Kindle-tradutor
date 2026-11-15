# Kindle Tradutor (ChatGPT, sem API)

Extensão para Chrome/Edge/Brave que reproduz no **Kindle Web** (read.amazon.com / ler.amazon.com.br) a experiência do leitor gradedreaders.com: você seleciona um trecho e aparece um cartão com

- a **tradução** do trecho (em negrito, com botão para ouvir o original);
- a **divisão por partes** `trecho em inglês | tradução`, mantendo expressões idiomáticas e phrasal verbs juntos;
- uma **nota explicativa** quando há expressão, gíria ou construção que um aprendiz talvez não conheça.

A tradução é feita pelo **ChatGPT na sua própria conta, pela página do ChatGPT**, sem chave de API: a extensão abre uma aba do ChatGPT em segundo plano, digita o pedido no campo de mensagem, espera a resposta terminar, lê o JSON e devolve para a página do Kindle.

## Instalação

1. Baixe/clone este repositório.
2. Abra `chrome://extensions`, ative o **Modo do desenvolvedor** e clique em **Carregar sem compactação**, apontando para a pasta do projeto.
3. Abra `https://chatgpt.com` e faça login (a extensão usa essa sessão).
4. Abra um livro no Kindle Web, selecione um trecho e clique em **Traduzir**.

Outras formas de disparar: atalho **Alt+T** com um trecho selecionado, menu do botão direito **"Traduzir seleção com ChatGPT"**, ou o modo automático nas opções (traduz ao soltar a seleção).

## Opções

Clique no ícone da extensão para abrir as opções:

| Opção | Padrão |
| --- | --- |
| Idioma de destino | Português (Brasil) |
| Disparo | Botão "Traduzir" ao selecionar (ou automático) |
| Nota explicativa | ativada |
| Idioma da voz | inglês (EUA) |
| URL do ChatGPT | `https://chatgpt.com/?temporary-chat=true` (chat temporário, não polui o histórico) |
| Tempo máximo de resposta | 120 s |
| Tamanho máximo da seleção | 1500 caracteres |

## Como funciona

```
Kindle (content script)  ──TRANSLATE──▶  service worker  ──ASK──▶  aba do ChatGPT (content script)
   seleção + contexto                     fila + cache              digita, envia, espera a resposta
   cartão com resultado  ◀──resultado──   analisa o JSON  ◀──texto──  lê a última mensagem do assistente
```

- `src/kindle/content.js` roda em todos os frames do leitor, captura a seleção, extrai o parágrafo como contexto e desenha o balão e o cartão (Shadow DOM, sem conflito com o CSS do Kindle).
- `src/background.js` enfileira os pedidos (um por vez), mantém uma única aba do ChatGPT, renavega para um chat novo quando a URL muda ou após 40 turnos, e guarda um cache por trecho na sessão.
- `src/chatgpt/content.js` localiza o editor (`#prompt-textarea`/ProseMirror), insere o prompt, clica em enviar, espera sumir o botão "parar" e o texto estabilizar, e devolve o texto. Detecta página de login, desafio do Cloudflare e aviso de limite de mensagens.
- `src/shared/core.js` monta o prompt (pede um único objeto JSON `{translation, chunks, note}`) e interpreta a resposta mesmo quando vem com cerca de código ou texto em volta.

## Testes

```bash
npm install
npm test
```

- `npm run test:unit`: 16 testes do núcleo (prompt, interpretação da resposta, configurações, contexto).
- `npm run test:e2e`: 11 testes Playwright que carregam a extensão de verdade no Chromium contra um **Kindle simulado** (texto dentro de iframe, como o leitor real) e um **ChatGPT simulado** com a mesma estrutura de DOM (editor contenteditable, botão enviar/parar, mensagens do assistente transmitidas aos poucos). Cobrem: balão e cartão, divisão em partes e nota, cache, reuso da aba, modo automático, Alt+T, Escape/clique fora, resposta em cerca de código, resposta sem JSON, ChatGPT deslogado, limite de mensagens e tempo esgotado. `npm run test:e2e:headed` roda com a janela visível.

Os testes usam o Chromium instalado pelo Playwright (`npx playwright install chromium` se ainda não tiver).

## Limitações conhecidas

- Depende da interface web do ChatGPT; se a OpenAI mudar os atributos do editor ou dos botões, ajuste os seletores em `src/chatgpt/content.js` (`SEL`).
- Só funciona em navegadores desktop com extensões (Chrome, Edge, Brave). No celular, use um navegador que aceite extensões (por exemplo Kiwi).
- A extensão não contorna login, verificação do Cloudflare nem limites do plano do ChatGPT: nesses casos o cartão avisa e oferece o botão **Abrir ChatGPT** para você resolver na aba.
- O Kindle Web foi testado contra uma página simulada com a mesma estrutura (texto em iframe). Se a Amazon renderizar o texto de outra forma, o menu do botão direito ainda funciona, pois usa o texto selecionado que o próprio Chrome informa.
