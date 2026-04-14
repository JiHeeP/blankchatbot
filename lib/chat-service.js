import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_SOURCE_TEXT_LENGTH,
  buildRuntimeSystemPrompt,
  normalizeBotConfig,
} from "../public/config.js";
import {
  getPublishedBotRecord,
  getPublishedBotStoreInfo,
  publishBotRecord,
} from "./published-bot-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

const API_URL = "https://api.moonshot.ai/v1/chat/completions";

const MAKER_SYSTEM_PROMPT = `당신은 "챗봇 메이커 설계 엔진"입니다.

역할:
- 사용자의 설명을 읽고 실제로 쓸 수 있는 챗봇 설정안을 만듭니다.
- 추상적인 설명도 실무적으로 사용할 수 있게 구체화합니다.
- 지원하지 않는 기능을 지어내지 않습니다.

중요 규칙:
- 반드시 JSON 객체만 출력하세요.
- 마크다운 코드블록, 설명 문장, 머리말, 꼬리말을 절대 붙이지 마세요.
- 언어 코드는 반드시 ko, en, ja, zh 중 하나만 사용하세요.
- mustDo, mustNotDo, starterQuestions는 문자열 배열로 만드세요.
- knowledge에는 챗봇이 기억해야 할 핵심 내용만 정리해서 넣으세요.
- 사용자가 참고 자료를 줬다면 knowledge에 그 핵심을 반영하세요.
- 과장된 마케팅 문구보다 실제 동작하는 설정을 우선하세요.

반드시 아래 키를 모두 포함하세요:
{
  "name": "string",
  "tagline": "string",
  "role": "string",
  "purpose": "string",
  "targetAudience": "string",
  "language": "ko|en|ja|zh",
  "tone": "string",
  "responseStyle": "string",
  "greeting": "string",
  "knowledge": "string",
  "mustDo": ["string"],
  "mustNotDo": ["string"],
  "starterQuestions": ["string"]
}`;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function getRuntimeConfig() {
  const runningOnVercel = Boolean(process.env.VERCEL);
  const chatTemperature = readNumberEnv("MOONSHOT_TEMPERATURE", 1);
  const model = process.env.MOONSHOT_MODEL || "kimi-k2.5";

  return {
    model,
    makerModel: process.env.MOONSHOT_MAKER_MODEL || model,
    chatTemperature,
    makerTemperature: readNumberEnv(
      "MOONSHOT_MAKER_TEMPERATURE",
      chatTemperature,
    ),
    logsDir: path.join(projectRoot, process.env.LOG_DIR || "logs"),
    moonshotConfigured: Boolean(process.env.MOONSHOT_API_KEY),
    runningOnVercel,
    loggingMode: normalizeLoggingMode(
      process.env.CHAT_LOGGING,
      runningOnVercel,
    ),
  };
}

export function getHealthPayload() {
  const config = getRuntimeConfig();
  const publishStore = getPublishedBotStoreInfo();

  return {
    ok: true,
    app: "chatbot-maker",
    model: config.model,
    makerModel: config.makerModel,
    temperatures: {
      chat: config.chatTemperature,
      maker: config.makerTemperature,
    },
    moonshotConfigured: config.moonshotConfigured,
    loggingMode: config.loggingMode,
    publishStorage: publishStore.mode,
    timestamp: new Date().toISOString(),
  };
}

export async function processMakerRequest(body, meta = {}) {
  const config = getRuntimeConfig();
  const brief = sanitizeText(body?.brief, 3000);
  const sourceText = sanitizeText(body?.sourceText, MAX_SOURCE_TEXT_LENGTH);
  const sessionId = readSessionId(body?.sessionId);

  if (!config.moonshotConfigured) {
    throw new HttpError(
      500,
      "MOONSHOT_API_KEY가 없습니다. 루트 폴더의 .env 파일에 API 키를 넣어 주세요.",
    );
  }

  if (!brief && !sourceText) {
    throw new HttpError(400, "챗봇 의도 또는 참고 자료를 먼저 입력해 주세요.");
  }

  const rawConfig = await callMoonshotWithTemperatureFallback({
    ...buildMakerModelOptions(config),
    messages: [
      { role: "system", content: MAKER_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildMakerUserPrompt({ brief, sourceText }),
      },
    ],
  });

  const parsed = parseMakerJson(rawConfig);
  const botConfig = normalizeBotConfig({
    ...parsed,
    knowledge:
      sanitizeText(parsed?.knowledge, 6000) ||
      buildKnowledgeFallback(brief, sourceText),
    referenceText: sourceText || parsed?.referenceText,
  });

  await writeEventLog(
    {
      type: "make-bot",
      sessionId,
      botName: botConfig.name,
      briefLength: brief.length,
      sourceLength: sourceText.length,
      userAgent: meta.userAgent || "",
      remoteAddress: meta.remoteAddress || "",
      createdAt: new Date().toISOString(),
    },
    config,
  ).catch((error) => {
    console.error("메이커 로그 저장에 실패했습니다.", error);
  });

  return {
    botConfig,
  };
}

export async function processChatRequest(body, meta = {}) {
  const config = getRuntimeConfig();
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const sessionId = readSessionId(body?.sessionId);

  if (!config.moonshotConfigured) {
    throw new HttpError(
      500,
      "MOONSHOT_API_KEY가 없습니다. 루트 폴더의 .env 파일에 API 키를 넣어 주세요.",
    );
  }

  if (!body?.botConfig || typeof body.botConfig !== "object") {
    throw new HttpError(400, "테스트할 챗봇 설정이 없습니다.");
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
    throw new HttpError(400, "보낼 대화 내용이 없습니다.");
  }

  const botConfig = normalizeBotConfig(body.botConfig);
  const reply = await callMoonshotWithTemperatureFallback({
    model: config.model,
    temperature: config.chatTemperature,
    messages: [
      { role: "system", content: buildRuntimeSystemPrompt(botConfig) },
      ...normalizedMessages,
    ],
  });

  await writeEventLog(
    {
      type: "chat",
      sessionId,
      botName: botConfig.name,
      messageCount: normalizedMessages.length,
      userAgent: meta.userAgent || "",
      remoteAddress: meta.remoteAddress || "",
      createdAt: new Date().toISOString(),
    },
    config,
  ).catch((error) => {
    console.error("대화 로그 저장에 실패했습니다.", error);
  });

  return {
    message: reply,
  };
}

export async function processPublishRequest(body, meta = {}) {
  const config = getRuntimeConfig();
  const sessionId = readSessionId(body?.sessionId);

  if (!body?.botConfig || typeof body.botConfig !== "object") {
    throw new HttpError(400, "발행할 챗봇 설계안이 없습니다.");
  }

  const botConfig = normalizeBotConfig(body.botConfig);
  const now = new Date().toISOString();
  const published = await publishBotRecord({
    id: "",
    accessMode: "link-only",
    status: "published",
    createdAt: now,
    updatedAt: now,
    botConfig,
    sourceMeta: sanitizePublishedSourceMeta(body?.uploadedPdfMeta),
  }).catch((error) => {
    throw new HttpError(
      503,
      error instanceof Error ? error.message : "챗봇 링크를 발행하지 못했습니다.",
    );
  });

  await writeEventLog(
    {
      type: "publish-bot",
      sessionId,
      botId: published.id,
      botName: botConfig.name,
      referenceLength: botConfig.referenceText.length,
      userAgent: meta.userAgent || "",
      remoteAddress: meta.remoteAddress || "",
      createdAt: now,
    },
    config,
  ).catch((error) => {
    console.error("챗봇 발행 로그 기록에 실패했습니다.", error);
  });

  return {
    publishedBot: createPublishedBotSummary(published, meta.baseUrl || ""),
  };
}

export async function getPublishedBotResponse(botId) {
  const published = await readPublishedBot(botId);

  return {
    bot: {
      botId: published.id,
      name: published.botConfig.name,
      tagline: published.botConfig.tagline,
      language: published.botConfig.language,
      greeting: published.botConfig.greeting,
      starterQuestions: published.botConfig.starterQuestions,
      publishedAt: published.createdAt,
    },
  };
}

export async function processPublicChatRequest(body, meta = {}) {
  const config = getRuntimeConfig();
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const sessionId = readSessionId(body?.sessionId);
  const botId = readBotId(body?.botId);

  if (!config.moonshotConfigured) {
    throw new HttpError(
      500,
      "MOONSHOT_API_KEY가 없습니다. 배포 환경변수를 먼저 확인해 주세요.",
    );
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
    throw new HttpError(400, "보낼 대화 내용이 없습니다.");
  }

  const published = await readPublishedBot(botId);
  const reply = await callMoonshotWithTemperatureFallback({
    model: config.model,
    temperature: config.chatTemperature,
    messages: [
      { role: "system", content: buildRuntimeSystemPrompt(published.botConfig) },
      ...normalizedMessages,
    ],
  });

  await writeEventLog(
    {
      type: "public-chat",
      sessionId,
      botId,
      botName: published.botConfig.name,
      messageCount: normalizedMessages.length,
      userAgent: meta.userAgent || "",
      remoteAddress: meta.remoteAddress || "",
      createdAt: new Date().toISOString(),
    },
    config,
  ).catch((error) => {
    console.error("공개 챗봇 로그 기록에 실패했습니다.", error);
  });

  return {
    message: reply,
  };
}

function createPublishedBotSummary(record, baseUrl) {
  return {
    botId: record.id,
    name: record.botConfig.name,
    shareUrl: buildPublicBotUrl(baseUrl, record.id),
    publishedAt: record.createdAt,
    accessMode: record.accessMode,
  };
}

async function readPublishedBot(botId) {
  const safeBotId = readBotId(botId);
  const record = await getPublishedBotRecord(safeBotId);

  if (!record || record.status !== "published") {
    throw new HttpError(404, "해당 링크의 챗봇을 찾지 못했습니다.");
  }

  return record;
}

function buildPublicBotUrl(baseUrl, botId) {
  if (!baseUrl) {
    return `/bot/${botId}`;
  }

  return `${baseUrl.replace(/\/$/, "")}/bot/${botId}`;
}

function sanitizePublishedSourceMeta(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    pageCount: readSafeNumber(value.pageCount),
    ocrPageCount: readSafeNumber(value.ocrPageCount),
    extractedCharCount: readSafeNumber(value.extractedCharCount),
    truncated: Boolean(value.truncated),
  };
}

function readBotId(value) {
  const botId = sanitizeText(value, 120);

  if (!botId || !/^[A-Za-z0-9_-]{8,120}$/.test(botId)) {
    throw new HttpError(400, "챗봇 링크가 올바르지 않습니다.");
  }

  return botId;
}

function buildMakerUserPrompt({ brief, sourceText }) {
  return `아래 설명을 바탕으로 챗봇 설정 JSON을 만들어 주세요.

[사용자 의도]
${brief || "별도 설명 없음"}

[참고 자료]
${sourceText || "별도 참고 자료 없음"}

요청 사항:
- 사용자의 의도를 가장 잘 수행하는 챗봇으로 설계하세요.
- language는 사용자 의도와 자료의 언어를 보고 가장 자연스러운 값을 정하세요.
- greeting은 실제 첫 인사처럼 자연스럽게 쓰세요.
- 참고 자료에 페이지 마커가 있으면, 그 구조를 참고해 핵심 규칙과 사실을 정리하세요.
- mustDo에는 꼭 지켜야 할 운영 규칙을 3~5개 넣으세요.
- mustNotDo에는 피해야 할 행동을 2~4개 넣으세요.
- starterQuestions에는 실제 테스트에 쓸 만한 시작 질문을 3개 넣으세요.
- referenceText 키는 만들지 마세요. 제가 따로 붙일 것입니다.
- 출력은 JSON 객체 하나만 주세요.`;
}

function buildKnowledgeFallback(brief, sourceText) {
  const parts = [];

  if (brief) {
    parts.push(`의도 요약: ${brief}`);
  }

  if (sourceText) {
    parts.push(`참고 자료 요약용 원문이 제공됨. 답변할 때 이 자료를 우선 참고하세요.`);
  }

  return parts.join("\n");
}

function buildMakerModelOptions(config) {
  if (config.makerModel === "kimi-k2.5") {
    return {
      model: config.makerModel,
      temperature: 0.6,
      thinking: { type: "disabled" },
    };
  }

  return {
    model: config.makerModel,
    temperature: config.makerTemperature,
  };
}

function parseMakerJson(raw) {
  const candidates = [];
  const trimmed = typeof raw === "string" ? raw.trim() : "";

  if (!trimmed) {
    throw new HttpError(502, "챗봇 설정을 생성하지 못했습니다.");
  }

  candidates.push(trimmed);

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new HttpError(
    502,
    "생성된 챗봇 설정을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  );
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
          body: JSON.stringify(payload),
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
          "Moonshot API 호출에 실패했습니다.";

        if (response.status >= 500) {
          throw new Error(errorMessage);
        }

        throw new HttpError(response.status, errorMessage);
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

      throw new Error("Moonshot API가 비어 있는 응답을 보냈습니다.");
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) {
        throw error;
      }

      lastError = error;
    }
  }

  if (lastError instanceof HttpError) {
    throw lastError;
  }

  if (lastError instanceof Error) {
    throw new HttpError(500, lastError.message);
  }

  throw new HttpError(500, "Moonshot API 호출에 실패했습니다.");
}

async function callMoonshotWithTemperatureFallback(payload) {
  try {
    return await callMoonshot(payload);
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.status === 400 &&
      /temperature/i.test(error.message) &&
      payload.temperature !== 1
    ) {
      return callMoonshot({
        ...payload,
        temperature: 1,
      });
    }

    throw error;
  }
}

async function writeEventLog(entry, config) {
  if (config.loggingMode === "off") {
    return;
  }

  if (config.loggingMode === "console") {
    console.log(`[chatbot-maker-log] ${JSON.stringify(entry)}`);
    return;
  }

  await mkdir(config.logsDir, { recursive: true });
  const day = entry.createdAt.slice(0, 10);
  const filePath = path.join(config.logsDir, `events-${day}.jsonl`);
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function normalizeLoggingMode(value, runningOnVercel) {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "off";

  if (normalized === "console") {
    return "console";
  }

  if (normalized === "file") {
    return runningOnVercel ? "console" : "file";
  }

  return "off";
}

function readSessionId(value) {
  const sessionId = sanitizeText(value, 120);
  return sessionId || "anonymous";
}

function readSafeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readNumberEnv(key, fallback) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
