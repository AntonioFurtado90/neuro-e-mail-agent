# Neuro, agente de e-mail

Automação (Google Apps Script) para triagem diária da caixa de entrada do Gmail. Existia um script legado no Apps Script que parou de funcionar corretamente, deixando a caixa com ~4 mil e-mails acumulados. Este repositório versiona esse script, adiciona testes e um pipeline de CI, e documenta o fluxo de trabalho.

## Requisitos

- [nvm](https://github.com/nvm-sh/nvm) — nada de Node/npm instalado direto no sistema. O Node é isolado por projeto via nvm, pinado no arquivo [.nvmrc](.nvmrc).
- Conta Google com um projeto no [Apps Script](https://script.google.com) já existente (o script legado).

Não é necessário instalar nada globalmente: todas as dependências (`clasp`, `typescript`, `jest`, etc.) ficam em `node_modules/` e são chamadas via `npx`/scripts do `npm`.

## Diagnóstico do script legado (por que ~4 mil e-mails acumularam)

Análise de [`src/Código.js`](src/Código.js) como foi clonado do Apps Script, antes de qualquer alteração. Três problemas — provavelmente combinados — explicam o script ter parado de categorizar/arquivar e-mails novos:

### Bug A — `salvarMemoria` estoura o limite de tamanho do PropertiesService (causa mais provável da parada total)

`salvarMemoria` (linhas 100-104) grava a memória de classificação inteira (até `MAX_MEMORIA = 500` entradas) numa única Script Property (`EMAIL_MEMORIA`). O Apps Script limita cada valor de propriedade a 9KB. A própria função `importarMemoria` (linhas 412-420) existe porque alguém já bateu nesse limite antes: ela importa 200 entradas manualmente **divididas em 5 chunks** (`EMAIL_MEMORIA_0`..`_4`) — só que `carregarMemoria`/`salvarMemoria` nunca leem essas chaves, só `EMAIL_MEMORIA`. A gravação real (não fragmentada) provavelmente excede 9KB rapidamente, `setProperty` lança exceção, e essa chamada fica **fora** do `try/catch` de `categorizarEmailsNovos` (linhas 218-233) — o catch só envolve `processarThread`, não `salvarMemoria`. Isso derruba a execução inteira do trigger.

**Evidência**: nos próprios dados importados em `importarMemoria`, várias entradas são e-mails do próprio Google com assunto "summary of failures for Google Apps Script" — ou seja, o script já vinha recebendo avisos de falha recorrente do trigger. O Apps Script desabilita automaticamente um trigger depois de falhar repetidamente, o que bate com "o script parou de funcionar".

**Correção proposta**: gravar a memória em chunks (como `importarMemoria` já faz manualmente) e envolver `salvarMemoria` em `try/catch` para nunca derrubar o trigger inteiro.

### Bug B — throughput muito abaixo do volume real de e-mails

O comentário e o log dizem "a cada 10 min" (linhas 215 e 374), mas o trigger real criado em `configurarTriggers` (linhas 367-368) roda **uma vez por dia**, às 8h. Cada execução processa no máximo **50 threads** (linha 221: `GmailApp.search(..., 0, 50)`). Se chegam mais de 50 e-mails novos num dia, o excedente nunca é sequer tentado — fica acumulando na inbox.

**Correção proposta**: trigger a cada 10 min de fato (como o código já diz que faz) e paginação da busca em vez de truncar em 50 (mesmo padrão `do/while` já usado em `arquivarEmailsLidos`).

### Bug C — memória "importada" nunca é usada

Consequência direta do Bug A: como `EMAIL_MEMORIA_0..4` nunca é lido pelo código real, o k-NN roda praticamente sempre a frio, caindo sempre no fallback de regras fixas em vez de aprender com o histórico.

**Correção proposta**: depois do fix do Bug A, migrar os dados de `EMAIL_MEMORIA_0..4` para o novo formato, para não perder as 200 entradas já existentes.

### Plano de trabalho

1. Corrigir Bug A (gravação em chunks + `try/catch`), com testes.
2. Corrigir Bug B (trigger de 10 em 10 min + paginação), com testes.
3. Migrar a memória já importada para o novo formato.
4. Cobertura de testes: `extrairTokens`, `calcularSimilaridade`, `consultarKNN` e `classificarEmail` já são funções puras (sem `GmailApp`/`PropertiesService` direto) — testáveis com Jest sem mock nenhum. As demais (`aplicarCategoria`, `arquivarEmailsLidos` etc.) exigem mockar `GmailApp`/`PropertiesService`/`ScriptApp`.

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
