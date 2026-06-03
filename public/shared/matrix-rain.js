/**
 * Shared Matrix rain canvas effect for CoreSapian pages.
 * Self-contained — no external dependencies.
 * Expects: <canvas id="matrix-canvas" aria-hidden="true"></canvas>
 */
(function () {
  const matrixCanvas = document.getElementById("matrix-canvas");
  if (!matrixCanvas) return;

  const ctx = matrixCanvas.getContext("2d");

  // Blend Elder Futhark runes with mathematical/alchemical symbols
  const chars = [
    "\u2643", "\u2202", "\u03b6", "\u2646", "\u224b", "\u1d6d9", "\u27f0",
    "\u2600", "\u263d", "\u2645", "\u2af7", "\u1d79d", "\u2633", "\u03a3",
    "\u03e0", "\u03da", "\u0394", "\u0681", "\u06af",
    "\u16b2", "\u16df", "\u16b1", "\u16d6", "\u16a8", "\u16d2", "\u16de",
    "\u16c7", "\u16a0", "\u16b7", "\u16ba", "\u16c1", "\u16c3", "\u16da",
    "\u16d7", "\u16c9",
  ];

  const fontSize = 18;
  let drops = [];
  let animationId = null;

  function resize() {
    matrixCanvas.width = window.innerWidth;
    matrixCanvas.height = window.innerHeight;

    const rows = Math.floor(matrixCanvas.height / fontSize);
    drops = [];
    for (let y = 0; y < rows; y++) {
      drops[y] = Math.floor(Math.random() * (matrixCanvas.width / fontSize));
    }
  }

  window.addEventListener("resize", resize);
  resize();

  let lastTime = 0;
  const frameInterval = 50; // ~20fps throttle

  function draw(currentTime) {
    animationId = requestAnimationFrame(draw);

    if (currentTime - lastTime < frameInterval) return;
    lastTime = currentTime;

    ctx.fillStyle = "rgba(10, 10, 31, 0.08)";
    ctx.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);

    ctx.fillStyle = "var(--matrix-green, #00ff41)";
    ctx.font = fontSize + "px 'Noto Sans Runic', monospace";

    for (let i = 0; i < drops.length; i++) {
      const txt = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(txt, drops[i] * fontSize, i * fontSize);

      if (drops[i] * fontSize > matrixCanvas.width && Math.random() > 0.98) {
        drops[i] = 0;
      }
      drops[i]++;
    }
  }

  animationId = requestAnimationFrame(draw);

  window.addEventListener("beforeunload", () => {
    if (animationId) cancelAnimationFrame(animationId);
  });
})();
