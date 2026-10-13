# Monitor de Concursos - Telegram Bot

Agente automatizado que monitora diariamente feeds RSS de portais de concursos públicos, filtra vagas na área de Tecnologia da Informação (TI) com provas no estado do Rio de Janeiro (ou aplicação nacional) e envia notificações estruturadas via Telegram.

## Arquitetura e Tecnologias
* **Node.js**: Script principal de raspagem e orquestração.
* **GitHub Actions**: Automação da execução diária (cron job) e persistência de dados.
* **RSS Parser & Cheerio**: Leitura de feeds e extração de texto HTML.
* **Google Gemini API**: Inteligência Artificial para interpretar os textos das notícias e extrair metadados (remuneração, lotação e confirmação do local de prova).
* **Google Custom Search API**: Busca automatizada do edital anterior nos acervos das bancas quando a informação está ausente na notícia.

## Configuração do Ambiente
Para rodar este projeto, adicione as seguintes chaves em **Settings > Secrets and variables > Actions** no seu repositório:
* `TELEGRAM_TOKEN`: Token do seu bot gerado no BotFather.
* `TELEGRAM_CHAT_ID`: Seu ID numérico de usuário no Telegram.
* `GEMINI_API_KEY`: Chave da API do Google AI Studio.
* `GOOGLE_SEARCH_API_KEY`: Chave da Custom Search API no Google Cloud Console.
* `GOOGLE_SEARCH_CX`: ID do mecanismo de pesquisa programável do Google.

O workflow do GitHub Actions já está configurado com `permissions: contents: write` para permitir que o bot faça commits automáticos atualizando o estado da blacklist.

## Sistema de Blacklist (Comandos via Telegram)
O bot possui uma lista de bloqueios gerenciada diretamente pelo chat do Telegram para evitar notificações indesejadas de órgãos específicos. Os comandos enviados são processados assim que o script roda, salvando as alterações no arquivo `blacklist.json`.

Envie as seguintes mensagens para o seu bot:
* `/add_blacklist <termo>`: Adiciona uma palavra à lista de bloqueios (ex: `/add_blacklist prefeitura`).
* `/remove_blacklist <termo>`: Remove um termo previamente bloqueado.
* `/blacklist`: Exibe todos os itens que estão atualmente bloqueados.
* `/reset_blacklist`: Limpa toda a lista e volta a notificar sobre todos os órgãos aprovados nos filtros.

## Execução
O sistema roda de forma autônoma todos os dias às 08:00 (BRT). Para testar o envio de mensagens ou forçar o processamento imediato de comandos da blacklist, acesse a aba **Actions** no repositório e clique no botão **Run workflow**.
