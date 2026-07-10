# youtube-mcp — contexto para o Claude

Servidor MCP local (Node.js >= 18, transporte stdio) com 4 tools de YouTube, todas em `index.js`:

- `youtube_transcript` — legendas via yt-dlp (formato json3, fallback pt → en → automática). Requer yt-dlp.
- `youtube_info` — metadados via youtubei.js (título, canal, duração, legendas disponíveis). Sem dependência extra.
- `youtube_vision` — baixa o vídeo com yt-dlp, envia para a Google File API e analisa com Gemini. Requer yt-dlp + `GEMINI_API_KEY`.
- `youtube_whisper` — baixa o áudio com yt-dlp e transcreve localmente com OpenAI Whisper. Requer yt-dlp + `openai-whisper` (pip) + FFmpeg.

Fatos importantes do código:

- A única env var é `GEMINI_API_KEY`, usada só pela `youtube_vision`. O servidor lê `process.env` — ele **não carrega o `.env` sozinho** (não há dotenv). A chave precisa ir no registro do MCP (bloco `env` / flag `-e`); o `.env` (gitignored) serve como cofre local.
- O yt-dlp é detectado como `python3 -m yt_dlp` ou binário `yt-dlp` no PATH; no Windows, o comando Python costuma ser `python`, então o que vale é o binário `yt-dlp` funcionar.
- Arquivos temporários vão para o diretório temp do sistema e são apagados ao final de cada tool.

## Onboarding assistido (instruções para o Claude)

Se você abrir este repositório e o servidor ainda não estiver configurado (verifique com `claude mcp list` — sem entrada `youtube`/`youtube-mcp`), **ofereça ativamente**: "Quer que eu configure o youtube-mcp pra você agora? Eu instalo o que faltar, crio a chave do Gemini com você no navegador e valido tudo com um vídeo real."

### Protocolo

1. **Pré-requisitos, nesta ordem** — mostre o resultado de cada checagem e confirme com o usuário antes de instalar qualquer software novo:
   - Node.js 18+ (`node --version`) e `npm install` na raiz do repo.
   - yt-dlp: teste `yt-dlp --version`, `python3 -m yt_dlp --version` e, no Windows, `python -m yt_dlp --version`. Se faltar, instale (`python -m pip install yt-dlp`, ou winget/brew/apt) e garanta que `yt-dlp --version` funciona no PATH.
2. **Tools opcionais** — pergunte com AskUserQuestion quais o usuário quer ativar:
   - `youtube_whisper`: exige `pip install openai-whisper` + FFmpeg (`ffmpeg -version`; instalar via winget/brew/apt se faltar). 100% local, sem chave.
   - `youtube_vision`: exige `GEMINI_API_KEY` (etapa de navegador abaixo).
3. **Etapas de navegador** — para CADA etapa de navegador, SEMPRE pergunte antes com AskUserQuestion: "Essa etapa é no navegador. Quer que eu faça pra você?" com três rotas:
   - **Default — Playwright MCP**: se não estiver disponível, adicione com `claude mcp add playwright -- npx -y @playwright/mcp@latest`. Você navega, o usuário faz o login sozinho na janela aberta.
   - **Alternativa — Claude in Chrome**: se o usuário já usa a extensão, use o Chrome logado dele.
   - **Manual**: passo a passo por escrito, com o usuário colando o resultado em arquivo local (nunca no chat).
   - Em qualquer rota: NUNCA peça senha, código 2FA ou o valor da chave no chat.
4. **Registro no Claude Code** — com caminho absoluto do repo:
   - Com vision: `claude mcp add --scope user youtube -e GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-)" -- node <caminho-absoluto>/index.js` (lê a chave do `.env` sem ecoar o valor).
   - Sem vision: `claude mcp add --scope user youtube -- node <caminho-absoluto>/index.js`.
5. **Validação real antes de concluir** — teste com um vídeo público curto do YouTube: `youtube_info` (deve voltar título e canal), `youtube_transcript` (deve voltar texto), `youtube_whisper` com `model: tiny` (se ativada), `youtube_vision` com prompt curto (se ativada). Se a sessão não enxergar as tools recém-registradas, peça para o usuário reiniciar o Claude Code e continue depois. Falhou = diagnosticar e corrigir antes do resumo final.
6. **Segredos** — a chave só existe no `.env` local (gitignored) e no registro do MCP. Nunca no chat, nunca em log, nunca em commit, nunca ecoada em comando.
7. **Resumo final** — o que foi instalado, o que ficou configurado, quais tools estão ativas e 2 exemplos de uso.

### Etapas de navegador deste projeto

- **GEMINI_API_KEY (Google AI Studio)** — necessária SÓ para `youtube_vision`:
  1. Abrir `https://aistudio.google.com/apikey` (login com a conta Google do usuário; não precisa de cartão de crédito).
  2. Aceitar os termos se for o primeiro acesso.
  3. Clicar em "Criar chave de API" / "Create API key" (criar/escolher projeto se o Google pedir).
  4. Copiar a chave exibida e gravar em `.env` na raiz do repo (`GEMINI_API_KEY=...`), sem exibir o valor na conversa.
  5. Registrar o MCP lendo a chave do `.env` (comando do item 4 do protocolo).
  - Observação: este projeto **não** usa a YouTube Data API v3 — não é preciso Google Cloud Console, ativação de API nem billing.

### Fora do escopo do onboarding

- Não alterar `index.js`, `package.json`, versão ou criar CI.
- Não commitar `.env` (já está no `.gitignore`).
- Não publicar a chave em lugar nenhum.
