import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import os from "os";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── CONFIGURAÇÃO ────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────

function extractVideoId(url) {
  if (!url) return null;

  // Já é um ID (11 caracteres alfanuméricos + _ e -)
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ok(text) {
  return { content: [{ type: "text", text: String(text) }] };
}

function err(message) {
  return { content: [{ type: "text", text: `❌ Erro: ${message}` }], isError: true };
}

// ─── MCP SERVER ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "youtube-mcp",
  version: "1.0.0",
});

// ─── TOOL 1: youtube_transcript ──────────────────────────────────────────────

server.tool(
  "youtube_transcript",
  "Extrai a transcrição de um vídeo do YouTube usando legendas automáticas (rápido, sem API key). Funciona para vídeos com legendas disponíveis.",
  {
    url: z.string().describe("URL ou ID do vídeo (youtube.com/watch, youtu.be, shorts)"),
    lang: z.string().optional().default("pt").describe("Código de idioma das legendas (padrão: pt, fallback automático: en)"),
    include_timestamps: z.boolean().optional().default(false).describe("Incluir timestamps no texto (padrão: false)"),
  },
  async ({ url, lang, include_timestamps }) => {
    const videoId = extractVideoId(url);
    if (!videoId) return err(`URL inválida: "${url}". Use um link do YouTube válido ou um ID de 11 caracteres.`);

    let YoutubeTranscript;
    try {
      const mod = await import("youtube-transcript");
      YoutubeTranscript = mod.YoutubeTranscript;
    } catch {
      return err('Pacote "youtube-transcript" não instalado. Execute: npm install na pasta do youtube-mcp');
    }

    let transcript;
    let usedLang = lang || "pt";
    let fallbackUsed = false;

    try {
      transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: usedLang });
    } catch (e1) {
      // Fallback para inglês se o idioma solicitado não estiver disponível
      if (usedLang !== "en") {
        try {
          usedLang = "en";
          transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
          fallbackUsed = true;
        } catch (e2) {
          // Tenta sem especificar idioma (pega o padrão do vídeo)
          try {
            transcript = await YoutubeTranscript.fetchTranscript(videoId);
            usedLang = "auto";
            fallbackUsed = true;
          } catch (e3) {
            return err(
              `Não foi possível obter legendas para este vídeo.\n\n` +
              `Possíveis causas:\n` +
              `- O vídeo não tem legendas habilitadas\n` +
              `- O vídeo é privado ou restrito por região\n` +
              `- O ID/URL está incorreto\n\n` +
              `Dica: Use youtube_vision para análise via IA mesmo sem legendas.\n\n` +
              `Erro técnico: ${e3.message}`
            );
          }
        }
      } else {
        try {
          transcript = await YoutubeTranscript.fetchTranscript(videoId);
          usedLang = "auto";
          fallbackUsed = true;
        } catch (e2) {
          return err(
            `Não foi possível obter legendas para este vídeo.\n\n` +
            `Possíveis causas:\n` +
            `- O vídeo não tem legendas habilitadas\n` +
            `- O vídeo é privado ou restrito por região\n` +
            `- O ID/URL está incorreto\n\n` +
            `Dica: Use youtube_vision para análise via IA mesmo sem legendas.\n\n` +
            `Erro técnico: ${e2.message}`
          );
        }
      }
    }

    if (!transcript || transcript.length === 0) {
      return err("Transcrição retornada vazia. O vídeo pode não ter legendas.");
    }

    let text;
    if (include_timestamps) {
      text = transcript
        .map((item) => `[${formatTimestamp(item.offset / 1000)}] ${item.text}`)
        .join("\n");
    } else {
      text = transcript.map((item) => item.text).join(" ");
    }

    const wordCount = text.split(/\s+/).length;
    const durationSec = transcript[transcript.length - 1]?.offset / 1000 || 0;
    const durationMin = Math.round(durationSec / 60);

    let output = `# Transcrição do vídeo\n\n`;
    output += `**ID:** ${videoId}\n`;
    output += `**Idioma usado:** ${usedLang}`;
    if (fallbackUsed) output += ` ⚠️ (fallback — idioma "${lang}" não disponível)`;
    output += `\n`;
    output += `**Duração aproximada:** ${durationMin} min\n`;
    output += `**Palavras:** ~${wordCount}\n\n`;
    output += `---\n\n`;
    output += text;

    return ok(output);
  }
);

// ─── TOOL 2: youtube_info ─────────────────────────────────────────────────────

server.tool(
  "youtube_info",
  "Retorna informações sobre um vídeo do YouTube: título, canal e idiomas disponíveis para legendas.",
  {
    url: z.string().describe("URL ou ID do vídeo do YouTube"),
  },
  async ({ url }) => {
    const videoId = extractVideoId(url);
    if (!videoId) return err(`URL inválida: "${url}"`);

    let YoutubeTranscript;
    try {
      const mod = await import("youtube-transcript");
      YoutubeTranscript = mod.YoutubeTranscript;
    } catch {
      return err('Pacote "youtube-transcript" não instalado. Execute: npm install na pasta do youtube-mcp');
    }

    try {
      // Busca lista de transcrições disponíveis (inclui metadata)
      const transcripts = await YoutubeTranscript.listTranscripts(videoId);

      let output = `# Informações do vídeo\n\n`;
      output += `**ID:** ${videoId}\n`;
      output += `**URL:** https://www.youtube.com/watch?v=${videoId}\n\n`;

      if (transcripts.videoDetails) {
        const d = transcripts.videoDetails;
        if (d.title) output += `**Título:** ${d.title}\n`;
        if (d.author) output += `**Canal:** ${d.author}\n`;
        if (d.lengthSeconds) output += `**Duração:** ${Math.round(d.lengthSeconds / 60)} min\n`;
      }

      output += `\n## Legendas disponíveis\n\n`;

      const allTranscripts = [
        ...(transcripts.manuallyCreated || []),
        ...(transcripts.generated || []),
      ];

      if (allTranscripts.length === 0) {
        output += `Nenhuma legenda disponível para este vídeo.\n`;
      } else {
        if (transcripts.manuallyCreated?.length > 0) {
          output += `**Manuais (mais precisas):**\n`;
          for (const t of transcripts.manuallyCreated) {
            output += `  - ${t.language} (${t.languageCode})\n`;
          }
        }
        if (transcripts.generated?.length > 0) {
          output += `**Automáticas:**\n`;
          for (const t of transcripts.generated) {
            output += `  - ${t.language} (${t.languageCode})\n`;
          }
        }
      }

      return ok(output);
    } catch (e) {
      // Fallback: tenta buscar transcrição padrão para checar se existe
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        let output = `# Informações do vídeo\n\n`;
        output += `**ID:** ${videoId}\n`;
        output += `**URL:** https://www.youtube.com/watch?v=${videoId}\n\n`;
        output += `**Legendas:** Disponíveis (idioma padrão do vídeo)\n`;
        output += `**Segmentos:** ${transcript.length}\n`;
        return ok(output);
      } catch (e2) {
        return err(
          `Não foi possível obter informações do vídeo.\n` +
          `- Verifique se o vídeo é público\n` +
          `- Erro: ${e.message}`
        );
      }
    }
  }
);

// ─── TOOL 3: youtube_vision ───────────────────────────────────────────────────

server.tool(
  "youtube_vision",
  "Analisa um vídeo do YouTube usando Google Gemini Vision. Faz download do vídeo, envia para a API e retorna análise completa. Requer GEMINI_API_KEY e yt-dlp instalado.",
  {
    url: z.string().describe("URL do vídeo do YouTube"),
    prompt: z.string().optional().default("Transcreva e descreva o conteúdo deste vídeo em detalhes").describe("O que analisar no vídeo"),
    lang: z.string().optional().default("pt-BR").describe("Idioma da resposta (padrão: pt-BR)"),
  },
  async ({ url, prompt, lang }) => {
    if (!GEMINI_API_KEY) {
      return err(
        "GEMINI_API_KEY não configurada.\n\n" +
        "Adicione a variável de ambiente no claude_desktop_config.json:\n" +
        '```json\n"env": { "GEMINI_API_KEY": "sua-chave-aqui" }\n```\n\n' +
        "Obtenha sua chave em: https://aistudio.google.com/apikey"
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) return err(`URL inválida: "${url}"`);

    // Verificar se yt-dlp está instalado
    try {
      await execAsync("yt-dlp --version");
    } catch {
      return err(
        "yt-dlp não está instalado.\n\n" +
        "Instale com:\n" +
        "```\nwinget install yt-dlp\n```\n" +
        "ou baixe em: https://github.com/yt-dlp/yt-dlp/releases"
      );
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const tmpPath = join(os.tmpdir(), `yt-${videoId}.mp4`);

    try {
      // Download do vídeo em baixa qualidade
      process.stderr.write(`[youtube-mcp] Baixando vídeo ${videoId}...\n`);
      await execAsync(
        `yt-dlp --format "worst[ext=mp4]/worst" -o "${tmpPath}" "${videoUrl}"`,
        { timeout: 120000 }
      );

      if (!existsSync(tmpPath)) {
        return err("Falha no download do vídeo. Arquivo não foi criado.");
      }

      // Upload para Google File API e análise com Gemini
      process.stderr.write(`[youtube-mcp] Enviando para Gemini...\n`);

      let GoogleGenerativeAI, GoogleAIFileManager;
      try {
        const genai = await import("@google/generative-ai");
        GoogleGenerativeAI = genai.GoogleGenerativeAI;
        const fileApi = await import("@google/generative-ai/server");
        GoogleAIFileManager = fileApi.GoogleAIFileManager;
      } catch {
        return err(
          'Pacote "@google/generative-ai" não instalado.\n' +
          "Execute: npm install na pasta do youtube-mcp"
        );
      }

      const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

      // Upload do arquivo
      const uploadResult = await fileManager.uploadFile(tmpPath, {
        mimeType: "video/mp4",
        displayName: `YouTube video ${videoId}`,
      });

      const fileUri = uploadResult.file.uri;
      const fileName = uploadResult.file.name;

      // Aguarda processamento do arquivo
      let fileState = uploadResult.file.state;
      let attempts = 0;
      while (fileState === "PROCESSING" && attempts < 30) {
        await new Promise((r) => setTimeout(r, 5000));
        const fileInfo = await fileManager.getFile(fileName);
        fileState = fileInfo.state;
        attempts++;
      }

      if (fileState !== "ACTIVE") {
        await fileManager.deleteFile(fileName).catch(() => {});
        return err(`Arquivo ficou no estado "${fileState}" após ${attempts * 5}s. Tente novamente.`);
      }

      // Análise com Gemini
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      const result = await model.generateContent([
        {
          fileData: {
            mimeType: "video/mp4",
            fileUri,
          },
        },
        `${prompt}\n\nResponda em ${lang}.`,
      ]);

      const analysis = result.response.text();

      // Limpeza
      await fileManager.deleteFile(fileName).catch(() => {});

      let output = `# Análise Gemini Vision\n\n`;
      output += `**Vídeo:** ${videoId}\n`;
      output += `**Prompt:** ${prompt}\n`;
      output += `**Idioma:** ${lang}\n\n`;
      output += `---\n\n`;
      output += analysis;

      return ok(output);
    } catch (e) {
      return err(`Falha na análise: ${e.message}`);
    } finally {
      // Limpar arquivo temporário
      if (existsSync(tmpPath)) {
        try { unlinkSync(tmpPath); } catch {}
      }
    }
  }
);

// ─── TOOL 4: youtube_whisper ──────────────────────────────────────────────────

server.tool(
  "youtube_whisper",
  "Baixa o áudio de um vídeo e transcreve localmente com OpenAI Whisper. Funciona mesmo sem legendas. Requer yt-dlp e whisper (pip) instalados.",
  {
    url: z.string().describe("URL do vídeo do YouTube"),
    lang: z.string().optional().default("pt").describe("Idioma do áudio para o Whisper (padrão: pt)"),
    model: z.enum(["tiny", "base", "small", "medium", "large"]).optional().default("base").describe("Modelo Whisper: tiny (rápido) → large (preciso). Padrão: base"),
  },
  async ({ url, lang, model }) => {
    const videoId = extractVideoId(url);
    if (!videoId) return err(`URL inválida: "${url}"`);

    // Verificar yt-dlp
    try {
      await execAsync("yt-dlp --version");
    } catch {
      return err(
        "yt-dlp não está instalado.\n\n" +
        "Instale com:\n```\nwinget install yt-dlp\n```\n" +
        "ou baixe em: https://github.com/yt-dlp/yt-dlp/releases"
      );
    }

    // Verificar whisper
    try {
      await execAsync("whisper --help");
    } catch {
      return err(
        "Whisper não está instalado.\n\n" +
        "Instale com:\n```\npip install openai-whisper\n```\n" +
        "Requisito: Python 3.8+ e FFmpeg instalados.\n" +
        "FFmpeg: winget install ffmpeg"
      );
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const tmpDir = os.tmpdir();
    const audioPath = join(tmpDir, `yt-audio-${videoId}.mp3`);
    const whisperOutputBase = join(tmpDir, `yt-audio-${videoId}`);
    const whisperTxtPath = `${whisperOutputBase}.txt`;

    try {
      // Download apenas do áudio
      process.stderr.write(`[youtube-mcp] Baixando áudio ${videoId}...\n`);
      await execAsync(
        `yt-dlp --extract-audio --audio-format mp3 -o "${audioPath}" "${videoUrl}"`,
        { timeout: 120000 }
      );

      if (!existsSync(audioPath)) {
        return err("Falha no download do áudio. Arquivo não foi criado.");
      }

      // Transcrição com Whisper
      process.stderr.write(`[youtube-mcp] Transcrevendo com Whisper (model: ${model})...\n`);
      await execAsync(
        `whisper "${audioPath}" --language ${lang} --model ${model} --output_format txt --output_dir "${tmpDir}"`,
        { timeout: 600000 } // 10 min timeout para modelos grandes
      );

      if (!existsSync(whisperTxtPath)) {
        return err("Whisper não gerou o arquivo de saída esperado.");
      }

      const transcription = readFileSync(whisperTxtPath, "utf-8").trim();

      const wordCount = transcription.split(/\s+/).length;

      let output = `# Transcrição Whisper\n\n`;
      output += `**Vídeo:** ${videoId}\n`;
      output += `**Modelo:** ${model}\n`;
      output += `**Idioma:** ${lang}\n`;
      output += `**Palavras:** ~${wordCount}\n\n`;
      output += `---\n\n`;
      output += transcription;

      return ok(output);
    } catch (e) {
      return err(`Falha na transcrição: ${e.message}`);
    } finally {
      // Limpar arquivos temporários
      for (const f of [audioPath, whisperTxtPath]) {
        if (existsSync(f)) {
          try { unlinkSync(f); } catch {}
        }
      }
    }
  }
);

// ─── START ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
