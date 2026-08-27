# Neuro, agente de e-mail

Automação (Google Apps Script) para triagem diária da caixa de entrada do Gmail. Existia um script legado no Apps Script que parou de funcionar corretamente, deixando a caixa com ~4 mil e-mails acumulados. Este repositório versiona esse script, adiciona testes e um pipeline de CI, e documenta o fluxo de trabalho.

## Requisitos

- [nvm](https://github.com/nvm-sh/nvm) — nada de Node/npm instalado direto no sistema. O Node é isolado por projeto via nvm, pinado no arquivo [.nvmrc](.nvmrc).
- Conta Google com um projeto no [Apps Script](https://script.google.com) já existente (o script legado).

Não é necessário instalar nada globalmente: todas as dependências (`clasp`, `typescript`, `jest`, etc.) ficam em `node_modules/` e são chamadas via `npx`/scripts do `npm`.

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
