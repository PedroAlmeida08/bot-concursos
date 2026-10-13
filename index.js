const Parser = require('rss-parser');
const cheerio = require('cheerio');
const fs = require('fs');

const parser = new Parser();
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;

// --- CONFIGURAÇÃO DO BANCO DE DADOS LOCAL ---
const DB_FILE = 'database.json';

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ 
    lastUpdateId: 0, 
    blacklist: [], 
    watchlist: ["bndes", "epe"] 
  }));
}
let db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
if (!db.blacklist) db.blacklist = [];
if (!db.watchlist) db.watchlist = ["bndes", "epe"];

// Modificado para aceitar teclados interativos (reply_markup)
async function enviarMensagemTelegram(texto, reply_markup = null) {
  const body = { chat_id: CHAT_ID, text: texto, parse_mode: 'Markdown' };
  if (reply_markup) {
    body.reply_markup = reply_markup;
  }
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// --- PROCESSAMENTO DE COMANDOS E BOTÕES (CALLBACKS) ---
async function processarComandosTelegram() {
  console.log("Checando novos comandos e cliques no Telegram...");
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${db.lastUpdateId + 1}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    let respostas = [];

    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        db.lastUpdateId = update.update_id; 

        // 1. Processa Cliques em Botões (Callback Query)
        if (update.callback_query) {
          const callbackData = update.callback_query.data;
          const callbackId = update.callback_query.id;

          if (callbackData.startsWith('add_blk:')) {
            const termo = callbackData.replace('add_blk:', '').trim();
            if (!db.blacklist.includes(termo)) db.blacklist.push(termo);
            respostas.push(`🚫 '${termo}' foi adicionado à Blacklist via botão.`);
          }

          // Responde à API do Telegram para tirar o ícone de "carregando" do botão
          await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ callback_query_id: callbackId })
          });
          continue; // Pula para a próxima atualização
        }
        
        // 2. Processa Comandos de Texto Normais
        if (!update.message || !update.message.text) continue;
        const texto = update.message.text.trim().toLowerCase();

        // [MANTIDA A LÓGICA ANTERIOR DE COMANDOS DE TEXTO]
        if (texto.startsWith('/add_blacklist ')) {
          const termo = texto.replace('/add_blacklist ', '').trim();
          if (!db.blacklist.includes(termo)) db.blacklist.push(termo);
          respostas.push(`🚫 '${termo}' adicionado à Blacklist.`);
        } 
        else if (texto.startsWith('/remove_blacklist ')) {
          const termo = texto.replace('/remove_blacklist ', '').trim();
          db.blacklist = db.blacklist.filter(t => t !== termo);
          respostas.push(`✅ '${termo}' removido da Blacklist.`);
        } 
        else if (texto === '/blacklist') {
          respostas.push(db.blacklist.length > 0 ? `📋 *Blacklist:*\n- ${db.blacklist.join('\n- ')}` : `📋 Blacklist vazia.`);
        } 
        else if (texto === '/reset_blacklist') {
          db.blacklist = [];
          respostas.push(`♻️ Blacklist zerada!`);
        }
        else if (texto.startsWith('/add_watchlist ')) {
          const termo = texto.replace('/add_watchlist ', '').trim();
          if (!db.watchlist.includes(termo)) db.watchlist.push(termo);
          respostas.push(`🎯 '${termo}' adicionado à Watchlist.`);
        } 
        else if (texto.startsWith('/remove_watchlist ')) {
          const termo = texto.replace('/remove_watchlist ', '').trim();
          db.watchlist = db.watchlist.filter(t => t !== termo);
          respostas.push(`✅ '${termo}' removido da Watchlist.`);
        } 
        else if (texto === '/watchlist') {
          respostas.push(db.watchlist.length > 0 ? `📡 *Radar (Watchlist):*\n- ${db.watchlist.join('\n- ')}` : `📡 Watchlist vazia.`);
        } 
        else if (texto === '/reset_watchlist') {
          db.watchlist = [];
          respostas.push(`♻️ Watchlist zerada!`);
        }
      }

      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
      if (respostas.length > 0) await enviarMensagemTelegram(respostas.join('\n\n'));
    }
  } catch (error) {
    console.error("Erro ao ler interações do Telegram:", error);
  }
}

// --- FUNÇÕES DE BUSCA E IA ---
async function buscarEditalAnteriorNoGoogle(nomeConcurso) {
  const query = encodeURIComponent(`edital anterior concurso ${nomeConcurso}`);
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${query}&num=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.items && data.items.length > 0) return `[${data.items[0].title}](${data.items[0].link})`;
    return "Não encontrado na busca automática.";
  } catch (error) { return "Erro na busca."; }
}

async function extrairDadosComIA(textoPagina) {
  const prompt = `
    Analise o texto do concurso abaixo e responda ESTRITAMENTE em formato JSON.
    {
      "nomeConcurso": "Nome do Órgão/Concurso",
      "estado": "Previsto / Inscrições Abertas / etc",
      "remuneracao": "R$ X + Benefícios",
      "locaisTrabalho": "Cidades/Estados onde estão as vagas",
      "locaisProva": "Cidades/Estados onde as provas serão aplicadas",
      "aplicaProvaRJ": true, 
      "modeloTrabalho": "Presencial/Remoto e Carga Horária",
      "tipoProva": "Discursiva/Objetiva/Ambos",
      "banca": "Nome da Banca",
      "siteUltimoConcurso": "URL ou 'Não informado'"
    }
    Se alguma informação não existir, preencha com "Não informado".
    Texto: ${textoPagina.substring(0, 15000)}
  `;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" } 
    })
  });
  const data = await response.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

async function buscarTextoDaPagina(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $= cheerio.load(html);$('script, style, nav, footer, header').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
  } catch (e) { return ""; }
}

const feeds = [
  'https://www.pciconcursos.com.br/rss/sudeste/',
  'https://www.pciconcursos.com.br/rss/nacional/',
  'https://www.pciconcursos.com.br/rss/informatica/',
  'https://blog.grancursosonline.com.br/feed/',
  'https://www.estrategiaconcursos.com.br/blog/feed/',
  'https://www.direcaoconcursos.com.br/noticias/feed/',
  'https://jcconcursos.com.br/rss',
  'https://www.novaconcursos.com.br/portal/feed/', 
  'https://folhadirigida.com.br/rss/concursos'    
];

const termosAreaTI = ['ti', 'tecnologia', 'computação', 'informática', 'sistemas', 'dados', 'software', 'desenvolvedor', 'programador', 'analista'];
const indiciosProvaRJ = ['rio de janeiro', ' rj ', 'niterói', 'são gonçalo', 'nacional', 'todas as capitais', 'principais capitais'];

async function monitorarConcursos() {
  await processarComandosTelegram();

  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - (24 * 60 * 60 * 1000));

  for (const feedUrl of feeds) {
    const feed = await parser.parseURL(feedUrl);
    
    for (const item of feed.items) {
      const dataPublicacao = new Date(item.pubDate);
      const titulo = item.title.toLowerCase();

      if (dataPublicacao >= ontem) {
        
        const estaNaWatchlist = db.watchlist.some(termo => titulo.includes(termo));
        if (estaNaWatchlist) {
          const mensagemRadar = `🎯 *RADAR ATIVADO: Movimentação Detectada!*\n\n` +
                                `📌 *Notícia:* ${item.title}\n` +
                                `🔗 [Acessar Notícia Completa](${item.link})`;
          await enviarMensagemTelegram(mensagemRadar);
          continue; 
        }

        const isFeedExclusivoTI = feedUrl.includes('informatica');
        const mencionaAreaTI = termosAreaTI.some(t => titulo.includes(t));

        if (isFeedExclusivoTI || mencionaAreaTI) {
          const textoCompleto = await buscarTextoDaPagina(item.link);
          const textoLower = textoCompleto.toLowerCase();
          const temIndicioProvaRJ = indiciosProvaRJ.some(t => textoLower.includes(t));

          if (temIndicioProvaRJ && textoCompleto.length > 500) {
            const dadosGerais = await extrairDadosComIA(textoCompleto);
            const nomeConcursoLower = dadosGerais.nomeConcurso.toLowerCase();
            const estaNaBlacklist = db.blacklist.some(termo => nomeConcursoLower.includes(termo));

            if (!estaNaBlacklist && dadosGerais.aplicaProvaRJ === true) {
              
              let linkEditalAnterior = dadosGerais.siteUltimoConcurso;
              if (linkEditalAnterior === "Não informado") {
                linkEditalAnterior = await buscarEditalAnteriorNoGoogle(dadosGerais.nomeConcurso);
              }

              const mensagem = `🚨 *Nova Oportunidade (TI): ${dadosGerais.nomeConcurso}*\n\n` +
                               `*Status:* ${dadosGerais.estado}\n` +
                               `*Banca:* ${dadosGerais.banca}\n` +
                               `*Remuneração:* ${dadosGerais.remuneracao}\n` +
                               `*Lotação:* ${dadosGerais.locaisTrabalho}\n` +
                               `*Local de Prova:* ${dadosGerais.locaisProva}\n` +
                               `*Jornada:* ${dadosGerais.modeloTrabalho}\n` +
                               `*Provas:* ${dadosGerais.tipoProva}\n\n` +
                               `*Edital Anterior:* ${linkEditalAnterior}\n\n` +
                               `🔗 [Acessar Notícia Completa](${item.link})`;

              // --- CRIAÇÃO DO BOTÃO INTERATIVO ---
              // Limitamos a string a 40 caracteres porque a API do Telegram 
              // tem limite rígido de 64 bytes para o callback_data
              const termoBotao = nomeConcursoLower.substring(0, 40).trim();
              
              const tecladoInterativo = {
                inline_keyboard: [
                  [
                    { 
                      text: "🚫 Ignorar Próximos (Blacklist)", 
                      callback_data: `add_blk:${termoBotao}` 
                    }
                  ]
                ]
              };

              // Agora passamos o teclado como segundo parâmetro
              await enviarMensagemTelegram(mensagem, tecladoInterativo);
            }
          }
        }
      }
    }
  }
}

monitorarConcursos().catch(console.error);
