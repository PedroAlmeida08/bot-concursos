# 🚨 Monitor Inteligente de Concursos (TI & RJ)

Um agente autônomo desenvolvido em Node.js que monitora diariamente os principais portais de concursos públicos do Brasil. Ele foca em vagas de Tecnologia da Informação (TI) com lotação de trabalho ou aplicação de provas no estado do Rio de Janeiro (ou certames nacionais).

O projeto utiliza inteligência artificial para ler as notícias e editais, estruturar as informações cruciais e enviar alertas formatados diretamente para o seu celular via Telegram.

## ✨ Arquitetura e Funcionalidades

1. **Coleta (Web Scraping & RSS):** Monitora feeds diários de portais como Gran Cursos Online, Estratégia Concursos, Nova Concursos, Concursos no Brasil, Notícias Concursos e AlfaCon usando `rss-parser`. Extrai o conteúdo completo com `cheerio`.
2. **Processamento com IA:** Envia o texto da notícia para a API do **Google Gemini (Flash)**, que analisa o edital e extrai dados estruturados (Remuneração, Banca, Status, Lotação, Local de Prova e Tipo de Prova).
3. **Busca Ativa (Fallback):** Caso a notícia não informe o link do último edital ou o site da banca, o script aciona a **Google Custom Search API** para localizar o edital anterior na internet.
4. **Radar de Órgãos (Watchlist):** Órgãos cadastrados no Radar possuem prioridade total (notificação imediata ao detectar movimentação, dispensando filtros de TI).
5. **Deduplicação Inteligente:** Mantém histórico dos links já processados no `database.json`, evitando notificações repetidas e economizando cota de IA caso o workflow seja executado múltiplas vezes.
6. **Notificação Resiliente:** Dispara mensagens formatadas via **Telegram Bot API**, com fallback automático para texto sem marcação caso haja caracteres especiais.
7. **Automação:** Roda de forma 100% gratuita na nuvem usando **GitHub Actions**, agendado para executar todos os dias às 8h da manhã (BRT).

## 🚀 Tecnologias Utilizadas

* Node.js (v20+)
* GitHub Actions (CI/CD & Cron Jobs)
* Google Gemini API (LLM)
* Google Custom Search API (Web Search)
* Telegram Bot API
* `cheerio` & `rss-parser`

## ⚙️ Como Configurar

Para rodar este projeto no seu próprio repositório, configure 5 *Secrets* no GitHub (`Settings > Secrets and variables > Actions > New repository secret`):

* `TELEGRAM_TOKEN`: O token HTTP API gerado pelo @BotFather no Telegram.
* `TELEGRAM_CHAT_ID`: O seu ID de usuário numérico do Telegram (obtido via @userinfobot).
* `GEMINI_API_KEY`: Chave de API do Google AI Studio.
* `GOOGLE_SEARCH_API_KEY`: Chave de API gerada no Google Cloud Console (Custom Search API).
* `GOOGLE_SEARCH_CX`: ID do Mecanismo de Pesquisa gerado no Programmable Search Engine.

## 💻 Testando Localmente

Se desejar rodar o script no seu próprio computador antes de enviar para o GitHub:

1. Clone o repositório: `git clone <seu-repositorio>`
2. Instale as dependências: `npm install`
3. Crie um arquivo `.env` na raiz do projeto contendo as 5 variáveis acima. O Node.js 20+ carrega o `.env` nativamente.
4. Execute o bot: `node index.js`

## 📱 Comandos via Telegram

Você pode interagir diretamente com o bot no Telegram para gerenciar órgãos de interesse ou bloquear certames indesejados:

### 📡 Radar (Watchlist)
Órgãos no Radar recebem alerta imediato sobre qualquer novidade, independentemente dos filtros padrão de TI:
* `/add_watchlist <termo>`: Adiciona um órgão de interesse (ex: `/add_watchlist bndes`, `/add_watchlist petrobras`).
* `/remove_watchlist <termo>`: Remove um órgão do Radar.
* `/watchlist`: Exibe todos os órgãos atualmente monitorados no Radar.
* `/reset_watchlist`: Limpa todo o Radar.

### 🚫 Blacklist (Bloqueios)
Ignora órgãos indesejados mesmo que contenham vagas de TI:
* `/add_blacklist <termo>`: Bloqueia notificações de um órgão (ex: `/add_blacklist prefeitura`).
* `/remove_blacklist <termo>`: Remove um termo da Blacklist.
* `/blacklist`: Exibe a lista de bloqueios ativa.
* `/reset_blacklist`: Limpa toda a Blacklist.

### ℹ️ Ajuda
* `/ajuda` ou `/help`: Exibe o menu com todos os comandos disponíveis.

## ⏱️ Execução Automática

A automação está configurada no arquivo `.github/workflows/monitor.yml`:
* **Automática:** O script roda todos os dias às 8h BRT (`0 11 * * *` UTC).
* **Manual:** Na aba *Actions* do GitHub, selecione o *Workflow* "Monitor de Concursos" e clique em **Run workflow** para disparar uma execução imediata.
