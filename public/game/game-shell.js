/**
 * ═══════════════════════════════════════════════════════════════════
 * CORESAPIAN — CRT Terminal Game Shell v2.0
 * Shared JavaScript for web + iOS (identical code path)
 *
 * Features:
 *   • Orange Phosphor CRT loading screen with real progress
 *   • 120s progress-stall timeout → error state (mobile needs time)
 *   • "click" popup post-load → enables first-person controls
 *   • Anonymous WebSocket chat panel (no auth, no usernames)
 *   • Unread message badge when chat is closed
 *   • Keyboard isolation — typing in chat doesn't trigger game keys
 *   • Auto-reconnect chat on visibility change (tab switch back)
 *   • Audio context management (iOS autoplay unlock)
 *   • Toolbar (sound/fullscreen) with auto-hide
 *   • Orientation gate for handheld devices
 * ═══════════════════════════════════════════════════════════════════
 */

// ── DOM References ──────────────────────────────────────────────────
const canvas = document.getElementById("canvas");
const ambientAudio = document.getElementById("ambient-audio");
const crtLoader = document.getElementById("crt-loader");
const crtBarFill = document.getElementById("crt-bar-fill");
const crtPercent = document.getElementById("crt-percent");
const crtSpinner = document.getElementById("crt-spinner");
const crtError = document.getElementById("crt-error");
const clickOverlay = document.getElementById("click-overlay");
const chatToggle = document.getElementById("chat-toggle");
const chatPanel = document.getElementById("chat-panel");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatClose = document.getElementById("chat-close");
const chatStatusDot = document.getElementById("chat-status-dot");
const chatBadge = document.getElementById("chat-badge");
const toolbar = document.getElementById("immersive-toolbar");
const rotateGate = document.getElementById("rotate-gate");
const fullscreenToggle = document.getElementById("fullscreen-toggle");
const soundToggle = document.getElementById("sound-toggle");
const rotateLaunch = document.getElementById("rotate-launch");
const GODOT_CONFIG = window.__GODOT_CONFIG;
const THREADS_ENABLED = false;
const TOOLBAR_HIDE_DELAY_MS = 2600;
const PROGRESS_STALL_TIMEOUT_MS = 120_000; // 2 min — mobile needs time for 57MB .pck
const CHAT_RECONNECT_DELAY_MS = 3_000;

// ── State ───────────────────────────────────────────────────────────
let gameLoaded = false;
let controlsActivated = false;
let toolbarHideTimer = 0;
let audioEnabled = true;
let spinnerTimer = 0;
let stallTimer = 0;
let chatWs = null;
let chatOpened = false;
let chatConnected = false;
let unreadCount = 0;
let chatReconnectTimer = 0;

const trackedAudioContexts = new Set();

// ═══════════════════════════════════════════════════════════════════
// SECTION 1 — CRT Loading Screen
// ═══════════════════════════════════════════════════════════════════

const SPINNER_FRAMES = ["|", "/", "—", "\\"];

function startSpinner() {
  let idx = 0;
  stopSpinner();
  spinnerTimer = setInterval(() => {
    if (crtSpinner) {
      idx = (idx + 1) % SPINNER_FRAMES.length;
      crtSpinner.textContent = SPINNER_FRAMES[idx];
    }
  }, 120);
}

function stopSpinner() {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = 0;
  }
}

function updateLoadingProgress(current, total) {
  if (current > 0 && total > 0) {
    const percent = Math.min(100, Math.round((current / total) * 100));
    if (crtBarFill) crtBarFill.style.width = `${percent}%`;
    if (crtPercent) crtPercent.textContent = `${percent}%`;
  }
  // Reset stall timer on every progress callback
  resetStallTimer();
}

function resetStallTimer() {
  if (stallTimer) clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    if (!gameLoaded) {
      showLoadingError();
    }
  }, PROGRESS_STALL_TIMEOUT_MS);
}

function showLoadingError(detail) {
  stopSpinner();
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = 0; }
  if (crtLoader) crtLoader.classList.add("is-error");
  if (crtError) {
    crtError.hidden = false;
    const msg = detail
      ? `[ERR] ${detail}\n— TAP TO RETRY`
      : "[ERR] LOAD FAILED — TAP TO RETRY";
    crtError.textContent = msg;
    crtError.style.whiteSpace = "pre-wrap";
    console.error("[Coresapian] Loading error:", detail || "stall timeout");
  }
}

function hideLoadingScreen() {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = 0; }
  stopSpinner();
  if (crtLoader) {
    crtLoader.classList.add("is-fading");
    setTimeout(() => {
      crtLoader.hidden = true;
    }, 1100);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2 — Click Popup (post-load transition)
// ═══════════════════════════════════════════════════════════════════

function showClickPopup() {
  if (clickOverlay) {
    clickOverlay.hidden = false;
  }
}

function dismissClickPopup() {
  if (!controlsActivated) {
    controlsActivated = true;
    if (clickOverlay) clickOverlay.hidden = true;
    focusCanvas();
    showToolbar();
    void attemptUserAudioActivation();
    // Reveal chat toggle now that the user is "in the world"
    if (chatToggle) chatToggle.hidden = false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3 — Anonymous Chat (WebSocket)
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
    // Default phosphor dot (no extra class needed)
  } else if (status === "connecting") {
    chatStatusDot.classList.add("is-connecting");
  } else {
    chatStatusDot.classList.add("is-disconnected");
  }
}

function connectChat() {
  if (chatWs && (chatWs.readyState === WebSocket.OPEN || chatWs.readyState === WebSocket.CONNECTING)) return;

  // Cancel any pending reconnect
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

  chatWs.onopen = () => {
    setChatStatus("connected");
  };

  chatWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (Array.isArray(data)) {
        // History batch on connect
        chatMessages.replaceChildren();
        for (const msg of data) {
          appendChatMessage(msg);
        }
        scrollChatToBottom();
      } else if (data && typeof data.text === "string") {
        appendChatMessage(data);
        scrollChatToBottom();
        // Increment unread badge if chat is closed
        if (!chatOpened) incrementUnread();
      } else if (data && data.type === "system") {
        appendSystemMessage(data.message || "");
        scrollChatToBottom();
      }
    } catch (err) {
      console.warn("[chat] parse error:", err);
    }
  };

  chatWs.onerror = () => {
    console.warn("[chat] WebSocket error");
  };

  chatWs.onclose = () => {
    setChatStatus("disconnected");
    chatWs = null;
    // Auto-reconnect if chat panel is open
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
    // Visual feedback — flash input border
    chatInput.style.transition = "border-color 0.3s ease";
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
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `[${h}:${m}]`;
  } catch {
    return "";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function appendChatMessage(msg) {
  const div = document.createElement("div");
  div.className = "chat-msg";
  const time = msg.timestamp ? formatTime(msg.timestamp) : "";
  div.innerHTML = `<span class="chat-msg__time">${time}</span>${escapeHtml(msg.text)}`;
  chatMessages.appendChild(div);

  // Cap at 200 messages in DOM
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
  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
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
    // Don't disconnect — keep receiving so badge can show
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 4 — Audio Context Management
// ═══════════════════════════════════════════════════════════════════

function focusCanvas() {
  canvas?.focus();
}

function addEventListenerSafe(target, type, handler, options) {
  if (target && typeof target.addEventListener === "function") {
    target.addEventListener(type, handler, options);
  }
}

function installAudioContextTracker(name) {
  const OriginalCtor = window[name];
  if (typeof OriginalCtor !== "function" || OriginalCtor.__coreSapianTracked) return;

  const handler = {
    construct(target, args) {
      const instance = Reflect.construct(target, args);
      registerAudioContext(instance);
      return instance;
    },
  };

  const TrackedProxy = new Proxy(OriginalCtor, handler);
  TrackedProxy.__coreSapianTracked = true;
  // NOTE: Do NOT call Object.setPrototypeOf on a Proxy without a
  // setPrototypeOf trap — it delegates to the target, turning
  // setPrototypeOf(Proxy, OriginalCtor) into setPrototypeOf(OriginalCtor,
  // OriginalCtor) → Cyclic __proto__ TypeError.  The Proxy already
  // transparently delegates all property access and construct calls to
  // OriginalCtor, so the prototype chain is correct as-is.
  window[name] = TrackedProxy;
}

function registerAudioContext(context) {
  trackedAudioContexts.add(context);
  if (!audioEnabled) void suspendAudioContext(context);
  updateSoundToggle();
}

async function resumeAudioContext(context) {
  if (!context || context.state === "closed" || context.state === "running") return;
  try { await context.resume(); } catch (e) { console.warn("Audio resume:", e); }
}

async function suspendAudioContext(context) {
  if (!context || context.state === "closed" || context.state === "suspended") return;
  try { await context.suspend(); } catch (e) { console.warn("Audio suspend:", e); }
}

async function playAmbientAudio() {
  if (!ambientAudio || !audioEnabled) return;
  try {
    ambientAudio.volume = 0.45;
    if (ambientAudio.paused) await ambientAudio.play();
  } catch (e) { console.warn("Ambient audio:", e); }
}

function pauseAmbientAudio() { ambientAudio?.pause(); }

function hasRunningAudioContext() {
  return [...trackedAudioContexts].some((c) => c.state === "running");
}

function isSoundActive() {
  return Boolean((ambientAudio && !ambientAudio.paused) || hasRunningAudioContext());
}

function updateSoundToggle() {
  if (!soundToggle) return;
  soundToggle.textContent = !audioEnabled
    ? "Sound Off"
    : isSoundActive() ? "Sound On" : "Sound";
  soundToggle.setAttribute("aria-pressed", String(audioEnabled));
}

async function attemptUserAudioActivation() {
  if (!audioEnabled) { updateSoundToggle(); return; }
  await Promise.allSettled([...trackedAudioContexts].map(resumeAudioContext));
  await playAmbientAudio();
  updateSoundToggle();
}

async function setAudioEnabled(next) {
  audioEnabled = next;
  if (audioEnabled) {
    await attemptUserAudioActivation();
  } else {
    pauseAmbientAudio();
    await Promise.allSettled([...trackedAudioContexts].map(suspendAudioContext));
    updateSoundToggle();
  }
}

async function handleSoundToggle() {
  if (!audioEnabled || !isSoundActive()) await setAudioEnabled(true);
  else await setAudioEnabled(false);
  showToolbar();
  focusCanvas();
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5 — Orientation Gate
// ═══════════════════════════════════════════════════════════════════

function isHandheldDevice() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const userAgentDataMobile = navigator.userAgentData?.mobile === true;
  const isIPhone = /\biPhone\b/i.test(ua);
  const isIPod = /\biPod\b/i.test(ua);
  const isIPad = /\biPad\b/i.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
  const isAndroidHandheld = /\bAndroid\b/i.test(ua) && (/\bMobile\b/i.test(ua) || hasCoarsePointer);
  return userAgentDataMobile || isIPhone || isIPod || isIPad || isAndroidHandheld;
}

function isLandscape() { return window.innerWidth >= window.innerHeight; }

function updateOrientationGate() {
  const shouldBlock = Boolean(rotateGate) && isHandheldDevice() && !isLandscape();
  if (rotateGate) rotateGate.hidden = !shouldBlock;
  document.body?.classList.toggle("orientation-blocked", shouldBlock);
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6 — Toolbar
// ═══════════════════════════════════════════════════════════════════

function clearToolbarHideTimer() {
  if (toolbarHideTimer) { window.clearTimeout(toolbarHideTimer); toolbarHideTimer = 0; }
}

function hideToolbar() {
  if (!toolbar) return;
  if (rotateGate && !rotateGate.hidden) { scheduleToolbarHide(); return; }
  if (toolbar.matches(":hover") || toolbar.matches(":focus-within")) { scheduleToolbarHide(); return; }
  toolbar.classList.add("shell__toolbar--hidden");
}

function scheduleToolbarHide() {
  if (!toolbar) return;
  clearToolbarHideTimer();
  toolbarHideTimer = window.setTimeout(hideToolbar, TOOLBAR_HIDE_DELAY_MS);
}

function showToolbar() {
  if (!toolbar) return;
  toolbar.classList.remove("shell__toolbar--hidden");
  scheduleToolbarHide();
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 7 — Fullscreen
// ═══════════════════════════════════════════════════════════════════

async function requestFullscreenLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch (e) { console.warn("Fullscreen:", e); }
  try {
    if (isHandheldDevice() && screen.orientation?.lock) await screen.orientation.lock("landscape");
  } catch (e) { console.warn("Orientation lock:", e); }
  focusCanvas();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen?.();
    else await requestFullscreenLandscape();
  } catch (e) { console.warn("Fullscreen toggle:", e); }
  updateFullscreenToggle();
  showToolbar();
  void attemptUserAudioActivation();
}

function updateFullscreenToggle() {
  if (!fullscreenToggle) return;
  fullscreenToggle.textContent = document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen";
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 8 — Keyboard Isolation
// ═══════════════════════════════════════════════════════════════════

/** Returns true if the user is currently typing in a text field. */
function isTextInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 9 — Game Startup
// ═══════════════════════════════════════════════════════════════════

async function startGame() {
  if (!GODOT_CONFIG) { showLoadingError("Missing Godot config"); return; }
  if (!canvas) { showLoadingError("No canvas element"); return; }
  if (typeof Engine !== "function") { showLoadingError("Engine not loaded (check network)"); return; }

  console.log("[Coresapian] Starting engine...", {
    executable: GODOT_CONFIG.executable,
    fileSizes: GODOT_CONFIG.fileSizes,
  });

  const missing = Engine.getMissingFeatures({ threads: THREADS_ENABLED });
  if (missing.length !== 0) {
    console.error("Missing engine features:", missing);
    showLoadingError("Browser missing: " + missing.join(", "));
    return;
  }

  const engine = new Engine(GODOT_CONFIG);
  startSpinner();
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

    // Fade out loading screen, then show click popup
    hideLoadingScreen();

    setTimeout(() => {
      // Reveal toolbar (hidden until ready)
      if (toolbar) toolbar.hidden = false;
      showClickPopup();
    }, 1000);

  } catch (error) {
    console.error("Engine start failed:", error);
    const detail = error?.message || String(error);
    showLoadingError("Engine: " + detail);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 10 — Event Wiring
// ═══════════════════════════════════════════════════════════════════

// Audio tracking
installAudioContextTracker("AudioContext");
if (window.webkitAudioContext && window.webkitAudioContext !== window.AudioContext) {
  installAudioContextTracker("webkitAudioContext");
}

addEventListenerSafe(ambientAudio, "play", updateSoundToggle);
addEventListenerSafe(ambientAudio, "pause", updateSoundToggle);
addEventListenerSafe(ambientAudio, "ended", updateSoundToggle);

// Toolbar buttons
addEventListenerSafe(fullscreenToggle, "click", toggleFullscreen);
addEventListenerSafe(soundToggle, "click", handleSoundToggle);

// Rotate gate
addEventListenerSafe(rotateLaunch, "click", async () => {
  await requestFullscreenLandscape();
  void attemptUserAudioActivation();
});

// Click popup — dismiss and activate controls
addEventListenerSafe(clickOverlay, "click", dismissClickPopup);
addEventListenerSafe(clickOverlay, "touchend", (e) => {
  e.preventDefault();
  dismissClickPopup();
});

// Loading error — tap to reload
addEventListenerSafe(crtError, "click", () => location.reload());
addEventListenerSafe(crtError, "touchend", (e) => {
  e.preventDefault();
  location.reload();
});

// Chat toggle + close
addEventListenerSafe(chatToggle, "click", toggleChat);
addEventListenerSafe(chatClose, "click", toggleChat);

// Chat input — Enter key + send button
addEventListenerSafe(chatInput, "keydown", (e) => {
  // Stop propagation so game keyboard controls don't fire
  e.stopPropagation();
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatMessage();
  }
});

// Also stop propagation for all keyup/keypress in chat input
addEventListenerSafe(chatInput, "keyup", (e) => e.stopPropagation());
addEventListenerSafe(chatInput, "keypress", (e) => e.stopPropagation());

addEventListenerSafe(chatSend, "click", sendChatMessage);
addEventListenerSafe(chatSend, "touchend", (e) => {
  e.preventDefault();
  sendChatMessage();
});

// Canvas interactions
addEventListenerSafe(canvas, "pointerdown", () => {
  if (controlsActivated) {
    showToolbar();
    focusCanvas();
    void attemptUserAudioActivation();
  }
});

// Toolbar activity
addEventListenerSafe(toolbar, "mouseenter", showToolbar);
addEventListenerSafe(toolbar, "mouseleave", scheduleToolbarHide);
addEventListenerSafe(toolbar, "focusin", showToolbar);
addEventListenerSafe(toolbar, "focusout", scheduleToolbarHide);

// Global activity
addEventListenerSafe(window, "resize", updateOrientationGate);
addEventListenerSafe(window, "orientationchange", updateOrientationGate);
addEventListenerSafe(document, "visibilitychange", () => {
  updateOrientationGate();
  // Reconnect chat when page becomes visible again
  if (!document.hidden && chatOpened && (!chatWs || chatWs.readyState !== WebSocket.OPEN)) {
    connectChat();
  }
});
addEventListenerSafe(document, "pointermove", showToolbar, { passive: true });
addEventListenerSafe(document, "pointerdown", showToolbar, { passive: true });
addEventListenerSafe(document, "touchstart", showToolbar, { passive: true });
addEventListenerSafe(document, "fullscreenchange", updateFullscreenToggle);

// Keyboard — dismiss click popup on any key (but not when typing in chat)
addEventListenerSafe(document, "keydown", (e) => {
  if (isTextInputFocused()) return; // Don't trigger when typing in chat
  if (!controlsActivated && !clickOverlay?.hidden) {
    dismissClickPopup();
  }
});

// Page lifecycle — clean up WS on unload
addEventListenerSafe(window, "beforeunload", () => {
  if (chatWs) {
    try { chatWs.close(1000, "page unload"); } catch {}
  }
});

// ── Init ────────────────────────────────────────────────────────────

updateOrientationGate();
updateFullscreenToggle();
updateSoundToggle();
startGame();
