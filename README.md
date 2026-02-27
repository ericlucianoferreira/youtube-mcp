# youtube-mcp

MCP local para extrair transcrições e análise visual de vídeos do YouTube.

## Tools disponíveis

| Tool | Método | Dependências |
|------|--------|-------------|
| `youtube_transcript` | Legendas automáticas | Nenhuma (npm only) |
| `youtube_info` | Metadata do vídeo | Nenhuma (npm only) |
| `youtube_vision` | Gemini Vision API | yt-dlp + GEMINI_API_KEY |
| `youtube_whisper` | Whisper local | yt-dlp + whisper (pip) |

## Instalação

```bash
cd "MCPs e Skills/youtube-mcp"
npm install
```

## Dependências de sistema

Para `youtube_vision` e `youtube_whisper`:

```bash
# yt-dlp
winget install yt-dlp

# Whisper (apenas para youtube_whisper)
pip install openai-whisper

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
