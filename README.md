# youtube-mcp

MCP local para extrair transcrições e análise de vídeos do YouTube.

## Tools disponíveis

| Tool | Método | Dependências |
|------|--------|-------------|
| `youtube_transcript` | Legendas via yt-dlp (formato json3) | `python3 -m pip install yt-dlp` |
| `youtube_info` | Metadata via youtubei.js | Nenhuma extra |
| `youtube_vision` | Análise visual via Gemini 1.5 Pro | yt-dlp + GEMINI_API_KEY |
| `youtube_whisper` | Transcrição local via Whisper | yt-dlp + whisper (pip) + FFmpeg |

## Instalação

```bash
cd "MCPs e Skills/youtube-mcp"
npm install

# Instalar yt-dlp (obrigatório para youtube_transcript, youtube_vision, youtube_whisper)
python3 -m pip install yt-dlp

# Instalar Whisper (apenas para youtube_whisper)
python3 -m pip install openai-whisper

# FFmpeg (necessário para Whisper)
winget install ffmpeg
```

## Configuração no Claude Desktop

Adicione em `claude_desktop_config.json`:

```json
"youtube-mcp": {
  "command": "node",
  "args": ["C:\\Users\\Eric Luciano\\OneDrive\\Documentos\\GitHub\\MCPs e Skills\\youtube-mcp\\index.js"],
  "env": {
    "GEMINI_API_KEY": "sua-chave-aqui"
  }
}
```

Obtenha sua GEMINI_API_KEY em: https://aistudio.google.com/apikey

## Formatos de URL suportados

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- ID direto: `VIDEO_ID` (11 caracteres)

## Notas técnicas

- **youtube_transcript**: usa `yt-dlp --sub-format json3` que produz legendas limpas sem duplicatas. Fallback automático para inglês se o idioma solicitado não estiver disponível.
- **youtube_info**: usa `youtubei.js` para obter metadata (título, canal, duração, legendas disponíveis) sem autenticação.
- **youtube_vision**: baixa o vídeo em baixa qualidade, envia para a Google File API e analisa com Gemini 1.5 Pro.
- **youtube_whisper**: baixa apenas o áudio e transcreve localmente com OpenAI Whisper.
