/**
 * Shared torch overlay effect for CoreSapian pages.
 * Requires GSAP (loaded before this script).
 * Expects: <div id="torch-overlay" aria-hidden="true"></div>
 */
(function () {
  const torch = document.getElementById("torch-overlay");
  if (!torch) return;

  // Touch device detection (shared with other modules)
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const hasFinePointer =
    window.matchMedia &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const isTouchOnly = hasTouch && !hasFinePointer;

  if (isTouchOnly) {
    // Hide torch on touch-only devices (performance)
    torch.style.background = "transparent";
    return;
  }

  if (typeof gsap === "undefined") return;

  const torchPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  window.addEventListener("mousemove", (e) => {
    gsap.to(torchPos, {
      duration: 0.6,
      x: e.clientX,
      y: e.clientY,
      ease: "power2.out",
    });
  });

  gsap.ticker.add(() => {
    torch.style.setProperty("--torch-x", `${torchPos.x}px`);
    torch.style.setProperty("--torch-y", `${torchPos.y}px`);
  });

  gsap.to(torch, {
    "--torch-size": "200px",
    duration: 4,
    ease: "sine.inOut",
    repeat: -1,
    yoyo: true,
  });

  gsap.to(torch, {
    "--torch-brightness": 0.35,
    duration: 0.2,
    ease: "rough({ template: none.out, strength: 2, points: 25, taper: 'out', randomize: true, clamp: false})",
    repeat: -1,
    yoyo: true,
  });

  gsap.to(torch, {
    "--torch-flicker-opacity": 0.2,
    duration: 0.1,
    ease: "rough({ template: none.out, strength: 1.5, points: 30, taper: 'none', randomize: true, clamp: false})",
    repeat: -1,
    yoyo: true,
  });
})();
