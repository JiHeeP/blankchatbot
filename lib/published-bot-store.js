import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get as getBlob, put as putBlob } from "@vercel/blob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

const LOCAL_DATA_DIR = path.join(projectRoot, "data");
const LOCAL_DATA_FILE = path.join(LOCAL_DATA_DIR, "published-bots.json");
const KV_KEY_PREFIX = "published-bot:";
const BLOB_PATH_PREFIX = "published-bots";

export function getPublishedBotStoreInfo() {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN || "";
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

  if (blobToken) {
    return {
      available: true,
      durable: true,
      mode: "vercel-blob",
      url: "",
      token: blobToken,
    };
  }

  if (url && token) {
    return {
      available: true,
      durable: true,
      mode: "vercel-kv",
      url,
      token,
    };
  }

  if (process.env.VERCEL) {
    return {
      available: false,
      durable: false,
      mode: "not-configured",
      url: "",
      token: "",
    };
  }

  return {
    available: true,
    durable: true,
    mode: "local-file",
    url: "",
    token: "",
  };
}

export async function publishBotRecord(record) {
  const store = getPublishedBotStoreInfo();

  if (!store.available) {
    throw new Error(
      "발행용 저장소가 아직 연결되지 않았습니다. Vercel Blob 또는 KV를 프로젝트에 연결해 주세요.",
    );
  }

  const nextRecord = {
    ...record,
    id: record.id || createPublishedBotId(),
  };

  if (store.mode === "vercel-kv") {
    await setKvRecord(nextRecord.id, nextRecord, store);
    return nextRecord;
  }

  if (store.mode === "vercel-blob") {
    await setBlobRecord(nextRecord.id, nextRecord, store);
    return nextRecord;
  }

  await setLocalRecord(nextRecord.id, nextRecord);
  return nextRecord;
}

export async function getPublishedBotRecord(botId) {
  const store = getPublishedBotStoreInfo();

  if (!store.available) {
    return null;
  }

  if (store.mode === "vercel-kv") {
    return getKvRecord(botId, store);
  }

  if (store.mode === "vercel-blob") {
    return getBlobRecord(botId, store);
  }

  return getLocalRecord(botId);
}

function createPublishedBotId() {
  return crypto.randomBytes(12).toString("base64url");
}

async function getLocalRecord(botId) {
  const store = await readLocalStore();
  return store.bots[botId] || null;
}

async function setLocalRecord(botId, record) {
  const store = await readLocalStore();
  store.bots[botId] = record;
  await writeLocalStore(store);
}

async function readLocalStore() {
  await mkdir(LOCAL_DATA_DIR, { recursive: true });

  const raw = await readFile(LOCAL_DATA_FILE, "utf8").catch(() => "");
  if (!raw) {
    return { bots: {} };
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.bots
      ? parsed
      : { bots: {} };
  } catch {
    return { bots: {} };
  }
}

async function writeLocalStore(store) {
  await mkdir(LOCAL_DATA_DIR, { recursive: true });
  await writeFile(LOCAL_DATA_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function getKvRecord(botId, store) {
  const results = await runKvCommands([["GET", kvKey(botId)]], store);
  const raw = results[0]?.result;

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("저장된 챗봇 데이터를 읽을 수 없습니다.");
  }
}

async function getBlobRecord(botId, store) {
  const result = await getBlob(blobPath(botId), {
    access: "private",
    token: store.token,
  }).catch((error) => {
    if (String(error?.message || "").includes("BlobNotFoundError")) {
      return null;
    }

    throw error;
  });

  if (!result || result.statusCode !== 200 || !result.stream) {
    return null;
  }

  const raw = await new Response(result.stream).text();

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("저장된 챗봇 데이터를 읽을 수 없습니다.");
  }
}

async function setKvRecord(botId, record, store) {
  const results = await runKvCommands(
    [["SET", kvKey(botId), JSON.stringify(record)]],
    store,
  );

  if (results[0]?.error) {
    throw new Error(results[0].error);
  }
}

async function setBlobRecord(botId, record, store) {
  await putBlob(blobPath(botId), JSON.stringify(record), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    token: store.token,
  });
}

function kvKey(botId) {
  return `${KV_KEY_PREFIX}${botId}`;
}

function blobPath(botId) {
  return `${BLOB_PATH_PREFIX}/${botId}.json`;
}

async function runKvCommands(commands, store) {
  const response = await fetch(`${store.url}/multi-exec`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${store.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error || "발행용 저장소와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  if (!Array.isArray(data)) {
    throw new Error("발행용 저장소 응답 형식이 올바르지 않습니다.");
  }

  return data;
}
