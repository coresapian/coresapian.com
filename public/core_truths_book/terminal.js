// ── Oracle Stone Tablet ────────────────────────────────────────────
// Interactive expandable runic panel — decorative only.
// AI chat worker removed (not needed in production).

const tabletContainer = document.getElementById('terminal-container');
const tabletHeader = document.getElementById('terminal-header');
const tabletContent = document.getElementById('terminal-content');
const tabletToggle = document.getElementById('terminal-toggle');
const tabletOutput = document.getElementById('terminal-output');

// Ancient terminology mappings (kept for welcome message)
const ancientTerms = {
  'AI': 'Oracle',
  'model': 'ancient wisdom',
  'loading': 'awakening',
  'ready': 'enlightened',
  'error': 'cursed',
  'processing': 'divining',
  'complete': 'fulfilled',
  'initializing': 'summoning the spirits'
};

// ── Stone Tablet UI ─────────────────────────────────────────────────

tabletHeader.addEventListener('click', () => {
  tabletContent.classList.toggle('hidden');
  const isHidden = tabletContent.classList.contains('hidden');
  tabletContainer.style.height = isHidden ? '3rem' : '20rem';
  tabletToggle.textContent = isHidden ? '▲' : '▼';
});

// ── Helper Functions ────────────────────────────────────────────────

function carveText(text) {
  const inscription = document.createElement('div');
  inscription.className = 'carved-text oracle-response';
  inscription.textContent = translateToAncient(text);
  tabletOutput.appendChild(inscription);
  tabletContent.scrollTop = tabletContent.scrollHeight;
}

function translateToAncient(text) {
  if (!text) return text;
  let ancientText = text;
  for (const [modern, ancient] of Object.entries(ancientTerms)) {
    const regex = new RegExp(modern, 'gi');
    ancientText = ancientText.replace(regex, ancient);
  }
  return ancientText;
}

// ── Welcome Inscription ─────────────────────────────────────────────

carveText('ᚹᛖᛚᚲᛟᛗᛖ ᛏᛟ ᚦᛖ ᛟᚱᚨᚲᛚᛖ ᛟᚠ ᚲᛟᚱᛖ - Expand the stone tablet to view the ancient wisdom.');
