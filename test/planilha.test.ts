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

function criarFolhaFake() {
  let dados: unknown[][] = [];
  return {
    getLastRow: () => dados.length,
    getRange: (linha: number, coluna: number, numLinhas: number, numColunas: number) => ({
      getValues: () => dados.slice(linha - 1, linha - 1 + numLinhas).map(r => r.slice(coluna - 1, coluna - 1 + numColunas)),
      setValues: (valores: unknown[][]) => {
        for (let i = 0; i < valores.length; i++) {
          const idx = linha - 1 + i;
          while (dados.length <= idx) dados.push([]);
          for (let j = 0; j < valores[i].length; j++) {
            (dados[idx] as unknown[])[coluna - 1 + j] = valores[i][j];
          }
        }
      },
    }),
    clearContents: () => {
      dados = [];
    },
    appendRow: (linha: unknown[]) => {
      dados.push([...linha]);
    },
    linhas: () => dados,
  };
}

function criarSpreadsheetAppMock() {
  const planilhas: Record<string, ReturnType<typeof criarPlanilhaFake>> = {};
  let contador = 0;

  function criarPlanilhaFake() {
    const id = `planilha-${++contador}`;
    const abas: Record<string, ReturnType<typeof criarFolhaFake>> = {};
    return {
      getId: () => id,
      getSheetByName: (nome: string) => abas[nome] || null,
      insertSheet: (nome: string) => {
        abas[nome] = criarFolhaFake();
        return abas[nome];
      },
    };
  }

  const create = jest.fn(() => {
    const planilha = criarPlanilhaFake();
    planilhas[planilha.getId()] = planilha;
    return planilha;
  });
  const openById = jest.fn((id: string) => {
    if (!planilhas[id]) throw new Error('planilha nao encontrada');
    return planilhas[id];
  });

  return { create, openById };
}

function carregarScript(spreadsheetMock: ReturnType<typeof criarSpreadsheetAppMock>, propsMock: ReturnType<typeof criarPropertiesServiceMock>) {
  const g = global as Record<string, unknown>;
  g.SpreadsheetApp = spreadsheetMock;
  g.PropertiesService = propsMock;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../src/Código.js');
}

describe('sincronizarPlanilhaMemoria', () => {
  it('cria a planilha na primeira sincronizacao e escreve cabecalho + linhas', () => {
    const spreadsheet = criarSpreadsheetAppMock();
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, sincronizarPlanilhaMemoria } = carregarScript(spreadsheet, props);

    salvarMemoria([
      { tokens: { dominio: 'x.com', palavras: ['alpha', 'beta'] }, categoria: 'Promoções', prioridade: 'baixa', estrela: false, threadId: 't1' },
    ]);

    sincronizarPlanilhaMemoria();

    expect(spreadsheet.create).toHaveBeenCalledTimes(1);
    expect(props.store.get('PLANILHA_MEMORIA_ID')).toBe('planilha-1');
  });

  it('reaproveita a planilha ja existente em vez de criar outra', () => {
    const spreadsheet = criarSpreadsheetAppMock();
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, sincronizarPlanilhaMemoria } = carregarScript(spreadsheet, props);

    salvarMemoria([{ tokens: { dominio: 'x.com', palavras: [] }, categoria: 'Promoções', prioridade: 'baixa', estrela: false, threadId: 't1' }]);
    sincronizarPlanilhaMemoria();
    sincronizarPlanilhaMemoria();

    expect(spreadsheet.create).toHaveBeenCalledTimes(1);
    expect(spreadsheet.openById).toHaveBeenCalled();
  });

  it('detecta uma categoria editada manualmente na planilha e atualiza a memoria', () => {
    const spreadsheet = criarSpreadsheetAppMock();
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, sincronizarPlanilhaMemoria, carregarMemoria } = carregarScript(spreadsheet, props);

    salvarMemoria([
      { tokens: { dominio: 'x.com', palavras: [] }, categoria: 'Promoções', prioridade: 'baixa', estrela: false, threadId: 't1' },
    ]);

    // primeira sincronizacao so exporta (planilha comeca vazia, nada pra comparar)
    sincronizarPlanilhaMemoria();

    // usuario edita a coluna "Categoria" da linha diretamente na planilha
    const planilha = spreadsheet.openById(props.store.get('PLANILHA_MEMORIA_ID')!);
    const aba = planilha.getSheetByName('Memória')!;
    const linhas = aba.linhas();
    (linhas[1] as unknown[])[2] = 'Finanças';

    sincronizarPlanilhaMemoria();

    expect(carregarMemoria()[0]).toMatchObject({ categoria: 'Finanças' });
  });

  it('exporta entradas sem threadId (memoria antiga) mas nao as trata como editaveis', () => {
    const spreadsheet = criarSpreadsheetAppMock();
    const props = criarPropertiesServiceMock();
    const { salvarMemoria, sincronizarPlanilhaMemoria, carregarMemoria } = carregarScript(spreadsheet, props);

    salvarMemoria([{ tokens: { dominio: 'x.com', palavras: [] }, categoria: 'Promoções', prioridade: 'baixa', estrela: false }]);

    expect(() => sincronizarPlanilhaMemoria()).not.toThrow();

    const planilha = spreadsheet.openById(props.store.get('PLANILHA_MEMORIA_ID')!);
    const aba = planilha.getSheetByName('Memória')!;
    expect(aba.linhas()).toHaveLength(2); // cabecalho + 1 linha
    expect(carregarMemoria()[0].categoria).toBe('Promoções'); // sem mudanca
  });
});
