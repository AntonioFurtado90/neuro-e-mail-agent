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

function criarEntrada(dominio: string, categoria: string, threadId?: string) {
  return {
    tokens: { dominio, palavras: [] },
    categoria,
    prioridade: 'baixa',
    estrela: false,
    ...(threadId ? { threadId } : {}),
  };
}

function criarThreadFake(headerUnsubscribe: string | null) {
  return {
    getMessages: () => [
      {
        getHeader: (nome: string) => (nome === 'List-Unsubscribe' ? headerUnsubscribe : null),
      },
    ],
  };
}

function criarGmailAppMock(threadsPorId: Record<string, ReturnType<typeof criarThreadFake> | null> = {}) {
  return {
    getThreadById: jest.fn((id: string) => {
      if (id === 'erro') throw new Error('falha ao buscar thread');
      return Object.prototype.hasOwnProperty.call(threadsPorId, id) ? threadsPorId[id] : null;
    }),
    sendEmail: jest.fn(),
  };
}

function criarSessionMock() {
  return { getActiveUser: () => ({ getEmail: () => 'ae.furtado90@gmail.com' }) };
}

function carregarScript(gmailMock: unknown, propsMock: ReturnType<typeof criarPropertiesServiceMock>) {
  const g = global as Record<string, unknown>;
  g.GmailApp = gmailMock;
  g.PropertiesService = propsMock;
  g.Session = criarSessionMock();
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../src/Código.js');
}

describe('remetentesCronicos', () => {
  it('so inclui dominios de categorias de baixo valor com ocorrencias acima do limiar', () => {
    const { remetentesCronicos } = carregarScript(criarGmailAppMock(), criarPropertiesServiceMock());

    const memoria = [
      ...Array.from({ length: 5 }, () => criarEntrada('spam.com', 'Promoções')),
      ...Array.from({ length: 2 }, () => criarEntrada('pouco.com', 'Promoções')),
      ...Array.from({ length: 10 }, () => criarEntrada('financeiro.com', 'Finanças')),
    ];

    const resultado = remetentesCronicos(memoria, 5);

    expect(resultado.map((r: { dominio: string }) => r.dominio)).toEqual(['spam.com']);
  });

  it('ordena por numero de ocorrencias, do maior pro menor', () => {
    const { remetentesCronicos } = carregarScript(criarGmailAppMock(), criarPropertiesServiceMock());

    const memoria = [
      ...Array.from({ length: 6 }, () => criarEntrada('medio.com', 'Notícias')),
      ...Array.from({ length: 12 }, () => criarEntrada('pior.com', 'Notícias')),
    ];

    const resultado = remetentesCronicos(memoria, 5);

    expect(resultado.map((r: { dominio: string }) => r.dominio)).toEqual(['pior.com', 'medio.com']);
  });

  it('identifica a categoria mais comum de cada dominio', () => {
    const { remetentesCronicos } = carregarScript(criarGmailAppMock(), criarPropertiesServiceMock());

    const memoria = [
      ...Array.from({ length: 4 }, () => criarEntrada('misto.com', 'Notícias')),
      ...Array.from({ length: 6 }, () => criarEntrada('misto.com', 'Entretenimento')),
    ];

    const resultado = remetentesCronicos(memoria, 5);

    expect(resultado[0].categoriaMaisComum).toBe('Entretenimento');
  });

  it('ignora entradas sem dominio', () => {
    const { remetentesCronicos } = carregarScript(criarGmailAppMock(), criarPropertiesServiceMock());
    const memoria = Array.from({ length: 6 }, () => criarEntrada('', 'Promoções'));

    expect(remetentesCronicos(memoria, 5)).toEqual([]);
  });
});

describe('buscarLinkDescadastro', () => {
  it('extrai o link de dentro de <...> quando o header traz varias opcoes', () => {
    const gmail = criarGmailAppMock({ t1: criarThreadFake('<mailto:x@x.com>, <https://exemplo.com/unsub>') });
    const { buscarLinkDescadastro } = carregarScript(gmail, criarPropertiesServiceMock());

    expect(buscarLinkDescadastro('t1')).toBe('mailto:x@x.com');
  });

  it('retorna o header como esta quando nao tem colchetes', () => {
    const gmail = criarGmailAppMock({ t1: criarThreadFake('https://exemplo.com/unsub') });
    const { buscarLinkDescadastro } = carregarScript(gmail, criarPropertiesServiceMock());

    expect(buscarLinkDescadastro('t1')).toBe('https://exemplo.com/unsub');
  });

  it('retorna null quando nao ha header List-Unsubscribe', () => {
    const gmail = criarGmailAppMock({ t1: criarThreadFake(null) });
    const { buscarLinkDescadastro } = carregarScript(gmail, criarPropertiesServiceMock());

    expect(buscarLinkDescadastro('t1')).toBeNull();
  });

  it('retorna null quando a thread nao existe ou da erro', () => {
    const gmail = criarGmailAppMock({});
    const { buscarLinkDescadastro } = carregarScript(gmail, criarPropertiesServiceMock());

    expect(buscarLinkDescadastro('nao-existe')).toBeNull();
    expect(buscarLinkDescadastro('erro')).toBeNull();
  });

  it('retorna null quando nao ha threadId', () => {
    const gmail = criarGmailAppMock({});
    const { buscarLinkDescadastro } = carregarScript(gmail, criarPropertiesServiceMock());

    expect(buscarLinkDescadastro(undefined)).toBeNull();
  });
});

describe('sugerirDescadastro', () => {
  it('envia um e-mail na primeira vez que encontra remetentes cronicos', () => {
    const gmail = criarGmailAppMock({ t1: criarThreadFake('<https://exemplo.com/unsub>') });
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, sugerirDescadastro } = carregarScript(gmail, props);

    salvarMemoria(Array.from({ length: 6 }, () => criarEntrada('spam.com', 'Promoções', 't1')));

    sugerirDescadastro();

    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    const corpo = gmail.sendEmail.mock.calls[0][2] as string;
    expect(corpo).toContain('spam.com');
    expect(corpo).toContain('https://exemplo.com/unsub');
  });

  it('nao envia de novo quando os mesmos dominios ja foram sugeridos', () => {
    const gmail = criarGmailAppMock({ t1: criarThreadFake(null) });
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, sugerirDescadastro } = carregarScript(gmail, props);

    salvarMemoria(Array.from({ length: 6 }, () => criarEntrada('spam.com', 'Promoções', 't1')));

    sugerirDescadastro();
    gmail.sendEmail.mockClear();
    sugerirDescadastro();

    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it('avisa so sobre o dominio novo quando um remetente ja sugerido continua cronico e outro aparece', () => {
    const gmail = criarGmailAppMock({});
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, sugerirDescadastro } = carregarScript(gmail, props);

    salvarMemoria(Array.from({ length: 6 }, () => criarEntrada('velho.com', 'Promoções')));
    sugerirDescadastro();
    gmail.sendEmail.mockClear();

    salvarMemoria([
      ...Array.from({ length: 6 }, () => criarEntrada('velho.com', 'Promoções')),
      ...Array.from({ length: 6 }, () => criarEntrada('novo.com', 'Notícias')),
    ]);
    sugerirDescadastro();

    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    const corpo = gmail.sendEmail.mock.calls[0][2] as string;
    expect(corpo).toContain('novo.com');
    expect(corpo).not.toContain('velho.com');
  });

  it('nao envia nada quando nenhum dominio bate o limiar', () => {
    const gmail = criarGmailAppMock({});
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, sugerirDescadastro } = carregarScript(gmail, props);

    salvarMemoria([criarEntrada('poucos.com', 'Promoções')]);
    sugerirDescadastro();

    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });
});
