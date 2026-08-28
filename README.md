# Neuro, agente de e-mail

Automação (Google Apps Script) para triagem diária da caixa de entrada do Gmail. Existia um script legado no Apps Script que parou de funcionar corretamente, deixando a caixa com ~4 mil e-mails acumulados. Este repositório versiona esse script, adiciona testes e um pipeline de CI, e documenta o fluxo de trabalho.

## Requisitos

- [nvm](https://github.com/nvm-sh/nvm) — nada de Node/npm instalado direto no sistema. O Node é isolado por projeto via nvm, pinado no arquivo [.nvmrc](.nvmrc).
- Conta Google com um projeto no [Apps Script](https://script.google.com) já existente (o script legado).

Não é necessário instalar nada globalmente: todas as dependências (`clasp`, `typescript`, `jest`, etc.) ficam em `node_modules/` e são chamadas via `npx`/scripts do `npm`.

## Diagnóstico do script legado (por que ~4 mil e-mails acumularam)

Análise de [`src/Código.js`](src/Código.js) como foi clonado do Apps Script, antes de qualquer alteração. Três problemas — provavelmente combinados — explicam o script ter parado de categorizar/arquivar e-mails novos:

### Bug A — `salvarMemoria` estourava o limite de tamanho do PropertiesService (causa mais provável da parada total) — ✅ corrigido

`salvarMemoria` gravava a memória de classificação inteira (até `MAX_MEMORIA = 500` entradas) numa única Script Property (`EMAIL_MEMORIA`). O Apps Script limita cada valor de propriedade a 9KB. A própria função `importarMemoria` existe porque alguém já bateu nesse limite antes: ela importa 200 entradas manualmente **divididas em 5 chunks** (`EMAIL_MEMORIA_0`..`_4`) — só que `carregarMemoria`/`salvarMemoria` nunca liam essas chaves, só `EMAIL_MEMORIA`. A gravação real (não fragmentada) provavelmente excedia 9KB rapidamente, `setProperty` lançava exceção, e essa chamada ficava **fora** do `try/catch` de `categorizarEmailsNovos` — o catch só envolvia `processarThread`, não `salvarMemoria`. Isso derrubava a execução inteira do trigger.

**Evidência**: nos próprios dados importados em `importarMemoria`, várias entradas são e-mails do próprio Google com assunto "summary of failures for Google Apps Script" — ou seja, o script já vinha recebendo avisos de falha recorrente do trigger. O Apps Script desabilita automaticamente um trigger depois de falhar repetidamente, o que bate com "o script parou de funcionar".

**Correção aplicada**: `carregarMemoria`/`salvarMemoria` agora gravam em chunks (mesmo formato que `importarMemoria` já usava manualmente), `limparTudo` apaga os chunks certos, e a chamada a `salvarMemoria` dentro de `categorizarEmailsNovos` ganhou `try/catch`. Testes em [`test/memoria.test.ts`](test/memoria.test.ts).

### Bug B — throughput muito abaixo do volume real de e-mails, e nunca tocava no backlog — ✅ corrigido

O comentário e o log diziam "a cada 10 min", mas o trigger real criado em `configurarTriggers` rodava **uma vez por dia**, às 8h, e cada execução processava no máximo **50 threads**. Além disso, a busca filtrava por `after:` (últimas 24h) — ou seja, mesmo sem bug nenhum, o agente **nunca conseguiria processar o backlog de e-mails antigos**, só e-mails novos.

**Correção aplicada**: trigger passou a `everyMinutes(10)`; a busca por data foi trocada por exclusão das threads que já têm alguma label de categoria (`construirQueryNaoProcessados`), o que também deixa o agente processar o backlog aos poucos; e a busca agora pagina em lotes de 100 com um teto de 300 threads/execução (evita estourar o limite de 6 min do Apps Script). Testes em [`test/categorizacao.test.ts`](test/categorizacao.test.ts).

### Bug C — memória "importada" nunca era usada — ✅ corrigido como efeito colateral do Bug A

Consequência direta do Bug A: como `EMAIL_MEMORIA_0..4` nunca era lido pelo código real, o k-NN rodava praticamente sempre a frio, caindo sempre no fallback de regras fixas em vez de aprender com o histórico. Como o novo formato de `carregarMemoria`/`salvarMemoria` usa exatamente as mesmas chaves que `importarMemoria` já escrevia, as 200 entradas antigas passaram a ser lidas automaticamente — sem migração separada.

### Status

- [x] Bug A — memória em chunks + `try/catch`
- [x] Bug B — trigger de 10 em 10 min, paginação, processamento do backlog
- [x] Bug C — resolvido junto com o Bug A
- [x] `clasp push` — correções já enviadas para o Apps Script real
- [x] Item 1 — cobertura de testes das funções puras do classificador
- [x] Item 2.1 — aprendizado por feedback real do usuário (`revisarFeedback`)
- [x] Item 2.2 — prazo de exclusão por categoria
- [ ] Rodar `configurarTriggers()` de novo em produção (só enviar o código não recria triggers já agendados)
- [ ] Acompanhar as primeiras execuções reais para confirmar que o backlog está sendo processado sem estourar o limite de execução

## Próximas etapas

Revisão do projeto contra a dor real do usuário — objetivo declarado: *"um classificador de e-mails com um algoritmo que aprenda o que é importante e o que não é, e faça a exclusão dos e-mails desnecessários"*. Gaps de produto encontrados (não são bugs):

- [x] **2.1 — O "aprendizado" era auto-reforço, não feedback do usuário.** Corrigido: `revisarFeedback()` compara o que foi gravado com o estado real da thread (categoria/importância/estrela) e atualiza a memória quando o usuário corrigiu algo manualmente.
- [x] **2.2 — Política de exclusão era única e conservadora.** Corrigido: `DIAS_LIXEIRA_POR_CATEGORIA` define 30 dias para Promoções/Notícias/Redes Sociais/Entretenimento/Apps & Estudos, 60 dias para Leituras & Newsletters/Cursos & Vagas, e mantém 180 dias para as categorias com aviso prévio (Finanças, Compras & Recibos, Sistemas & Segurança, Transporte).
- [ ] **2.3 — A memória é opaca.** Fica como JSON dentro do Script Properties — o usuário não consegue ver ou corrigir o que o algoritmo aprendeu.
- [ ] **2.4 — Nada reduz o volume futuro.** O script só limpa o que já chegou; não há nenhuma ajuda para identificar remetentes crônicos de baixo valor e cancelar inscrição (`List-Unsubscribe`).

Antes de implementar qualquer um desses, preciso saber qual prioridade faz sentido pra você.

## Configuração do ambiente

```bash
# 1. Instalar o nvm (se ainda não tiver) - https://github.com/nvm-sh/nvm#installing-and-updating
nvm install   # lê a versão em .nvmrc
nvm use

# 2. Instalar as dependências do projeto (local, sem -g)
npm install
```

### Extensões de VS Code recomendadas

Não existe uma extensão oficial "Apps Script" no VS Code — o `clasp` é uma CLI. As extensões que realmente ajudam aqui:

- **ESLint** (`dbaeumer.vscode-eslint`)
- **Prettier - Code formatter** (`esbenp.prettier-vscode`)

O autocomplete de `GmailApp`, `PropertiesService`, `SpreadsheetApp` etc. vem do pacote `@types/google-apps-script` (já listado no `package.json`), não de uma extensão do editor.

## Baixando o script real via clasp

1. Login (abre o navegador para autenticar com a conta Google dona do script):

   ```bash
   npx clasp login
   ```

2. Achar o **Script ID**: em [script.google.com](https://script.google.com), abra o projeto → ícone de engrenagem "Configurações do projeto" → copie o campo **ID do Script**.

3. Clonar o código para `src/`:

   ```bash
   npx clasp clone <SCRIPT_ID> --rootDir src
   ```

   Isso cria um `.clasp.json` local (não versionado — veja `.clasp.json.example` para o formato). O `.claspignore` já está configurado para nunca enviar ao Google arquivos de tooling do repo (`package.json`, `tsconfig.json`, testes, CI, etc.) — apenas o código em `src/**/*.ts` e o `appsscript.json`.

4. Depois de clonado, abra o código com a Claude para analisarmos juntos as mudanças propostas antes de qualquer edição.

### Enviando alterações de volta

```bash
npm run push   # npx clasp push
npm run pull   # npx clasp pull
```

## Configuração (`.env` vs Script Properties)

O runtime do Apps Script **não lê arquivos `.env`** — não há acesso a filesystem em produção. Configuração dentro do script deve usar `PropertiesService` (Script Properties). O `.env.example` deste repo existe só para eventuais scripts Node locais de apoio (ex.: um harness de teste fora do Apps Script).

## Testes, lint e checagem de tipos

```bash
npm run typecheck
npm run lint
npm test
```

O CI (`.github/workflows/ci.yml`) roda essas três checagens em todo push/PR. A branch `main` só recebe commits com testes passando.

## Fluxo de trabalho

- **Pair Programming**: antes de qualquer mudança no código, a Claude explica exatamente o que vai fazer para revisão e ajuste.
- **TDD**: toda funcionalidade nova vem com teste unitário; todo bug corrigido vem com teste de regressão.
- **CI**: toda alteração roda a suíte de testes antes de ser considerada pronta.
- **Small Releases**: mudanças são separadas em commits pequenos e coesos, cada um descrito corretamente.
- **Refatoração contínua** como padrão de qualidade de código.

Diretrizes completas de arquitetura (Twelve-Factor App) e do fluxo de trabalho estão em [CLAUDE.md](CLAUDE.md).
