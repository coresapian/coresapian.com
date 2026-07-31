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

// LLM worker state
let llmWorker = null;
let llmState = "idle"; // idle | loading | ready | generating
let llmChatHistory = []; // [{role, content}] for the LLM context
let llmStreamingMsg = null; // DOM element for streaming output

const trackedAudioContexts = new Set();

// ── Loading status messages ───────────────────────────────────────
const STATUS_MESSAGES = [
  { pct: 0,   text: "Initializing engine" },
  { pct: 10,  text: "Loading runtime" },
  { pct: 25,  text: "Decoding assets" },
  { pct: 45,  text: "Building world geometry" },
  { pct: 65,  text: "Assembling geometry" },
  { pct: 80,  text: "Optimizing scene" },
  { pct: 92,  text: "Finalizing load" },
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
        ChatVirtualList.replaceAll(data);
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

  // Check for @ai mention — route to local LLM instead of chat server
  if (/^@ai\b/i.test(text) || /\s@ai\b/i.test(text)) {
    const prompt = text.replace(/\s*@ai\s*/gi, " ").trim();
    if (prompt) {
      handleAiMessage(prompt);
      chatInput.value = "";
      chatInput.focus();
    }
    return;
  }

  // Normal chat — send to WebSocket relay
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

// ═══════════════════════════════════════════════════════════════════
// SECTION 2b — LLM (@ai mention) via transformers.js Web Worker
// ═══════════════════════════════════════════════════════════════════

function handleAiMessage(prompt) {
  // Show user message in chat
  appendChatMessage({ text: `@ai ${prompt}`, timestamp: new Date().toISOString() });

  // Lazy-load the worker on first use
  if (!llmWorker) {
    initLlmWorker();
  }

  if (llmState === "loading") {
    appendSystemMessage("⏳ AI model is still loading... please wait.");
    return;
  }

  if (llmState === "generating") {
    appendSystemMessage("⏳ AI is already generating a response. Wait or type @ai stop.");
    return;
  }

  if (llmState === "idle") {
    // First use — trigger model download
    appendSystemMessage("🤖 Loading AI model into your browser (first time only, ~460MB)...");
    llmState = "loading";
    llmWorker.postMessage({ type: "load" });

    // Queue the prompt — it'll be sent once the model is ready
    llmPendingPrompt = prompt;
    return;
  }

  // Model is ready — generate
  if (llmState === "ready") {
    runAiGeneration(prompt);
  }
}

let llmPendingPrompt = null;

function initLlmWorker() {
  // Determine worker URL — same directory as game-shell.js
  const workerUrl = new URL("llm-worker.js", import.meta.url).href;

  llmWorker = new Worker(workerUrl, { type: "module" });

  llmWorker.addEventListener("message", (e) => {
    const { status, data, output, tps, numTokens } = e.data;

    switch (status) {
      case "loading":
        // Model is downloading or warming up
        if (data) {
          updateLlmStatusMessage(data);
        }
        break;

      case "progress":
        // Download progress for specific files
        if (data && data.status === "progress" && data.file) {
          const pct = data.total > 0 ? Math.round((data.loaded / data.total) * 100) : 0;
          updateLlmStatusMessage(`📥 ${data.file} — ${pct}%`);
        }
        break;

      case "ready":
        llmState = "ready";
        updateLlmStatusMessage("✅ AI ready!");
        // If there's a pending prompt from before the model loaded, process it
        if (llmPendingPrompt) {
          const p = llmPendingPrompt;
          llmPendingPrompt = null;
          runAiGeneration(p);
        }
        break;

      case "start":
        // Generation starting — create streaming message element
        llmState = "generating";
        llmStreamingMsg = document.createElement("div");
        llmStreamingMsg.className = "chat-msg chat-msg--ai";
        // Static structure with named child nodes so updates only mutate textContent.
        llmStreamingMsg.appendChild(Object.assign(document.createElement("span"), { className: "chat-msg__time", textContent: formatTime(Date.now()) }));
        llmStreamingMsg.appendChild(document.createTextNode(" "));
        llmStreamingMsg.appendChild(Object.assign(document.createElement("span"), { className: "chat-msg__ai-label", textContent: "🤖 AI" }));
        llmStreamingMsg.appendChild(document.createTextNode(" "));
        llmStreamingMsg._contentSpan = Object.assign(document.createElement("span"), { className: "chat-msg__content" });
        llmStreamingMsg.appendChild(llmStreamingMsg._contentSpan);
        llmStreamingMsg._tpsSpan = Object.assign(document.createElement("span"), { className: "chat-msg__tps" });
        llmStreamingMsg._tpsSpan.hidden = true;
        llmStreamingMsg.appendChild(llmStreamingMsg._tpsSpan);
        chatMessages.appendChild(llmStreamingMsg);
        scrollChatToBottom();
        break;

      case "update":
        // Streaming token — append to current message
        if (llmStreamingMsg && output) {
          llmStreamingMsg._contentSpan.textContent = output;
          if (tps) {
            llmStreamingMsg._tpsSpan.textContent = ` ${Math.round(tps)} tok/s`;
            llmStreamingMsg._tpsSpan.hidden = false;
          } else {
            llmStreamingMsg._tpsSpan.hidden = true;
          }
          scrollChatToBottom();
        }
        break;

      case "complete":
        // Final response
        if (llmStreamingMsg && output) {
          llmStreamingMsg._contentSpan.textContent = output;
          llmStreamingMsg._tpsSpan.hidden = true;
        }
        llmStreamingMsg = null;
        llmState = "ready";

        // Add to conversation history
        if (output) {
          llmChatHistory.push({ role: "assistant", content: output });
          // Keep history manageable
          if (llmChatHistory.length > 20) {
            llmChatHistory = llmChatHistory.slice(-20);
          }
        }
        scrollChatToBottom();
        break;

      case "error":
        appendSystemMessage(`❌ AI error: ${data || "unknown"}`);
        llmState = "ready";
        llmStreamingMsg = null;
        llmPendingPrompt = null; // clear any queued prompt
        break;
    }
  });

  llmWorker.addEventListener("error", (err) => {
    console.error("[LLM Worker] Error:", err);
    appendSystemMessage("❌ AI worker failed to start. Your browser may not support this feature.");
    llmState = "idle";
    llmWorker = null;
  });
}

function runAiGeneration(prompt) {
  // Add user message to LLM history
  llmChatHistory.push({ role: "user", content: prompt });

  // Keep history manageable
  if (llmChatHistory.length > 20) {
    llmChatHistory = llmChatHistory.slice(-20);
  }

  // Send to worker — pass last several messages for context
  const contextMessages = llmChatHistory.slice(-10);
  llmWorker.postMessage({
    type: "generate",
    data: contextMessages,
  });
}

let llmStatusMsg = null;

function updateLlmStatusMessage(text) {
  if (!llmStatusMsg || !llmStatusMsg.parentNode) {
    llmStatusMsg = document.createElement("div");
    llmStatusMsg.className = "chat-msg chat-msg--system";
    chatMessages.appendChild(llmStatusMsg);
  }
  llmStatusMsg.textContent = text;
  scrollChatToBottom();

  // Auto-remove success messages after 3 seconds
  if (text.startsWith("✅")) {
    setTimeout(() => {
      if (llmStatusMsg && llmStatusMsg.parentNode) {
        llmStatusMsg.remove();
      }
    }, 3000);
  }
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

const ChatVirtualList = (function () {
  const buffer = [];          // all message objects
  const pool = [];              // recycled DOM nodes
  const renderWindow = 15;    // max nodes visible at once
  let heightEstimate = 0;
  let scrollTop = 0;
  let listHeight = 0;
  let paddingTop = 0;
  let paddingBottom = 0;

  function createNode() {
    const div = document.createElement("div");
    div.className = "chat-msg";
    return div;
  }

  function getNode() {
    return pool.length ? pool.pop() : createNode();
  }

  function recycle(node) {
    node.remove();
    node.textContent = "";
    node.removeAttribute("data-msg-id");
    pool.push(node);
  }

  function renderModel() {
    const total = buffer.length;
    if (!total) return;
    const avg = listHeight / Math.max(1, chatMessages.children.length || renderWindow);
    const rowH = avg > 0 ? avg : 24;
    heightEstimate = total * rowH;
    const startIndex = Math.max(0, Math.floor(scrollTop / rowH) - 2);
    const endIndex = Math.min(total, startIndex + renderWindow + 4);
    paddingTop = startIndex * rowH;
    paddingBottom = Math.max(0, (total - endIndex) * rowH);
    chatMessages.style.paddingTop = paddingTop + "px";
    chatMessages.style.paddingBottom = paddingBottom + "px";

    const existing = Array.from(chatMessages.children).filter(n => n.classList.contains("chat-msg") && !n.classList.contains("chat-msg--system"));
    const needed = endIndex - startIndex;
    // Recycle excess nodes
    while (existing.length > needed) recycle(existing.pop());
    // Ensure enough nodes
    while (existing.length < needed) {
      const node = getNode();
      chatMessages.appendChild(node);
      existing.push(node);
    }
    for (let i = 0; i < needed; i++) {
      const msg = buffer[startIndex + i];
      const node = existing[i];
      const msgId = msg.id || (msg.timestamp + msg.text);
      if (node.dataset.msgId === msgId) continue;
      node.dataset.msgId = msgId;
      // Build with DOM methods to avoid innerHTML entirely
      node.textContent = "";
      const timeSpan = document.createElement("span");
      timeSpan.className = "chat-msg__time";
      timeSpan.textContent = msg.timestamp ? formatTime(msg.timestamp) : "";
      node.appendChild(timeSpan);
      node.appendChild(document.createTextNode(msg.text));
    }
  }

  function append(msg) {
    const msgId = msg.id || (msg.timestamp + msg.text);
    if (buffer.find(m => (m.id || (m.timestamp + m.text)) === msgId)) return;
    buffer.push(msg);
    if (buffer.length > 200) buffer.shift();
    renderModel();
  }

  function replaceAll(msgs) {
    buffer.length = 0;
    for (const msg of msgs) buffer.push(msg);
    if (buffer.length > 200) buffer.splice(0, buffer.length - 200);
    renderModel();
  }

  function pruneIfClosed() {
    if (!chatOpened && buffer.length > 50) {
      buffer.splice(0, buffer.length - 50);
      renderModel();
    }
  }

  function onScroll() {
    scrollTop = chatMessages.scrollTop;
    listHeight = chatMessages.scrollHeight;
    renderModel();
  }

  function init() {
    chatMessages.addEventListener("scroll", onScroll, { passive: true });
    listHeight = chatMessages.scrollHeight;
  }

  return { append, replaceAll, pruneIfClosed, init, renderModel };
})();

function appendChatMessage(msg) {
  ChatVirtualList.append(msg);
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
    ChatVirtualList.pruneIfClosed();
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
ChatVirtualList.init();
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

// ═══════════════════════════════════════════════════════════════════
// SECTION 7 — FrostBridge: Nordic realm transition
// Called by Godot via JavaScriptBridge.eval("window.FrostBridge.travel(url)")
// Plays a 2.5s particle wormhole, then navigates cross-origin.
// ═══════════════════════════════════════════════════════════════════

const FrostBridge = (() => {
  const RUNE_CHARS = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛟᛞ";
  const PHASE_AWAKENING_MS = 800;
  const PHASE_CROSSING_MS = 1200;
  const PHASE_FLASH_MS = 300;
  const PARTICLE_COUNT = 180;

  let overlay = null;
  let canvas = null;
  let ctx = null;
  let particles = [];
  let animFrame = 0;
  let crossingStart = 0;
  let canvasW = 0;
  let canvasH = 0;

  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.id = "frostbridge";

    const runeEl = document.createElement("div");
    runeEl.className = "frostbridge__rune";
    runeEl.textContent = "⟁";

    const statusEl = document.createElement("div");
    statusEl.className = "frostbridge__status";
    statusEl.textContent = "Traversing the FrostBridge...";

    canvas = document.createElement("canvas");
    canvas.id = "frostbridge__canvas";

    const flash = document.createElement("div");
    flash.className = "frostbridge__flash";

    overlay.appendChild(canvas);
    overlay.appendChild(runeEl);
    overlay.appendChild(statusEl);
    overlay.appendChild(flash);
    document.body.appendChild(overlay);
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvasW = window.innerWidth;
    canvasH = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = canvasW + "px";
    canvas.style.height = canvasH + "px";
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

  function spawnParticle() {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 8;
    const roll = Math.random();
    let type, color, size;

    if (roll < 0.15) {
      type = "rune";
      color = "#80DEEA";
      size = 14 + Math.random() * 20;
    } else if (roll < 0.22) {
      type = "spark";
      color = "#FF8C00";
      size = 2 + Math.random() * 3;
    } else {
      type = "ice";
      color = Math.random() > 0.4 ? "#00E5FF" : "#E0F7FA";
      size = 2 + Math.random() * 5;
    }

    return {
      x: canvasW / 2 + (Math.random() - 0.5) * 30,
      y: canvasH / 2 + (Math.random() - 0.5) * 30,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: size,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.15,
      type: type,
      color: color,
      rune: type === "rune"
        ? RUNE_CHARS[Math.floor(Math.random() * RUNE_CHARS.length)]
        : null,
      life: 0,
      maxLife: 50 + Math.random() * 60,
      accel: 1.02 + Math.random() * 0.03,
    };
  }

  function drawParticle(p) {
    const alpha = Math.max(0, 1 - p.life / p.maxLife);

    if (p.type === "rune") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = p.color;
      ctx.font = p.size + 'px "Cinzel", serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.fillText(p.rune, 0, 0);
      ctx.restore();
    } else if (p.type === "ice") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.6, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function animateCrossing() {
    const now = performance.now();
    const elapsed = now - crossingStart;

    ctx.fillStyle = "rgba(5, 2, 0, 0.15)";
    ctx.fillRect(0, 0, canvasW, canvasH);

    if (elapsed < PHASE_CROSSING_MS * 0.8) {
      const spawnCount = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i < spawnCount && particles.length < PARTICLE_COUNT; i++) {
        particles.push(spawnParticle());
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= p.accel;
      p.vy *= p.accel;
      p.rotation += p.rotSpeed;
      p.life++;

      drawParticle(p);

      if (p.life > p.maxLife ||
          p.x < -50 || p.x > canvasW + 50 ||
          p.y < -50 || p.y > canvasH + 50) {
        particles.splice(i, 1);
      }
    }

    if (elapsed < PHASE_CROSSING_MS) {
      animFrame = requestAnimationFrame(animateCrossing);
    }
  }

  async function travel(url) {
    if (!url || typeof url !== "string") return;
    console.log("[FrostBridge] Initiating travel to:", url);

    if (!overlay) buildOverlay();
    resizeCanvas();

    // Phase 1: Awakening
    overlay.classList.add("is-active");
    await sleep(PHASE_AWAKENING_MS);

    // Phase 2: Crossing
    overlay.classList.add("is-crossing");
    particles = [];
    crossingStart = performance.now();
    animFrame = requestAnimationFrame(animateCrossing);
    await sleep(PHASE_CROSSING_MS);

    // Phase 3: Flash + navigate
    if (animFrame) cancelAnimationFrame(animFrame);
    const flash = overlay.querySelector(".frostbridge__flash");
    if (flash) flash.classList.add("is-flashing");
    await sleep(PHASE_FLASH_MS);

    window.location.href = url;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  window.addEventListener("resize", () => {
    if (overlay && overlay.classList.contains("is-active")) {
      resizeCanvas();
    }
  });

  return { travel };
})();

window.FrostBridge = FrostBridge;

// ── Init ────────────────────────────────────────────────────────────
startGame();
