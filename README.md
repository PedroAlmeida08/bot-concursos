# 🚨 Monitor Inteligente de Concursos (TI & RJ)

Um agente autônomo desenvolvido em Node.js que monitora diariamente os principais portais de concursos públicos do Brasil. Ele foca em vagas de Tecnologia da Informação (TI) com lotação de prova no estado do Rio de Janeiro.

O projeto utiliza inteligência artificial para ler os editais, estruturar as informações cruciais e enviar alertas formatados diretamente para o seu celular via Telegram.

## ✨ Arquitetura e Funcionalidades

1. **Coleta (Web Scraping & RSS):** Lê os feeds diários do PCI Concursos, Gran Cursos, Estratégia, Direção e QConcursos usando `rss-parser` e extrai o texto completo das notícias com `cheerio`.
2. **Processamento com IA:** Envia o texto da notícia para a API do **Google Gemini (Flash)**, que lê o conteúdo e extrai informações estruturadas (Remuneração, Banca, Status, Locais de trabalho e Tipo de prova).
3. **Busca Ativa (Fallback):** Caso a notícia não informe o link do último edital ou o site da banca, o script aciona a **Google Custom Search API** para buscar automaticamente o edital anterior na internet.
4. **Notificação:** Formata os dados e dispara uma mensagem via **Telegram Bot API**.
5. **Automação:** Roda de forma 100% gratuita na nuvem usando **GitHub Actions**, agendado para executar todos os dias às 8h da manhã.

## 🚀 Tecnologias Utilizadas

* Node.js (v20)
* GitHub Actions (CI/CD & Cron Jobs)
* Google Gemini API (LLM)
* Google Custom Search API (Web Search)
* Telegram Bot API
* `cheerio` & `rss-parser`

## ⚙️ Como Configurar

Para rodar este projeto no seu próprio repositório, você precisará configurar 5 *Secrets* no GitHub (`Settings > Secrets and variables > Actions > New repository secret`):

* `TELEGRAM_TOKEN`: O token HTTP API gerado pelo @BotFather no Telegram.
* `TELEGRAM_CHAT_ID`: O seu ID de usuário numérico do Telegram (obtido via @userinfobot).
* `GEMINI_API_KEY`: Chave de API do Google AI Studio.
* `GOOGLE_SEARCH_API_KEY`: Chave de API gerada no Google Cloud Console (Custom Search API).
* `GOOGLE_SEARCH_CX`: ID do Mecanismo de Pesquisa gerado no Programmable Search Engine.

## 💻 Testando Localmente

Se desejar rodar o script no seu próprio computador antes de enviar para o GitHub:

1. Clone o repositório: `git clone <seu-repositorio>`
2. Instale as dependências: `npm install`
3. Crie um arquivo `.env` na raiz do projeto contendo as 5 variáveis acima.
4. (Opcional) Instale o dotenv para ler o arquivo local: `npm install dotenv` e adicione `require('dotenv').config();` na primeira linha do seu `index.js`.
5. Execute o bot: `node index.js`

## ⏱️ Execução Automática

A automação já está configurada no arquivo `.github/workflows/monitor.yml`. 
* **Automática:** O script rodará todos os dias automaticamente.
* **Manual:** Você pode ir na aba *Actions* do GitHub, selecionar o *Workflow* "Monitor de Concursos" e clicar em **Run workflow** para forçar uma execução imediata.