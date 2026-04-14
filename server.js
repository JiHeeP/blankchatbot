import { createServer } from "node:http";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LANGUAGES, getSystemPrompt } from "./public/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

await loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.MOONSHOT_MODEL || "kimi-k2.5";
const TEMPERATURE = Number(process.env.MOONSHOT_TEMPERATURE || 1);
const logsDir = path.join(__dirname, process.env.LOG_DIR || "logs");
const API_URL = "https://api.moonshot.ai/v1/chat/completions";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: "잘못된 요청입니다." });
      return;
    }

    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host || `localhost:${PORT}`}`,
    );

    if (requestUrl.pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        app: "terrain-explorer-chatbot",
        model: MODEL,
        moonshotConfigured: Boolean(process.env.MOONSHOT_API_KEY),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (requestUrl.pathname === "/api/chat" && req.method === "POST") {
      await handleChat(req, res);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "허용되지 않는 요청입니다." });
      return;
    }

    await serveStatic(requestUrl.pathname, res);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "서버에서 알 수 없는 오류가 발생했습니다.";
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`지형 탐험 도우미 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});

async function handleChat(req, res) {
  const body = await readJson(req);
  const lang = typeof body.lang === "string" ? body.lang : "ko";
  const terrain = typeof body.terrain === "string" ? body.terrain : "mountain";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim().slice(0, 120)
      : "anonymous";

  if (!process.env.MOONSHOT_API_KEY) {
    sendJson(res, 500, {
      error:
        "MOONSHOT_API_KEY가 없습니다. 루트 폴더에 .env 파일을 만들고 API 키를 넣어 주세요.",
    });
    return;
  }

  if (!LANGUAGES.some((item) => item.code === lang)) {
    sendJson(res, 400, { error: "지원하지 않는 언어입니다." });
    return;
  }

  if (!messages.length) {
    sendJson(res, 400, { error: "보낼 대화 내용이 없습니다." });
    return;
  }

  const normalizedMessages = messages
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim(),
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));

  if (!normalizedMessages.length) {
    sendJson(res, 400, { error: "유효한 대화 내용이 없습니다." });
    return;
  }

  const reply = await callMoonshot({
    model: MODEL,
    messages: [
      { role: "system", content: getSystemPrompt(lang, terrain) },
      ...normalizedMessages,
    ],
  });

  await writeChatLog({
    sessionId,
    lang,
    terrain,
    model: MODEL,
    temperature: TEMPERATURE,
    userAgent: req.headers["user-agent"] || "",
    remoteAddress: req.socket.remoteAddress || "",
    messages: normalizedMessages,
    reply,
    createdAt: new Date().toISOString(),
  }).catch((error) => {
    console.error("대화 로그 저장에 실패했습니다.", error);
  });

  sendJson(res, 200, { message: reply });
}

async function callMoonshot(payload) {
  const retries = [0, 1000, 2000, 4000];
  let lastError;

  for (const delay of retries) {
    if (delay) {
      await wait(delay);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      let response;
      try {
        response = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}`,
          },
          body: JSON.stringify({
            ...payload,
            temperature: TEMPERATURE,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage =
          data?.error?.message ||
          data?.message ||
          "Kimi 2.5 API 호출에 실패했습니다.";

        if (response.status >= 500) {
          throw new Error(errorMessage);
        }

        throw new NonRetryableError(errorMessage);
      }

      const content = data?.choices?.[0]?.message?.content;

      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }

      if (Array.isArray(content)) {
        const joined = content
          .map((item) => (typeof item?.text === "string" ? item.text : ""))
          .join("")
          .trim();

        if (joined) {
          return joined;
        }
      }

      throw new Error("Kimi 2.5가 비어 있는 응답을 보냈습니다.");
    } catch (error) {
      if (error instanceof NonRetryableError) {
        throw error;
      }

      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Kimi 2.5 API 호출에 실패했습니다.");
}

async function writeChatLog(entry) {
  await mkdir(logsDir, { recursive: true });
  const day = entry.createdAt.slice(0, 10);
  const filePath = path.join(logsDir, `chat-${day}.jsonl`);
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

async function serveStatic(requestPath, res) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path
    .normalize(normalizedPath)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
  const filePath = path.join(publicDir, safePath);

  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat || !fileStat.isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("파일을 찾을 수 없습니다.");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[extension] || "application/octet-stream";
  const file = await readFile(filePath);

  res.writeHead(200, { "Content-Type": mimeType });
  res.end(file);
}

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

async function loadEnvFile(filePath) {
  const content = await readFile(filePath, "utf8").catch(() => "");

  if (!content) {
    return;
  }

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const index = trimmed.indexOf("=");
    if (index === -1) {
      return;
    }

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class NonRetryableError extends Error {}
