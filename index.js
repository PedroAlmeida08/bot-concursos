const Parser = require('rss-parser');
const cheerio = require('cheerio');
const fs = require('fs');

const parser = new Parser();
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;

// --- CONFIGURAÇÃO DA BLACKLIST ---
const BLACKLIST_FILE = 'blacklist.json';

if (!fs.existsSync(BLACKLIST_FILE)) {
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify({ lastUpdateId: 0, termos: [] }));
}
let db = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf-8'));

async function enviarMensagemTelegram(texto) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: texto, parse_mode: 'Markdown' })
  });
}

// --- FUNÇÃO PARA PROCESSAR COMANDOS DO USUÁRIO ---
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

        // Lógica dos Comandos
        if (texto.startsWith('/add_blacklist ')) {
          const termo = texto.replace('/add_blacklist ', '').trim();
          if (!db.termos.includes(termo)) db.termos.push(termo);
          respostas.push(`🚫 '${termo}' foi adicionado à sua blacklist.`);
        } 
        else if (texto.startsWith('/remove_blacklist ')) {
          const termo = texto.replace('/remove_blacklist ', '').trim();
          db.termos = db.termos.filter(t => t !== termo);
          respostas.push(`✅ '${termo}' foi removido da sua blacklist.`);
        } 
        else if (texto === '/blacklist') {
          respostas.push(db.termos.length > 0 ? `📋 *Sua Blacklist:*\n- ${db.termos.join('\n- ')}` : `📋 Sua blacklist está vazia.`);
        } 
        else if (texto === '/reset_blacklist') {
          db.termos = [];
          respostas.push(`♻️ Blacklist zerada com sucesso!`);
        }
      }

      fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(db, null, 2));
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
  const prompt = `
    Analise o texto do concurso abaixo e responda ESTRITAMENTE em formato JSON.
    ATENÇÃO: Diferencie claramente o local onde o aprovado vai TRABALHAR do local onde a PROVA será aplicada.
    
    {
      "nomeConcurso": "Nome do Órgão/Concurso",
      "estado": "Previsto / Inscrições Abertas / etc",
      "remuneracao": "R$ X + Benefícios",
      "locaisTrabalho": "Cidades/Estados onde estão as vagas (Ex: Brasília/DF, Nacional, etc)",
      "locaisProva": "Cidades/Estados onde as provas serão aplicadas",
      "aplicaProvaRJ": true, // Retorne o booleano TRUE se a prova for aplicada no estado do RJ (Rio, Niterói, etc) ou se for prova Nacional em todas as capitais. Caso contrário, FALSE.
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
  } catch (e) {
    return "";
  }
}

// --- VARIÁVEIS DE MONITORAMENTO ---
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

// --- LOOP PRINCIPAL ---
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
        const isFeedExclusivoTI = feedUrl.includes('informatica');
        const mencionaAreaTI = termosAreaTI.some(t => titulo.includes(t));

        if (isFeedExclusivoTI || mencionaAreaTI) {
          const textoCompleto = await buscarTextoDaPagina(item.link);
          const textoLower = textoCompleto.toLowerCase();
          const temIndicioProvaRJ = indiciosProvaRJ.some(t => textoLower.includes(t));

          if (temIndicioProvaRJ && textoCompleto.length > 500) {
            const dadosGerais = await extrairDadosComIA(textoCompleto);
            const nomeConcursoLower = dadosGerais.nomeConcurso.toLowerCase();
            
            const estaNaBlacklist = db.termos.some(termo => nomeConcursoLower.includes(termo));

            if (!estaNaBlacklist && dadosGerais.aplicaProvaRJ === true) {
              
              let linkEditalAnterior = dadosGerais.siteUltimoConcurso;
              if (linkEditalAnterior === "Não informado") {
                linkEditalAnterior = await buscarEditalAnteriorNoGoogle(dadosGerais.nomeConcurso);
              }

              const mensagem = `🚨 *Nova Oportunidade: ${dadosGerais.nomeConcurso}*\n\n` +
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
  }
}

monitorarConcursos().catch(console.error);
