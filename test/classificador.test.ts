export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const script = require('../src/Código.js');
const { extrairTokens, calcularSimilaridade, consultarKNN, classificarEmail } = script;

describe('extrairTokens', () => {
  it('extrai o dominio do remetente em minusculas', () => {
    expect(extrairTokens('Nome Sobrenome <USER@Dominio.COM>', '').dominio).toBe('dominio.com');
  });

  it('retorna dominio vazio quando o remetente nao tem @', () => {
    expect(extrairTokens('remetente-sem-arroba', '').dominio).toBe('');
  });

  it('mantem acentos e remove digitos/pontuacao do assunto', () => {
    const { palavras } = extrairTokens('a@a.com', 'Fatura nº 123 vence em: início março!');
    expect(palavras).toEqual(['fatura', 'vence', 'início', 'março']);
  });

  it('filtra palavras com 2 caracteres ou menos', () => {
    const { palavras } = extrairTokens('a@a.com', 'eu vi um ok teste de ir la');
    expect(palavras).toEqual(['teste']);
  });

  it('limita a 15 palavras, preservando a ordem', () => {
    const vinteEntradas = [
      'alfa', 'bravo', 'charlie', 'delta', 'eco', 'foxtrot', 'golf', 'hotel',
      'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar',
      'papa', 'quebec', 'romeo', 'sierra', 'tango',
    ];
    const { palavras } = extrairTokens('a@a.com', vinteEntradas.join(' '));
    expect(palavras).toHaveLength(15);
    expect(palavras).toEqual(vinteEntradas.slice(0, 15));
  });
});

describe('calcularSimilaridade', () => {
  it('soma 0.6 quando os dominios sao iguais e as palavras nao se sobrepoem', () => {
    const a = { dominio: 'x.com', palavras: ['alpha', 'beta'] };
    const b = { dominio: 'x.com', palavras: ['gamma', 'delta'] };
    expect(calcularSimilaridade(a, b)).toBeCloseTo(0.6);
  });

  it('soma ate 0.4 pela sobreposicao de palavras (jaccard) quando os dominios diferem', () => {
    const a = { dominio: 'x.com', palavras: ['alpha', 'beta'] };
    const b = { dominio: 'y.com', palavras: ['alpha', 'beta'] };
    expect(calcularSimilaridade(a, b)).toBeCloseTo(0.4);
  });

  it('soma os dois fatores quando dominio e palavras batem totalmente', () => {
    const a = { dominio: 'x.com', palavras: ['alpha', 'beta'] };
    const b = { dominio: 'x.com', palavras: ['alpha', 'beta'] };
    expect(calcularSimilaridade(a, b)).toBeCloseTo(1.0);
  });

  it('retorna 0 quando nao ha dominio nem palavras em comum', () => {
    const a = { dominio: 'x.com', palavras: ['alpha'] };
    const b = { dominio: 'y.com', palavras: ['beta'] };
    expect(calcularSimilaridade(a, b)).toBe(0);
  });

  it('nao retorna NaN quando as duas listas de palavras estao vazias', () => {
    const a = { dominio: 'x.com', palavras: [] };
    const b = { dominio: 'y.com', palavras: [] };
    expect(calcularSimilaridade(a, b)).toBe(0);
  });
});

describe('consultarKNN', () => {
  it('retorna null quando a memoria esta vazia', () => {
    expect(consultarKNN('a@a.com', 'assunto qualquer', [])).toBeNull();
  });

  it('retorna null quando o vizinho mais proximo fica abaixo de MIN_SIMILARIDADE (0.25)', () => {
    const memoria = [
      { tokens: { dominio: 'outro.com', palavras: ['nada', 'a', 'ver'] }, categoria: 'X', prioridade: 'baixa', estrela: false },
    ];
    expect(consultarKNN('a@dominio.com', 'assunto completamente diferente', memoria)).toBeNull();
  });

  it('usa os dados do vizinho mais proximo quando so ha um', () => {
    const memoria = [
      { tokens: { dominio: 'dominio.com', palavras: ['fatura', 'vencimento'] }, categoria: 'Finanças', prioridade: 'alta', estrela: true },
    ];
    const resultado = consultarKNN('cobranca@dominio.com', 'fatura vencimento', memoria);

    expect(resultado).toMatchObject({ categoria: 'Finanças', prioridade: 'alta', estrela: true, fonte: 'memoria' });
  });

  it('decide por soma de similaridade dos vizinhos, nao so pelo mais proximo isolado', () => {
    // e1 sozinho (dominio igual, sim=0.6) tem maior similaridade que qualquer um dos
    // outros dois isolados, mas e2+e3 (mesma categoria) somam mais e devem vencer.
    const memoria = [
      { tokens: { dominio: 'q.com', palavras: ['zzz', 'yyy'] }, categoria: 'A', prioridade: 'alta', estrela: true },
      { tokens: { dominio: 'outro1.com', palavras: ['alpha', 'beta', 'gamma'] }, categoria: 'B', prioridade: 'baixa', estrela: false },
      { tokens: { dominio: 'outro2.com', palavras: ['alpha', 'beta', 'gamma'] }, categoria: 'B', prioridade: 'baixa', estrela: false },
    ];

    const resultado = consultarKNN('user@q.com', 'alpha beta gamma', memoria);

    expect(resultado.categoria).toBe('B');
    // confianca reflete o vizinho isolado mais similar (e1, 0.6), mesmo B tendo vencido
    expect(resultado.confianca).toBeCloseTo(0.6);
  });

  it('so considera os K_VIZINHOS (3) mais similares, mesmo com mais entradas na memoria', () => {
    const memoriaTopoA = [
      { tokens: { dominio: 'x1.com', palavras: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'] }, categoria: 'A', prioridade: 'alta', estrela: true },
      { tokens: { dominio: 'x2.com', palavras: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] }, categoria: 'A', prioridade: 'alta', estrela: true },
      { tokens: { dominio: 'x3.com', palavras: ['alpha', 'beta', 'gamma', 'delta'] }, categoria: 'A', prioridade: 'alta', estrela: true },
    ];
    // 6 entradas de categoria B, cada uma com similaridade menor que qualquer uma do
    // topo A - mas juntas somariam mais que A, se o corte de K_VIZINHOS nao existisse.
    const memoriaExcedenteB = Array.from({ length: 6 }, (_, i) => ({
      tokens: { dominio: `b${i}.com`, palavras: ['alpha', 'beta', 'gamma'] },
      categoria: 'B',
      prioridade: 'baixa',
      estrela: false,
    }));

    const resultado = consultarKNN('user@q.com', 'alpha beta gamma delta epsilon zeta', [...memoriaTopoA, ...memoriaExcedenteB]);

    expect(resultado.categoria).toBe('A');
  });
});

describe('classificarEmail', () => {
  it('prioriza a memoria (k-NN) quando ha um vizinho suficientemente similar', () => {
    const memoria = [
      { tokens: { dominio: 'meudominio.com', palavras: ['fatura', 'vencimento'] }, categoria: 'Finanças', prioridade: 'alta', estrela: true },
    ];
    const resultado = classificarEmail('cobranca@meudominio.com', 'fatura vencimento', memoria);
    expect(resultado.fonte).toBe('memoria');
    expect(resultado.categoria).toBe('Finanças');
  });

  it('cai para as REGRAS fixas (remetente) quando a memoria nao ajuda', () => {
    const resultado = classificarEmail('noreply@uber.com', 'Seu recibo Uber', []);
    expect(resultado).toMatchObject({ categoria: 'Transporte', prioridade: 'media', estrela: true, fonte: 'regra' });
  });

  it('cai para as REGRAS fixas (assunto) quando o remetente nao bate mas o assunto sim', () => {
    const resultado = classificarEmail('alguem@dominio-desconhecido.com', 'Seu Código de segurança', []);
    expect(resultado).toMatchObject({ categoria: 'Sistemas & Segurança', fonte: 'regra' });
  });

  it('cai no padrao (Promoções, confianca 0) quando nada bate', () => {
    const resultado = classificarEmail('alguem@dominio-nunca-visto.com', 'assunto qualquer sem padrao conhecido', []);
    expect(resultado).toEqual({ categoria: 'Promoções', prioridade: 'baixa', estrela: false, confianca: 0, fonte: 'default' });
  });
});
