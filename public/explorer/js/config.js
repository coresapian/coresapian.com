// config.js - Lightweight YAML parser with fallback defaults
// Parses config.yaml at runtime, no dependencies needed.

import S from './state.js';

const FALLBACK_CONFIG = {
  player: {
    height: 1.7,
    eye_height: 1.6,
    radius: 0.4,
    walk_speed: 4.5,
    sprint_speed: 8.0,
    mouse_sensitivity: 0.002,
    touch_look_multiplier: 0.008,
    head_bob_speed: 12.0,
    head_bob_amount: 0.04,
    gravity: 20.0,
    jump_velocity: 7.0
  },
  environment: {
    model: "hintze_hall.glb",
    background_color: "#111122",
    ambient_intensity: 0.15,
    hemisphere_sky_color: "#ccddff",
    hemisphere_ground_color: "#111133",
    hemisphere_intensity: 0.3,
    convert_to_basic: false
  },
  spawn: {
    position: [0, 0, 0],
    yaw: 0
  },
  fog: {
    enabled: true,
    color: "#111122",
    density: 0.003
  },
  lights: [
    { type: "point", position: [0, 12, 0], color: "#ffffff", intensity: 2.0, distance: 50 }
  ],
  pickable_items: [
    { id: "blue_gem", name: "Sapphire Crystal", description: "A brilliant blue gemstone.", icon: "gem", color: "#4488ff", emissive: "#2244aa", position: [3, 1.2, -5], scale: 0.3, shape: "octahedron", float_amplitude: 0.15, float_speed: 2.0, rotation_speed: 1.5 }
  ],
  interaction: {
    pickup_range: 3.0,
    pickup_prompt: "[E] Pick up",
    highlight_color: "#ffffff",
    highlight_intensity: 0.3
  },
  inventory: {
    max_slots: 20,
    columns: 5
  },
  mobile: {
    joystick_size: 120,
    joystick_deadzone: 0.15,
    look_zone_width_percent: 55,
    sprint_button: true,
    pause_button: true,
    pickup_button: true
  }
};

function parseYAML(text) {
  // Quote-aware comment stripping: only strip # that appears after the last closing quote
  const lines = text.split('\n').map(line => {
    let inQuote = false;
    let lastQuoteIdx = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' && (i === 0 || line[i-1] !== '\\')) {
        inQuote = !inQuote;
        if (!inQuote) lastQuoteIdx = i;
      }
    }
    // Find # that appears after the last closing quote
    let commentIdx = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '#') {
        if (lastQuoteIdx === -1 || i > lastQuoteIdx) {
          commentIdx = i;
          break;
        }
      }
    }
    if (commentIdx !== -1) line = line.substring(0, commentIdx);
    return line;
  });

  const stack = [{ obj: {}, key: '__root__' }];
  const result = {};

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // Measure indent
    const indent = line.length - line.trimStart().length;

    // Pop stack to correct depth
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const trimmed = line.trim();

    // List item
    if (trimmed.startsWith('- ')) {
      const parentFrame = stack[stack.length - 1];
      // Auto-detect: if parent is an object, convert to array
      if (!Array.isArray(parentFrame.obj)) {
        const grandparent = stack[stack.length - 2];
        if (grandparent) {
          const key = parentFrame.key;
          grandparent.obj[key] = [];
          parentFrame.obj = grandparent.obj[key];
        }
      }
      const val = trimmed.substring(2).trim();
      if (val.includes(':')) {
        // Inline object or start of sub-object
        const newObj = {};
        parentFrame.obj.push(newObj);
        parseInlineKeys(val, newObj);
        stack.push({ obj: newObj, indent: indent + 2, key: null });
      } else {
        // Simple value
        const parsed = parseValue(val);
        if (typeof parsed !== 'undefined') {
          parentFrame.obj.push(parsed);
        }
      }
      continue;
    }

    // Key: value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    const val = trimmed.substring(colonIdx + 1).trim();

    const currentObj = stack[stack.length - 1].obj;

    if (val === '') {
      // Sub-object indicator
      if (Array.isArray(currentObj)) {
        const newObj = {};
        currentObj.push(newObj);
        stack.push({ obj: newObj, indent: indent + 2, key });
      } else {
        currentObj[key] = {};
        stack.push({ obj: currentObj[key], indent: indent + 2, key });
      }
    } else {
      currentObj[key] = parseValue(val);
    }
  }

  return stack[0].obj.__root__ || result;
}

function parseInlineKeys(text, obj) {
  // Parse "key: val, key2: val2" or "key: val" inline
  // Handle bracketed arrays [a, b, c]
  const parts = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') depth++;
    if (text[i] === ']') depth--;
    if (text[i] === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += text[i];
    }
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    const ci = part.indexOf(':');
    if (ci === -1) continue;
    const k = part.substring(0, ci).trim();
    const v = part.substring(ci + 1).trim();
    obj[k] = parseValue(v);
  }
}

function parseValue(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;

  // Quoted string
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }

  // Bracketed array
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map(s => parseValue(s.trim()));
  }

  // Number
  if (val !== '' && !isNaN(Number(val))) {
    return Number(val);
  }

  return val;
}

export async function loadConfig() {
  try {
    const resp = await fetch('config.yaml');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    S.CFG = parseYAML(text);
  } catch (e) {
    console.warn('Config load failed, using defaults:', e);
    S.CFG = JSON.parse(JSON.stringify(FALLBACK_CONFIG));
  }

  // Flatten commonly used settings
  const c = S.CFG;
  S.settings = {
    walkSpeed: (c.player && c.player.walk_speed) || 4.5,
    sprintSpeed: (c.player && c.player.sprint_speed) || 8.0,
    eyeHeight: (c.player && c.player.eye_height) || 1.6,
    mouseSens: (c.player && c.player.mouse_sensitivity) || 0.002,
    touchLookMult: (c.player && c.player.touch_look_multiplier) || 0.008,
    headBobSpeed: (c.player && c.player.head_bob_speed) || 12.0,
    headBobAmount: (c.player && c.player.head_bob_amount) || 0.04,
    gravity: (c.player && c.player.gravity) || 20.0,
    jumpVelocity: (c.player && c.player.jump_velocity) || 7.0,
    pickupRange: (c.interaction && c.interaction.pickup_range) || 3.0,
    maxSlots: (c.inventory && c.inventory.max_slots) || 20
  };
}
