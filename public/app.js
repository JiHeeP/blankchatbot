import { ENTRY_Q, LANGUAGES, TERRAINS } from "./config.js";

const STORAGE_KEY = "terrain-explorer-state-v2";
const SESSION_KEY = "terrain-explorer-session-id";

const UI_TEXT = {
  ko: {
    introTitle: "지형 탐험 도우미",
    introCopy:
      "원안의 수업 흐름을 그대로 살려, 아이들이 지형의 모습과 자원을 차근차근 묻도록 만든 챗봇입니다.",
    info1Label: "AI Model",
    info1Value: "Kimi 2.5",
    info2Label: "수업 흐름",
    info2Value: "모습 → 자원 → 하는 일",
    info3Label: "기록 상태",
    info3Value: "브라우저 자동 저장 + 서버 로그",
    languageTitle: "대화에 쓸 언어를 고르세요.",
    languageCopy: "학생이 편하게 시작할 수 있도록 먼저 언어를 정합니다.",
    terrainTitle: "탐험할 지형을 골라 주세요.",
    terrainCopy: "원안의 흐름에 맞춰 산지, 하천, 해안 중 하나를 선택합니다.",
    terrainBack: "언어 다시 선택",
    chatCopy:
      "첫 질문 버튼을 누르면 원안에 맞는 시작 질문이 자동으로 들어갑니다.",
    reset: "처음으로",
    clearChat: "대화 초기화",
    exportChat: "대화 내보내기",
    placeholder: "궁금한 것을 물어봐!",
    helper:
      "대화는 이 브라우저에 자동 저장되고, 서버의 logs 폴더에도 기록됩니다.",
    send: "보내기",
    startHint: "여기를 눌러 시작!",
    emptyError: "질문을 먼저 적어 주세요.",
    languageCaption: "학생에게 보여 줄 언어를 이 기준으로 맞춥니다.",
    statusLabel: "현재 세션",
    userLabel: "학생",
    assistantLabel: "도우미",
    exportTitle: "지형 탐험 도우미 대화 기록",
  },
  zh: {
    introTitle: "地形探索助手",
    introCopy:
      "这个聊天机器人保留了原案中的课堂流程，让学生一步一步地提问。",
    info1Label: "AI Model",
    info1Value: "Kimi 2.5",
    info2Label: "学习流程",
    info2Value: "样子 → 资源 → 做什么",
    info3Label: "记录状态",
    info3Value: "浏览器自动保存 + 服务器日志",
    languageTitle: "请选择对话语言。",
    languageCopy: "先选语言，再进入地形学习。",
    terrainTitle: "请选择要探索的地形。",
    terrainCopy: "按照原案流程，在山地、河流、海岸中选择一个。",
    terrainBack: "重新选择语言",
    chatCopy: "点击起始问题按钮，就会自动发送符合原案的第一句提问。",
    reset: "重新开始",
    clearChat: "清空对话",
    exportChat: "导出对话",
    placeholder: "请输入问题...",
    helper: "对话会自动保存在浏览器中，也会写入服务器 logs 文件夹。",
    send: "发送",
    startHint: "点击这里开始！",
    emptyError: "请先输入问题。",
    languageCaption: "按这个语言来显示学生看到的界面。",
    statusLabel: "当前会话",
    userLabel: "学生",
    assistantLabel: "助手",
    exportTitle: "地形探索助手对话记录",
  },
  ru: {
    introTitle: "Помощник по изучению рельефа",
    introCopy:
      "Чат-бот повторяет структуру исходного плана и ведет ученика по шагам.",
    info1Label: "AI Model",
    info1Value: "Kimi 2.5",
    info2Label: "Порядок урока",
    info2Value: "вид → ресурсы → чем занимаются",
    info3Label: "Состояние истории",
    info3Value: "автосохранение + серверный лог",
    languageTitle: "Выберите язык общения.",
    languageCopy: "Сначала выбираем язык, потом переходим к выбору рельефа.",
    terrainTitle: "Выберите рельеф для изучения.",
    terrainCopy: "Можно выбрать горы, реку или побережье по исходному сценарию.",
    terrainBack: "Сменить язык",
    chatCopy:
      "Кнопка стартового вопроса отправляет первую фразу по структуре исходного плана.",
    reset: "Сначала",
    clearChat: "Очистить диалог",
    exportChat: "Экспорт диалога",
    placeholder: "Задайте вопрос...",
    helper:
      "Диалог автоматически сохраняется в браузере и записывается в папку logs на сервере.",
    send: "Отправить",
    startHint: "Нажмите, чтобы начать!",
    emptyError: "Сначала введите вопрос.",
    languageCaption: "Интерфейс ученика будет показан на этом языке.",
    statusLabel: "Текущая сессия",
    userLabel: "Ученик",
    assistantLabel: "Помощник",
    exportTitle: "История диалога помощника по рельефу",
  },
};

const TERRAIN_CAPTIONS = {
  mountain: {
    ko: "높은 땅, 꼬불꼬불한 길, 산의 자원을 알아봐요.",
    zh: "看看高高的山地、弯弯的路和山里的资源。",
    ru: "Узнаем про высокие горы, извилистые дороги и горные ресурсы.",
  },
  river: {
    ko: "넓고 평평한 곳, 강 주변의 자원을 배워요.",
    zh: "学习平坦开阔的地方和河流周围的资源。",
    ru: "Изучим ровные места и ресурсы вокруг реки.",
  },
  coast: {
    ko: "바다와 섬, 갯벌과 항구 이야기를 시작해요.",
    zh: "开始了解大海、岛屿、滩涂和港口。",
    ru: "Поговорим о море, островах, приливных отмелях и портах.",
  },
};

const app = document.getElementById("app");

const state = loadInitialState();

function loadInitialState() {
  const persisted = readPersistedState();
  const lang = isValidLang(persisted.lang) ? persisted.lang : null;
  const terrain = lang && isValidTerrain(lang, persisted.terrain) ? persisted.terrain : null;
  const messages = sanitizeMessages(persisted.messages);
  const sessionId = getSessionId();

  return {
    sessionId,
    lang,
    terrain,
    messages,
    loading: false,
    started: messages.length > 0 ? true : Boolean(persisted.started && terrain),
    lastSavedAt: typeof persisted.lastSavedAt === "string" ? persisted.lastSavedAt : null,
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
        sessionId: state.sessionId,
        lang: state.lang,
        terrain: state.terrain,
        messages: state.messages,
        started: state.started,
        lastSavedAt: state.lastSavedAt,
      }),
    );
  } catch {
    // Ignore storage failures so the chat can still run.
  }
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

  return messages.filter(
    (message) =>
      message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim(),
  );
}

function isValidLang(lang) {
  return LANGUAGES.some((item) => item.code === lang);
}

function isValidTerrain(lang, terrain) {
  return Boolean((TERRAINS[lang] || []).some((item) => item.code === terrain));
}

function getCopy() {
  return UI_TEXT[state.lang || "ko"];
}

function getTerrainList() {
  return TERRAINS[state.lang || "ko"] || TERRAINS.ko;
}

function getTerrain() {
  return getTerrainList().find((item) => item.code === state.terrain);
}

function getLanguage() {
  return LANGUAGES.find((item) => item.code === state.lang) || LANGUAGES[0];
}

function shortSessionId() {
  return state.sessionId.slice(0, 8);
}

function formatSavedAt() {
  if (!state.lastSavedAt) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat(state.lang || "ko", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(state.lastSavedAt));
  } catch {
    return state.lastSavedAt;
  }
}

function setState(patch) {
  Object.assign(state, patch);
  state.lastSavedAt = new Date().toISOString();
  persistState();
  render();
}

function resetState() {
  Object.assign(state, {
    sessionId: renewSessionId(),
    lang: null,
    terrain: null,
    messages: [],
    loading: false,
    started: false,
    lastSavedAt: new Date().toISOString(),
  });
  persistState();
  render();
}

function clearConversation() {
  Object.assign(state, {
    sessionId: renewSessionId(),
    messages: [],
    loading: false,
    started: false,
    lastSavedAt: new Date().toISOString(),
  });
  persistState();
  render();
}

function exportConversation() {
  if (!state.messages.length) {
    return;
  }

  const copy = getCopy();
  const language = getLanguage();
  const terrain = getTerrain();
  const lines = [
    copy.exportTitle,
    `Exported at: ${new Date().toLocaleString()}`,
    `Session ID: ${state.sessionId}`,
    `Language: ${language.label}`,
    `Terrain: ${terrain?.label || "-"}`,
    "",
  ];

  state.messages.forEach((message, index) => {
    lines.push(
      `[${index + 1}] ${message.role === "user" ? copy.userLabel : copy.assistantLabel}`,
    );
    lines.push(message.content);
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+/, "");

  anchor.href = url;
  anchor.download = `terrain-chat-${stamp}.txt`;
  anchor.click();

  URL.revokeObjectURL(url);
}

function createSidebar(copy) {
  const sidebar = document.createElement("aside");
  sidebar.className = "panel sidebar";
  sidebar.innerHTML = `
    <div class="brand">
      <div class="brand-head">
        <img class="brand-mark" src="/brand-mark.svg" alt="Terrain Explorer" />
        <div class="badge">🗺️ Geography Lab</div>
      </div>
      <h1 class="title">${copy.introTitle}</h1>
      <p class="subtitle">${copy.introCopy}</p>
    </div>
    <div class="fact-list">
      <article class="fact-card">
        <span class="fact-label">${copy.info1Label}</span>
        <div class="fact-value">${copy.info1Value}</div>
      </article>
      <article class="fact-card">
        <span class="fact-label">${copy.info2Label}</span>
        <div class="fact-value">${copy.info2Value}</div>
      </article>
      <article class="fact-card">
        <span class="fact-label">${copy.info3Label}</span>
        <div class="fact-value">${copy.info3Value}</div>
      </article>
    </div>
    <div class="brand-note">
      <span>${copy.statusLabel}</span>
      <strong>${shortSessionId()}</strong>
      <em>${formatSavedAt()}</em>
    </div>
  `;
  return sidebar;
}

function createActionButton({
  label,
  className = "ghost-button",
  onClick,
  disabled = false,
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function createScreen(title, description, actions = []) {
  const screen = document.createElement("section");
  screen.className = "screen";

  const header = document.createElement("div");
  header.className = "screen-header";

  const left = document.createElement("div");
  left.innerHTML = `
    <div>
      <p class="eyebrow">Classroom Flow</p>
      <h2 class="screen-title">${title}</h2>
      <p class="screen-copy">${description}</p>
    </div>
  `;
  header.appendChild(left);

  if (actions.length) {
    const cluster = document.createElement("div");
    cluster.className = "action-cluster";
    actions.forEach((action) => cluster.appendChild(action));
    header.appendChild(cluster);
  }

  screen.appendChild(header);
  return screen;
}

function createLanguageScreen(copy) {
  const screen = createScreen(copy.languageTitle, copy.languageCopy);
  const grid = document.createElement("div");
  grid.className = "card-grid";

  LANGUAGES.forEach((language) => {
    const button = document.createElement("button");
    button.className = "select-card";
    button.innerHTML = `
      <span class="emoji">${language.flag}</span>
      <span class="label">${language.label}</span>
      <span class="caption">${copy.languageCaption}</span>
    `;
    button.addEventListener("click", () => {
      setState({
        lang: language.code,
        terrain: null,
        messages: [],
        started: false,
        loading: false,
        sessionId: renewSessionId(),
      });
    });
    grid.appendChild(button);
  });

  screen.appendChild(grid);
  return screen;
}

function createTerrainScreen(copy) {
  const screen = createScreen(copy.terrainTitle, copy.terrainCopy, [
    createActionButton({
      label: copy.terrainBack,
      onClick: () => {
        setState({
          lang: null,
          terrain: null,
          messages: [],
          started: false,
          loading: false,
          sessionId: renewSessionId(),
        });
      },
    }),
  ]);

  const grid = document.createElement("div");
  grid.className = "card-grid";

  getTerrainList().forEach((terrain) => {
    const button = document.createElement("button");
    button.className = "select-card";
    button.innerHTML = `
      <span class="emoji">${terrain.emoji}</span>
      <span class="label">${terrain.label}</span>
      <span class="caption">${TERRAIN_CAPTIONS[terrain.code][state.lang]}</span>
    `;
    button.addEventListener("click", () => {
      setState({
        terrain: terrain.code,
        messages: [],
        loading: false,
        started: false,
        sessionId: renewSessionId(),
      });
    });
    grid.appendChild(button);
  });

  screen.appendChild(grid);
  return screen;
}

function createMessageRow(message) {
  const row = document.createElement("div");
  row.className = `message-row ${message.role}`;

  if (message.role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "🌍";
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.content;
  row.appendChild(bubble);

  return row;
}

function createTypingRow() {
  const row = document.createElement("div");
  row.className = "message-row assistant";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "🌍";

  const typing = document.createElement("div");
  typing.className = "typing";
  typing.innerHTML = "<span></span><span></span><span></span>";

  row.append(avatar, typing);
  return row;
}

function createChatScreen(copy) {
  const terrain = getTerrain();
  const label = getLanguage();
  const actions = [
    createActionButton({
      label: copy.exportChat,
      className: "mini-button",
      disabled: !state.messages.length || state.loading,
      onClick: exportConversation,
    }),
    createActionButton({
      label: copy.clearChat,
      className: "mini-button",
      disabled: state.loading,
      onClick: clearConversation,
    }),
    createActionButton({
      label: copy.reset,
      onClick: resetState,
      disabled: state.loading,
    }),
  ];

  const screen = createScreen(
    `${terrain.label} ${
      state.lang === "ko" ? "탐험" : state.lang === "zh" ? "探索" : "исследование"
    }`,
    copy.chatCopy,
    actions,
  );

  const chatShell = document.createElement("div");
  chatShell.className = "chat-shell";

  const meta = document.createElement("div");
  meta.className = "meta-row";
  meta.innerHTML = `
    <span class="status-pill">${label.flag} ${label.label}</span>
    <span class="meta-tag">${copy.statusLabel}: ${shortSessionId()}</span>
  `;
  chatShell.appendChild(meta);

  if (!state.started) {
    const hero = document.createElement("section");
    hero.className = "chat-hero";
    hero.innerHTML = `
      <div class="hero-icon">${terrain.emoji}</div>
      <h3 class="hero-title">${ENTRY_Q[state.terrain][state.lang]}</h3>
      <p class="hero-copy">${copy.startHint}</p>
    `;

    const startButton = document.createElement("button");
    startButton.className = "primary-button";
    startButton.textContent = ENTRY_Q[state.terrain][state.lang];
    startButton.addEventListener("click", () => {
      void sendMessage(ENTRY_Q[state.terrain][state.lang]);
    });

    hero.appendChild(startButton);
    chatShell.appendChild(hero);
  }

  const log = document.createElement("div");
  log.className = "chat-log";
  log.id = "chat-log";

  state.messages.forEach((message) => {
    log.appendChild(createMessageRow(message));
  });

  if (state.loading) {
    log.appendChild(createTypingRow());
  }

  chatShell.appendChild(log);

  const composer = document.createElement("form");
  composer.className = "composer";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = copy.placeholder;
  input.autocomplete = "off";
  input.disabled = state.loading;

  const sendButton = document.createElement("button");
  sendButton.type = "submit";
  sendButton.textContent = "↑";
  sendButton.title = copy.send;
  sendButton.disabled = state.loading;

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();

    if (!value) {
      input.setCustomValidity(copy.emptyError);
      input.reportValidity();
      return;
    }

    input.setCustomValidity("");
    void sendMessage(value);
  });

  composer.append(input, sendButton);
  chatShell.appendChild(composer);

  const helper = document.createElement("p");
  helper.className = "helper-line";
  helper.textContent = copy.helper;
  chatShell.appendChild(helper);

  screen.appendChild(chatShell);

  queueMicrotask(() => {
    const chatLog = document.getElementById("chat-log");
    chatLog?.scrollTo({ top: chatLog.scrollHeight, behavior: "smooth" });
  });

  return screen;
}

async function sendMessage(text) {
  if (!text.trim() || state.loading) {
    return;
  }

  const nextMessages = [...state.messages, { role: "user", content: text.trim() }];

  setState({
    messages: nextMessages,
    loading: true,
    started: true,
  });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        lang: state.lang,
        terrain: state.terrain,
        messages: nextMessages,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "챗봇 응답을 받아오지 못했습니다.");
    }

    setState({
      messages: [...nextMessages, { role: "assistant", content: data.message }],
      loading: false,
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
              : "인터넷을 확인하거나 다시 질문해 줘! 🔌",
        },
      ],
      loading: false,
    });
  }
}

function render() {
  const copy = getCopy();

  app.replaceChildren();

  const page = document.createElement("div");
  page.className = "page";
  page.appendChild(createSidebar(copy));

  const main = document.createElement("main");
  main.className = "panel main-panel";

  if (!state.lang) {
    main.appendChild(createLanguageScreen(copy));
  } else if (!state.terrain) {
    main.appendChild(createTerrainScreen(copy));
  } else {
    main.appendChild(createChatScreen(copy));
  }

  page.appendChild(main);
  app.appendChild(page);
}

render();
