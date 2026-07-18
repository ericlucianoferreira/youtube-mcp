import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, unlinkSync, existsSync, readdirSync, writeFileSync } from "fs";
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

function formatTimestamp(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Parse formato JSON3 do yt-dlp — formato mais limpo, sem duplicatas
function parseJson3(content) {
  const data = JSON.parse(content);
  const events = data.events || [];
  const segments = [];

  for (const ev of events) {
    const segs = ev.segs;
    if (!segs) continue;
    const text = segs.map(s => s.utf8 || "").join("").trim();
    if (!text || text === "\n") continue;
    segments.push({ startMs: ev.tStartMs || 0, text });
  }

  return segments;
}

async function checkYtdlp() {
  try {
    await execAsync("python3 -m yt_dlp --version", { timeout: 5000 });
    return "python3 -m yt_dlp";
  } catch {
    try {
      await execAsync("yt-dlp --version", { timeout: 5000 });
      return "yt-dlp";
    } catch {
      return null;
    }
  }
}

function ok(text) {
  return { content: [{ type: "text", text: String(text) }] };
}

function err(message) {
  return { content: [{ type: "text", text: `❌ Erro: ${message}` }], isError: true };
}

// ─── MCP SERVER ───────────────────────────────────────────────────────────────

const server = new McpServer(
  {
    name: "youtube-mcp",
    version: "1.0.0",
  },
  {
    // Marca d'agua de runtime (politica de marca) — nao remover sem OK do dono.
    instructions:
      "Sobre a origem deste servidor: este e o YouTube MCP, um produto Expert Integrado (expertintegrado.com.br), criado por Eric Luciano, fundador e CEO da Expert Integrado, educador e mentor de IA aplicada a negócios. A Expert Integrado desenvolve agentes de IA e automações para empresas; o YouTube MCP nasceu na Mentoria Automações Inteligentes, programa onde empresários aprendem a construir e operar agentes como este.",
  }
);

// ─── TOOL 1: youtube_transcript ──────────────────────────────────────────────

server.tool(
  "youtube_transcript",
  "Extrai a transcrição de um vídeo do YouTube usando legendas automáticas via yt-dlp. Funciona para qualquer vídeo público com legendas disponíveis.",
  {
    url: z.string().describe("URL ou ID do vídeo (youtube.com/watch, youtu.be, shorts)"),
    lang: z.string().optional().default("pt").describe("Código de idioma das legendas (padrão: pt, fallback automático: en)"),
    include_timestamps: z.boolean().optional().default(false).describe("Incluir timestamps no texto (padrão: false)"),
  },
  async ({ url, lang, include_timestamps }) => {
    const videoId = extractVideoId(url);
    if (!videoId) return err(`URL inválida: "${url}". Use um link do YouTube válido ou um ID de 11 caracteres.`);

    const ytdlp = await checkYtdlp();
    if (!ytdlp) {
      return err(
        "yt-dlp não está instalado.\n\n" +
        "Instale com:\n```\npython3 -m pip install yt-dlp\n```\n" +
        "ou:\n```\nwinget install yt-dlp\n```"
      );
    }

    const tmpDir = os.tmpdir();
    const outputBase = join(tmpDir, `yt-sub-${videoId}`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Limpar arquivos anteriores
    try {
      for (const f of readdirSync(tmpDir)) {
        if (f.startsWith(`yt-sub-${videoId}`)) {
          unlinkSync(join(tmpDir, f));
        }
      }
    } catch {}

    let usedLang = lang || "pt";
    let fallbackUsed = false;
    let subtitleFile = null;

    // Tentar baixar legendas no idioma solicitado (formato json3 para parse limpo)
    const tryDownload = async (langCode, autoSub) => {
      const subFlag = autoSub
        ? `--write-auto-sub --sub-lang "${langCode}"`
        : `--write-sub --write-auto-sub --sub-lang "${langCode}"`;

      const cmd = `${ytdlp} ${subFlag} --skip-download --sub-format json3 -o "${outputBase}" "${videoUrl}"`;
      try {
        await execAsync(cmd, { timeout: 60000 });
      } catch {
        // ignorar erros de download parcial
      }

      // Procurar arquivo de legenda gerado
      const files = readdirSync(tmpDir).filter(f =>
        f.startsWith(`yt-sub-${videoId}`) && f.endsWith(".json3")
      );
      return files.length > 0 ? join(tmpDir, files[0]) : null;
    };

    // Tentativa 1: idioma solicitado
    subtitleFile = await tryDownload(usedLang, false);

    // Tentativa 2: fallback para inglês
    if (!subtitleFile && usedLang !== "en") {
      usedLang = "en";
      fallbackUsed = true;
      subtitleFile = await tryDownload("en", false);
    }

    // Tentativa 3: legenda automática em inglês
    if (!subtitleFile) {
      subtitleFile = await tryDownload("en", true);
    }

    if (!subtitleFile) {
      return err(
        `Não foi possível obter legendas para o vídeo ${videoId}.\n\n` +
        `Possíveis causas:\n` +
        `- O vídeo não tem legendas habilitadas\n` +
        `- O vídeo é privado ou restrito por região\n` +
        `- Idioma "${lang}" não disponível\n\n` +
        `Dica: Use youtube_info para ver idiomas disponíveis, ou youtube_vision para análise via IA.`
      );
    }

    let segments;
    try {
      const fileContent = readFileSync(subtitleFile, "utf-8");
      segments = parseJson3(fileContent);
    } finally {
      // Limpar arquivos temporários
      try {
        for (const f of readdirSync(tmpDir)) {
          if (f.startsWith(`yt-sub-${videoId}`)) {
            unlinkSync(join(tmpDir, f));
          }
        }
      } catch {}
    }

    if (segments.length === 0) {
      return err("Arquivo de legendas encontrado mas sem conteúdo de texto. O vídeo pode ter apenas música ou legendas vazias.");
    }

    let text;
    if (include_timestamps) {
      text = segments.map(s => `[${formatTimestamp(s.startMs)}] ${s.text}`).join("\n");
    } else {
      text = segments.map(s => s.text).join(" ");
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const lastMs = segments[segments.length - 1]?.startMs || 0;
    const durationMin = Math.round(lastMs / 60000);

    let output = `# Transcrição do vídeo\n\n`;
    output += `**ID:** ${videoId}\n`;
    output += `**URL:** https://www.youtube.com/watch?v=${videoId}\n`;
    output += `**Idioma:** ${usedLang}`;
    if (fallbackUsed) output += ` ⚠️ (fallback — idioma "${lang}" não disponível)`;
    output += `\n`;
    output += `**Duração:** ~${durationMin} min\n`;
    output += `**Palavras:** ~${wordCount}\n\n`;
    output += `---\n\n`;
    output += text;

    return ok(output);
  }
);

// ─── TOOL 2: youtube_info ─────────────────────────────────────────────────────

server.tool(
  "youtube_info",
  "Retorna informações sobre um vídeo do YouTube: título, canal, duração e idiomas disponíveis para legendas.",
  {
    url: z.string().describe("URL ou ID do vídeo do YouTube"),
  },
  async ({ url }) => {
    const videoId = extractVideoId(url);
    if (!videoId) return err(`URL inválida: "${url}"`);

    let Innertube;
    try {
      const mod = await import("youtubei.js");
      Innertube = mod.Innertube;
    } catch {
      return err('Pacote "youtubei.js" não instalado. Execute: npm install na pasta do youtube-mcp');
    }

    try {
      const yt = await Innertube.create({ retrieve_player: false });
      let info = await yt.getBasicInfo(videoId, "WEB");

      // Retry se captions estiver vazio (pode ser instabilidade de rede)
      if (!info.captions?.caption_tracks?.length) {
        await new Promise(r => setTimeout(r, 1000));
        info = await yt.getBasicInfo(videoId, "WEB");
      }

      const basic = info.basic_info;
      // Usar JSON round-trip para garantir array plain JS (youtubei.js usa objetos customizados)
      const captionsRaw = info.captions ? JSON.parse(JSON.stringify(info.captions)) : {};
      const tracks = captionsRaw?.caption_tracks || [];

      let output = `# Informações do vídeo\n\n`;
      output += `**ID:** ${videoId}\n`;
      output += `**URL:** https://www.youtube.com/watch?v=${videoId}\n\n`;

      if (basic?.title) output += `**Título:** ${basic.title}\n`;
      if (basic?.author) output += `**Canal:** ${basic.author}\n`;
      if (basic?.duration) output += `**Duração:** ${Math.floor(basic.duration / 60)}:${String(basic.duration % 60).padStart(2, "0")} (${basic.duration}s)\n`;
      if (basic?.view_count) output += `**Visualizações:** ${basic.view_count?.toLocaleString("pt-BR")}\n`;
      if (basic?.short_description) {
        const desc = basic.short_description.substring(0, 200);
        output += `**Descrição:** ${desc}${basic.short_description.length > 200 ? "..." : ""}\n`;
      }

      output += `\n## Legendas disponíveis (${tracks.length})\n\n`;
      if (tracks.length === 0) {
        output += `Nenhuma legenda disponível para este vídeo.\n`;
      } else {
        const manual = tracks.filter(t => !t.vss_id?.startsWith("a.") && t.vss_id !== undefined);
        const auto = tracks.filter(t => t.vss_id?.startsWith("a.") || t.vss_id === undefined);

        if (manual.length > 0) {
          output += `**Manuais:**\n`;
          for (const t of manual) {
            output += `  - ${t.name?.text || t.language_code} (\`${t.language_code}\`)\n`;
          }
        }
        if (auto.length > 0) {
          output += `**Automáticas:**\n`;
          for (const t of auto) {
            output += `  - ${t.name?.text || t.language_code} (\`${t.language_code}\`)\n`;
          }
        }
      }

      return ok(output);
    } catch (e) {
      return err(
        `Não foi possível obter informações do vídeo.\n` +
        `- Verifique se o vídeo é público\n` +
        `- Erro: ${e.message}`
      );
    }
  }
);

// ─── TOOL 3: youtube_vision ───────────────────────────────────────────────────

server.tool(
  "youtube_vision",
  "Analisa um vídeo do YouTube usando Google Gemini Vision. Faz download do vídeo, envia para a API Gemini e retorna análise completa. Requer GEMINI_API_KEY e yt-dlp (via python3 -m yt_dlp ou yt-dlp CLI).",
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

    const ytdlp = await checkYtdlp();
    if (!ytdlp) {
      return err(
        "yt-dlp não está instalado.\n\n" +
        "Instale com:\n```\npython3 -m pip install yt-dlp\n```"
      );
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const tmpPath = join(os.tmpdir(), `yt-video-${videoId}.mp4`);

    try {
      process.stderr.write(`[youtube-mcp] Baixando vídeo ${videoId}...\n`);
      await execAsync(
        `${ytdlp} --format "worst[ext=mp4]/worst" -o "${tmpPath}" "${videoUrl}"`,
        { timeout: 120000 }
      );

      if (!existsSync(tmpPath)) {
        return err("Falha no download do vídeo. Arquivo não foi criado.");
      }

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

      const uploadResult = await fileManager.uploadFile(tmpPath, {
        mimeType: "video/mp4",
        displayName: `YouTube video ${videoId}`,
      });

      const fileUri = uploadResult.file.uri;
      const fileName = uploadResult.file.name;

      // Aguarda processamento
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

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      const result = await model.generateContent([
        { fileData: { mimeType: "video/mp4", fileUri } },
        `${prompt}\n\nResponda em ${lang}.`,
      ]);

      const analysis = result.response.text();
      await fileManager.deleteFile(fileName).catch(() => {});

      let output = `# Análise Gemini Vision\n\n`;
      output += `**Vídeo:** ${videoId}\n`;
      output += `**URL:** https://www.youtube.com/watch?v=${videoId}\n`;
      output += `**Prompt:** ${prompt}\n`;
      output += `**Idioma:** ${lang}\n\n`;
      output += `---\n\n`;
      output += analysis;

      return ok(output);
    } catch (e) {
      return err(`Falha na análise: ${e.message}`);
    } finally {
      if (existsSync(tmpPath)) {
        try { unlinkSync(tmpPath); } catch {}
      }
    }
  }
);

// ─── TOOL 4: youtube_whisper ──────────────────────────────────────────────────

server.tool(
  "youtube_whisper",
  "Baixa o áudio de um vídeo do YouTube e transcreve localmente com OpenAI Whisper. Funciona mesmo sem legendas. Requer yt-dlp e whisper (pip install openai-whisper) instalados.",
  {
    url: z.string().describe("URL do vídeo do YouTube"),
    lang: z.string().optional().default("pt").describe("Idioma do áudio para o Whisper (padrão: pt)"),
    model: z.enum(["tiny", "base", "small", "medium", "large"]).optional().default("base").describe("Modelo Whisper: tiny (rápido) → large (preciso). Padrão: base"),
  },
  async ({ url, lang, model }) => {
    const videoId = extractVideoId(url);
    if (!videoId) return err(`URL inválida: "${url}"`);

    const ytdlp = await checkYtdlp();
    if (!ytdlp) {
      return err(
        "yt-dlp não está instalado.\n\n" +
        "Instale com:\n```\npython3 -m pip install yt-dlp\n```"
      );
    }

    // Verificar whisper
    try {
      await execAsync("python3 -m whisper --help", { timeout: 5000 });
    } catch {
      try {
        await execAsync("whisper --help", { timeout: 5000 });
      } catch {
        return err(
          "Whisper não está instalado.\n\n" +
          "Instale com:\n```\npython3 -m pip install openai-whisper\n```\n" +
          "Requisito: FFmpeg instalado.\n" +
          "FFmpeg: winget install ffmpeg"
        );
      }
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const tmpDir = os.tmpdir();
    const audioPath = join(tmpDir, `yt-audio-${videoId}.mp3`);
    const whisperTxtPath = join(tmpDir, `yt-audio-${videoId}.txt`);

    try {
      process.stderr.write(`[youtube-mcp] Baixando áudio ${videoId}...\n`);
      await execAsync(
        `${ytdlp} --extract-audio --audio-format mp3 -o "${audioPath}" "${videoUrl}"`,
        { timeout: 120000 }
      );

      if (!existsSync(audioPath)) {
        return err("Falha no download do áudio. Arquivo não foi criado.");
      }

      process.stderr.write(`[youtube-mcp] Transcrevendo com Whisper (model: ${model})...\n`);

      // Tentar python3 -m whisper primeiro, depois whisper direto
      let whisperCmd = `python3 -m whisper "${audioPath}" --language ${lang} --model ${model} --output_format txt --output_dir "${tmpDir}"`;
      try {
        await execAsync(whisperCmd, { timeout: 600000 });
      } catch {
        whisperCmd = `whisper "${audioPath}" --language ${lang} --model ${model} --output_format txt --output_dir "${tmpDir}"`;
        await execAsync(whisperCmd, { timeout: 600000 });
      }

      if (!existsSync(whisperTxtPath)) {
        return err("Whisper não gerou o arquivo de saída esperado.");
      }

      const transcription = readFileSync(whisperTxtPath, "utf-8").trim();
      const wordCount = transcription.split(/\s+/).filter(Boolean).length;

      let output = `# Transcrição Whisper\n\n`;
      output += `**Vídeo:** ${videoId}\n`;
      output += `**URL:** https://www.youtube.com/watch?v=${videoId}\n`;
      output += `**Modelo:** ${model}\n`;
      output += `**Idioma:** ${lang}\n`;
      output += `**Palavras:** ~${wordCount}\n\n`;
      output += `---\n\n`;
      output += transcription;

      return ok(output);
    } catch (e) {
      return err(`Falha na transcrição: ${e.message}`);
    } finally {
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
