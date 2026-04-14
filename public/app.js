import {
  MAKER_SUGGESTIONS,
  MAX_SOURCE_TEXT_LENGTH,
  createEmptyBotConfig,
  getLanguageLabel,
  normalizeBotConfig,
} from "./config.js";
import {
  PDF_MAX_FILE_BYTES,
  PDF_MAX_PAGE_COUNT,
  extractPdfSourceText,
} from "./pdf-tools.js";

const STORAGE_KEY = "chatbot-maker-state-v2";
const SESSION_KEY = "chatbot-maker-session-id";

const app = document.getElementById("app");
const state = loadInitialState();

function loadInitialState() {
  const persisted = readPersistedState();

  return {
    sessionId: getSessionId(),
    makerBrief: readText(persisted.makerBrief, 3000),
    sourceText: readText(persisted.sourceText, MAX_SOURCE_TEXT_LENGTH),
    uploadedPdfMeta: normalizeUploadedPdfMeta(persisted.uploadedPdfMeta),
    botConfig: persisted.botConfig ? normalizeBotConfig(persisted.botConfig) : null,
    publishedBot: normalizePublishedBot(persisted.publishedBot),
    messages: sanitizeMessages(persisted.messages),
    loadingPdf: false,
    loadingMake: false,
    loadingChat: false,
    loadingPublish: false,
    isDragActive: false,
    makeError: "",
    publishError: "",
    lastSavedAt:
      typeof persisted.lastSavedAt === "string" ? persisted.lastSavedAt : null,
  };
}

function readPersistedState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistState() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        makerBrief: state.makerBrief,
        sourceText: state.sourceText,
        uploadedPdfMeta: state.uploadedPdfMeta,
        botConfig: state.botConfig,
        publishedBot: state.publishedBot,
        messages: state.messages,
        lastSavedAt: state.lastSavedAt,
      }),
    );
  } catch {
    // Ignore storage failures so the app can still run.
  }
}

function readText(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function normalizeUploadedPdfMeta(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    fileName: readText(value.fileName, 220),
    fileSize: toSafeNumber(value.fileSize),
    pageCount: toSafeNumber(value.pageCount),
    ocrPageCount: toSafeNumber(value.ocrPageCount),
    extractedCharCount: toSafeNumber(value.extractedCharCount),
    truncated: Boolean(value.truncated),
    extractionStatus: readText(value.extractionStatus, 80) || "완료",
    extractionError: readText(value.extractionError, 240),
  };
}

function normalizePublishedBot(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const botId = readText(value.botId, 120);
  const shareUrl = readText(value.shareUrl, 400);

  if (!botId || !shareUrl) {
    return null;
  }

  return {
    botId,
    name: readText(value.name, 120),
    shareUrl,
    publishedAt: readText(value.publishedAt, 80),
    accessMode: readText(value.accessMode, 40) || "link-only",
  };
}

function toSafeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function getSessionId() {
  try {
    const saved = window.localStorage.getItem(SESSION_KEY);
    if (saved) {
      return saved;
    }
  } catch {
    // Ignore storage failures and generate a fresh session id.
  }

  const next = createSessionId();

  try {
    window.localStorage.setItem(SESSION_KEY, next);
  } catch {
    // Ignore storage failures so the app still works.
  }

  return next;
}

function renewSessionId() {
  const next = createSessionId();

  try {
    window.localStorage.setItem(SESSION_KEY, next);
  } catch {
    // Ignore storage failures so the app still works.
  }

  return next;
}

function createSessionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
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
}

function setState(patch, options = {}) {
  const { persist = true, updateSavedAt = persist } = options;

  Object.assign(state, patch);

  if (updateSavedAt) {
    state.lastSavedAt = new Date().toISOString();
  }

  if (persist) {
    persistState();
  }

  render();
}

function persistDraft() {
  state.lastSavedAt = new Date().toISOString();
  persistState();
}

function shortSessionId() {
  return state.sessionId.slice(0, 8);
}

function formatSavedAt() {
  if (!state.lastSavedAt) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(state.lastSavedAt));
  } catch {
    return state.lastSavedAt;
  }
}

function formatPublishedAt(value) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)}${units[exponent]}`;
}

function resetWorkspace() {
  Object.assign(state, {
    sessionId: renewSessionId(),
    makerBrief: "",
    sourceText: "",
    uploadedPdfMeta: null,
    botConfig: null,
    publishedBot: null,
    messages: [],
    loadingPdf: false,
    loadingMake: false,
    loadingChat: false,
    loadingPublish: false,
    isDragActive: false,
    makeError: "",
    publishError: "",
    lastSavedAt: new Date().toISOString(),
  });
  persistState();
  render();
}

function clearInputs() {
  setState({
    makerBrief: "",
    sourceText: "",
    uploadedPdfMeta: null,
    makeError: "",
  });
}

function clearConversation() {
  setState({
    sessionId: renewSessionId(),
    messages: [],
  });
}

function applyBotConfigEdits() {
  if (!state.botConfig) {
    return;
  }

  setState({
    sessionId: renewSessionId(),
    botConfig: normalizeBotConfig(state.botConfig),
    messages: [],
  });
}

function exportBotConfig() {
  if (!state.botConfig) {
    return;
  }

  const fileName = `${slugify(state.botConfig.name || "custom-bot")}.json`;
  downloadBlob(
    fileName,
    JSON.stringify(normalizeBotConfig(state.botConfig), null, 2),
    "application/json;charset=utf-8",
  );
}

function exportConversation() {
  if (!state.botConfig || !state.messages.length) {
    return;
  }

  const lines = [
    `Bot: ${state.botConfig.name}`,
    `Tagline: ${state.botConfig.tagline}`,
    `Language: ${getLanguageLabel(state.botConfig.language)}`,
    `Exported At: ${new Date().toLocaleString()}`,
    `Session ID: ${state.sessionId}`,
    "",
  ];

  state.messages.forEach((message, index) => {
    lines.push(
      `[${index + 1}] ${message.role === "user" ? "User" : state.botConfig.name}`,
    );
    lines.push(message.content);
    lines.push("");
  });

  downloadBlob(
    `${slugify(state.botConfig.name || "bot")}-chat.txt`,
    lines.join("\n"),
    "text/plain;charset=utf-8",
  );
}

function downloadBlob(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  URL.revokeObjectURL(url);
}

function slugify(value) {
  return String(value || "chatbot")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parseLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(items) {
  return Array.isArray(items) ? items.join("\n") : "";
}

function removePdfAndText() {
  setState({
    uploadedPdfMeta: null,
    sourceText: "",
    makeError: "",
  });
}

function keepExtractedTextOnly() {
  setState({
    uploadedPdfMeta: null,
    makeError: "",
  });
}

function canGenerateBot() {
  if (
    state.loadingPdf ||
    state.loadingMake ||
    state.loadingChat ||
    state.loadingPublish
  ) {
    return false;
  }

  return Boolean(state.makerBrief.trim() || state.sourceText.trim());
}

function canPublishBot() {
  if (
    !state.botConfig ||
    state.loadingPdf ||
    state.loadingMake ||
    state.loadingChat ||
    state.loadingPublish
  ) {
    return false;
  }

  return true;
}

async function publishBot() {
  if (!state.botConfig) {
    return;
  }

  setState(
    {
      loadingPublish: true,
      publishError: "",
    },
    { persist: false, updateSavedAt: false },
  );

  try {
    const response = await fetch("/api/publish-bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        botConfig: normalizeBotConfig(state.botConfig),
        uploadedPdfMeta: state.uploadedPdfMeta,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "챗봇 링크를 발행하지 못했습니다.");
    }

    setState({
      loadingPublish: false,
      publishError: "",
      publishedBot: normalizePublishedBot(data.publishedBot),
    });
  } catch (error) {
    setState({
      loadingPublish: false,
      publishError:
        error instanceof Error
          ? error.message
          : "챗봇 링크를 발행하지 못했습니다.",
    });
  }
}

async function copyPublishedLink() {
  if (!state.publishedBot?.shareUrl) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(state.publishedBot.shareUrl);
      setState({ publishError: "" }, { persist: false, updateSavedAt: false });
      return;
    }
  } catch {
    // Fall through to the prompt fallback.
  }

  window.prompt("이 링크를 복사해 사용해 주세요.", state.publishedBot.shareUrl);
}

async function handlePdfSelection(file) {
  if (!file) {
    return;
  }

  const previousMeta = state.uploadedPdfMeta;
  const previousSourceText = state.sourceText;

  setState(
    {
      loadingPdf: true,
      isDragActive: false,
      makeError: "",
      uploadedPdfMeta: {
        fileName: file.name,
        fileSize: file.size,
        pageCount: 0,
        ocrPageCount: 0,
        extractedCharCount: 0,
        truncated: false,
        extractionStatus: "업로드 확인 중",
        extractionError: "",
      },
    },
    { persist: false, updateSavedAt: false },
  );

  try {
    const result = await extractPdfSourceText(file, (meta) => {
      setState(
        {
          uploadedPdfMeta: normalizeUploadedPdfMeta(meta),
          loadingPdf: true,
          makeError: "",
        },
        { persist: false, updateSavedAt: false },
      );
    });

    setState({
      uploadedPdfMeta: normalizeUploadedPdfMeta(result.meta),
      sourceText: result.sourceText,
      loadingPdf: false,
      makeError: "",
    });
  } catch (error) {
    setState({
      uploadedPdfMeta: previousMeta,
      sourceText: previousSourceText,
      loadingPdf: false,
      makeError:
        error instanceof Error
          ? error.message
          : "PDF를 처리하지 못했습니다. 다른 파일로 다시 시도해 주세요.",
    });
  }
}

async function generateBot() {
  const brief = state.makerBrief.trim();
  const sourceText = state.sourceText.trim();

  if (!brief && !sourceText) {
    setState({
      makeError: "챗봇의 목적이나 참고 자료를 먼저 입력해 주세요.",
    });
    return;
  }

  setState(
    {
      loadingMake: true,
      makeError: "",
    },
    { persist: false, updateSavedAt: false },
  );

  try {
    const response = await fetch("/api/make-bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        brief,
        sourceText,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "챗봇 설계안을 생성하지 못했습니다.");
    }

    setState({
      sessionId: renewSessionId(),
      botConfig: normalizeBotConfig(data.botConfig || createEmptyBotConfig()),
      messages: [],
      loadingMake: false,
      makeError: "",
      publishError: "",
    });
  } catch (error) {
    setState({
      loadingMake: false,
      makeError:
        error instanceof Error
          ? error.message
          : "챗봇 설계안을 생성하지 못했습니다.",
    });
  }
}

async function sendMessage(text) {
  if (!state.botConfig || state.loadingChat || !text.trim()) {
    return;
  }

  const nextMessages = [...state.messages, { role: "user", content: text.trim() }];

  setState(
    {
      messages: nextMessages,
      loadingChat: true,
    },
    { persist: true, updateSavedAt: false },
  );

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        botConfig: normalizeBotConfig(state.botConfig),
        messages: nextMessages,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "챗봇 응답을 받아오지 못했습니다.");
    }

    setState({
      messages: [...nextMessages, { role: "assistant", content: data.message }],
      loadingChat: false,
    });
  } catch (error) {
    setState({
      messages: [
        ...nextMessages,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "응답을 받는 데 실패했습니다. 잠시 후 다시 시도해 주세요.",
        },
      ],
      loadingChat: false,
    });
  }
}

function createElement(tag, className, text) {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (typeof text === "string") {
    node.textContent = text;
  }

  return node;
}

function createButton({
  label,
  className,
  onClick,
  disabled = false,
  type = "button",
}) {
  const button = createElement("button", className, label);
  button.type = type;
  button.disabled = disabled;

  if (typeof onClick === "function") {
    button.addEventListener("click", onClick);
  }

  return button;
}

function createHeaderChip(text) {
  return createElement("span", "header-chip", text);
}

function createSectionCard(step, title, description) {
  const card = createElement("section", "section-card");
  const header = createElement("div", "section-head");
  const stepBadge = createElement("div", "step-badge", step);
  const textWrap = createElement("div", "section-copy");
  const titleNode = createElement("h2", "section-title", title);
  const descriptionNode = createElement("p", "section-desc", description);

  textWrap.append(titleNode, descriptionNode);
  header.append(stepBadge, textWrap);
  card.appendChild(header);

  return card;
}

function createField(label, hint, input) {
  const wrapper = createElement("label", "field");
  const top = createElement("div", "field-top");
  const labelNode = createElement("span", "field-label", label);
  const hintNode = createElement("span", "field-hint", hint);

  top.append(labelNode, hintNode);
  wrapper.append(top, input);

  return wrapper;
}

function createInput(value, placeholder, onInput) {
  const input = document.createElement("input");
  input.className = "text-input";
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function createTextarea(value, placeholder, rows, onInput) {
  const textarea = document.createElement("textarea");
  textarea.className = "text-area";
  textarea.rows = rows;
  textarea.value = value;
  textarea.placeholder = placeholder;
  textarea.addEventListener("input", () => onInput(textarea.value));
  return textarea;
}

function createSelect(value, options, onChange) {
  const select = document.createElement("select");
  select.className = "text-select";

  options.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;

    if (option.value === value) {
      node.selected = true;
    }

    select.appendChild(node);
  });

  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function createInfoList(title, items) {
  const card = createElement("article", "info-card");
  const titleNode = createElement("div", "info-label", title);
  const list = createElement("div", "info-list");

  items.forEach((item) => {
    const row = createElement("div", "info-item", item);
    list.appendChild(row);
  });

  card.append(titleNode, list);
  return card;
}

function createSidebar() {
  const sidebar = createElement("aside", "panel sidebar");
  const brand = createElement("div", "brand");
  const brandHead = createElement("div", "brand-head");
  const logo = document.createElement("img");
  logo.className = "brand-mark";
  logo.src = "/brand-mark.svg";
  logo.alt = "Chatbot Maker";
  const badge = createHeaderChip("Moonshot / Kimi");

  brandHead.append(logo, badge);
  brand.appendChild(brandHead);
  brand.appendChild(createElement("h1", "brand-title", "챗봇 메이커"));
  brand.appendChild(
    createElement(
      "p",
      "brand-copy",
      "원하는 역할과 자료를 넣으면, 설계안 생성부터 테스트 대화까지 한 화면에서 바로 진행합니다. PDF를 올리면 텍스트 추출과 OCR도 브라우저에서 처리합니다.",
    ),
  );

  if (state.botConfig) {
    const activeBot = createElement("div", "active-bot");
    activeBot.appendChild(createElement("span", "active-bot-label", "현재 설계"));
    activeBot.appendChild(
      createElement("strong", "active-bot-name", state.botConfig.name),
    );
    activeBot.appendChild(
      createElement("p", "active-bot-copy", state.botConfig.tagline),
    );
    brand.appendChild(activeBot);
  }

  const facts = createElement("div", "info-stack");
  facts.append(
    createInfoList("Flow", ["기획 입력", "PDF 추출", "설계안 생성", "바로 테스트"]),
    createInfoList("Runtime", ["API 키는 서버 전용", "Moonshot으로 생성/응답"]),
    createInfoList("Privacy", ["원본 PDF는 저장 안 함", "브라우저에 텍스트 초안 저장"]),
  );

  const footer = createElement("div", "sidebar-footer");
  footer.appendChild(createElement("span", "footer-label", "Session"));
  footer.appendChild(createElement("strong", "footer-value", shortSessionId()));
  footer.appendChild(
    createElement("span", "footer-muted", `저장 시각 ${formatSavedAt()}`),
  );

  const resetButton = createButton({
    label: "워크스페이스 초기화",
    className: "ghost-button full-width",
    onClick: resetWorkspace,
    disabled:
      state.loadingPdf ||
      state.loadingMake ||
      state.loadingChat ||
      state.loadingPublish,
  });

  footer.appendChild(resetButton);
  sidebar.append(brand, facts, footer);

  return sidebar;
}

function createPdfUploadField() {
  const wrapper = createElement("div", "field");
  const top = createElement("div", "field-top");
  const labelNode = createElement("span", "field-label", "PDF 업로드");
  const hintNode = createElement(
    "span",
    "field-hint",
    `PDF 1개, 최대 ${PDF_MAX_PAGE_COUNT}페이지 / ${formatBytes(PDF_MAX_FILE_BYTES)}. 텍스트 PDF와 스캔본 OCR을 지원합니다.`,
  );
  top.append(labelNode, hintNode);
  wrapper.appendChild(top);

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,application/pdf";
  input.className = "hidden-input";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    void handlePdfSelection(file);
  });

  const dropzone = createElement(
    "div",
    `pdf-dropzone${state.isDragActive ? " is-active" : ""}${state.loadingPdf ? " is-busy" : ""}`,
  );
  dropzone.tabIndex = 0;

  const icon = createElement("div", "pdf-dropzone-icon", "PDF");
  const textWrap = createElement("div", "pdf-dropzone-copy");
  textWrap.append(
    createElement(
      "strong",
      "pdf-dropzone-title",
      state.loadingPdf ? "PDF를 처리하는 중입니다" : "PDF를 끌어다 놓거나 눌러서 선택하세요",
    ),
    createElement(
      "p",
      "pdf-dropzone-text",
      state.loadingPdf
        ? "페이지별 텍스트 추출과 OCR을 순서대로 진행하고 있습니다."
        : "추출 결과는 참고 자료 칸에 자동으로 들어가고, 그 뒤에 직접 수정할 수 있습니다.",
    ),
  );

  const badgeRow = createElement("div", "pdf-badge-row");
  badgeRow.append(
    createElement("span", "pdf-badge", "브라우저 처리"),
    createElement("span", "pdf-badge", "OCR: kor + eng"),
  );

  dropzone.append(icon, textWrap, badgeRow);

  if (!state.loadingPdf) {
    dropzone.addEventListener("click", () => input.click());
    dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
  }

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();

      if (state.loadingPdf) {
        return;
      }

      setState(
        { isDragActive: true },
        { persist: false, updateSavedAt: false },
      );
    });
  });

  ["dragleave", "dragend"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();

      if (!state.isDragActive) {
        return;
      }

      setState(
        { isDragActive: false },
        { persist: false, updateSavedAt: false },
      );
    });
  });

  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];

    setState(
      { isDragActive: false },
      { persist: false, updateSavedAt: false },
    );

    if (state.loadingPdf) {
      return;
    }

    void handlePdfSelection(file);
  });

  wrapper.append(input, dropzone);

  if (state.uploadedPdfMeta) {
    wrapper.appendChild(createPdfMetaPanel(() => input.click()));
  }

  return wrapper;
}

function createPdfMetaPanel(openPicker) {
  const meta = state.uploadedPdfMeta;
  const panel = createElement("div", "pdf-meta-card");

  const head = createElement("div", "pdf-meta-head");
  const titleWrap = createElement("div", "pdf-meta-copy");
  titleWrap.append(
    createElement("span", "pdf-meta-label", "현재 PDF"),
    createElement("strong", "pdf-meta-name", meta.fileName || "이름 없는 PDF"),
  );
  const status = createElement(
    "span",
    `pdf-status-pill ${getPdfStatusClass(meta)}`,
    meta.extractionStatus,
  );
  head.append(titleWrap, status);

  const stats = createElement("div", "pdf-stat-grid");
  stats.append(
    createPdfStat("파일 크기", formatBytes(meta.fileSize)),
    createPdfStat("페이지", meta.pageCount ? `${meta.pageCount}p` : "-"),
    createPdfStat("OCR 적용", meta.ocrPageCount ? `${meta.ocrPageCount}p` : "0p"),
    createPdfStat("반영 글자 수", meta.extractedCharCount.toLocaleString()),
  );

  panel.append(head, stats);

  if (meta.truncated) {
    panel.appendChild(
      createElement(
        "div",
        "warning-banner",
        "일부 페이지 또는 내용이 50,000자 제한으로 생략되었습니다.",
      ),
    );
  }

  if (meta.extractionError) {
    panel.appendChild(createElement("div", "warning-banner", meta.extractionError));
  }

  const actionRow = createElement("div", "action-row");
  actionRow.append(
    createButton({
      label: "PDF 교체",
      className: "ghost-button",
      onClick: openPicker,
      disabled: state.loadingPdf,
    }),
    createButton({
      label: "PDF 제거",
      className: "ghost-button",
      onClick: removePdfAndText,
      disabled: state.loadingPdf,
    }),
    createButton({
      label: "추출 텍스트만 유지",
      className: "ghost-button",
      onClick: keepExtractedTextOnly,
      disabled: state.loadingPdf,
    }),
  );
  panel.appendChild(actionRow);

  panel.appendChild(
    createElement(
      "p",
      "section-note",
      "PDF 제거는 참고 자료 칸도 함께 비웁니다. 텍스트만 남기려면 '추출 텍스트만 유지'를 사용하세요.",
    ),
  );

  return panel;
}

function createPdfStat(label, value) {
  const item = createElement("div", "pdf-stat");
  item.append(
    createElement("span", "pdf-stat-label", label),
    createElement("strong", "pdf-stat-value", value),
  );
  return item;
}

function getPdfStatusClass(meta) {
  if (state.loadingPdf) {
    return "is-busy";
  }

  if (meta.extractionError || meta.truncated) {
    return "is-warning";
  }

  return "is-ready";
}

function createMakerCard() {
  const card = createSectionCard(
    "01",
    "챗봇 기획",
    "무엇을 도와야 하는 챗봇인지 설명해 주세요. 직접 붙여 넣은 자료와 PDF 추출 텍스트를 함께 참고 자료로 쓸 수 있습니다.",
  );

  const layout = createElement("div", "form-stack");
  const briefField = createTextarea(
    state.makerBrief,
    "예: 우리 서비스 소개서와 FAQ를 바탕으로, 신규 고객에게 한국어로 친절하게 설명하는 챗봇을 만들고 싶어.",
    7,
    (value) => {
      state.makerBrief = value.slice(0, 3000);
      persistDraft();
    },
  );
  layout.appendChild(
    createField(
      "의도 설명",
      "챗봇의 역할, 대상, 말투, 목적을 적어 주세요.",
      briefField,
    ),
  );

  const chipRow = createElement("div", "chip-row");
  MAKER_SUGGESTIONS.forEach((suggestion) => {
    chipRow.appendChild(
      createButton({
        label: suggestion,
        className: "chip-button",
        onClick: () => {
          const nextBrief = state.makerBrief.trim()
            ? `${state.makerBrief.trim()}\n${suggestion}`
            : suggestion;
          setState({ makerBrief: nextBrief });
        },
      }),
    );
  });
  layout.appendChild(chipRow);

  layout.appendChild(createPdfUploadField());

  const sourceField = createTextarea(
    state.sourceText,
    "예: 서비스 소개, 제품 설명, 강의안, 운영 규칙, 말투 가이드, Q&A 문서 등을 붙여 넣어 주세요. PDF를 추출하면 이 칸에 자동으로 채워집니다.",
    10,
    (value) => {
      state.sourceText = value.slice(0, MAX_SOURCE_TEXT_LENGTH);
      persistDraft();
    },
  );
  layout.appendChild(
    createField(
      "참고 자료",
      `${state.sourceText.length.toLocaleString()} / ${MAX_SOURCE_TEXT_LENGTH.toLocaleString()}자. PDF 추출 후에도 직접 수정할 수 있습니다.`,
      sourceField,
    ),
  );

  if (state.makeError) {
    layout.appendChild(createElement("div", "error-banner", state.makeError));
  }

  layout.appendChild(
    createElement(
      "p",
      "section-note",
      "원본 PDF는 저장하지 않습니다. 새로고침 후에는 추출된 텍스트와 PDF 메타정보만 남습니다. OCR은 첫 사용 시 네트워크로 언어 데이터를 내려받을 수 있습니다.",
    ),
  );

  const actions = createElement("div", "action-row");
  actions.append(
    createButton({
      label: state.loadingMake ? "설계 생성 중..." : "설계 생성",
      className: "primary-button",
      onClick: generateBot,
      disabled: !canGenerateBot(),
    }),
    createButton({
      label: "입력 비우기",
      className: "ghost-button",
      onClick: clearInputs,
      disabled: state.loadingPdf || state.loadingMake || state.loadingPublish,
    }),
  );
  layout.appendChild(actions);

  card.appendChild(layout);
  return card;
}

function createConfigCard() {
  const card = createSectionCard(
    "02",
    "설계안 편집",
    "생성된 설계안을 다듬고 적용하세요. 적용하면 테스트 대화가 새 세션으로 초기화됩니다.",
  );

  if (!state.botConfig) {
    const empty = createElement("div", "empty-state");
    empty.appendChild(createElement("strong", "empty-title", "설계안이 아직 없습니다."));
    empty.appendChild(
      createElement(
        "p",
        "empty-copy",
        "왼쪽 기획 입력과 PDF 참고 자료를 바탕으로 설계안을 생성하면, 여기서 이름과 말투, 가드레일, 시작 질문까지 직접 수정할 수 있습니다.",
      ),
    );
    card.appendChild(empty);
    return card;
  }

  const formGrid = createElement("div", "config-grid");

  formGrid.append(
    createField(
      "봇 이름",
      "테스트 화면과 내보내기 파일에 쓰입니다.",
      createInput(state.botConfig.name, "예: 브랜드 안내 도우미", (value) => {
        state.botConfig.name = value;
        persistDraft();
      }),
    ),
    createField(
      "기본 언어",
      "주 응답 언어를 정합니다.",
      createSelect(
        state.botConfig.language,
        [
          { value: "ko", label: "한국어" },
          { value: "en", label: "English" },
          { value: "ja", label: "日本語" },
          { value: "zh", label: "中文" },
        ],
        (value) => {
          state.botConfig.language = value;
          persistDraft();
        },
      ),
    ),
    createField(
      "한줄 소개",
      "이 챗봇의 핵심 인상을 짧게 적습니다.",
      createInput(
        state.botConfig.tagline,
        "예: 우리 서비스의 첫 응답을 맡는 친절한 안내 챗봇",
        (value) => {
          state.botConfig.tagline = value;
          persistDraft();
        },
      ),
    ),
    createField(
      "대상 사용자",
      "누구를 돕는 챗봇인지 정합니다.",
      createInput(
        state.botConfig.targetAudience,
        "예: 신규 고객, 수강생, 내부 팀원",
        (value) => {
          state.botConfig.targetAudience = value;
          persistDraft();
        },
      ),
    ),
    createField(
      "역할",
      "이 챗봇이 어떤 정체성으로 말할지 적습니다.",
      createTextarea(
        state.botConfig.role,
        "예: 회사 서비스와 운영 정책을 설명하는 고객지원 도우미",
        3,
        (value) => {
          state.botConfig.role = value;
          persistDraft();
        },
      ),
    ),
    createField(
      "핵심 목적",
      "이 챗봇이 가장 잘해야 하는 일을 적습니다.",
      createTextarea(
        state.botConfig.purpose,
        "예: 고객 질문을 빠르게 분류하고, FAQ 범위에서는 바로 답하고, 그 밖의 경우 다음 절차를 안내한다.",
        3,
        (value) => {
          state.botConfig.purpose = value;
          persistDraft();
        },
      ),
    ),
    createField(
      "말투",
      "톤과 태도를 지정합니다.",
      createInput(
        state.botConfig.tone,
        "예: 친절하고 차분하며 과장 없는 말투",
        (value) => {
          state.botConfig.tone = value;
          persistDraft();
        },
      ),
    ),
    createField(
      "응답 스타일",
      "길이, 형식, 구조를 정합니다.",
      createInput(
        state.botConfig.responseStyle,
        "예: 짧은 단락 중심, 필요하면 번호 목록으로 안내",
        (value) => {
          state.botConfig.responseStyle = value;
          persistDraft();
        },
      ),
    ),
  );

  const longFields = createElement("div", "form-stack");
  longFields.append(
    createField(
      "첫 인사",
      "대화를 시작할 때 보여줄 기본 인사입니다.",
      createTextarea(
        state.botConfig.greeting,
        "예: 안녕하세요. 궁금한 내용을 말씀해 주시면 빠르게 도와드릴게요.",
        3,
        (value) => {
          state.botConfig.greeting = value;
          persistDraft();
        },
      ),
    ),
    createField(
      "핵심 지식 요약",
      "봇이 꼭 기억해야 할 정보만 간결하게 정리합니다.",
      createTextarea(
        state.botConfig.knowledge,
        "예: 서비스 특징, 정책 요약, 설명해야 할 핵심 기준",
        6,
        (value) => {
          state.botConfig.knowledge = value;
          persistDraft();
        },
      ),
    ),
    createField(
      "참고 자료 원문",
      "붙여 넣은 자료나 PDF 추출 결과를 유지하거나 직접 수정할 수 있습니다.",
      createTextarea(
        state.botConfig.referenceText,
        "예: 원문 FAQ, 강의노트, 설명 문서 전문",
        10,
        (value) => {
          state.botConfig.referenceText = value.slice(0, MAX_SOURCE_TEXT_LENGTH);
          persistDraft();
        },
      ),
    ),
    createField(
      "반드시 할 것",
      "줄바꿈으로 한 줄에 하나씩 적어 주세요.",
      createTextarea(
        joinLines(state.botConfig.mustDo),
        "예:\n짧고 분명하게 답한다.\n자료에 없는 내용은 확인을 요청한다.",
        5,
        (value) => {
          state.botConfig.mustDo = parseLines(value);
          persistDraft();
        },
      ),
    ),
    createField(
      "피해야 할 것",
      "하지 말아야 할 행동을 적습니다.",
      createTextarea(
        joinLines(state.botConfig.mustNotDo),
        "예:\n확인되지 않은 사실을 단정하지 않는다.\n자료에 없는 기능을 지어내지 않는다.",
        4,
        (value) => {
          state.botConfig.mustNotDo = parseLines(value);
          persistDraft();
        },
      ),
    ),
    createField(
      "시작 질문",
      "테스트 화면에서 바로 눌러볼 질문입니다.",
      createTextarea(
        joinLines(state.botConfig.starterQuestions),
        "예:\n이 챗봇은 어떤 질문에 잘 답해?\n자료를 기준으로 무엇을 설명해 줄 수 있어?",
        4,
        (value) => {
          state.botConfig.starterQuestions = parseLines(value);
          persistDraft();
        },
      ),
    ),
  );

  const actions = createElement("div", "action-row");
  actions.append(
    createButton({
      label: "수정 적용",
      className: "primary-button",
      onClick: applyBotConfigEdits,
      disabled:
        state.loadingPdf ||
        state.loadingMake ||
        state.loadingChat ||
        state.loadingPublish,
    }),
    createButton({
      label: "JSON 내보내기",
      className: "ghost-button",
      onClick: exportBotConfig,
    }),
  );

  card.append(formGrid, longFields, actions);
  return card;
}

function createSummaryCard() {
  const card = createSectionCard(
    "03",
    "설계 미리보기",
    "현재 설계가 테스트 화면에서 어떻게 동작할지 빠르게 확인합니다.",
  );

  if (!state.botConfig) {
    const empty = createElement("div", "empty-state");
    empty.appendChild(createElement("strong", "empty-title", "봇 미리보기가 아직 없습니다."));
    empty.appendChild(
      createElement(
        "p",
        "empty-copy",
        "설계안을 생성하면 여기에서 이름, 대상, 핵심 목적, 시작 인사와 규칙을 한눈에 볼 수 있습니다.",
      ),
    );
    card.appendChild(empty);
    return card;
  }

  const hero = createElement("div", "preview-hero");
  hero.appendChild(createElement("span", "preview-overline", "CURRENT BOT"));
  hero.appendChild(createElement("h3", "preview-title", state.botConfig.name));
  hero.appendChild(createElement("p", "preview-copy", state.botConfig.tagline));

  const meta = createElement("div", "preview-meta");
  meta.append(
    createElement("span", "meta-pill", getLanguageLabel(state.botConfig.language)),
    createElement("span", "meta-pill", state.botConfig.targetAudience),
  );

  if (state.uploadedPdfMeta) {
    meta.append(
      createElement(
        "span",
        "meta-pill",
        `PDF ${state.uploadedPdfMeta.pageCount}p / OCR ${state.uploadedPdfMeta.ocrPageCount}p`,
      ),
    );
  }

  hero.appendChild(meta);

  const blocks = createElement("div", "preview-blocks");
  blocks.append(
    createInfoList("Role", [state.botConfig.role]),
    createInfoList("Purpose", [state.botConfig.purpose]),
    createInfoList(
      "Must Do",
      state.botConfig.mustDo.length ? state.botConfig.mustDo : ["기본 규칙 없음"],
    ),
  );

  const greetingBox = createElement("div", "greeting-box");
  greetingBox.appendChild(createElement("span", "greeting-label", "첫 인사"));
  greetingBox.appendChild(createElement("p", "greeting-copy", state.botConfig.greeting));

  card.append(hero, blocks, greetingBox);
  return card;
}

function createMessageRow(message) {
  const row = createElement("div", `message-row ${message.role}`);

  if (message.role === "assistant") {
    row.appendChild(createElement("div", "message-avatar", "AI"));
  }

  const bubble = createElement("div", "bubble", message.content);
  row.appendChild(bubble);
  return row;
}

function createTypingRow() {
  const row = createElement("div", "message-row assistant");
  row.appendChild(createElement("div", "message-avatar", "AI"));

  const typing = createElement("div", "typing");
  typing.append(createElement("span"), createElement("span"), createElement("span"));

  row.appendChild(typing);
  return row;
}

function createChatCard() {
  const card = createSectionCard(
    "04",
    "테스트 대화",
    "생성된 봇을 바로 써 보면서 말투와 규칙이 제대로 반영되는지 확인하세요. 참고 자료에 없는 내용은 추측하지 않아야 합니다.",
  );

  if (!state.botConfig) {
    const empty = createElement("div", "empty-state");
    empty.appendChild(createElement("strong", "empty-title", "테스트할 봇이 없습니다."));
    empty.appendChild(
      createElement(
        "p",
        "empty-copy",
        "설계 생성이 끝나면 이 영역에서 실제 사용자처럼 질문을 보내고 응답을 검증할 수 있습니다.",
      ),
    );
    card.appendChild(empty);
    return card;
  }

  const headRow = createElement("div", "chat-head");
  const left = createElement("div", "chat-head-copy");
  left.append(
    createElement("h3", "chat-title", state.botConfig.name),
    createElement("p", "chat-subtitle", state.botConfig.tagline),
  );

  const actions = createElement("div", "action-row compact");
  actions.append(
    createButton({
      label: "대화 내보내기",
      className: "ghost-button",
      onClick: exportConversation,
      disabled: !state.messages.length || state.loadingChat,
    }),
    createButton({
      label: "대화 초기화",
      className: "ghost-button",
      onClick: clearConversation,
      disabled: state.loadingChat,
    }),
  );

  headRow.append(left, actions);
  card.appendChild(headRow);

  const meta = createElement("div", "chat-meta");
  meta.append(
    createElement("span", "meta-pill", `언어 ${getLanguageLabel(state.botConfig.language)}`),
    createElement("span", "meta-pill", `세션 ${shortSessionId()}`),
  );

  if (state.uploadedPdfMeta) {
    meta.append(
      createElement(
        "span",
        "meta-pill",
        `참고 자료 ${state.uploadedPdfMeta.extractedCharCount.toLocaleString()}자`,
      ),
    );
  }

  card.appendChild(meta);

  const shell = createElement("div", "chat-shell");
  const log = createElement("div", "chat-log");
  log.id = "chat-log";

  if (!state.messages.length) {
    const welcome = createElement("div", "welcome-panel");
    welcome.appendChild(createElement("p", "welcome-label", "첫 인사"));
    welcome.appendChild(createElement("h4", "welcome-title", state.botConfig.greeting));

    const starterWrap = createElement("div", "starter-grid");
    state.botConfig.starterQuestions.forEach((question) => {
      starterWrap.appendChild(
        createButton({
          label: question,
          className: "starter-button",
          onClick: () => {
            void sendMessage(question);
          },
          disabled: state.loadingChat,
        }),
      );
    });

    welcome.appendChild(starterWrap);
    log.appendChild(welcome);
  }

  state.messages.forEach((message) => {
    log.appendChild(createMessageRow(message));
  });

  if (state.loadingChat) {
    log.appendChild(createTypingRow());
  }

  shell.appendChild(log);

  const composer = document.createElement("form");
  composer.className = "composer";

  const input = document.createElement("input");
  input.className = "composer-input";
  input.type = "text";
  input.placeholder = "테스트할 질문을 입력해 주세요.";
  input.autocomplete = "off";
  input.disabled = state.loadingChat;

  const sendButton = createButton({
    label: state.loadingChat ? "..." : "보내기",
    className: "send-button",
    type: "submit",
    disabled: state.loadingChat,
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();

    if (!value) {
      input.setCustomValidity("질문을 먼저 입력해 주세요.");
      input.reportValidity();
      return;
    }

    input.setCustomValidity("");
    void sendMessage(value);
  });

  composer.append(input, sendButton);
  shell.appendChild(composer);
  shell.appendChild(
    createElement(
      "p",
      "section-note",
      "테스트 대화와 설계안은 브라우저에 저장됩니다. 서버 로그는 기본적으로 꺼져 있고, 켜더라도 메타데이터만 남기도록 구성했습니다.",
    ),
  );

  card.appendChild(shell);

  queueMicrotask(() => {
    const chatLog = document.getElementById("chat-log");
    chatLog?.scrollTo({ top: chatLog.scrollHeight, behavior: "smooth" });
  });

  return card;
}

function createPublishCard() {
  const card = createSectionCard(
    "05",
    "링크 발행",
    "설계를 마친 챗봇을 전용 링크로 발행합니다. 링크를 받은 사람은 메이커 화면이 아니라 공개 챗봇 화면만 보게 됩니다.",
  );

  if (!state.botConfig) {
    const empty = createElement("div", "empty-state");
    empty.appendChild(createElement("strong", "empty-title", "발행할 챗봇이 아직 없습니다."));
    empty.appendChild(
      createElement(
        "p",
        "empty-copy",
        "설계안을 만든 뒤 발행하기를 누르면 공유 전용 링크가 만들어집니다.",
      ),
    );
    card.appendChild(empty);
    return card;
  }

  const wrap = createElement("div", "publish-card");

  wrap.appendChild(
    createElement(
      "p",
      "section-note",
      "다시 발행하면 이전 링크를 덮어쓰지 않고 새 링크가 만들어집니다. 지금 카드에는 마지막으로 발행한 링크만 보여줍니다.",
    ),
  );

  if (state.publishError) {
    wrap.appendChild(createElement("div", "error-banner", state.publishError));
  }

  if (state.publishedBot) {
    const linkBox = createElement("div", "publish-link-box");
    linkBox.append(
      createElement("span", "publish-link-label", "마지막 발행 링크"),
      createElement("p", "publish-link-url", state.publishedBot.shareUrl),
    );

    const meta = createElement("div", "publish-meta");
    meta.append(
      createElement(
        "span",
        "meta-pill",
        `발행 ${formatPublishedAt(state.publishedBot.publishedAt)}`,
      ),
      createElement(
        "span",
        "meta-pill",
        state.publishedBot.accessMode === "link-only"
          ? "링크 있는 사람만"
          : state.publishedBot.accessMode,
      ),
    );

    linkBox.appendChild(meta);
    wrap.appendChild(linkBox);
  }

  const actions = createElement("div", "action-row");
  actions.append(
    createButton({
      label: state.loadingPublish ? "발행 중.." : "발행하기",
      className: "primary-button",
      onClick: publishBot,
      disabled: !canPublishBot(),
    }),
  );

  if (state.publishedBot?.shareUrl) {
    actions.append(
      createButton({
        label: "링크 복사",
        className: "ghost-button",
        onClick: () => {
          void copyPublishedLink();
        },
      }),
      createButton({
        label: "챗봇 열기",
        className: "ghost-button",
        onClick: () => {
          window.open(state.publishedBot.shareUrl, "_blank", "noopener,noreferrer");
        },
      }),
    );
  }

  wrap.appendChild(actions);
  card.appendChild(wrap);
  return card;
}

function render() {
  app.replaceChildren();

  const page = createElement("div", "page");
  page.appendChild(createSidebar());

  const main = createElement("main", "panel main-panel");
  const workspace = createElement("div", "workspace-grid");
  const leftColumn = createElement("div", "column-stack");
  const rightColumn = createElement("div", "column-stack");

  leftColumn.append(createMakerCard(), createConfigCard());
  rightColumn.append(createSummaryCard(), createChatCard(), createPublishCard());

  workspace.append(leftColumn, rightColumn);
  main.appendChild(workspace);
  page.appendChild(main);
  app.appendChild(page);
}

render();
