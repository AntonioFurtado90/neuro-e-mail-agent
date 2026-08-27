// ============================================================
// AGENTE DE E-MAIL — SCRIPT COMPLETO
// v4.0 — Classificação k-NN + Arquivo de lidos + Limpeza
//
// SETUP (faça uma vez):
//   1. Cole este script em script.google.com
//   2. Execute configurarTriggers()
//   3. Feche tudo. O agente roda sozinho.
// ============================================================

// ─────────────────────────────────────────
// CONFIGURAÇÃO
// ─────────────────────────────────────────

const LOTE_TAMANHO             = 100; // threads por chamada de busca
const MAX_THREADS_POR_EXECUCAO = 300; // teto por execucao (evita estourar o limite de 6 min do Apps Script)
const K_VIZINHOS       = 3;     // vizinhos no k-NN
const MIN_SIMILARIDADE = 0.25;  // limiar mínimo para usar memória
const MAX_MEMORIA      = 500;   // máx de entradas na memória

const DIAS_ARQUIVAR    = 30;    // dias após leitura para arquivar
const DIAS_LIXEIRA     = 180;   // dias sem leitura para apagar

// ─────────────────────────────────────────
// REGRAS FIXAS (fallback do k-NN)
// ─────────────────────────────────────────

const REGRAS = {
  'Transporte':
    'from:noreply@uber.com OR from:uber@uber.com',
  'Finanças':
    'from:mercadopago.com OR from:nao-responder@mercadopago.com.br ' +
    'OR subject:"Seu Pix foi enviado" OR subject:"fatura" ' +
    'OR from:googleplay-noreply@google.com OR from:focus@bcb.gov.br',
  'Compras & Recibos':
    'from:amazon.com.br OR from:shipment-tracking@amazon.com.br ' +
    'OR from:payments-update@amazon.com.br OR from:auto-confirm@amazon.com.br ' +
    'OR from:store-news@amazon.com.br OR from:e.drogasil.com.br ' +
    'OR from:steampowered.com OR from:email3.gog.com OR from:deals.aliexpress.com',
  'Leituras & Newsletters':
    'from:donotreply@wordpress.com OR from:canalmeio.com.br OR from:quora.com',
  'Cursos & Vagas':
    'from:veduca.org',
  'Sistemas & Segurança':
    'from:noreply@github.com OR from:noreply-apps-scripts-notifications@google.com ' +
    'OR from:no-reply@accounts.google.com ' +
    'OR subject:"Código de segurança" OR subject:"SSH key" OR subject:"verify your device"',
  'Redes Sociais':   'from:service.tiktok.com',
  'Apps & Estudos':  'from:duolingo.com OR from:email.openai.com',
  'Entretenimento':  'from:marketing.hbomax.com',
  'Notícias':
    'from:noticiasaominutobr.com OR from:newsg.globo.com OR from:newsletterg1.globo.com',
  'Promoções':
    'from:news.mcdonalds.com.br OR from:blipay.com.br OR from:oferta.jurosbaixos.com.br ' +
    'OR from:marketing.picpay.com OR from:mail.planos.tim.com.br ' +
    'OR from:comunicacao.consumidorpositivo.com.br OR from:mail.consumidorpositivo.com.br ' +
    'OR from:newskmdevantagens.com.br OR from:minhaclaro.com.br ' +
    'OR from:uciunique.ucicinemas.com.br OR from:hafidme.com.br OR from:99app.com ' +
    'OR from:zoxnews.net',
};

const PRIORIDADE_PADRAO = {
  'Sistemas & Segurança':   { prioridade: 'alta',  estrela: true  },
  'Finanças':               { prioridade: 'alta',  estrela: true  },
  'Compras & Recibos':      { prioridade: 'alta',  estrela: true  },
  'Transporte':             { prioridade: 'media', estrela: true  },
  'Leituras & Newsletters': { prioridade: 'media', estrela: true  },
  'Cursos & Vagas':         { prioridade: 'media', estrela: true  },
  'Apps & Estudos':         { prioridade: 'baixa', estrela: false },
  'Redes Sociais':          { prioridade: 'baixa', estrela: false },
  'Entretenimento':         { prioridade: 'baixa', estrela: false },
  'Notícias':               { prioridade: 'baixa', estrela: false },
  'Promoções':              { prioridade: 'baixa', estrela: false },
};

// ─────────────────────────────────────────
// POLÍTICA DE LIMPEZA
// ─────────────────────────────────────────

// Apagados direto após DIAS_LIXEIRA sem leitura
const CATEGORIAS_LIXEIRA = [
  'Promoções', 'Notícias', 'Redes Sociais',
  'Apps & Estudos', 'Entretenimento',
  'Leituras & Newsletters', 'Cursos & Vagas',
];

// Geram e-mail de aviso antes de apagar
const CATEGORIAS_AVISAR = [
  'Finanças', 'Compras & Recibos', 'Sistemas & Segurança', 'Transporte',
];

// ─────────────────────────────────────────
// MEMÓRIA (k-NN)
// ─────────────────────────────────────────

// PropertiesService limita cada valor a 9KB — a memoria e guardada em
// pedacos (EMAIL_MEMORIA_0, EMAIL_MEMORIA_1, ...) para nao estourar esse
// limite. EMAIL_MEMORIA_CHUNKS guarda quantos pedacos existem.
const MEMORIA_CHAVE_PREFIXO = 'EMAIL_MEMORIA';
const MEMORIA_CHAVE_CHUNKS  = 'EMAIL_MEMORIA_CHUNKS';
const MEMORIA_TAMANHO_CHUNK = 8000; // margem de seguranca abaixo do limite de 9KB

function carregarMemoria() {
  const props      = PropertiesService.getScriptProperties();
  const totalChunks = parseInt(props.getProperty(MEMORIA_CHAVE_CHUNKS) || '0', 10);
  if (!totalChunks) return [];

  let json = '';
  for (let i = 0; i < totalChunks; i++) {
    json += props.getProperty(`${MEMORIA_CHAVE_PREFIXO}_${i}`) || '';
  }
  return json ? JSON.parse(json) : [];
}

function salvarMemoria(memoria) {
  if (memoria.length > MAX_MEMORIA) memoria = memoria.slice(-MAX_MEMORIA);
  const props = PropertiesService.getScriptProperties();

  const totalChunksAntigo = parseInt(props.getProperty(MEMORIA_CHAVE_CHUNKS) || '0', 10);

  const json   = JSON.stringify(memoria);
  const chunks = [];
  for (let i = 0; i < json.length; i += MEMORIA_TAMANHO_CHUNK) {
    chunks.push(json.slice(i, i + MEMORIA_TAMANHO_CHUNK));
  }

  chunks.forEach((chunk, i) => props.setProperty(`${MEMORIA_CHAVE_PREFIXO}_${i}`, chunk));
  for (let i = chunks.length; i < totalChunksAntigo; i++) {
    props.deleteProperty(`${MEMORIA_CHAVE_PREFIXO}_${i}`);
  }
  props.setProperty(MEMORIA_CHAVE_CHUNKS, String(chunks.length));
}

function extrairTokens(remetente, assunto) {
  const dominio  = (remetente.match(/@([\w.]+)/) || ['', ''])[1].toLowerCase();
  const palavras = assunto
    .toLowerCase()
    .replace(/[^a-záéíóúàãõâêîôûç\s]/gi, ' ')
    .split(/\s+/)
    .filter(p => p.length > 2)
    .slice(0, 15);
  return { dominio, palavras };
}

function calcularSimilaridade(a, b) {
  const dominioMatch = a.dominio === b.dominio ? 0.6 : 0;
  const setA = new Set(a.palavras);
  const setB = new Set(b.palavras);
  const intersecao = [...setA].filter(p => setB.has(p)).length;
  const uniao = new Set([...setA, ...setB]).size;
  return dominioMatch + (uniao > 0 ? (intersecao / uniao) * 0.4 : 0);
}

function consultarKNN(remetente, assunto, memoria) {
  if (!memoria.length) return null;
  const tokens   = extrairTokens(remetente, assunto);
  const vizinhos = memoria
    .map(e => ({ ...e, sim: calcularSimilaridade(tokens, e.tokens) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, K_VIZINHOS);

  if (vizinhos[0].sim < MIN_SIMILARIDADE) return null;

  const votos = {};
  vizinhos.forEach(v => {
    if (v.sim >= MIN_SIMILARIDADE)
      votos[v.categoria] = (votos[v.categoria] || 0) + v.sim;
  });

  const cat = Object.entries(votos).sort((a, b) => b[1] - a[1])[0][0];
  const ref = vizinhos.find(v => v.categoria === cat);
  return { categoria: cat, prioridade: ref.prioridade, estrela: ref.estrela,
           confianca: vizinhos[0].sim, fonte: 'memoria' };
}

// ─────────────────────────────────────────
// CLASSIFICADOR
// ─────────────────────────────────────────

function classificarEmail(remetente, assunto, memoria) {
  const knn = consultarKNN(remetente, assunto, memoria);
  if (knn) return knn;

  for (const [categoria, query] of Object.entries(REGRAS)) {
    const termos = query.split(/\s+OR\s+/)
      .map(t => t.replace(/^from:|^subject:/, '').replace(/"/g, '').trim());
    const dom  = (remetente.match(/@([\w.]+)/) || ['', ''])[1].toLowerCase();
    const subj = assunto.toLowerCase();
    if (termos.some(t => dom.includes(t.toLowerCase())
                      || remetente.toLowerCase().includes(t.toLowerCase())
                      || subj.includes(t.toLowerCase()))) {
      const cfg = PRIORIDADE_PADRAO[categoria] || { prioridade: 'baixa', estrela: false };
      return { ...cfg, categoria, confianca: 1, fonte: 'regra' };
    }
  }

  return { categoria: 'Promoções', prioridade: 'baixa', estrela: false,
           confianca: 0, fonte: 'default' };
}

// ─────────────────────────────────────────
// APLICAR NO GMAIL
// ─────────────────────────────────────────

function aplicarCategoria(thread, categoria) {
  const m = GmailApp.getUserLabelByName(categoria) || GmailApp.createLabel(categoria);
  m.addToThreads([thread]);
}

function aplicarPrioridade(thread, prioridade, estrela) {
  const msgs = thread.getMessages();
  for (let i = 0; i < msgs.length; i += 100) {
    const lote = msgs.slice(i, i + 100);
    (estrela && prioridade !== 'baixa')
      ? GmailApp.starMessages(lote)
      : GmailApp.unstarMessages(lote);
  }
  prioridade === 'alta'
    ? thread.markImportant()
    : thread.markUnimportant();
}

function processarThread(thread, memoria) {
  const msg       = thread.getMessages()[0];
  const remetente = msg.getFrom();
  const assunto   = msg.getSubject() || '';
  const resultado = classificarEmail(remetente, assunto, memoria);

  aplicarCategoria(thread, resultado.categoria);
  aplicarPrioridade(thread, resultado.prioridade, resultado.estrela);

  memoria.push({
    tokens:     extrairTokens(remetente, assunto),
    categoria:  resultado.categoria,
    prioridade: resultado.prioridade,
    estrela:    resultado.estrela,
  });

  return resultado;
}

// ─────────────────────────────────────────
// FASE 1 — MONITORAMENTO CONTÍNUO (10 min)
// ─────────────────────────────────────────

// Threads que ja tem alguma label de categoria ja foram processadas -
// exclui-las da busca substitui o antigo filtro por data, o que
// tambem permite ao agente ir processando o backlog de e-mails
// antigos aos poucos, nao so e-mails novos.
function construirQueryNaoProcessados() {
  const exclusoes = Object.keys(PRIORIDADE_PADRAO)
    .map(categoria => `-label:"${categoria}"`)
    .join(' ');
  return `in:inbox -in:trash ${exclusoes}`;
}

function categorizarEmailsNovos() {
  const query   = construirQueryNaoProcessados();
  const memoria = carregarMemoria();
  let processados = 0;
  let lote;

  do {
    lote = GmailApp.search(query, 0, LOTE_TAMANHO);
    for (const thread of lote) {
      try {
        processarThread(thread, memoria);
      } catch (e) {
        console.error(`Erro: ${e.message}`);
      }
      processados++;
    }
  } while (lote.length === LOTE_TAMANHO && processados < MAX_THREADS_POR_EXECUCAO);

  try {
    salvarMemoria(memoria);
  } catch (e) {
    console.error(`Erro ao salvar memória: ${e.message}`);
  }

  if (processados) console.log(`✅ ${processados} thread(s) categorizada(s)`);
}

// ─────────────────────────────────────────
// FASE 2 — ARQUIVAR LIDOS (semanal)
// ─────────────────────────────────────────

function arquivarEmailsLidos() {
  const corte     = new Date(Date.now() - DIAS_ARQUIVAR * 24 * 60 * 60 * 1000);
  const dataCorte = Utilities.formatDate(corte, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  console.log(`Arquivando lidos antes de ${dataCorte}...`);

  // is:read = lidos; in:inbox = ainda na inbox (não arquivados)
  const query   = `in:inbox is:read before:${dataCorte} -in:trash`;
  let total     = 0;
  let lote;

  do {
    lote = GmailApp.search(query, 0, 100);
    if (!lote.length) break;
    // moveThreadsToArchive remove o label INBOX sem apagar
    GmailApp.moveThreadsToArchive(lote);
    total += lote.length;
    Utilities.sleep(300);
  } while (lote.length === 100);

  console.log(`✅ Arquivados: ${total} threads lidas com mais de ${DIAS_ARQUIVAR} dias`);
  return total;
}

// ─────────────────────────────────────────
// FASE 3 — LIMPEZA DE NÃO LIDOS (semanal)
// ─────────────────────────────────────────

function limparEmailsAntigos() {
  const corte     = new Date(Date.now() - DIAS_LIXEIRA * 24 * 60 * 60 * 1000);
  const dataCorte = Utilities.formatDate(corte, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  console.log(`Limpeza — corte: ${dataCorte}`);

  let totalLixeira = 0;
  const filaAviso  = [];

  // Categorias direto para lixeira
  for (const categoria of CATEGORIAS_LIXEIRA) {
    const query = `label:"${categoria}" is:unread before:${dataCorte} -in:trash`;
    let lote;
    do {
      lote = GmailApp.search(query, 0, 100);
      if (!lote.length) break;
      GmailApp.moveThreadsToTrash(lote);
      totalLixeira += lote.length;
      Utilities.sleep(300);
    } while (lote.length === 100);
  }

  // Categorias que geram aviso
  for (const categoria of CATEGORIAS_AVISAR) {
    const query   = `label:"${categoria}" is:unread before:${dataCorte} -in:trash`;
    const amostra = GmailApp.search(query, 0, 50);
    if (!amostra.length) continue;

    const total   = GmailApp.search(query, 0, 500).length;
    const exemplos = amostra.slice(0, 5).map(t => {
      const msg = t.getMessages()[0];
      return `  • ${msg.getDate().toLocaleDateString('pt-BR')} | ${msg.getFrom().replace(/<.*>/, '').trim()} — "${t.getFirstMessageSubject()}"`;
    });
    filaAviso.push({ categoria, total, exemplos });
  }

  if (filaAviso.length) {
    const totalAviso = filaAviso.reduce((s, f) => s + f.total, 0);
    const usuario    = Session.getActiveUser().getEmail();
    let corpo = `Antônio,\n\n`;
    corpo    += `${totalAviso} e-mail(s) não lidos com mais de ${DIAS_LIXEIRA} dias aguardam decisão.\n\n`;
    corpo    += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const { categoria, total, exemplos } of filaAviso) {
      corpo += `📂 ${categoria} — ${total} e-mail(s) antes de ${dataCorte}\n`;
      corpo += exemplos.join('\n');
      if (total > 5) corpo += `\n  ... e mais ${total - 5}`;
      corpo += `\n\n`;
    }

    corpo += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    corpo += `Para apagar tudo, execute aprovarLimpezaFinanceira() no script.google.com\n\n`;
    corpo += `— Agente de e-mails`;

    GmailApp.sendEmail(usuario, `[Agente] ${totalAviso} e-mails antigos aguardando decisão`, corpo);
  }

  console.log(`✅ Limpeza: ${totalLixeira} na lixeira`);
}

// Executar após receber o e-mail de aviso
function aprovarLimpezaFinanceira() {
  const corte     = new Date(Date.now() - DIAS_LIXEIRA * 24 * 60 * 60 * 1000);
  const dataCorte = Utilities.formatDate(corte, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  let total = 0;

  for (const categoria of CATEGORIAS_AVISAR) {
    const query = `label:"${categoria}" is:unread before:${dataCorte} -in:trash`;
    let lote;
    do {
      lote = GmailApp.search(query, 0, 100);
      if (!lote.length) break;
      GmailApp.moveThreadsToTrash(lote);
      total += lote.length;
      Utilities.sleep(300);
    } while (lote.length === 100);
  }

  console.log(`✅ ${total} threads na lixeira. 30 dias para desfazer.`);
}

// ─────────────────────────────────────────
// ROTINA SEMANAL — chama arquivo + limpeza
// ─────────────────────────────────────────

function rodinaSemanal() {
  arquivarEmailsLidos();
  limparEmailsAntigos();
}

// ─────────────────────────────────────────
// TRIGGERS
// ─────────────────────────────────────────

function configurarTriggers() {
  // Remove triggers antigos
  const funcoes = ['categorizarEmailsNovos', 'rodinaSemanal', 'limparEmailsAntigos', 'arquivarEmailsLidos'];
  ScriptApp.getProjectTriggers()
    .filter(t => funcoes.includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Novos e-mails — a cada 10 min
  ScriptApp.newTrigger('categorizarEmailsNovos')
    .timeBased().everyMinutes(10).create();

  // Arquivo + limpeza — todo domingo às 3h
  ScriptApp.newTrigger('rodinaSemanal')
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();

  console.log('✅ Triggers ativos:\n  • categorizarEmailsNovos — a cada 10 min\n  • rodinaSemanal — domingo 3h (arquiva lidos 30d + apaga não lidos 180d)');
}

// ─────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────

function verMemoria() {
  const mem  = carregarMemoria();
  const cont = {};
  mem.forEach(e => { cont[e.categoria] = (cont[e.categoria] || 0) + 1; });
  console.log(`Total: ${mem.length} entradas\n` + JSON.stringify(cont, null, 2));
}

function simularLimpeza() {
  const corte     = new Date(Date.now() - DIAS_LIXEIRA * 24 * 60 * 60 * 1000);
  const dataCorte = Utilities.formatDate(corte, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const corteArq  = new Date(Date.now() - DIAS_ARQUIVAR * 24 * 60 * 60 * 1000);
  const dataArq   = Utilities.formatDate(corteArq, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  console.log(`=== SIMULAÇÃO ===`);
  console.log(`Arquivar lidos antes de: ${dataArq}`);
  const lidos = GmailApp.search(`in:inbox is:read before:${dataArq} -in:trash`, 0, 500).length;
  console.log(`  → ${lidos} threads seriam arquivadas\n`);

  console.log(`Apagar não lidos antes de: ${dataCorte}`);
  for (const cat of [...CATEGORIAS_LIXEIRA, ...CATEGORIAS_AVISAR]) {
    const n   = GmailApp.search(`label:"${cat}" is:unread before:${dataCorte} -in:trash`, 0, 500).length;
    const ico = CATEGORIAS_AVISAR.includes(cat) ? '⚠️  AVISO  ' : '🗑️  LIXEIRA';
    if (n > 0) console.log(`  ${ico} | ${cat}: ${n}`);
  }
  console.log('\n(Nada foi alterado)');
}

function limparTudo() {
  const props       = PropertiesService.getScriptProperties();
  const totalChunks = parseInt(props.getProperty(MEMORIA_CHAVE_CHUNKS) || '0', 10);
  for (let i = 0; i < totalChunks; i++) {
    props.deleteProperty(`${MEMORIA_CHAVE_PREFIXO}_${i}`);
  }
  props.deleteProperty(MEMORIA_CHAVE_CHUNKS);
  console.log('Memória limpa.');
}
function importarMemoria() {
  const chunks = 5;
  PropertiesService.getScriptProperties().setProperty('EMAIL_MEMORIA_0', '[{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["vorcaro","chega","presídio","ficará","dias","isolado","cela","garota","anos","estuprada","por","sete","pessoas","ator","revela"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"pan.com.vc","palavras":["banco","pan","empréstimo","com","garantia","veículo"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"service.tiktok.com","palavras":["você","conhece","jairo","iavelberg"]},"categoria":"Redes Sociais","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"quora.com","palavras":["how","did","israeli","arabs","gain","citizenship","but","palestinians","did","not","are","israeli","arabs","not","ethnic"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"notification.bebee.com","palavras":["oportunidades","trabalho","como","consultor","comercial","financeiro","brasília"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"google.com","palavras":["pasta","compartilhada","com","você","documentos","para","abertura","conta","corrente"]},"categoria":"Sistemas & Segurança","prioridade":"alta","estrela":true},{"tokens":{"dominio":"email3.gog.com","palavras":["your","exclusive","discount","xnxwk","hxlf","xwv"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"unique.ucicinemas.com.br","palavras":["exclusivo","cena","inédita","push","limite","medo"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"mercadolivre.com","palavras":["olá","antônio","ajude","nos","melhorar"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"uber.com","palavras":["uber","seu","recibo"]},"categoria":"Transporte","prioridade":"media","estrela":true},{"tokens":{"dominio":"veduca.org","palavras":["governo","abriu","vagas","com","home","office"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"mercadopago.com","palavras":["seu","pix","foi","enviado"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["brasil","sobre","estradas","terra","retrato","infraestrutura","rodoviária","país"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["informalidade","não","escolha","sobrevivência","uma","economia","baixa","produtividade"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"mail.consumidorpositivo.com.br","palavras":["antonio","você","tem","até","limite"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"news.mcdonalds.com.br","palavras":["semana","consumidor"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"amazon.com.br","palavras":["melhores","descontos","dia","ebooks"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"newarrival.aliexpress.com","palavras":["itens","com","isenção","imposto"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"wordpress.com","palavras":["emprego","forte","mesmo","com","pib","fraco","retrato","atual","mercado","trabalho","brasileiro"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"canalmeio.com.br","palavras":["milícia","pessoal","vorcaro"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["inss","detecta","novo","consignado","irregular","master","ator","revela","estar","com","câncer","fase","terminal"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"veduca.org","palavras":["mercado","livre","abriu","vagas","todo","brasil"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"linkedin.com","palavras":["victor","maués","rodrigues","creative","copywriter","reagiu","esta","publicação","depois","dos","das","vez","dos"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"steampowered.com","palavras":["celeste","sua","lista","desejos","está","oferta"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"linkedin.com","palavras":["parabenize","gabriel","pereira","pelo","novo","cargo","advogado","sênior","empresa","ffv"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"duolingo.com","palavras":["vou","tentar","tudo"]},"categoria":"Apps & Estudos","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"wordpress.com","palavras":["conquistar","mercados","globais","não","acaso","engenharia","desenvolvimento"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"unique.ucicinemas.com.br","palavras":["cara","sucesso","muito","mais","uci","vem","ver"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"wordpress.com","palavras":["por","que","problema","produtividade","brasil","não","que","você","pensa","uma","análise","sobre","valor","complexidade"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"comunica.estacio.br","palavras":["você","tem","desconto","esperando"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"linkedin.com","palavras":["fugini","alimentos","está","contratando","para","cargo","gerente","área","vendas"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["daniel","vorcaro","banco","master","preso","pela","ator","globo","preso","por","estupro","menino","anos","áudio","vazado"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"99app.com","palavras":["você","pode","pagar","até","pay","com","todos","cartões"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"veduca.org","palavras":["hospital","einstein","abriu","vagas","home","office","sem","experiência"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["mercados","respiram","com","possível","cessar","fogo","queda","petróleo"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["daniel","vorcaro","banco","master","preso","pela","ator","globo","preso","por","estupro","menino","anos"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newarrival.aliexpress.com","palavras":["antônio","furtado","isso","sua","cara"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"myheritage.com","palavras":["antônio","furtado","fizemos","uma","descoberta","para","você","sobre","sua","família"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"mail.planos.tim.com.br","palavras":["mais","internet","mais","benefícios","confira","seu","novo","tim","controle"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"m.learn.coursera.org","palavras":["agenda","próximos","eventos","académicos"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"amazon.com.br","palavras":["curta","dia","com","ofertas","ebooks"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["mulheres","floresta","quebradeiras","andiroba","parceria","com","natura"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"mkt.99app.com","palavras":["antônio","desconto","próxima","corrida"]},"categoria":"Promoções","prioridade":"baixa","estrela":');
  PropertiesService.getScriptProperties().setProperty('EMAIL_MEMORIA_1', 'false},{"tokens":{"dominio":"canalmeio.com.br","palavras":["guerra","oriente","médio","intensifica","com","ataques","embaixadas"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"quora.com","palavras":["usp","tornou","antro","drogados","comunistas","vale","pena","entrar","nessa","universidade"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["seu","score","mudou"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["seu","score","mudou","descubra","hora"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["antônio","importante","sua","pontuação","score","mudou"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"veduca.org","palavras":["santander","abriu","vagas","home","office"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"linkedin.com","palavras":["baraa","khatib","salkini","acaba","publicar","again","uzomah","teslim","done","amazing","job","analyzing","channel","really","cool"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"linkedin.com","palavras":["anderson","pires","universidade","federal","pará","uma","pessoa","que","você","talvez","conheça"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"marketing.picpay.com","palavras":["sua","chance","ganhar","limite"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"comunicacoes.isaac.com.br","palavras":["agora","demonstrativo","está","disponível","meu","arco"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"linkedin.com","palavras":["antônio","seu","perfil","vem","sendo","notado"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"linkedin.com","palavras":["parabenize","gabriel","pereira","pelo","novo","cargo","advogado","sênior","empresa","ffv"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"duolingo.com","palavras":["vou","tentar","tudo"]},"categoria":"Apps & Estudos","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"promo.kabum.com.br","palavras":["quinzena","consumidor"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"unique.ucicinemas.com.br","palavras":["maratone","vem","uci","day","oscar","partir"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["trump","afirma","que","tudo","foi","destruído","irã","áudio","vazado","bap","explica","demissão","filipe","luís","ouça"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"email3.gog.com","palavras":["this","more","than","nostalgia","this","impact"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["complexidade","poder","mercado","termos","troca","por","que","chips","valem","mais","que","soja","século","xxi"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"linkedin.com","palavras":["analista","financeiro","agropalma","vila","nova","agroindustrial","estão","contratando"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"google.com","palavras":["summary","failures","for","google","apps","script","propostas"]},"categoria":"Sistemas & Segurança","prioridade":"alta","estrela":true},{"tokens":{"dominio":"amazon.com.br","palavras":["hoje","melhores","descontos","ebooks"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"brasil.santander.com.br","palavras":["compre","sem","precisar","seu","cartão","físico","antonio"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"veduca.org","palavras":["encerrando","caixa","vagas","home","office","pouca","experiência"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"google.com","palavras":["summary","failures","for","google","apps","script","contrato","adv"]},"categoria":"Sistemas & Segurança","prioridade":"alta","estrela":true},{"tokens":{"dominio":"newarrival.aliexpress.com","palavras":["uma","entrega","especial","para","você"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"zoxnews.net","palavras":["fazer","transferência","para","conta"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"google.com","palavras":["antônio","feliz","aniversário","anos"]},"categoria":"Sistemas & Segurança","prioridade":"alta","estrela":true},{"tokens":{"dominio":"ofertas.consumidorpositivo.com.br","palavras":["acompanhe","seu","cpf"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"amazon.com.br","palavras":["começou","amazon"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["pib","dois","tempos","crescimento","ano","estagnação","segundo","semestre","recorde","histórico","com","freio","margem"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"comunica.estacio.br","palavras":["data","igual","mas","desconto","não"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"canalmeio.com.br","palavras":["trump","diz","que","guerra","irã","vai","durar","tempo","que","for","necessário"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"i.tokstok.com.br","palavras":["mais","oportunidades","sale","com","appday"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["seu","score","liberou","uma","oferta"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["antônio","importante","sua","pontuação","score","mudou"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"veduca.org","palavras":["grupo","fleury","vagas","remotas","todo","brasil"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"academia","palavras":["are","you","the","antônio","furtado","who","wrote","specialized","motion","capture","system","for","real","time"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"colab.re","palavras":["responda","decida","como","será","novo","prédio","caixa","amaral","peixoto"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"steampowered.com","palavras":["mullet","madjack","sua","lista","desejos","está","oferta"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"linkedin.com","palavras":["sua","vez","antônio"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"myheritage.com","palavras":["manoel","estêvão","furtado","novo","resultado"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"mercadopago.com","palavras":["seu","pix","foi","enviado"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"linkedin.com","palavras":["antônio","siga","josé","berenguer","ceo","banco","empresa","inc"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"comunica.estacio.br","palavras":["falta","dia","para","desconto","mais","aguardado"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"marketing.hbomax.com","palavras":["não","perca","que","está","por","vir"]},"categoria":"Entretenimento","prioridade":"baixa","estrela":fals');
  PropertiesService.getScriptProperties().setProperty('EMAIL_MEMORIA_2', 'e},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["quer","subir","seu","score","aqui","vai","uma","dica"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"duolingo.com","palavras":["antônio"]},"categoria":"Apps & Estudos","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"linkedin.com","palavras":["eduarda","borges","ingryd","rodrigues","mais","pessoas","reagiram","uma","publicação"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"unique.ucicinemas.com.br","palavras":["março","com","oscar","uci","vem","garantir"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newskmdevantagens.com.br","palavras":["março","com","cashback"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"comunicacao.acordocerto.com.br","palavras":["informe","consulta","realizada","seu","cpf"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["clube","afasta","jogador","acusado","estupro","coletivo","rio","quem","deve","declarar","imposto","renda"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"amazon.com.br","palavras":["curta","dia","com","ofertas","ebooks"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"mail.e.ceapay.com.br","palavras":["antonio","sua","fatura","pay","vence","dias"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"nubank.com.br","palavras":["novo","boleto","emitido","seu","cpf"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"zoxnews.net","palavras":["fazer","transferência","para","conta"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["mercado","alerta","com","pib","fed","petróleo"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"veduca.org","palavras":["encerrando","canadá","vagas","remotas","para","quem","fala","português"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"faturas.isaac.com.br","palavras":["seu","vencimento","está","próximo"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"newarrival.aliexpress.com","palavras":["liquidação","até","desconto"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"wordpress.com","palavras":["produtividade","brasil","problema","não","eficiência","valor","adicionado"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"google.com","palavras":["summary","failures","for","google","apps","script","contratos","estagiarios"]},"categoria":"Sistemas & Segurança","prioridade":"alta","estrela":true},{"tokens":{"dominio":"canalmeio.com.br","palavras":["conflito","entre","eua","israel","irã","alastra","pelo","oriente","médio"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"bcb.gov.br","palavras":["focus","distribuições","frequência","das","expectativas","mercado","para","ipca","selic","pib","câmbio"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["quem","deve","declarar","imposto","renda","guerra","dos","estados","unidos","israel","contra","irã","bbb"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"bcb.gov.br","palavras":["focus","relatório","mercado"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["história","vale","silício","eletrônica","militar","magnificent"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"veduca.org","palavras":["mercado","livre","abriu","vagas","todo","brasil"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"assineagora.estadao.com.br","palavras":["concorra","prêmios","incríveis","mês","consumidor","estadão"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"duolingo.com","palavras":["antônio","sei","que","você","não","esqueceu"]},"categoria":"Apps & Estudos","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"wordpress.com","palavras":["crédito","brasil","expansão","acelerada","estagnação","relativa"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"linkedin.com","palavras":["eduarda","borges","compartilhou","publicação","portal","reforma"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"notification.bebee.com","palavras":["oportunidades","trabalho","como","vendedor","crédito","consignado","brasília"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"notification.bebee.com","palavras":["oportunidades","trabalho","como","consultor","comercial","brasília"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newarrival.aliexpress.com","palavras":["antônio","furtado","isso","para","você"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"service.tiktok.com","palavras":["ruiva","viu","seu","perfil"]},"categoria":"Redes Sociais","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"sexlog.com","palavras":["acesso","conta"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["urgente","irã","confirma","morte","ali","khamenei","cristiane","torloni","despede","dennis","carvalho"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"amazon.com.br","palavras":["hoje","melhores","descontos","ebooks"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"brasil.santander.com.br","palavras":["antonio","cadastre","mantenha","sua","chave","pix","tenha","dias","sem","juros","limite","conta"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"service.tiktok.com","palavras":["aline","paiva","seguiu","você","volta"]},"categoria":"Redes Sociais","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"news.mcdonalds.com.br","palavras":["março","começou","com","méqui","precinho"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"e.drogasil.com.br","palavras":["seu","medicamento","esta","acabando"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"contato.consumidorpositivo.com.br","palavras":["notificação","encerramento","comunicação"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"linkedin.com","palavras":["antônio","siga","paulo","moll","ceo","empresa","rede"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["urgente","irã","confirma","morte","ali","khamenei","cristiane","torloni","despede","dennis","carvalho","influenciadora","sofre","derretimento","facial"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"wordpress.com","palavras":["lin","manuel","miranda","broadway","reinvenção","latina","musical","americano"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["nicholas","kaldor","cepal","como","uma","viagem","chile","mudou","história","pensamento","econômico"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"veduca.org","palavras":["governo","abriu","vagas","com","home","office"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"primevideo.com","palavras":["anônimo",');
  PropertiesService.getScriptProperties().setProperty('EMAIL_MEMORIA_3', '"está","agora","disponível","prime","video"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"veduca.org","palavras":["ita","liberou","cursos","online","com","opção","certificado"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"notification.bebee.com","palavras":["oportunidades","trabalho","como","consultor","comercial","taguatinga","brasília","distrito","federal"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"notification.bebee.com","palavras":["oportunidades","trabalho","como","consultor","comercial","financeiro","brasília","brasília"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"email3.gog.com","palavras":["zqqhxpaup","ekurh","expires","hours"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"info.crunchyroll.com","palavras":["por","favor","atualize","seus","dados","pagamento"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"wordpress.com","palavras":["armadilha","sofisticação","por","que","produzir","tecnologia","não","significa","ser","dono","dela"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["última","chamada","controle","seus","dados","agora","com","premium"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["urgente","eua","israel","lançam","ataque","contra","irã","leitura","labial","revela","ofensa","chocante","neymar","durante","jogo"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"amazon.com.br","palavras":["ofertas","dia","ebooks"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"veduca.org","palavras":["encerrando","caixa","vagas","home","office","pouca","experiência"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"e.drogaraia.com.br","palavras":["condição","especial","seu","benefício","farmácia","liberada"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newarrival.aliexpress.com","palavras":["antônio","furtado","vida","nos","detalhes"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"mail.planos.tim.com.br","palavras":["mais","internet","mais","benefícios","confira","seu","novo","tim","controle"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["urgente","eua","israel","lançam","ataque","contra","irã","leitura","labial","revela","ofensa","chocante","neymar","durante","jogo"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"steampowered.com","palavras":["resident","evil","requiem","está","disponível","steam"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"veduca.org","palavras":["casas","bahia","abriu","vagas","remotas","todo","brasil"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"linkedin.com","palavras":["baraa","khatib","salkini","founder","reagiu","esta","publicação","sql"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"linkedin.com","palavras":["lise","tupiassu","merlin","universidade","federal","pará","uma","pessoa","que","você","talvez","conheça"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"sf.grancursosonline.com.br","palavras":["gran","eventos","programa","desligamento","voluntário","concursos"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"sf.grancursosonline.com.br","palavras":["gran","eventos","pré","lançamento","pílulas","semanais","com","aragonê","fernandes"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"marketing.hbomax.com","palavras":["chegou","seu","guia","para","fim","semana"]},"categoria":"Entretenimento","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newarrival.aliexpress.com","palavras":["seleção","com","mais","vendidos"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["antônio","mais","chances","fazer","seu","score","subir"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"minhaclaro.com.br","palavras":["monarch","chegou","garanta","apple","seu","plano","claro"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"e.drogaraia.com.br","palavras":["condição","especial","seu","benefício","farmácia","liberada"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newsletter.elitepain.com","palavras":["new","packages"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"email3.gog.com","palavras":["you","must","repopulate","the","human","race"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"notification.bebee.com","palavras":["oportunidades","trabalho","como","consultor","comercial","financeiro","brasília"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"linkedin.com","palavras":["analista","financeiro","empresas","coe","centro","excelência","votorantim","moura","dubeux","contrataram","perto","você"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"movimentoblackmoney.com.br","palavras":["você","está","perdendo","dinheiro","sem","perceber"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"e.drogasil.com.br","palavras":["seu","medicamento","esta","acabando"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"minhaclaro.com.br","palavras":["parte","temporada","bridgerton","chegou"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["zema","nikolas","são","criticados","por","tragédias","prestianni","admitiu","insulto","racista","vini","bbb"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"linkedin.com","palavras":["legrand","está","contratando","para","cargo","gerente","distrital","vendas"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"marketing.picpay.com","palavras":["ofertas","off","muito","mais"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"economia.gov.br","palavras":["gov","alerta","segurança","acesso","novo","dispositivo"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"bcb.gov.br","palavras":["instituições","top"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"veduca.org","palavras":["encerrando","gol","vagas","home","office"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"adultfriendfinder.com","palavras":["the","signs","they","ready","meet"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"mail.planos.tim.com.br","palavras":["mais","internet","mais","benefícios","confira","seu","novo","tim","controle"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"amazon.com.br","palavras":["aproveite","ofertas","ebooks","dessa","sexta"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"zoxnews.net","palavras":["seu","crédito","foi","enviado","hoje"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"wordpress.com","palavras":["ipca","fevereiro","surpreende","pressiona","cenário","juros"]},"categoria":"Leituras & Newsletters","prioridad');
  PropertiesService.getScriptProperties().setProperty('EMAIL_MEMORIA_4', 'e":"media","estrela":true},{"tokens":{"dominio":"canalmeio.com.br","palavras":["mendonça","cpi","inss","quebram","sigilos","lulinha"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"uber.com","palavras":["antônio","indo","para","trabalho","escola","use","moto"]},"categoria":"Transporte","prioridade":"media","estrela":true},{"tokens":{"dominio":"quora.com","palavras":["espagnol","est","seule","langue","avec","deux","verbes","être","deux","verbes","avoir"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["zema","nikolas","são","criticados","por","tragédias","comprovantes","para","devem","ser","enviados","até","hoje","bbb"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"wordpress.com","palavras":["estado","empregador","quanto","pesam","funcionários","públicos","mercado","trabalho","dos","eua","brasil"]},"categoria":"Leituras & Newsletters","prioridade":"media","estrela":true},{"tokens":{"dominio":"veduca.org","palavras":["mercado","livre","abriu","vagas","todo","brasil"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"google.com","palavras":["summary","failures","for","google","apps","script","propostas"]},"categoria":"Sistemas & Segurança","prioridade":"alta","estrela":true},{"tokens":{"dominio":"google.com","palavras":["summary","failures","for","google","apps","script","contratos","estagiarios"]},"categoria":"Sistemas & Segurança","prioridade":"alta","estrela":true},{"tokens":{"dominio":"steampowered.com","palavras":["baldur","gate","outros","itens","sua","lista","desejos","estão","oferta"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"email.openai.com","palavras":["experimente","novo","visual","sem","compromisso"]},"categoria":"Apps & Estudos","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"news.termius.com","palavras":["termius","february","news","tips","for","using","agents"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["antônio","avance","jogo","vida","financeira"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"unique.ucicinemas.com.br","palavras":["pandora","chamas","vem","ver","filme","semana","uci"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"amazon.com.br","palavras":["melhores","descontos","dia","ebooks"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"email3.gog.com","palavras":["your","exclusive","discount","zqqhxpaup","ekurh"]},"categoria":"Compras & Recibos","prioridade":"alta","estrela":true},{"tokens":{"dominio":"newsbox.noticiasaominutobr.com","palavras":["cpi","inss","aprova","quebra","sigilo","lulinha","parlamentares","trocam","socos","humorista","sofre","acidente","está","coma","mulher"]},"categoria":"Notícias","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"mail.crunchyroll.com","palavras":["reminder","payment","update","needed"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"emkt.ze.delivery","palavras":["lollabr","confira","atrações","palco","budweiser"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"brasilcard.net","palavras":["olá","antonio","sua","fatura","brasilcard","chegou"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"newskmdevantagens.com.br","palavras":["off","superquinta","kmv"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"veduca.org","palavras":["hospital","einstein","abriu","vagas","sem","experiência","home","office"]},"categoria":"Cursos & Vagas","prioridade":"media","estrela":true},{"tokens":{"dominio":"novidades.serasa.com.br","palavras":["pague","menos","dia","descubra","quem","consultou","seu","cpf"]},"categoria":"Promoções","prioridade":"baixa","estrela":false},{"tokens":{"dominio":"zoxnews.net","palavras":["seu","crédito","foi","enviado","hoje"]},"categoria":"Finanças","prioridade":"alta","estrela":true},{"tokens":{"dominio":"imprensa.com","palavras":["crédito","para","comprar","mais","prazo","para","pagar"]},"categoria":"Promoções","prioridade":"baixa","estrela":false}]');
  PropertiesService.getScriptProperties().setProperty('EMAIL_MEMORIA_CHUNKS', String(chunks));
  console.log("Memória importada: 200 entradas em 5 chunks");
}

// ─────────────────────────────────────────
// EXPORTS (somente para testes locais com Jest — no runtime do Apps
// Script "module" nao existe, entao este bloco nunca roda por la)
// ─────────────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = {
    carregarMemoria,
    salvarMemoria,
    limparTudo,
    extrairTokens,
    calcularSimilaridade,
    consultarKNN,
    classificarEmail,
    construirQueryNaoProcessados,
    categorizarEmailsNovos,
  };
}