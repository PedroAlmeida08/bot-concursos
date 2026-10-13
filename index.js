const Parser = require('rss-parser');
const cheerio = require('cheerio');

const parser = new Parser();
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;

const feeds = [
  'https://www.pciconcursos.com.br/rss/sudeste/',
  'https://www.pciconcursos.com.br/rss/nacional/', // Adicionado o Nacional para não perder vagas federais
  'https://www.pciconcursos.com.br/rss/informatica/',
  'https://blog.grancursosonline.com.br/feed/',
  'https://www.estrategiaconcursos.com.br/blog/feed/',
  'https://www.direcaoconcursos.com.br/noticias/feed/',
  'https://jcconcursos.com.br/rss'
];

// O filtro principal agora é focado estritamente na CARREIRA
const termosAreaTI = [
  'ti', 'tecnologia', 'computação', 'informática', 
  'sistemas', 'dados', 'software', 'desenvolvedor', 
  'programador', 'analista'
];

// Termos para fazer um pré-filtro no texto antes de gastar a API do Gemini
const indiciosProvaRJ = [
  'rio de janeiro', ' rj ', 'niterói', 'são gonçalo', 
  'nacional', 'todas as capitais', 'principais capitais'
];

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

async function monitorarConcursos() {
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

        // Se a vaga for de TI, avançamos para investigar o local
        if (isFeedExclusivoTI || mencionaAreaTI) {
          console.log(`Verificando texto de: ${item.title}`);
          
          const textoCompleto = await buscarTextoDaPagina(item.link);
          const textoLower = textoCompleto.toLowerCase();
          
          // Pré-filtro: O texto fala de RJ ou provas nacionais?
          const temIndicioProvaRJ = indiciosProvaRJ.some(t => textoLower.includes(t));

          if (temIndicioProvaRJ && textoCompleto.length > 500) {
            console.log(`Enviando para a IA analisar os locais de prova: ${item.title}`);
            const dadosGerais = await extrairDadosComIA(textoCompleto);
            
            // O FILTRO FINAL: A IA confirmou que a prova pode ser feita no RJ?
            if (dadosGerais.aplicaProvaRJ === true) {
              
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

              await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: CHAT_ID,
                  text: mensagem,
                  parse_mode: 'Markdown'
                })
              });
            } else {
              console.log(`Descartado: Vaga de TI, mas a prova NÃO é no RJ. (${item.title})`);
            }
          }
        }
      }
    }
  }
}

monitorarConcursos().catch(console.error);