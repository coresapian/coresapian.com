/**
 * ═══════════════════════════════════════════════════════════════════
 * CORESAPIAN — LLM Worker
 *
 * Runs Qwen2.5-0.5B-Instruct entirely in the user's browser via
 * transformers.js. Lazy-loaded on first @ai mention.
 *
 * Messages from main thread:
 *   { type: "load" }          → Start downloading the model
 *   { type: "generate", data } → Generate text from chat messages
 *   { type: "interrupt" }      → Stop current generation
 *
 * Messages to main thread:
 *   { status: "loading", data }    → Model is downloading/loading
 *   { status: "progress", data }   → Download progress for a file
 *   { status: "ready" }            → Model loaded and warmed up
 *   { status: "start" }            → Generation starting
 *   { status: "update", output }   → Streaming token
 *   { status: "complete", output } → Full response
 *   { status: "error", data }      → Error occurred
 * ═══════════════════════════════════════════════════════════════════
 */

import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";

// State
let tokenizer = null;
let model = null;
let isLoading = false;
let isReady = false;

// System prompt for the AI persona
const SYSTEM_PROMPT = {
  role: "system",
  content:
    "You are the CoreSapian AI, a helpful assistant embedded in a 3D interactive web experience. " +
    "Keep responses concise and friendly. You are running entirely in the user's browser. " +
    "Answer questions about technology, the website, or general topics.",
};

const stopping_criteria = new InterruptableStoppingCriteria();

// ── WebGPU detection ────────────────────────────────────────────────
async function detectDevice() {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) {
      return { device: "webgpu", dtype: "q4f16" };
    }
  } catch {}
  // Fallback to WASM with q8 quantization
  return { device: "wasm", dtype: "q8" };
}

// ── Model loading (singleton) ───────────────────────────────────────
async function loadModel() {
  if (isLoading || isReady) return;
  isLoading = true;

  const { device, dtype } = await detectDevice();

  self.postMessage({
    status: "loading",
    data: `Loading Qwen2.5-0.5B (${device.toUpperCase()}, ${dtype})...`,
    device,
  });

  const progress_callback = (data) => {
    self.postMessage({ status: "progress", data });
  };

  try {
    // Load tokenizer and model in parallel
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
      progress_callback,
    });

    model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
      dtype,
      device,
      progress_callback,
    });

    self.postMessage({
      status: "loading",
      data: "Compiling shaders and warming up model...",
    });

    // Warm up with a dummy token to compile shaders
    const inputs = tokenizer("hello");
    await model.generate({ ...inputs, max_new_tokens: 1 });

    isReady = true;
    isLoading = false;
    self.postMessage({ status: "ready" });
  } catch (err) {
    isLoading = false;
    self.postMessage({
      status: "error",
      data: `Model load failed: ${err.message || err}`,
    });
  }
}

// ── Text generation ─────────────────────────────────────────────────
async function generate(messages) {
  if (!isReady) {
    self.postMessage({
      status: "error",
      data: "Model not loaded yet",
    });
    return;
  }

  stopping_criteria.reset();

  // Prepend system prompt
  const fullMessages = [SYSTEM_PROMPT, ...messages];

  const inputs = tokenizer.apply_chat_template(fullMessages, {
    add_generation_prompt: true,
    return_dict: true,
  });

  let startTime;
  let numTokens = 0;
  let tps = 0;

  const token_callback_function = () => {
    startTime ??= performance.now();
    if (numTokens++ > 0) {
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
  };

  const callback_function = (output) => {
    self.postMessage({
      status: "update",
      output,
      tps,
      numTokens,
    });
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function,
    token_callback_function,
  });

  self.postMessage({ status: "start" });

  try {
    const { sequences } = await model.generate({
      ...inputs,
      max_new_tokens: 512,
      do_sample: true,
      top_k: 3,
      temperature: 0.7,
      streamer,
      stopping_criteria,
      return_dict_in_generate: true,
    });

    const decoded = tokenizer.batch_decode(sequences, {
      skip_special_tokens: true,
    });

    // Extract just the assistant response (after the last <|im_start|>assistant)
    let response = decoded[0];
    const assistantTag = "<|im_start|>assistant\n";
    const idx = response.lastIndexOf(assistantTag);
    if (idx !== -1) {
      response = response.slice(idx + assistantTag.length);
    }
    // Clean up any remaining special tokens
    response = response.replace(/<\|im_end\|>/g, "").trim();

    self.postMessage({
      status: "complete",
      output: response,
    });
  } catch (err) {
    self.postMessage({
      status: "error",
      data: `Generation failed: ${err.message || err}`,
    });
  }
}

// ── Message handler ─────────────────────────────────────────────────
self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case "load":
      await loadModel();
      break;

    case "generate":
      await generate(data);
      break;

    case "interrupt":
      stopping_criteria.interrupt();
      break;
  }
});
