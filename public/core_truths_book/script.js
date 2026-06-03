document.addEventListener("DOMContentLoaded", (event) => {
  // Free alternative to GSAP SplitText - splits text into character spans
  class TextSplitter {
    constructor(element, options = {}) {
      this.element = element;
      this.type = options.type || "chars";
      this.chars = [];
      this.words = [];
      this._split();
    }

    _split() {
      const text = this.element.textContent;
      this.element.textContent = "";

      if (this.type.includes("words") || this.type.includes("chars")) {
        const words = text.split(/\s+/);
        words.forEach((word, wordIdx) => {
          const wordSpan = document.createElement("span");
          wordSpan.style.display = "inline-block";
          wordSpan.style.whiteSpace = "pre";

          if (this.type.includes("chars")) {
            word.split("").forEach((char) => {
              const charSpan = document.createElement("span");
              charSpan.textContent = char;
              charSpan.style.display = "inline-block";
              charSpan.className = "char";
              wordSpan.appendChild(charSpan);
              this.chars.push(charSpan);
            });
          } else {
            wordSpan.textContent = word;
          }

          this.element.appendChild(wordSpan);
          this.words.push(wordSpan);

          if (wordIdx < words.length - 1) {
            const space = document.createElement("span");
            space.innerHTML = "&nbsp;";
            space.style.display = "inline-block";
            this.element.appendChild(space);
          }
        });
      }
    }
  }

  // Expose globally like GSAP SplitText
  window.TextSplitter = TextSplitter;

  // Note: Touch device detection is now handled in the inline script in index.html
  // using improved detection that distinguishes touch-only from hybrid devices

  const initTextAnimations = () => {
    // Wait for fonts before splitting text to avoid stale glyph metrics.
    const mainTitleSplit = new TextSplitter(document.querySelector(".container > h1"), { type: "chars" });
    gsap.from(mainTitleSplit.chars, {
        duration: 0.6, opacity: 0, scale: 0, y: 20, rotationX: -90,
        transformOrigin: "0% 50% -50", ease: "back.out", stagger: 0.05
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const truthNumberHeading = entry.target.querySelector(".truth-number h3");
          const truthText = entry.target.querySelector(".truth-text");
          const introHeading = entry.target.querySelector(".intro-heading");
          const introSubheadings = entry.target.querySelectorAll(".intro-subheading");
          const tl = gsap.timeline();

          if (truthNumberHeading) {
            const h3Split = new TextSplitter(truthNumberHeading, { type: "words,chars" });
            tl.from(h3Split.chars, {
                duration: 0.6, opacity: 0, scale: 0, ease: "back.out", stagger: 0.08
            }, 0.1);
          }
          if (truthText) {
            const pSplit = new TextSplitter(truthText, { type: "chars" });
            tl.from(pSplit.chars, {
                duration: 0.8, opacity: 0, ease: "power1.in",
                stagger: { each: 0.025, from: "start" }
            }, 0.3);
          }
          if (introHeading) {
            const h1Split = new TextSplitter(introHeading, { type: "chars" });
            tl.from(h1Split.chars, {
                duration: 0.6, opacity: 0, scale: 0.5, ease: "back.out", stagger: 0.05
            });
          }
          if (introSubheadings.length > 0) {
            introSubheadings.forEach((subheading) => {
              const h3Split = new TextSplitter(subheading, { type: "chars" });
              tl.from(h3Split.chars, {
                duration: 0.8, opacity: 0, ease: "power1.in",
                stagger: { each: 0.025, from: "start" }
              }, "-=0.2");
            });
          }
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.5
    });

    document.querySelectorAll('.carousel-item').forEach(item => observer.observe(item));
  };

  const fontsReady = (document.fonts && document.fonts.ready)
    ? document.fonts.ready
    : Promise.resolve();
  fontsReady.then(initTextAnimations).catch(initTextAnimations);

  // --- KONAMI CODE EASTER EGG ---
  const konamiCode = [
    'ArrowUp',
    'ArrowUp',
    'ArrowDown',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowLeft',
    'ArrowRight',
    'b',
    'a'
  ];
  let konamiIndex = 0;
  document.addEventListener('keydown', (e) => {
    if (e.key === konamiCode[konamiIndex]) {
      konamiIndex++;
      if (konamiIndex === konamiCode.length) {
        document.body.classList.add('konami-active');
        konamiIndex = 0;
      }
    } else {
      konamiIndex = 0;
    }
  });
});
