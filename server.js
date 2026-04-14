import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HttpError,
  getPublishedBotResponse,
  getHealthPayload,
  processChatRequest,
  processMakerRequest,
  processPublicChatRequest,
  processPublishRequest,
} from "./lib/chat-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

await loadEnvFile(path.join(__dirname, ".env.local"));
await loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3010);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
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
      sendJson(res, 200, getHealthPayload());
      return;
    }

    if (requestUrl.pathname === "/api/make-bot" && req.method === "POST") {
      await handleMaker(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/chat" && req.method === "POST") {
      await handleChat(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/publish-bot" && req.method === "POST") {
      await handlePublish(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/api/public-chat" && req.method === "POST") {
      await handlePublicChat(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/public-bot" && req.method === "GET") {
      await handlePublicBot(res, requestUrl);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "허용되지 않는 요청입니다." });
      return;
    }

    await serveStatic(requestUrl.pathname, res);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "서버에서 알 수 없는 오류가 발생했습니다.";
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(
    `챗봇 메이커 서버가 http://localhost:${PORT} 에서 실행 중입니다.`,
  );
});

async function handleMaker(req, res) {
  try {
    const result = await processMakerRequest(await readJson(req), {
      userAgent: req.headers["user-agent"] || "",
      remoteAddress: req.socket.remoteAddress || "",
    });
    sendJson(res, 200, result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "챗봇 설계안을 생성하지 못했습니다.";
    sendJson(res, status, { error: message });
  }
}

async function handleChat(req, res) {
  try {
    const result = await processChatRequest(await readJson(req), {
      userAgent: req.headers["user-agent"] || "",
      remoteAddress: req.socket.remoteAddress || "",
    });
    sendJson(res, 200, result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "챗봇 응답을 처리하지 못했습니다.";
    sendJson(res, status, { error: message });
  }
}

async function handlePublish(req, res, requestUrl) {
  try {
    const result = await processPublishRequest(await readJson(req), {
      userAgent: req.headers["user-agent"] || "",
      remoteAddress: req.socket.remoteAddress || "",
      baseUrl: getBaseUrl(req, requestUrl),
    });
    sendJson(res, 200, result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "챗봇 링크를 발행하지 못했습니다.";
    sendJson(res, status, { error: message });
  }
}

async function handlePublicChat(req, res) {
  try {
    const result = await processPublicChatRequest(await readJson(req), {
      userAgent: req.headers["user-agent"] || "",
      remoteAddress: req.socket.remoteAddress || "",
    });
    sendJson(res, 200, result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "공개 챗봇 응답을 처리하지 못했습니다.";
    sendJson(res, status, { error: message });
  }
}

async function handlePublicBot(res, requestUrl) {
  try {
    const botId = requestUrl.searchParams.get("botId") || "";
    const result = await getPublishedBotResponse(botId);
    sendJson(res, 200, result, {
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "공개 챗봇 정보를 불러오지 못했습니다.";
    sendJson(res, status, { error: message });
  }
}

async function serveStatic(requestPath, res) {
  const normalizedPath = resolveStaticPath(requestPath);
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

  const extraHeaders =
    normalizedPath === "/bot.html"
      ? { "X-Robots-Tag": "noindex, nofollow, noarchive" }
      : {};

  res.writeHead(200, {
    "Content-Type": mimeType,
    ...extraHeaders,
  });
  res.end(file);
}

function resolveStaticPath(requestPath) {
  if (requestPath === "/") {
    return "/index.html";
  }

  if (requestPath === "/bot" || requestPath === "/bot/") {
    return "/bot.html";
  }

  if (requestPath.startsWith("/bot/")) {
    return "/bot.html";
  }

  return requestPath;
}

function getBaseUrl(req, requestUrl) {
  const forwardedHost = req.headers["x-forwarded-host"];
  const host =
    (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ||
    req.headers.host ||
    requestUrl.host;
  const hostText = String(host || "");
  const isLocalHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(hostText);

  if (isLocalHost) {
    return requestUrl.origin;
  }

  return `https://${hostText}`;
}

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
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
