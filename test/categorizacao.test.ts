export {};

function criarPropertiesServiceMock() {
  const store = new Map<string, string>();
  const props = {
    getProperty: (chave: string) => (store.has(chave) ? store.get(chave)! : null),
    setProperty: (chave: string, valor: string) => {
      store.set(chave, valor);
    },
    deleteProperty: (chave: string) => {
      store.delete(chave);
    },
  };
  return { getScriptProperties: () => props, store };
}

function criarThreadFake(id: number, quebrado = false) {
  return {
    id,
    getMessages: () => {
      if (quebrado) throw new Error(`thread ${id} quebrada`);
      return [
        {
          getFrom: () => `remetente${id}@exemplo.com`,
          getSubject: () => `Assunto ${id}`,
        },
      ];
    },
    markImportant: jest.fn(),
    markUnimportant: jest.fn(),
  };
}

function criarGmailAppMock(totalThreads: number, idsQuebrados: number[] = []) {
  const fila = Array.from({ length: totalThreads }, (_, i) => criarThreadFake(i, idsQuebrados.includes(i)));
  const label = { addToThreads: jest.fn() };
  return {
    search: jest.fn((_query: string, _start: number, max: number) => fila.splice(0, max)),
    getUserLabelByName: jest.fn(() => label),
    createLabel: jest.fn(() => label),
    starMessages: jest.fn(),
    unstarMessages: jest.fn(),
  };
}

function carregarScript(gmailMock: ReturnType<typeof criarGmailAppMock>, propsMock: ReturnType<typeof criarPropertiesServiceMock>) {
  const g = global as Record<string, unknown>;
  g.GmailApp = gmailMock;
  g.PropertiesService = propsMock;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../src/Código.js');
}

describe('construirQueryNaoProcessados', () => {
  it('exclui todas as categorias conhecidas e nao filtra por data', () => {
    const { construirQueryNaoProcessados } = carregarScript(criarGmailAppMock(0), criarPropertiesServiceMock());
    const query = construirQueryNaoProcessados();

    expect(query).toContain('in:inbox');
    expect(query).toContain('-in:trash');
    expect(query).toContain('-label:"Transporte"');
    expect(query).toContain('-label:"Promoções"');
    expect(query).not.toContain('after:');
  });
});

describe('categorizarEmailsNovos (paginacao e teto de seguranca)', () => {
  it('processa tudo em paginas de 100 quando o total esta abaixo do teto', () => {
    const gmail = criarGmailAppMock(250);
    const props = criarPropertiesServiceMock();
    const { categorizarEmailsNovos } = carregarScript(gmail, props);

    categorizarEmailsNovos();

    expect(gmail.search).toHaveBeenCalledTimes(3);
    expect(Number(props.store.get('EMAIL_MEMORIA_CHUNKS'))).toBeGreaterThanOrEqual(1);
  });

  it('para em 300 threads por execucao mesmo com backlog maior', () => {
    const gmail = criarGmailAppMock(1000);
    const props = criarPropertiesServiceMock();
    const { categorizarEmailsNovos } = carregarScript(gmail, props);

    categorizarEmailsNovos();

    expect(gmail.search).toHaveBeenCalledTimes(3);
  });

  it('uma thread com erro nao interrompe o processamento das demais', () => {
    const gmail = criarGmailAppMock(5, [2]);
    const props = criarPropertiesServiceMock();
    const { categorizarEmailsNovos } = carregarScript(gmail, props);

    expect(() => categorizarEmailsNovos()).not.toThrow();
    expect(gmail.search).toHaveBeenCalledTimes(1);
  });
});
