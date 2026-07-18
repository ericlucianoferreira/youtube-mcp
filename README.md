# youtube-mcp

MCP local para extrair transcrições e análise de vídeos do YouTube.

**[→ Como funciona o YouTube MCP](https://ericlucianoferreira.github.io/youtube-mcp/)** — a página do projeto, com o sistema explicado visualmente.

Open source, criado por **Eric Luciano** na **Mentoria Automações Inteligentes** (Expert Integrado).

## Tools disponíveis

| Tool | Método | Dependências |
| --- | --- | --- |
| `youtube_transcript` | Legendas via yt-dlp (formato json3) | yt-dlp |
| `youtube_info` | Metadata via youtubei.js | Nenhuma extra |
| `youtube_vision` | Análise visual via Google Gemini | yt-dlp + `GEMINI_API_KEY` |
| `youtube_whisper` | Transcrição local via Whisper | yt-dlp + openai-whisper + FFmpeg |

Só a `youtube_vision` precisa de chave de API (criada de graça no [Google AI Studio](https://aistudio.google.com/apikey), sem cartão de crédito). As outras três funcionam sem chave nenhuma.

## Instalação assistida (recomendada)

Pré-requisitos mínimos: [Node.js 18+](https://nodejs.org) e [Claude Code](https://claude.com/claude-code). O resto (yt-dlp, Whisper, FFmpeg, chave do Gemini) o próprio Claude instala e configura com você.

1. Clone o repositório e abra o Claude Code na pasta:

```bash
git clone https://github.com/ericlucianoferreira/youtube-mcp.git
cd youtube-mcp
claude
```

2. Cole o prompt abaixo e responda aos botões:

```text
Configure o youtube-mcp (o servidor MCP desta pasta) de ponta a ponta pra mim, seguindo exatamente este roteiro:

1. PRÉ-REQUISITOS — verifique um a um, me mostrando o resultado, e instale o que faltar (confirmando comigo antes de instalar qualquer software novo):
   - Node.js 18+ (node --version) e depois npm install nesta pasta.
   - yt-dlp: teste "yt-dlp --version" e "python3 -m yt_dlp --version" (no Windows, também "python -m yt_dlp --version"). Se nenhum funcionar, instale com "python -m pip install yt-dlp" (ou winget/brew/apt) e garanta que o comando yt-dlp funciona no PATH. É obrigatório para youtube_transcript, youtube_vision e youtube_whisper.
   - Pergunte-me com AskUserQuestion quais tools opcionais eu quero ativar:
     (a) youtube_whisper (transcrição offline, sem chave) — exige "pip install openai-whisper" + FFmpeg ("ffmpeg -version"; se faltar: winget install ffmpeg / brew install ffmpeg / apt install ffmpeg);
     (b) youtube_vision (análise visual com Gemini) — exige uma GEMINI_API_KEY.

2. CHAVE DO GEMINI (só se eu ativei a youtube_vision) — a chave é criada no navegador, em https://aistudio.google.com/apikey (Google AI Studio; basta conta Google, sem cartão de crédito). Essa etapa é no navegador, então pergunte-me com AskUserQuestion: "Essa etapa é no navegador. Quer que eu faça pra você?" com estas opções:
   - "Sim, faz pra mim" (DEFAULT, via Playwright MCP): se o Playwright MCP não estiver disponível, adicione com "claude mcp add playwright -- npx -y @playwright/mcp@latest" e me avise se precisar reiniciar a sessão. Abra https://aistudio.google.com/apikey, espere EU fazer o login na janela (NUNCA peça senha nem código no chat), aceite os termos se aparecerem, clique em "Criar chave de API" / "Create API key" (criando projeto novo se o Google pedir) e copie a chave exibida na tela direto para o arquivo .env desta pasta (GEMINI_API_KEY=...), sem nunca exibir a chave na conversa.
   - "Sim, pelo Claude in Chrome": se eu já uso a extensão Claude in Chrome, faça o mesmo fluxo no meu Chrome já logado.
   - "Prefiro fazer manualmente": me passe o passo a passo (abrir https://aistudio.google.com/apikey → login → "Criar chave de API" → copiar a chave) e me peça para colar a chave no arquivo .env desta pasta (GEMINI_API_KEY=...; o .env já está no .gitignore). Depois leia a chave DO ARQUIVO — nunca me peça para colar a chave no chat.

3. REGISTRO NO CLAUDE CODE — registre o servidor com o caminho absoluto desta pasta:
   - Com vision: claude mcp add --scope user youtube -e GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-)" -- node <caminho-absoluto>/index.js
   - Sem vision: claude mcp add --scope user youtube -- node <caminho-absoluto>/index.js
   Importante: o servidor lê a chave da variável de ambiente do processo (ele NÃO carrega o .env sozinho) — a chave precisa ir no registro do MCP, lida do arquivo, sem ecoar o valor em tela.

4. VALIDAÇÃO REAL — antes de declarar pronto, teste com um vídeo público do YouTube (qualquer um curto serve):
   - youtube_info → deve voltar título e canal;
   - youtube_transcript → deve voltar o texto da transcrição;
   - youtube_whisper (se ativada) → teste com model "tiny" para ser rápido;
   - youtube_vision (se ativada) → uma análise curta, confirmando que a chave funciona.
   Se a sessão ainda não enxergar as tools novas, me peça para reiniciar o Claude Code e continue a validação depois.

5. SEGURANÇA — a GEMINI_API_KEY nunca aparece no chat, em log ou em commit: só no .env local e no registro do MCP. Não altere código, versão nem package.json.

6. RESUMO FINAL — liste o que foi instalado, o que ficou configurado, quais tools estão ativas e me dê 2 exemplos de uso (ex.: "resume esse vídeo <url>", "o que aparece na tela nesse vídeo <url>?").
```

O Claude verifica os pré-requisitos, instala o que faltar, oferece criar a chave do Gemini no navegador por você (você só faz o login), registra o MCP e testa cada tool com um vídeo real antes de concluir.

## Instalação manual

```bash
npm install

# yt-dlp (obrigatório para youtube_transcript, youtube_vision, youtube_whisper)
python -m pip install yt-dlp

# Whisper (apenas para youtube_whisper)
python -m pip install openai-whisper

# FFmpeg (necessário para o Whisper)
winget install ffmpeg   # Windows (brew install ffmpeg / apt install ffmpeg)
```

Registro no Claude Code (a chave só é necessária para `youtube_vision`):

```bash
claude mcp add --scope user youtube -e GEMINI_API_KEY=SUA_CHAVE -- node /caminho/absoluto/youtube-mcp/index.js
```

Ou no Claude Desktop, em `claude_desktop_config.json`:

```json
"youtube-mcp": {
  "command": "node",
  "args": ["/caminho/absoluto/youtube-mcp/index.js"],
  "env": {
    "GEMINI_API_KEY": "sua-chave-aqui"
  }
}
```

Obtenha sua `GEMINI_API_KEY` em: <https://aistudio.google.com/apikey>

> Nota: o servidor lê `GEMINI_API_KEY` da variável de ambiente do processo — ele não carrega o arquivo `.env` sozinho. Use o `.env` como cofre local e passe a chave no registro do MCP, como acima.

## Formatos de URL suportados

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- ID direto: `VIDEO_ID` (11 caracteres)

## Notas técnicas

- **youtube_transcript**: usa `yt-dlp --sub-format json3` que produz legendas limpas sem duplicatas. Fallback automático para inglês se o idioma solicitado não estiver disponível.
- **youtube_info**: usa `youtubei.js` para obter metadata (título, canal, duração, legendas disponíveis) sem autenticação.
- **youtube_vision**: baixa o vídeo em baixa qualidade, envia para a Google File API e analisa com Gemini.
- **youtube_whisper**: baixa apenas o áudio e transcreve localmente com OpenAI Whisper.
