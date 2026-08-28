export {};

function criarPropertiesServiceMock() {
  const store = new Map<string, string>();
  const props = {
    getProperty: (chave: string) => (store.has(chave) ? store.get(chave)! : null),
    setProperty: jest.fn((chave: string, valor: string) => {
      store.set(chave, valor);
    }),
    deleteProperty: (chave: string) => {
      store.delete(chave);
    },
  };
  return { getScriptProperties: () => props, store, setProperty: props.setProperty };
}

function criarThreadFake(id: string, opcoes: { labels?: string[]; importante?: boolean; estrelas?: boolean[] } = {}) {
  const { labels = [], importante = false, estrelas = [] } = opcoes;
  return {
    getId: () => id,
    getLabels: () => labels.map(nome => ({ getName: () => nome })),
    isImportant: () => importante,
    getMessages: () => estrelas.map(marcada => ({ isStarred: () => marcada })),
  };
}

function criarGmailAppMock(threadsPorId: Record<string, ReturnType<typeof criarThreadFake> | null>) {
  return {
    getThreadById: jest.fn((id: string) => {
      if (id === 'erro-de-rede') throw new Error('falha ao buscar thread');
      return Object.prototype.hasOwnProperty.call(threadsPorId, id) ? threadsPorId[id] : null;
    }),
  };
}

function carregarScript(gmailMock: unknown, propsMock: ReturnType<typeof criarPropertiesServiceMock>) {
  const g = global as Record<string, unknown>;
  g.GmailApp = gmailMock;
  g.PropertiesService = propsMock;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../src/Código.js');
}

describe('detectarCorrecao', () => {
  function carregarSoDetector() {
    return carregarScript(criarGmailAppMock({}), criarPropertiesServiceMock());
  }

  it('retorna null quando nada mudou', () => {
    const { detectarCorrecao } = carregarSoDetector();
    const registro = { categoria: 'Promoções', prioridade: 'baixa', estrela: false };
    const estadoAtual = { categorias: ['Promoções'], importante: false, estrela: false };

    expect(detectarCorrecao(registro, estadoAtual)).toBeNull();
  });

  it('detecta troca manual de categoria', () => {
    const { detectarCorrecao } = carregarSoDetector();
    const registro = { categoria: 'Promoções', prioridade: 'baixa', estrela: false };
    const estadoAtual = { categorias: ['Finanças'], importante: false, estrela: false };

    expect(detectarCorrecao(registro, estadoAtual)).toMatchObject({ categoria: 'Finanças' });
  });

  it('nao deduz categoria nova quando a label so foi removida (sem substituta)', () => {
    const { detectarCorrecao } = carregarSoDetector();
    const registro = { categoria: 'Promoções', prioridade: 'baixa', estrela: false };
    const estadoAtual = { categorias: [], importante: false, estrela: false };

    expect(detectarCorrecao(registro, estadoAtual)).toBeNull();
  });

  it('detecta quando o usuario marcou como importante uma thread que era baixa prioridade', () => {
    const { detectarCorrecao } = carregarSoDetector();
    const registro = { categoria: 'Promoções', prioridade: 'baixa', estrela: false };
    const estadoAtual = { categorias: ['Promoções'], importante: true, estrela: false };

    expect(detectarCorrecao(registro, estadoAtual)).toMatchObject({ prioridade: 'alta' });
  });

  it('detecta quando o usuario desmarcou importante numa thread que era alta prioridade', () => {
    const { detectarCorrecao } = carregarSoDetector();
    const registro = { categoria: 'Finanças', prioridade: 'alta', estrela: true };
    const estadoAtual = { categorias: ['Finanças'], importante: false, estrela: true };

    expect(detectarCorrecao(registro, estadoAtual)).toMatchObject({ prioridade: 'baixa' });
  });

  it('detecta mudanca de estrela isolada', () => {
    const { detectarCorrecao } = carregarSoDetector();
    const registro = { categoria: 'Cursos & Vagas', prioridade: 'media', estrela: true };
    const estadoAtual = { categorias: ['Cursos & Vagas'], importante: false, estrela: false };

    expect(detectarCorrecao(registro, estadoAtual)).toMatchObject({ estrela: false, categoria: 'Cursos & Vagas', prioridade: 'media' });
  });

  it('detecta varias mudancas ao mesmo tempo', () => {
    const { detectarCorrecao } = carregarSoDetector();
    const registro = { categoria: 'Promoções', prioridade: 'baixa', estrela: false };
    const estadoAtual = { categorias: ['Sistemas & Segurança'], importante: true, estrela: true };

    expect(detectarCorrecao(registro, estadoAtual)).toEqual({ categoria: 'Sistemas & Segurança', prioridade: 'alta', estrela: true });
  });
});

describe('revisarFeedback', () => {
  it('ignora entradas de memoria sem threadId (memoria antiga/importada)', () => {
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, revisarFeedback, carregarMemoria } = carregarScript(criarGmailAppMock({}), props);

    const memoriaAntiga = [{ tokens: { dominio: 'x.com', palavras: [] }, categoria: 'Promoções', prioridade: 'baixa', estrela: false }];
    salvarMemoria(memoriaAntiga);

    expect(() => revisarFeedback()).not.toThrow();
    expect(carregarMemoria()).toEqual(memoriaAntiga);
  });

  it('atualiza a memoria quando a thread real diverge do que foi gravado', () => {
    const thread = criarThreadFake('t1', { labels: ['Finanças'], importante: false, estrelas: [] });
    const gmail = criarGmailAppMock({ t1: thread });
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, revisarFeedback, carregarMemoria } = carregarScript(gmail, props);

    salvarMemoria([{ tokens: { dominio: 'x.com', palavras: [] }, categoria: 'Promoções', prioridade: 'baixa', estrela: false, threadId: 't1' }]);

    revisarFeedback();

    expect(carregarMemoria()[0]).toMatchObject({ categoria: 'Finanças' });
  });

  it('nao derruba a execucao quando a thread nao existe mais', () => {
    const gmail = criarGmailAppMock({});
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, revisarFeedback } = carregarScript(gmail, props);

    salvarMemoria([{ tokens: { dominio: 'x.com', palavras: [] }, categoria: 'Promoções', prioridade: 'baixa', estrela: false, threadId: 'nao-existe' }]);

    expect(() => revisarFeedback()).not.toThrow();
  });

  it('nao derruba a execucao quando GmailApp.getThreadById lanca erro', () => {
    const gmail = criarGmailAppMock({});
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, revisarFeedback } = carregarScript(gmail, props);

    salvarMemoria([{ tokens: { dominio: 'x.com', palavras: [] }, categoria: 'Promoções', prioridade: 'baixa', estrela: false, threadId: 'erro-de-rede' }]);

    expect(() => revisarFeedback()).not.toThrow();
  });

  it('nao salva a memoria de novo quando nenhuma correcao foi encontrada', () => {
    const thread = criarThreadFake('t1', { labels: ['Promoções'], importante: false, estrelas: [] });
    const gmail = criarGmailAppMock({ t1: thread });
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, revisarFeedback } = carregarScript(gmail, props);

    salvarMemoria([{ tokens: { dominio: 'x.com', palavras: [] }, categoria: 'Promoções', prioridade: 'baixa', estrela: false, threadId: 't1' }]);
    props.setProperty.mockClear();

    revisarFeedback();

    expect(props.setProperty).not.toHaveBeenCalled();
  });
});
