/**
 * Browser Overlay v2.0 — creates closable iframe overlays on top of the game canvas.
 * Called by Godot via JavaScriptBridge when player interacts with temple objects.
 *
 * Usage from Godot:
 *   JavaScriptBridge.eval("window.__coresapianShowBrowser('/core_truths_book/', 'Core Truths')")
 *   JavaScriptBridge.eval("window.__coresapianCloseBrowser()")
 */

(function () {
  let overlay = null;
  let isOpen = false;

  function createOverlay(url, title) {
    // If already open, close first
    if (overlay) {
      closeOverlay();
    }

    overlay = document.createElement('div');
    overlay.id = 'cs-browser-overlay';
    overlay.innerHTML = `
      <div class="cs-browser-backdrop"></div>
      <div class="cs-browser-window">
        <div class="cs-browser-titlebar">
          <span class="cs-browser-title">${escapeHtml(title)}</span>
          <button class="cs-browser-close" aria-label="Close browser">&times;</button>
        </div>
        <iframe
          class="cs-browser-iframe"
          src="${url}"
          allow="fullscreen; clipboard-read; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      </div>
    `;

    // Inject styles — Orange Phosphor CRT theme
    const style = document.createElement('style');
    style.textContent = `
      #cs-browser-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        font-family: "VT323", "Share Tech Mono", "Courier New", monospace;
      }
      .cs-browser-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(5, 2, 0, 0.92);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        animation: cs-fade-in 0.2s ease;
      }
      .cs-browser-window {
        position: absolute;
        inset: 2rem;
        display: flex;
        flex-direction: column;
        background: #0a0500;
        border: 1px solid #FF8C00;
        border-radius: 4px;
        box-shadow:
          0 0 3rem rgba(0, 0, 0, 0.5),
          0 0 1rem rgba(255, 140, 0, 0.15);
        overflow: hidden;
        animation: cs-slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .cs-browser-titlebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.6rem 1rem;
        background: rgba(10, 5, 0, 0.95);
        border-bottom: 1px solid rgba(255, 140, 0, 0.3);
        flex-shrink: 0;
      }
      .cs-browser-title {
        color: #FF8C00;
        font-weight: 400;
        font-size: 1rem;
        letter-spacing: 0.06em;
        text-shadow: 0 0 4px rgba(255, 140, 0, 0.4);
      }
      .cs-browser-close {
        background: none;
        border: 1px solid rgba(255, 140, 0, 0.4);
        border-radius: 2px;
        color: #FF8C00;
        font-family: inherit;
        font-size: 1.3rem;
        line-height: 1;
        width: 2rem;
        height: 2rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s ease;
      }
      .cs-browser-close:active {
        background: rgba(255, 140, 0, 0.15);
      }
      .cs-browser-iframe {
        flex: 1;
        width: 100%;
        border: none;
        background: #030308;
      }
      @keyframes cs-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes cs-slide-up {
        from { opacity: 0; transform: translateY(1.5rem) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @media (max-width: 800px) {
        .cs-browser-window {
          inset: 0.5rem;
          border-radius: 4px;
        }
      }
    `;

    document.head.appendChild(style);
    overlay._style = style;

    // Event listeners
    const backdrop = overlay.querySelector('.cs-browser-backdrop');
    const closeBtn = overlay.querySelector('.cs-browser-close');

    backdrop.addEventListener('click', closeOverlay);
    closeBtn.addEventListener('click', closeOverlay);
    closeBtn.addEventListener('touchend', (e) => { e.preventDefault(); closeOverlay(); });

    document.body.appendChild(overlay);
    isOpen = true;
  }

  function closeOverlay() {
    if (!overlay) return;

    // Clean up style
    if (overlay._style) {
      overlay._style.remove();
    }

    overlay.remove();
    overlay = null;
    isOpen = false;

    // Refocus the game canvas
    const canvas = document.getElementById('canvas');
    if (canvas) {
      canvas.focus();
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Global API (called by Godot) ────────────────────────────────

  window.__coresapianShowBrowser = function (url, title) {
    createOverlay(url, title || 'Browser');
  };

  window.__coresapianCloseBrowser = function () {
    closeOverlay();
  };

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) {
      closeOverlay();
      e.preventDefault();
    }
  });
})();
