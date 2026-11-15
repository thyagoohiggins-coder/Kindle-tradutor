# Kindle Tradutor (ChatGPT, sem API)

Extensão para Chrome/Edge/Brave que reproduz no **Kindle Web** (read.amazon.com / ler.amazon.com.br) a experiência do leitor gradedreaders.com: você seleciona um trecho e aparece um cartão com

- a **tradução** do trecho (em negrito, com botão para ouvir o original);
- a **divisão por partes** `trecho em inglês | tradução`, mantendo expressões idiomáticas e phrasal verbs juntos;
- uma **nota explicativa** quando há expressão, gíria ou construção que um aprendiz talvez não conheça.

A tradução é feita pelo **ChatGPT na sua própria conta, pela página do ChatGPT**, sem chave de API: a extensão abre uma aba do ChatGPT em segundo plano, anexa o trecho, digita o pedido no campo de mensagem, espera a resposta terminar, lê o JSON e devolve para a página do Kindle.

> **Por que a extensão manda uma imagem?** O Kindle Web atual não coloca o texto do livro no DOM: cada página é renderizada como **imagem** (`.kg-full-page-img img`), coberta por caixas invisíveis de palavras. Quando você arrasta, o Kindle só cria retângulos de seleção (`.kg-selection`), sem texto. Por isso a extensão recorta a imagem da página nesses retângulos (uma faixa por linha, em ordem de leitura), anexa a página inteira como contexto e pede ao ChatGPT que **transcreva e traduza**. Em leitores que ainda têm texto HTML, a seleção normal é usada diretamente.

## Instalação

1. Baixe/clone este repositório.
2. Abra `chrome://extensions`, ative o **Modo do desenvolvedor** e clique em **Carregar sem compactação**, apontando para a pasta do projeto.
3. Abra `https://chatgpt.com` e faça login (a extensão usa essa sessão).
4. Abra um livro no Kindle Web, selecione um trecho e clique em **Traduzir**.

Outras formas de disparar: **dois cliques** em uma palavra, atalho **Alt+T** (com seleção traduz; sem seleção abre o modo de **retângulo**, para você desenhar a área sobre o texto), menu do botão direito **"Traduzir seleção com ChatGPT"**, ou o modo automático nas opções (traduz ao soltar a seleção).

### Não aconteceu nada ao selecionar?

1. Abra as opções da extensão (clique no ícone) e use **Diagnosticar aba do Kindle**. O relatório diz se o script está ativo na aba, se achou a imagem da página e quantos retângulos de seleção existem.
2. Depois de instalar ou atualizar a extensão, **recarregue a aba do Kindle (F5)**: o Chrome não injeta scripts em páginas já abertas.
3. Se o relatório não lista nenhuma aba, o seu leitor está em um endereço fora da lista monitorada (veja `manifest.json`); copie a URL da aba e abra uma issue.
4. Se a imagem da página não é encontrada, use **Alt+T** e desenhe um retângulo: nesse caso a extensão captura a aba visível.

## Opções

Clique no ícone da extensão para abrir as opções:

| Opção | Padrão |
| --- | --- |
| Idioma de destino | Português (Brasil) |
| Disparo | Botão "Traduzir" ao selecionar (ou automático) |
| Nota explicativa | ativada |
| Enviar a página inteira como contexto | ativado (imagem maior, tradução melhor) |
| Idioma da voz | inglês (EUA) |
| URL do ChatGPT | `https://chatgpt.com/?temporary-chat=true` (chat temporário, não polui o histórico) |
| Tempo máximo de resposta | 120 s |
| Tamanho máximo da seleção | 1500 caracteres |

## Como funciona

```
Kindle (content script)  ──TRANSLATE(_IMAGE)──▶  service worker  ──ASK──▶  aba do ChatGPT (content script)
   retângulos .kg-selection → recorte              fila + cache              anexa a imagem, digita, envia,
   da imagem da página (ou texto HTML)             analisa o JSON            espera a resposta terminar
   cartão com resultado    ◀──resultado──                        ◀──texto──  lê a última mensagem do assistente
```

- `src/kindle/content.js` roda em todos os frames do leitor. Ao soltar o mouse, usa a seleção de texto se existir; senão lê os retângulos `.kg-selection` sobre a imagem da página, recorta cada linha (preto sobre branco, ampliado), monta uma imagem com a página inteira e a seleção contornada, e envia. Tem ainda duplo clique em palavra, modo de retângulo (Alt+T) e captura da aba (`captureVisibleTab`) como último recurso. A interface (balão e cartão) é montada no documento de cima, em Shadow DOM.
- `src/background.js` enfileira os pedidos (um por vez), mantém uma única aba do ChatGPT, renavega para um chat novo quando a URL muda ou após 40 turnos, guarda cache por trecho/imagem na sessão e responde ao diagnóstico da página de opções.
- `src/chatgpt/content.js` localiza o editor (`#prompt-textarea`/ProseMirror), anexa a imagem (evento de colar, com fallback pelo `input[type=file]`), espera o upload terminar, insere o prompt, clica em enviar, espera sumir o botão "parar" e o texto estabilizar, e devolve o texto. Detecta página de login, desafio do Cloudflare e aviso de limite de mensagens.
- `src/shared/core.js` monta os prompts (texto e imagem; pedem um único objeto JSON `{source, translation, chunks, note}`) e interpreta a resposta mesmo quando vem com cerca de código ou texto em volta.

## Testes

```bash
npm install
npm test
```

- `npm run test:unit`: 20 testes do núcleo (prompts de texto e imagem, interpretação da resposta, hash de cache, configurações, contexto).
- `npm run test:e2e`: 13 testes Playwright que carregam a extensão de verdade no Chromium contra um **Kindle simulado como o atual** (página renderizada como imagem dentro de iframe, caixas de palavras sem texto e retângulos `.kg-selection` criados ao arrastar), um Kindle com texto HTML, e um **ChatGPT simulado** com a mesma estrutura de DOM (editor contenteditable, anexos por colar/input de arquivo, botão enviar/parar, mensagens transmitidas aos poucos). Cobrem: arrasto sobre a página-imagem e recorte enviado como imagem (dimensões e conteúdo verificados; as capturas ficam em `test/e2e/.build/`), cache por imagem, duplo clique em palavra, Alt+T com retângulo, falha de upload, modo automático, diagnóstico, caminho por texto, respostas em cerca de código/sem JSON, ChatGPT deslogado, limite de mensagens e tempo esgotado. `npm run test:e2e:headed` roda com a janela visível.

Os testes usam o Chromium instalado pelo Playwright (`npx playwright install chromium` se ainda não tiver).

## Limitações conhecidas

- Depende da interface web do ChatGPT; se a OpenAI mudar os atributos do editor ou dos botões, ajuste os seletores em `src/chatgpt/content.js` (`SEL`).
- Só funciona em navegadores desktop com extensões (Chrome, Edge, Brave). No celular, use um navegador que aceite extensões (por exemplo Kiwi).
- A extensão não contorna login, verificação do Cloudflare nem limites do plano do ChatGPT: nesses casos o cartão avisa e oferece o botão **Abrir ChatGPT** para você resolver na aba.
- Enviar imagens ao ChatGPT consome a cota de modelos com visão; em contas gratuitas o limite é menor. Desligar "Enviar a página inteira como contexto" reduz o tamanho da imagem.
- O Kindle Web foi testado contra uma página simulada com a mesma estrutura do leitor atual (imagem da página + `.kg-selection`), não contra a Amazon de verdade neste ambiente. Se a Amazon mudar os nomes das classes, ajuste `SEL` em `src/kindle/content.js`; o modo de retângulo (Alt+T) continua funcionando por captura da aba.
