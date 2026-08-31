export {};

function criarThreadFake(id: number) {
  return {
    id,
    getMessages: () => [{ getFrom: () => `remetente${id}@exemplo.com`, getDate: () => new Date(2000, 0, 1) }],
    getFirstMessageSubject: () => `Assunto ${id}`,
  };
}

// Um unico "queue" compartilhado entre todas as buscas, simulando o
// Gmail: uma vez que uma thread e movida (trash/arquivo), ela some da
// busca (o proprio search() ja a remove da fila).
function criarGmailAppMock(totalThreads: number) {
  const fila = Array.from({ length: totalThreads }, (_, i) => criarThreadFake(i));
  return {
    search: jest.fn((_query: string, _start: number, max: number) => fila.splice(0, max)),
    moveThreadsToTrash: jest.fn(),
    moveThreadsToArchive: jest.fn(),
    sendEmail: jest.fn(),
  };
}

function criarUtilitiesMock() {
  return { formatDate: () => '2000/01/01', sleep: jest.fn() };
}

function criarSessionMock() {
  return { getScriptTimeZone: () => 'UTC', getActiveUser: () => ({ getEmail: () => 'a@a.com' }) };
}

function carregarScript(gmail: ReturnType<typeof criarGmailAppMock>) {
  const g = global as Record<string, unknown>;
  g.GmailApp = gmail;
  g.Utilities = criarUtilitiesMock();
  g.Session = criarSessionMock();
  g.PropertiesService = undefined;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../src/Código.js');
}

describe('teto de execucao (nao pode mais estourar o limite de 6 min do Apps Script)', () => {
  it('arquivarEmailsLidos para em MAX_THREADS_POR_EXECUCAO mesmo com mais threads disponiveis', () => {
    const gmail = criarGmailAppMock(1000);
    const script = carregarScript(gmail);

    const total = script.arquivarEmailsLidos();

    expect(total).toBe(300);
  });

  it('limparEmailsAntigos respeita um teto TOTAL somado entre todas as categorias da lixeira', () => {
    // O mock puxa sempre da mesma fila, nao importa a query - com 1000
    // threads "disponiveis" (bem mais que qualquer categoria sozinha
    // precisaria), o total movido tem que ficar em ate 300 no total,
    // nao 300 por categoria (7 categorias x 300 estouraria de novo).
    const gmail = criarGmailAppMock(1000);
    const script = carregarScript(gmail);

    script.limparEmailsAntigos();

    const totalMovido = gmail.moveThreadsToTrash.mock.calls
      .reduce((soma: number, chamada: unknown[]) => soma + (chamada[0] as unknown[]).length, 0);

    expect(totalMovido).toBeLessThanOrEqual(300);
    expect(totalMovido).toBeGreaterThan(0);
  });

  it('aprovarLimpezaFinanceira tambem respeita o teto somado entre categorias', () => {
    const gmail = criarGmailAppMock(1000);
    const script = carregarScript(gmail);

    script.aprovarLimpezaFinanceira();

    const totalMovido = gmail.moveThreadsToTrash.mock.calls
      .reduce((soma: number, chamada: unknown[]) => soma + (chamada[0] as unknown[]).length, 0);

    expect(totalMovido).toBeLessThanOrEqual(300);
    expect(totalMovido).toBeGreaterThan(0);
  });

  it('quando ha menos threads que o teto, processa tudo sem exceder o disponivel', () => {
    const gmail = criarGmailAppMock(50);
    const script = carregarScript(gmail);

    const total = script.arquivarEmailsLidos();

    expect(total).toBe(50);
  });
});
