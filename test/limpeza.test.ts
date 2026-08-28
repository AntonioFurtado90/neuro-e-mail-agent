export {};

function criarGmailAppMock() {
  return {
    search: jest.fn(() => []),
    moveThreadsToTrash: jest.fn(),
    sendEmail: jest.fn(),
  };
}

function criarUtilitiesMock() {
  return {
    formatDate: (date: Date) => date.toISOString().slice(0, 10),
    sleep: jest.fn(),
  };
}

function criarSessionMock() {
  return {
    getScriptTimeZone: () => 'UTC',
    getActiveUser: () => ({ getEmail: () => 'ae.furtado90@gmail.com' }),
  };
}

function carregarScript() {
  const g = global as Record<string, unknown>;
  g.GmailApp = criarGmailAppMock();
  g.Utilities = criarUtilitiesMock();
  g.Session = criarSessionMock();
  g.PropertiesService = undefined;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return { script: require('../src/Código.js'), gmail: g.GmailApp as ReturnType<typeof criarGmailAppMock> };
}

function diasEntre(agora: Date, dias: number) {
  return new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe('diasLixeiraPara', () => {
  it('usa 30 dias para as categorias de baixo valor', () => {
    const { script } = carregarScript();
    for (const categoria of ['Promoções', 'Notícias', 'Redes Sociais', 'Entretenimento', 'Apps & Estudos']) {
      expect(script.diasLixeiraPara(categoria)).toBe(30);
    }
  });

  it('usa 60 dias para Leituras & Newsletters e Cursos & Vagas', () => {
    const { script } = carregarScript();
    expect(script.diasLixeiraPara('Leituras & Newsletters')).toBe(60);
    expect(script.diasLixeiraPara('Cursos & Vagas')).toBe(60);
  });

  it('cai no padrao (180) para categorias fora do mapa, ex.: as que tem aviso previo', () => {
    const { script } = carregarScript();
    expect(script.diasLixeiraPara('Finanças')).toBe(180);
    expect(script.diasLixeiraPara('categoria-desconhecida')).toBe(180);
  });
});

describe('limparEmailsAntigos usa o prazo certo por categoria', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-28T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('busca Promoções com corte de 30 dias e Leituras & Newsletters com corte de 60 dias', () => {
    const { script, gmail } = carregarScript();
    const agora = new Date();

    script.limparEmailsAntigos();

    const queries = gmail.search.mock.calls.map((c: unknown[]) => c[0] as string);
    const queryPromocoes = queries.find(q => q.includes('label:"Promoções"'));
    const queryLeituras  = queries.find(q => q.includes('label:"Leituras & Newsletters"'));
    const queryFinancas  = queries.find(q => q.includes('label:"Finanças"'));

    expect(queryPromocoes).toContain(`before:${diasEntre(agora, 30)}`);
    expect(queryLeituras).toContain(`before:${diasEntre(agora, 60)}`);
    expect(queryFinancas).toContain(`before:${diasEntre(agora, 180)}`);
  });
});
