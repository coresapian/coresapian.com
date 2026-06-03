const canvas = document.getElementById("canvas");
const ambientAudio = document.getElementById("ambient-audio");
const statusOverlay = document.getElementById("status");
const statusProgress = document.getElementById("status-progress");
const statusMeterFill = document.getElementById("status-meter-fill");
const statusNotice = document.getElementById("status-notice");
const toolbar = document.getElementById("immersive-toolbar");
const rotateGate = document.getElementById("rotate-gate");
const fullscreenToggle = document.getElementById("fullscreen-toggle");
const soundToggle = document.getElementById("sound-toggle");
const rotateLaunch = document.getElementById("rotate-launch");
const GODOT_CONFIG = window.__GODOT_CONFIG;
const THREADS_ENABLED = false;
const TOOLBAR_HIDE_DELAY_MS = 2600;

let initializing = true;
let statusMode = "";
let toolbarHideTimer = 0;
let audioEnabled = true;

const trackedAudioContexts = new Set();

function focusCanvas() {
  canvas?.focus();
}

function addEventListenerSafe(target, type, handler, options) {
  if (target && typeof target.addEventListener === "function") {
    target.addEventListener(type, handler, options);
  }
}

function setHiddenSafe(target, hidden) {
  if (target) {
    target.hidden = hidden;
  }
}

function setProgressPercent(percent) {
  const clampedPercent = Math.max(0, Math.min(100, percent));

  statusOverlay?.style.setProperty("--status-progress", `${clampedPercent}%`);

  if (statusMeterFill) {
    statusMeterFill.style.width = `${clampedPercent}%`;
  }
}

function updateLoadingProgress(current, total) {
  if (current > 0 && total > 0) {
    const percent = Math.round((current / total) * 100);

    if (statusProgress) {
      statusProgress.value = current;
      statusProgress.max = total;
    }

    setProgressPercent(percent);
    return;
  }

  statusProgress?.removeAttribute("value");
  statusProgress?.removeAttribute("max");
  setProgressPercent(0);
}

/**
 * Track AudioContext instances via a Proxy instead of class replacement.
 * Avoids monkey-patching global constructors which can break other libraries.
 */
function installAudioContextTracker(name) {
  const OriginalCtor = window[name];

  if (
    typeof OriginalCtor !== "function" ||
    OriginalCtor.__coreSapianTracked
  ) {
    return;
  }

  const handler = {
    construct(target, args) {
      const instance = Reflect.construct(target, args);
      registerAudioContext(instance);
      return instance;
    }
  };

  const TrackedProxy = new Proxy(OriginalCtor, handler);
  TrackedProxy.__coreSapianTracked = true;
  Object.setPrototypeOf(TrackedProxy, OriginalCtor);
  window[name] = TrackedProxy;
}

function registerAudioContext(context) {
  trackedAudioContexts.add(context);

  if (!audioEnabled) {
    void suspendAudioContext(context);
  }

  updateSoundToggle();
}

async function resumeAudioContext(context) {
  if (!context || context.state === "closed" || context.state === "running") {
    return;
  }

  try {
    await context.resume();
  } catch (error) {
    console.warn("Audio context resume failed:", error);
  }
}

async function suspendAudioContext(context) {
  if (!context || context.state === "closed" || context.state === "suspended") {
    return;
  }

  try {
    await context.suspend();
  } catch (error) {
    console.warn("Audio context suspend failed:", error);
  }
}

async function playAmbientAudio() {
  if (!ambientAudio || !audioEnabled) {
    return;
  }

  try {
    ambientAudio.volume = 0.45;

    if (ambientAudio.paused) {
      await ambientAudio.play();
    }
  } catch (error) {
    console.warn("Ambient audio start failed:", error);
  }
}

function pauseAmbientAudio() {
  ambientAudio?.pause();
}

function hasRunningAudioContext() {
  return [...trackedAudioContexts].some((context) => context.state === "running");
}

function isSoundActive() {
  return Boolean((ambientAudio && !ambientAudio.paused) || hasRunningAudioContext());
}

function updateSoundToggle() {
  if (!soundToggle) {
    return;
  }

  soundToggle.textContent = !audioEnabled
    ? "Sound Off"
    : isSoundActive()
      ? "Sound On"
      : "Sound";
  soundToggle.setAttribute("aria-pressed", String(audioEnabled));
}

async function attemptUserAudioActivation() {
  if (!audioEnabled) {
    updateSoundToggle();
    return;
  }

  await Promise.allSettled(
    [...trackedAudioContexts].map((context) => resumeAudioContext(context)),
  );
  await playAmbientAudio();
  updateSoundToggle();
}

async function setAudioEnabled(nextEnabled) {
  audioEnabled = nextEnabled;

  if (audioEnabled) {
    await attemptUserAudioActivation();
    return;
  }

  pauseAmbientAudio();
  await Promise.allSettled(
    [...trackedAudioContexts].map((context) => suspendAudioContext(context)),
  );
  updateSoundToggle();
}

async function handleSoundToggle() {
  if (!audioEnabled || !isSoundActive()) {
    await setAudioEnabled(true);
  } else {
    await setAudioEnabled(false);
  }

  showToolbar();
  focusCanvas();
}

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

function isLandscape() {
  return window.innerWidth >= window.innerHeight;
}

function updateOrientationGate() {
  const shouldBlock = Boolean(rotateGate) && isHandheldDevice() && !isLandscape();
  setHiddenSafe(rotateGate, !shouldBlock);
  document.body?.classList.toggle("orientation-blocked", shouldBlock);
}

function clearToolbarHideTimer() {
  if (toolbarHideTimer !== 0) {
    window.clearTimeout(toolbarHideTimer);
    toolbarHideTimer = 0;
  }
}

function hideToolbar() {
  if (!toolbar) {
    return;
  }

  if (rotateGate && !rotateGate.hidden) {
    scheduleToolbarHide();
    return;
  }

  if (toolbar.matches(":hover") || toolbar.matches(":focus-within")) {
    scheduleToolbarHide();
    return;
  }

  toolbar.classList.add("shell__toolbar--hidden");
}

function scheduleToolbarHide() {
  if (!toolbar) {
    return;
  }

  clearToolbarHideTimer();
  toolbarHideTimer = window.setTimeout(hideToolbar, TOOLBAR_HIDE_DELAY_MS);
}

function showToolbar() {
  if (!toolbar) {
    return;
  }

  toolbar.classList.remove("shell__toolbar--hidden");
  scheduleToolbarHide();
}

async function requestFullscreenLandscape() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  } catch (error) {
    console.warn("Fullscreen request failed:", error);
  }

  try {
    if (isHandheldDevice() && screen.orientation?.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch (error) {
    console.warn("Orientation lock failed:", error);
  }

  focusCanvas();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
    } else {
      await requestFullscreenLandscape();
    }
  } catch (error) {
    console.warn("Fullscreen toggle failed:", error);
  }

  updateFullscreenToggle();
  showToolbar();
  void attemptUserAudioActivation();
}

function updateFullscreenToggle() {
  if (!fullscreenToggle) {
    return;
  }

  fullscreenToggle.textContent = document.fullscreenElement
    ? "Exit Fullscreen"
    : "Fullscreen";
}

function setStatusMode(mode) {
  if (statusMode === mode || !initializing) {
    return;
  }

  if (mode === "hidden") {
    setHiddenSafe(statusOverlay, true);
    initializing = false;
    statusMode = mode;
    return;
  }

  if (statusOverlay) {
    statusOverlay.dataset.mode = mode;
  }

  setHiddenSafe(statusOverlay, false);
  setHiddenSafe(statusProgress, mode !== "progress");
  setHiddenSafe(statusNotice, mode !== "notice");
  statusMode = mode;
  showToolbar();
}

function setStatusNotice(text) {
  if (!statusNotice) {
    return;
  }

  statusNotice.replaceChildren();

  for (const line of String(text).split("\n")) {
    statusNotice.append(document.createTextNode(line), document.createElement("br"));
  }
}

function displayFailureNotice(error) {
  console.error(error);
  setProgressPercent(0);
  if (error instanceof Error) {
    setStatusNotice(error.message);
  } else if (typeof error === "string") {
    setStatusNotice(error);
  } else {
    setStatusNotice("An unknown error occurred.");
  }
  setStatusMode("notice");
  initializing = false;
}

async function startGame() {
  if (!GODOT_CONFIG) {
    displayFailureNotice("Missing Godot web configuration.");
    return;
  }

  if (!canvas) {
    displayFailureNotice("Missing game canvas.");
    return;
  }

  if (typeof Engine !== "function") {
    displayFailureNotice("Missing Godot engine bootstrap.");
    return;
  }

  const missing = Engine.getMissingFeatures({ threads: THREADS_ENABLED });
  if (missing.length !== 0) {
    const message = "Error\nnThe following features required to run Godot projects on the Web are missing:\n";
    displayFailureNotice(message + missing.join("\n"));
    return;
  }

  const engine = new Engine(GODOT_CONFIG);
  setStatusMode("progress");
  setProgressPercent(0);

  try {
    await engine.startGame({
      onProgress(current, total) {
        updateLoadingProgress(current, total);
      },
    });
    setStatusMode("hidden");
    focusCanvas();
    scheduleToolbarHide();
  } catch (error) {
    displayFailureNotice(error);
  }
}

function handleToolbarActivity() {
  showToolbar();
}

function handlePrimaryInteraction() {
  showToolbar();
  focusCanvas();
  void attemptUserAudioActivation();
}

installAudioContextTracker("AudioContext");

if (window.webkitAudioContext && window.webkitAudioContext !== window.AudioContext) {
  installAudioContextTracker("webkitAudioContext");
}

addEventListenerSafe(ambientAudio, "play", updateSoundToggle);
addEventListenerSafe(ambientAudio, "pause", updateSoundToggle);
addEventListenerSafe(ambientAudio, "ended", updateSoundToggle);

addEventListenerSafe(fullscreenToggle, "click", toggleFullscreen);
addEventListenerSafe(soundToggle, "click", handleSoundToggle);
addEventListenerSafe(rotateLaunch, "click", async () => {
  await requestFullscreenLandscape();
  void attemptUserAudioActivation();
});

addEventListenerSafe(canvas, "pointerdown", handlePrimaryInteraction);
addEventListenerSafe(canvas, "click", handlePrimaryInteraction);
addEventListenerSafe(statusOverlay, "pointerdown", handlePrimaryInteraction);
addEventListenerSafe(statusOverlay, "click", handlePrimaryInteraction);

addEventListenerSafe(toolbar, "mouseenter", showToolbar);
addEventListenerSafe(toolbar, "mouseleave", scheduleToolbarHide);
addEventListenerSafe(toolbar, "focusin", showToolbar);
addEventListenerSafe(toolbar, "focusout", scheduleToolbarHide);

addEventListenerSafe(window, "resize", updateOrientationGate);
addEventListenerSafe(window, "orientationchange", updateOrientationGate);
addEventListenerSafe(document, "visibilitychange", updateOrientationGate);
addEventListenerSafe(document, "pointermove", handleToolbarActivity, { passive: true });
addEventListenerSafe(document, "pointerdown", handleToolbarActivity, { passive: true });
addEventListenerSafe(document, "touchstart", handleToolbarActivity, { passive: true });
addEventListenerSafe(document, "keydown", handlePrimaryInteraction);
addEventListenerSafe(document, "fullscreenchange", updateFullscreenToggle);

updateOrientationGate();
updateFullscreenToggle();
updateSoundToggle();
showToolbar();
startGame();
