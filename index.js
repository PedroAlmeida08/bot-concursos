const Parser = require('rss-parser');
const cheerio = require('cheerio');
const fs = require('fs');

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;

// --- CONFIGURAÇÃO DO BANCO DE DADOS LOCAL ---
const DB_FILE = 'database.json';

if (!fs.existsSync(DB_FILE)) {
  // Inicializado com órgãos de interesse como exemplo de watchlist padrão
  fs.writeFileSync(DB_FILE, JSON.stringify({ 
    lastUpdateId: 0, 
    blacklist: [], 
    watchlist: ["bndes", "epe"] 
  }));
}
let db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));

// Garante compatibilidade caso o arquivo antigo (só com blacklist) ainda exista
if (!db.blacklist) db.blacklist = db.termos || [];
if (!db.watchlist) db.watchlist = ["bndes", "epe"];

async function enviarMensagemTelegram(texto) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: texto, parse_mode: 'Markdown' })
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Erro na API do Telegram:", data.description);
    }
  } catch (err) {
    console.error("Erro ao enviar mensagem Telegram:", err.message);
  }
}

// --- PROCESSAMENTO DE COMANDOS DO TELEGRAM ---
async function processarComandosTelegram() {
  console.log("Checando novos comandos no Telegram...");
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${db.lastUpdateId + 1}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    let respostas = [];

    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        db.lastUpdateId = update.update_id; 
        
        if (!update.message || !update.message.text) continue;
        const texto = update.message.text.trim().toLowerCase();

        // Comandos da Blacklist
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
        
        // Comandos da Watchlist
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
    console.error("Erro ao ler comandos do Telegram:", error);
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
  } catch (error) {
    return "Erro na busca.";
  }
}

async function extrairDadosComIA(textoPagina) {
  try {
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
    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      return JSON.parse(data.candidates[0].content.parts[0].text);
    }
    console.error("Resposta inesperada do Gemini:", JSON.stringify(data));
    return null;
  } catch (error) {
    console.error("Erro na extração com IA:", error.message);
    return null;
  }
}

async function buscarTextoDaPagina(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $= cheerio.load(html);$('script, style, nav, footer, header').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
  } catch (e) {
    return "";
  }
}

// --- VARIÁVEIS DE MONITORAMENTO ---
const feeds = [
  'https://blog.grancursosonline.com.br/feed/',
  'https://www.estrategiaconcursos.com.br/blog/feed/',
  'https://www.novaconcursos.com.br/portal/feed/',
  'https://concursosnobrasil.com/feed/',
  'https://noticiasconcursos.com.br/feed/',
  'https://blog.alfaconcursos.com.br/feed/'
];

const termosAreaTI = ['ti', 'tecnologia', 'computação', 'informática', 'sistemas', 'dados', 'software', 'desenvolvedor', 'programador', 'analista'];
const indiciosProvaRJ = ['rio de janeiro', ' rj ', 'niterói', 'são gonçalo', 'nacional', 'todas as capitais', 'principais capitais'];

// --- LOOP PRINCIPAL ---
async function monitorarConcursos() {
  await processarComandosTelegram();

  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - (24 * 60 * 60 * 1000));

  for (const feedUrl of feeds) {
    try {
      console.log(`Verificando feed: ${feedUrl}`);
      const feed = await parser.parseURL(feedUrl);
      
      for (const item of feed.items) {
        const dataPublicacao = new Date(item.pubDate);
        const titulo = item.title.toLowerCase();

        if (dataPublicacao >= ontem) {
          
          // 1. VERIFICAÇÃO DE WATCHLIST (Passe Livre)
          const estaNaWatchlist = db.watchlist.some(termo => titulo.includes(termo));
          
          if (estaNaWatchlist) {
            console.log(`Radar ativado para: ${item.title}`);
            const mensagemRadar = `🎯 *RADAR ATIVADO: Movimentação Detectada!*\n\n` +
                                  `📌 *Notícia:* ${item.title}\n` +
                                  `🔗 [Acessar Notícia Completa](${item.link})`;
            await enviarMensagemTelegram(mensagemRadar);
            continue; // Pula a análise de TI e IA para esta notícia
          }

          // 2. VERIFICAÇÃO PADRÃO (TI + RJ)
          const isFeedExclusivoTI = feedUrl.includes('informatica');
          const mencionaAreaTI = termosAreaTI.some(t => titulo.includes(t));

          if (isFeedExclusivoTI || mencionaAreaTI) {
            const textoCompleto = await buscarTextoDaPagina(item.link);
            const textoLower = textoCompleto.toLowerCase();
            const temIndicioProvaRJ = indiciosProvaRJ.some(t => textoLower.includes(t));

            if (temIndicioProvaRJ && textoCompleto.length > 500) {
              const dadosGerais = await extrairDadosComIA(textoCompleto);
              if (!dadosGerais || !dadosGerais.nomeConcurso) continue;

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
                                 `*Lotação (Trabalho):* ${dadosGerais.locaisTrabalho}\n` +
                                 `*Local de Prova:* ${dadosGerais.locaisProva}\n` +
                                 `*Jornada:* ${dadosGerais.modeloTrabalho}\n` +
                                 `*Provas:* ${dadosGerais.tipoProva}\n\n` +
                                 `*Edital Anterior:* ${linkEditalAnterior}\n\n` +
                                 `🔗 [Acessar Notícia Completa](${item.link})`;

                await enviarMensagemTelegram(mensagem);
              }
            }
          }
        }
      }
    } catch (feedError) {
      console.error(`Erro ao carregar feed (${feedUrl}):`, feedError.message);
    }
  }
}

monitorarConcursos().catch(console.error);
