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

function carregarScript(propertiesServiceMock: ReturnType<typeof criarPropertiesServiceMock>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as Record<string, any>).PropertiesService = propertiesServiceMock;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../src/Código.js');
}

function criarEntrada(dominio: string, categoria = 'Promoções') {
  return {
    tokens: { dominio, palavras: ['palavra1', 'palavra2'] },
    categoria,
    prioridade: 'baixa',
    estrela: false,
  };
}

describe('memoria (PropertiesService em chunks)', () => {
  it('salva e recarrega uma memoria pequena', () => {
    const mock = criarPropertiesServiceMock();
    const { salvarMemoria, carregarMemoria } = carregarScript(mock);

    const memoria = [criarEntrada('exemplo.com'), criarEntrada('outro.com', 'Finanças')];
    salvarMemoria(memoria);

    expect(carregarMemoria()).toEqual(memoria);
  });

  it('divide em varios chunks quando o JSON passa de 8000 caracteres e recarrega tudo', () => {
    const mock = criarPropertiesServiceMock();
    const { salvarMemoria, carregarMemoria } = carregarScript(mock);

    const memoriaGrande = Array.from({ length: 200 }, (_, i) => criarEntrada(`dominio-${i}.com`));
    salvarMemoria(memoriaGrande);

    const chunkCount = Number(mock.store.get('EMAIL_MEMORIA_CHUNKS'));
    expect(chunkCount).toBeGreaterThan(1);
    expect(carregarMemoria()).toEqual(memoriaGrande);
  });

  it('nao deixa chunk orfao ao salvar uma memoria menor depois de uma grande', () => {
    const mock = criarPropertiesServiceMock();
    const { salvarMemoria } = carregarScript(mock);

    const memoriaGrande = Array.from({ length: 200 }, (_, i) => criarEntrada(`dominio-${i}.com`));
    salvarMemoria(memoriaGrande);
    const chunksAntes = Number(mock.store.get('EMAIL_MEMORIA_CHUNKS'));
    expect(chunksAntes).toBeGreaterThan(1);

    salvarMemoria([criarEntrada('unico.com')]);
    const chunksDepois = Number(mock.store.get('EMAIL_MEMORIA_CHUNKS'));

    expect(chunksDepois).toBe(1);
    for (let i = chunksDepois; i < chunksAntes; i++) {
      expect(mock.store.has(`EMAIL_MEMORIA_${i}`)).toBe(false);
    }
  });

  it('limparTudo remove todos os chunks, nao so a chave antiga', () => {
    const mock = criarPropertiesServiceMock();
    const { salvarMemoria, limparTudo, carregarMemoria } = carregarScript(mock);

    const memoriaGrande = Array.from({ length: 200 }, (_, i) => criarEntrada(`dominio-${i}.com`));
    salvarMemoria(memoriaGrande);

    limparTudo();

    expect(carregarMemoria()).toEqual([]);
    expect(mock.store.size).toBe(0);
  });

  it('carregarMemoria retorna lista vazia quando nao ha nada salvo', () => {
    const mock = criarPropertiesServiceMock();
    const { carregarMemoria } = carregarScript(mock);

    expect(carregarMemoria()).toEqual([]);
  });
});
