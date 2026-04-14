import { getLanguageLabel } from "./config.js";

const app = document.getElementById("app");
const botId = readBotIdFromLocation();

const state = {
  botId,
  sessionId: createSessionId(),
  bot: null,
  messages: [],
  loadingBot: true,
  loadingChat: false,
  error: "",
};

void loadBot();

async function loadBot() {
  if (!state.botId) {
    state.loadingBot = false;
    state.error = "링크 형식이 올바르지 않습니다.";
    render();
    return;
  }

  try {
    const response = await fetch(
      `/api/public-bot?botId=${encodeURIComponent(state.botId)}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "챗봇 정보를 불러오지 못했습니다.");
    }

    state.bot = data.bot || null;
    state.error = "";
  } catch (error) {
    state.error =
      error instanceof Error
        ? error.message
        : "챗봇 정보를 불러오지 못했습니다.";
  } finally {
    state.loadingBot = false;
    render();
  }
}

async function sendMessage(text) {
  if (!state.bot || state.loadingChat || !text.trim()) {
    return;
  }

  const nextMessages = [...state.messages, { role: "user", content: text.trim() }];
  state.messages = nextMessages;
  state.loadingChat = true;
  render();

  try {
    const response = await fetch("/api/public-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botId: state.botId,
        sessionId: state.sessionId,
        messages: nextMessages,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "챗봇 응답을 받지 못했습니다.");
    }

    state.messages = [...nextMessages, { role: "assistant", content: data.message }];
  } catch (error) {
    state.messages = [
      ...nextMessages,
      {
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
    ];
  } finally {
    state.loadingChat = false;
    render();
  }
}

function readBotIdFromLocation() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  if (pathParts[0] === "bot" && pathParts[1]) {
    return pathParts[1];
  }

  const queryId = new URLSearchParams(window.location.search).get("botId");
  return queryId ? queryId.trim() : "";
}

function createSessionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `public-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function createButton({ label, className, onClick, disabled = false, type = "button" }) {
  const button = createElement("button", className, label);
  button.type = type;
  button.disabled = disabled;

  if (typeof onClick === "function") {
    button.addEventListener("click", onClick);
  }

  return button;
}

function createMessageRow(message) {
  const row = createElement("div", `message-row ${message.role}`);

  if (message.role === "assistant") {
    row.appendChild(createElement("div", "message-avatar", "AI"));
  }

  row.appendChild(createElement("div", "bubble", message.content));
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

function createErrorView(message) {
  const shell = createElement("div", "page public-page");
  const main = createElement("main", "panel public-main");
  const card = createElement("section", "section-card public-card");
  const title = createElement("h1", "section-title", "공유 챗봇을 열 수 없습니다");
  const copy = createElement("p", "section-desc", message);
  const actions = createElement("div", "action-row");
  actions.appendChild(
    createButton({
      label: "메이커로 돌아가기",
      className: "ghost-button",
      onClick: () => {
        window.location.href = "/";
      },
    }),
  );

  card.append(title, copy, actions);
  main.appendChild(card);
  shell.appendChild(main);
  return shell;
}

function createLoadingView() {
  const shell = createElement("div", "page public-page");
  const main = createElement("main", "panel public-main");
  const card = createElement("section", "section-card public-card");
  card.append(
    createElement("span", "header-chip", "Loading"),
    createElement("h1", "section-title", "챗봇을 불러오는 중입니다"),
    createElement(
      "p",
      "section-desc",
      "공유 링크에 연결된 챗봇 정보를 확인하고 있습니다.",
    ),
  );
  main.appendChild(card);
  shell.appendChild(main);
  return shell;
}

function createPublicView() {
  const shell = createElement("div", "page public-page");
  const main = createElement("main", "panel public-main");

  const hero = createElement("section", "section-card public-card");
  const heroTop = createElement("div", "public-hero-top");
  const left = createElement("div", "public-hero-copy");
  left.append(
    createElement("span", "header-chip", "Link Only Bot"),
    createElement("h1", "section-title", state.bot.name),
    createElement("p", "section-desc", state.bot.tagline),
  );

  const actionRow = createElement("div", "action-row");
  actionRow.append(
    createButton({
      label: "메이커 홈",
      className: "ghost-button",
      onClick: () => {
        window.location.href = "/";
      },
    }),
  );

  heroTop.append(left, actionRow);

  const meta = createElement("div", "public-meta-row");
  meta.append(
    createElement("span", "meta-pill", `언어 ${getLanguageLabel(state.bot.language)}`),
    createElement("span", "meta-pill", `발행 ${formatPublishedAt(state.bot.publishedAt)}`),
    createElement("span", "meta-pill", "링크 공유 전용"),
  );

  hero.append(heroTop, meta);

  const chatCard = createElement("section", "section-card public-card");
  const chatHead = createElement("div", "chat-head");
  const chatCopy = createElement("div", "chat-head-copy");
  chatCopy.append(
    createElement("h2", "chat-title", state.bot.name),
    createElement(
      "p",
      "chat-subtitle",
      "이 화면은 링크를 받은 사람만 사용할 수 있는 공개 챗봇입니다.",
    ),
  );
  chatHead.appendChild(chatCopy);
  chatCard.appendChild(chatHead);

  const chatShell = createElement("div", "chat-shell");
  const log = createElement("div", "chat-log");
  log.id = "public-chat-log";

  if (!state.messages.length) {
    const welcome = createElement("div", "welcome-panel");
    welcome.append(
      createElement("p", "welcome-label", "인사말"),
      createElement("h3", "welcome-title", state.bot.greeting),
    );

    const starterGrid = createElement("div", "starter-grid");
    state.bot.starterQuestions.forEach((question) => {
      starterGrid.appendChild(
        createButton({
          label: question,
          className: "starter-button",
          disabled: state.loadingChat,
          onClick: () => {
            void sendMessage(question);
          },
        }),
      );
    });
    welcome.appendChild(starterGrid);
    log.appendChild(welcome);
  }

  state.messages.forEach((message) => {
    log.appendChild(createMessageRow(message));
  });

  if (state.loadingChat) {
    log.appendChild(createTypingRow());
  }

  chatShell.appendChild(log);

  const composer = document.createElement("form");
  composer.className = "composer";
  const input = document.createElement("input");
  input.className = "composer-input";
  input.type = "text";
  input.placeholder = "질문을 입력해 주세요";
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
      input.setCustomValidity("질문을 입력해 주세요.");
      input.reportValidity();
      return;
    }

    input.setCustomValidity("");
    void sendMessage(value);
  });

  composer.append(input, sendButton);
  chatShell.appendChild(composer);
  chatShell.appendChild(
    createElement(
      "p",
      "section-note",
      "링크가 없으면 이 챗봇에 접근할 수 없고, 검색엔진에도 노출되지 않도록 설정되어 있습니다.",
    ),
  );

  chatCard.appendChild(chatShell);
  main.append(hero, chatCard);
  shell.appendChild(main);

  queueMicrotask(() => {
    const chatLog = document.getElementById("public-chat-log");
    chatLog?.scrollTo({ top: chatLog.scrollHeight, behavior: "smooth" });
  });

  return shell;
}

function render() {
  app.replaceChildren();

  if (state.loadingBot) {
    app.appendChild(createLoadingView());
    return;
  }

  if (state.error || !state.bot) {
    app.appendChild(createErrorView(state.error || "챗봇을 찾지 못했습니다."));
    return;
  }

  app.appendChild(createPublicView());
}

render();
