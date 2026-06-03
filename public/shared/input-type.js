/**
 * Shared input type detection.
 * Determines whether the device is touch-only, mouse-only, or hybrid.
 *
 * Usage:
 *   import { detectInputType, InputType } from '../shared/input-type.js';
 *   const inputType = detectInputType();
 *   const isTouchDevice = inputType === InputType.TOUCH;
 */

export const InputType = {
  TOUCH: 'touch',
  MOUSE: 'mouse',
  HYBRID: 'hybrid',
  UNKNOWN: 'unknown'
};

export function detectInputType() {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const hasMouse = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (hasTouch && hasMouse) return InputType.HYBRID;
  if (hasTouch) return InputType.TOUCH;
  if (hasMouse) return InputType.MOUSE;
  return InputType.UNKNOWN;
}
