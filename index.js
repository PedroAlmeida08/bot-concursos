if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch (e) { /* Arquivo .env opcional para execução local */ }
}

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- CONFIGURAÇÃO DO BANCO DE DADOS LOCAL ---
const DB_FILE = 'database.json';

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ 
    lastUpdateId: 0, 
    blacklist: [], 
    watchlist: ["bndes", "epe"],
    notifiedLinks: []
  }, null, 2));
}

let db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));

if (!db.blacklist) db.blacklist = db.termos || [];
if (!db.watchlist) db.watchlist = ["bndes", "epe"];
if (!db.notifiedLinks) db.notifiedLinks = [];

function salvarDatabase() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function registrarLink(link) {
  if (!link) return;
  if (!db.notifiedLinks.includes(link)) {
    db.notifiedLinks.push(link);
    // Limita o histórico aos últimos 500 links para não inflar o arquivo
    if (db.notifiedLinks.length > 500) {
      db.notifiedLinks = db.notifiedLinks.slice(-500);
    }
    salvarDatabase();
  }
}

async function enviarMensagemTelegram(texto, chatIdPersonalizado = null) {
  const targetChatId = chatIdPersonalizado || CHAT_ID;
  if (!TELEGRAM_TOKEN || !targetChatId) {
    console.warn("TELEGRAM_TOKEN ou CHAT_ID não definidos.");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: targetChatId, text: texto, parse_mode: 'Markdown' })
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn("Aviso na API do Telegram (tentando sem formatação):", data.description);
      // Fallback sem formatação Markdown caso caracteres especiais causem erro de parse
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text: texto.replace(/[*_`\[\]]/g, '') })
      });
    }
  } catch (err) {
    console.error("Erro ao enviar mensagem Telegram:", err.message);
  }

  await sleep(600); // Pausa para respeitar o rate limit do Telegram
}

// --- PROCESSAMENTO DE COMANDOS DO TELEGRAM ---
async function processarComandosTelegram() {
  if (!TELEGRAM_TOKEN) return;
  console.log("Checando novos comandos no Telegram...");
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${db.lastUpdateId + 1}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        db.lastUpdateId = update.update_id; 
        
        if (!update.message || !update.message.text) continue;
        const chatOrigem = update.message.chat.id;
        const textoOriginal = update.message.text.trim();
        const partes = textoOriginal.split(/\s+/);
        // Normaliza o comando removendo @nomedobot caso venha do menu ou de grupo (ex: /start@meu_bot -> /start)
        const comando = partes[0].toLowerCase().split('@')[0];
        const argumento = partes.slice(1).join(' ').trim();
        const argumentoLower = argumento.toLowerCase();

        let resposta = null;

        // Ajuda e Boas-Vindas
        if (comando === '/start' || comando === '/help' || comando === '/ajuda') {
          resposta = 
            `🤖 *Comandos do Monitor de Concursos:*\n\n` +
            `*Radar (Watchlist):*\n` +
            `• \`/add_watchlist <termo>\` - Notifica sobre qualquer notícia do órgão\n` +
            `• \`/remove_watchlist <termo>\` - Remove termo do Radar\n` +
            `• \`/watchlist\` - Lista termos no Radar\n` +
            `• \`/reset_watchlist\` - Zera o Radar\n\n` +
            `*Bloqueios (Blacklist):*\n` +
            `• \`/add_blacklist <termo>\` - Ignora concursos deste órgão\n` +
            `• \`/remove_blacklist <termo>\` - Remove da Blacklist\n` +
            `• \`/blacklist\` - Lista termos bloqueados\n` +
            `• \`/reset_blacklist\` - Zera a Blacklist`;
        }

        // Comandos da Blacklist
        else if (comando === '/add_blacklist') {
          if (!argumentoLower) {
            resposta = `⚠️ Informe o termo a bloquear. Exemplo: \`/add_blacklist prefeitura\``;
          } else {
            if (!db.blacklist.includes(argumentoLower)) db.blacklist.push(argumentoLower);
            resposta = `🚫 '${argumentoLower}' adicionado à Blacklist.`;
          }
        } 
        else if (comando === '/remove_blacklist') {
          if (!argumentoLower) {
            resposta = `⚠️ Informe o termo a remover. Exemplo: \`/remove_blacklist prefeitura\``;
          } else {
            db.blacklist = db.blacklist.filter(t => t !== argumentoLower);
            resposta = `✅ '${argumentoLower}' removido da Blacklist.`;
          }
        } 
        else if (comando === '/blacklist') {
          resposta = db.blacklist.length > 0 
            ? `📋 *Blacklist:*\n- ${db.blacklist.join('\n- ')}` 
            : `📋 Blacklist vazia.`;
        } 
        else if (comando === '/reset_blacklist') {
          db.blacklist = [];
          resposta = `♻️ Blacklist zerada!`;
        }
        
        // Comandos da Watchlist
        else if (comando === '/add_watchlist') {
          if (!argumentoLower) {
            resposta = `⚠️ Informe o órgão para o Radar. Exemplo: \`/add_watchlist bndes\``;
          } else {
            if (!db.watchlist.includes(argumentoLower)) db.watchlist.push(argumentoLower);
            resposta = `🎯 '${argumentoLower}' adicionado à Watchlist.`;
          }
        } 
        else if (comando === '/remove_watchlist') {
          if (!argumentoLower) {
            resposta = `⚠️ Informe o termo a remover. Exemplo: \`/remove_watchlist bndes\``;
          } else {
            db.watchlist = db.watchlist.filter(t => t !== argumentoLower);
            resposta = `✅ '${argumentoLower}' removido da Watchlist.`;
          }
        } 
        else if (comando === '/watchlist') {
          resposta = db.watchlist.length > 0 
            ? `📡 *Radar (Watchlist):*\n- ${db.watchlist.join('\n- ')}` 
            : `📡 Watchlist vazia.`;
        } 
        else if (comando === '/reset_watchlist') {
          db.watchlist = [];
          resposta = `♻️ Watchlist zerada!`;
        }

        if (resposta) {
          await enviarMensagemTelegram(resposta, chatOrigem);
        }
      }

      salvarDatabase();
    }
  } catch (error) {
    console.error("Erro ao ler comandos do Telegram:", error);
  }
}

// --- FUNÇÕES DE BUSCA E IA ---
async function buscarEditalAnteriorNoGoogle(nomeConcurso) {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_CX) {
    return "Não configurado na busca automática.";
  }
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
  if (!GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY não definida.");
    return null;
  }

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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" } 
      })
    });

    const data = await response.json();
    const textoJson = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
    if (textoJson) {
      return JSON.parse(textoJson);
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
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header').remove();
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
  'https://blog.alfaconcursos.com.br/feed/'
];

const termosAreaTI = ['ti', 'tecnologia', 'computação', 'informática', 'sistemas', 'dados', 'software', 'desenvolvedor', 'programador', 'analista'];
const indiciosProvaRJ = ['rio de janeiro', ' rj ', 'niterói', 'são gonçalo', 'nacional', 'todas as capitais', 'principais capitais'];

function validarConfiguracoes() {
  const faltantes = [];
  if (!TELEGRAM_TOKEN) faltantes.push('TELEGRAM_TOKEN');
  if (!CHAT_ID) faltantes.push('TELEGRAM_CHAT_ID');
  if (!GEMINI_API_KEY) faltantes.push('GEMINI_API_KEY');
  if (!GOOGLE_SEARCH_API_KEY) faltantes.push('GOOGLE_SEARCH_API_KEY');
  if (!GOOGLE_SEARCH_CX) faltantes.push('GOOGLE_SEARCH_CX');

  if (faltantes.length > 0) {
    console.warn(`\n⚠️ ATENÇÃO: As seguintes Secrets estão vazias no GitHub Actions:\n- ${faltantes.join('\n- ')}\nCertifique-se de adicioná-las em: Settings > Secrets and variables > Actions > Repository secrets no GitHub.\n`);
  }
}

// --- LOOP PRINCIPAL ---
async function monitorarConcursos() {
  validarConfiguracoes();
  await processarComandosTelegram();

  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - (24 * 60 * 60 * 1000));

  for (const feedUrl of feeds) {
    try {
      console.log(`Verificando feed: ${feedUrl}`);
      const feed = await parser.parseURL(feedUrl);
      
      for (const item of feed.items) {
        if (!item.link) continue;

        // Evita processar novamente notícias já notificadas ou analisadas
        if (db.notifiedLinks.includes(item.link)) {
          continue;
        }

        const dataPublicacao = new Date(item.pubDate);
        const dataValida = !isNaN(dataPublicacao.getTime());
        if (dataValida && dataPublicacao < ontem) {
          continue;
        }

        const textoItem = `${item.title || ''} ${item.contentSnippet || ''}`.toLowerCase();

        // 1. VERIFICAÇÃO DE WATCHLIST (Passe Livre)
        const estaNaWatchlist = db.watchlist.some(termo => textoItem.includes(termo));
        
        if (estaNaWatchlist) {
          console.log(`Radar ativado para: ${item.title}`);
          const mensagemRadar = `🎯 *RADAR ATIVADO: Movimentação Detectada!*\n\n` +
                                `📌 *Notícia:* ${item.title}\n` +
                                `🔗 [Acessar Notícia Completa](${item.link})`;
          await enviarMensagemTelegram(mensagemRadar);
          registrarLink(item.link);
          continue;
        }

        // 2. VERIFICAÇÃO PADRÃO (TI + RJ)
        const isFeedExclusivoTI = feedUrl.includes('informatica');
        const mencionaAreaTI = termosAreaTI.some(t => textoItem.includes(t));

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
              registrarLink(item.link);
            } else {
              // Registra link descartado para não chamar scraping e IA novamente no mesmo dia
              registrarLink(item.link);
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
