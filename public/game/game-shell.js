/**
 * ═══════════════════════════════════════════════════════════════════
 * CORESAPIAN — Shell JS v3.0
 *
 * What changed from v2:
 *   • Removed click overlay — game starts immediately after load
 *   • Removed toolbar (sound/fullscreen buttons) — was blocking iOS
 *   • New loading screen with progress + status messages
 *   • Audio auto-activates on first touch/click (no toggle needed)
 *   • Removed rotate gate — game works in any orientation
 * ═══════════════════════════════════════════════════════════════════
 */

// ── DOM ────────────────────────────────────────────────────────────
const canvas = document.getElementById("canvas");
const ambientAudio = document.getElementById("ambient-audio");
const loader = document.getElementById("loader");
const loaderFill = document.getElementById("loader-fill");
const loaderPercent = document.getElementById("loader-percent");
const loaderStatus = document.getElementById("loader-status");
const loaderError = document.getElementById("loader-error");
const loaderErrorText = document.getElementById("loader-error-text");
const chatToggle = document.getElementById("chat-toggle");
const chatPanel = document.getElementById("chat-panel");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatClose = document.getElementById("chat-close");
const chatStatusDot = document.getElementById("chat-status-dot");
const chatBadge = document.getElementById("chat-badge");
const loaderVersion = document.getElementById("loader-version");
const GODOT_CONFIG = window.__GODOT_CONFIG;
const THREADS_ENABLED = false;
const PROGRESS_STALL_TIMEOUT_MS = 120_000;
const CHAT_RECONNECT_DELAY_MS = 3_000;

// ── State ──────────────────────────────────────────────────────────
let gameLoaded = false;
let stallTimer = 0;
let chatWs = null;
let chatOpened = false;
let chatConnected = false;
let unreadCount = 0;
let chatReconnectTimer = 0;
let audioActivated = false;

const trackedAudioContexts = new Set();

// ── Loading status messages ───────────────────────────────────────
const STATUS_MESSAGES = [
  { pct: 0,   text: "Initializing engine" },
  { pct: 10,  text: "Loading runtime" },
  { pct: 25,  text: "Decoding assets" },
  { pct: 45,  text: "Building world geometry" },
  { pct: 65,  text: "Assembling geometry" },
  { pct: 80,  text: "Lighting the torches" },
  { pct: 92,  text: "Awakening the spirits" },
  { pct: 100, text: "Launching experience" },
];

function getStatusText(percent) {
  let msg = STATUS_MESSAGES[0].text;
  for (const entry of STATUS_MESSAGES) {
    if (percent >= entry.pct) msg = entry.text;
  }
  return msg;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 1 — Loading Screen
// ═══════════════════════════════════════════════════════════════════

function updateLoadingProgress(current, total) {
  if (current > 0 && total > 0) {
    const percent = Math.min(100, Math.round((current / total) * 100));
    if (loaderFill) loaderFill.style.width = `${percent}%`;
    if (loaderPercent) loaderPercent.textContent = `${percent}%`;
    if (loaderStatus) loaderStatus.textContent = getStatusText(percent);
  }
  resetStallTimer();
}

function resetStallTimer() {
  if (stallTimer) clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    if (!gameLoaded) showLoadingError();
  }, PROGRESS_STALL_TIMEOUT_MS);
}

function showLoadingError(detail) {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = 0; }
  if (loader) loader.classList.add("is-error");
  if (loaderError) loaderError.hidden = false;
  if (loaderErrorText) {
    loaderErrorText.textContent = detail
      ? `⚠ ${detail}`
      : "⚠ Connection failed";
  }
  console.error("[Coresapian] Loading error:", detail || "stall timeout");
}

function hideLoadingScreen() {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = 0; }
  if (loaderStatus) loaderStatus.textContent = "Launching experience";
  if (loaderFill) loaderFill.style.width = "100%";
  if (loaderPercent) loaderPercent.textContent = "100%";

  // Brief pause at 100% then fade
  setTimeout(() => {
    if (loader) {
      loader.classList.add("is-fading");
      setTimeout(() => { loader.hidden = true; }, 900);
    }
    // Reveal chat toggle
    if (chatToggle) chatToggle.hidden = false;

    // Focus canvas + trigger resize so the Godot engine begins rendering
    // immediately after the loader hides (critical for iOS WKWebView).
    if (canvas) {
      try { canvas.focus({ preventScroll: true }); } catch {}
    }
    window.dispatchEvent(new Event("resize"));
  }, 400);
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2 — Chat (WebSocket)
// ═══════════════════════════════════════════════════════════════════

function getChatWsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/chat`;
}

function setChatStatus(status) {
  chatConnected = (status === "connected");
  if (!chatStatusDot) return;
  chatStatusDot.classList.remove("is-disconnected", "is-connecting");
  if (status === "connected") {
    // Default amber dot
  } else if (status === "connecting") {
    chatStatusDot.classList.add("is-connecting");
  } else {
    chatStatusDot.classList.add("is-disconnected");
  }
}

function connectChat() {
  if (chatWs && (chatWs.readyState === WebSocket.OPEN || chatWs.readyState === WebSocket.CONNECTING)) return;
  if (chatReconnectTimer) { clearTimeout(chatReconnectTimer); chatReconnectTimer = 0; }

  try {
    setChatStatus("connecting");
    chatWs = new WebSocket(getChatWsUrl());
  } catch (err) {
    console.warn("[chat] WebSocket init failed:", err);
    setChatStatus("disconnected");
    scheduleChatReconnect();
    return;
  }

  chatWs.onopen = () => setChatStatus("connected");

  chatWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (Array.isArray(data)) {
        chatMessages.replaceChildren();
        for (const msg of data) appendChatMessage(msg);
        scrollChatToBottom();
      } else if (data && typeof data.text === "string") {
        appendChatMessage(data);
        scrollChatToBottom();
        if (!chatOpened) incrementUnread();
      } else if (data && data.type === "system") {
        appendSystemMessage(data.message || "");
        scrollChatToBottom();
      }
    } catch (err) {
      console.warn("[chat] parse error:", err);
    }
  };

  chatWs.onerror = () => console.warn("[chat] WebSocket error");

  chatWs.onclose = () => {
    setChatStatus("disconnected");
    chatWs = null;
    if (chatOpened) scheduleChatReconnect();
  };
}

function scheduleChatReconnect() {
  if (chatReconnectTimer) return;
  chatReconnectTimer = setTimeout(() => {
    chatReconnectTimer = 0;
    if (chatOpened) connectChat();
  }, CHAT_RECONNECT_DELAY_MS);
}

function sendChatMessage() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text) return;
  if (!chatWs || chatWs.readyState !== WebSocket.OPEN) {
    chatInput.style.transition = "border-bottom-color 0.3s ease";
    chatInput.style.borderBottom = "1px solid #ff4444";
    setTimeout(() => { chatInput.style.borderBottom = ""; }, 600);
    return;
  }
  chatWs.send(JSON.stringify({ text }));
  chatInput.value = "";
  chatInput.focus();
}

function formatTime(timestamp) {
  try {
    const d = new Date(timestamp);
    return `[${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}]`;
  } catch { return ""; }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function appendChatMessage(msg) {
  const div = document.createElement("div");
  div.className = "chat-msg";
  const time = msg.timestamp ? escapeHtml(formatTime(msg.timestamp)) : "";
  div.innerHTML = `<span class="chat-msg__time">${time}</span>${escapeHtml(msg.text)}`;
  chatMessages.appendChild(div);
  while (chatMessages.children.length > 200) {
    chatMessages.removeChild(chatMessages.firstChild);
  }
}

function appendSystemMessage(text) {
  const div = document.createElement("div");
  div.className = "chat-msg chat-msg--system";
  div.textContent = text;
  chatMessages.appendChild(div);
}

function scrollChatToBottom() {
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function incrementUnread() {
  unreadCount++;
  if (chatBadge) {
    chatBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    chatBadge.hidden = false;
  }
}

function clearUnread() {
  unreadCount = 0;
  if (chatBadge) chatBadge.hidden = true;
}

function toggleChat() {
  chatOpened = !chatOpened;
  if (chatOpened) {
    chatPanel.classList.remove("is-hidden");
    connectChat();
    clearUnread();
    setTimeout(() => chatInput?.focus(), 300);
  } else {
    chatPanel.classList.add("is-hidden");
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3 — Audio (auto-activate, no toggle)
// ═══════════════════════════════════════════════════════════════════

function installAudioContextTracker(name) {
  const OriginalCtor = window[name];
  if (typeof OriginalCtor !== "function" || OriginalCtor.__coreSapianTracked) return;

  const handler = {
    construct(target, args) {
      const instance = Reflect.construct(target, args);
      trackedAudioContexts.add(instance);
      return instance;
    },
  };

  window[name] = new Proxy(OriginalCtor, handler);
  window[name].__coreSapianTracked = true;
}

async function activateAudio() {
  if (audioActivated) return;
  audioActivated = true;

  // Resume all tracked AudioContexts
  await Promise.allSettled(
    [...trackedAudioContexts].map(ctx => {
      if (ctx.state === "suspended") return ctx.resume().catch(() => {});
      return Promise.resolve();
    })
  );

  // Play ambient audio
  if (ambientAudio) {
    try {
      ambientAudio.volume = 0.4;
      if (ambientAudio.paused) await ambientAudio.play();
    } catch (e) { /* autoplay may still be blocked */ }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5 — Game Startup
// ═══════════════════════════════════════════════════════════════════

async function startGame() {
  if (!GODOT_CONFIG) { showLoadingError("Missing Godot config"); return; }
  if (!canvas) { showLoadingError("No canvas element"); return; }
  if (typeof Engine !== "function") { showLoadingError("Engine not loaded"); return; }

  console.log("[Coresapian] Starting engine...", {
    executable: GODOT_CONFIG.executable,
    fileSizes: GODOT_CONFIG.fileSizes,
  });

  const missing = Engine.getMissingFeatures({ threads: THREADS_ENABLED });
  if (missing.length !== 0) {
    showLoadingError("Browser missing: " + missing.join(", "));
    return;
  }

  const engine = new Engine(GODOT_CONFIG);
  resetStallTimer();

  try {
    await engine.startGame({
      onProgress(current, total) {
        updateLoadingProgress(current, total);
      },
    });

    gameLoaded = true;
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = 0; }
    console.log("[Coresapian] Engine started successfully");

    hideLoadingScreen();

    // Activate audio on first user interaction with the page
    // (covers both desktop click and iOS touch)
    const audioHandler = () => {
      void activateAudio();
      document.removeEventListener("pointerdown", audioHandler);
      document.removeEventListener("keydown", audioHandler);
      document.removeEventListener("touchstart", audioHandler);
    };
    document.addEventListener("pointerdown", audioHandler, { passive: true });
    document.addEventListener("keydown", audioHandler, { passive: true });
    document.addEventListener("touchstart", audioHandler, { passive: true });

  } catch (error) {
    console.error("Engine start failed:", error);
    showLoadingError(error?.message || String(error));
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6 — Event Wiring
// ═══════════════════════════════════════════════════════════════════

// Safe event listener helper
function addSafe(target, type, handler, options) {
  if (target && typeof target.addEventListener === "function") {
    target.addEventListener(type, handler, options);
  }
}

// Audio tracking
installAudioContextTracker("AudioContext");
if (window.webkitAudioContext && window.webkitAudioContext !== window.AudioContext) {
  installAudioContextTracker("webkitAudioContext");
}

// Chat
addSafe(chatToggle, "click", toggleChat);
addSafe(chatClose, "click", toggleChat);
addSafe(chatInput, "keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") { e.preventDefault(); sendChatMessage(); }
});
addSafe(chatInput, "keyup", (e) => e.stopPropagation());
addSafe(chatInput, "keypress", (e) => e.stopPropagation());
addSafe(chatSend, "click", sendChatMessage);
addSafe(chatSend, "touchend", (e) => { e.preventDefault(); sendChatMessage(); });

// Loading error — tap to reload
addSafe(loaderError, "click", () => location.reload());
addSafe(loaderError, "touchend", (e) => { e.preventDefault(); location.reload(); });

addSafe(document, "visibilitychange", () => {
  if (!document.hidden && chatOpened && (!chatWs || chatWs.readyState !== WebSocket.OPEN)) {
    connectChat();
  }
});

// Page lifecycle
addSafe(window, "beforeunload", () => {
  if (chatWs) { try { chatWs.close(1000, "page unload"); } catch {} }
});

// ── Init ────────────────────────────────────────────────────────────
// Show version stamp on loading screen
if (loaderVersion) {
  const v = loaderVersion.getAttribute("data-version") || "";
  if (v) loaderVersion.textContent = v;
}
startGame();
