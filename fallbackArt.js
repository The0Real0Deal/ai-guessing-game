/**
 * Procedural SVG illustration generator used as a reliable fallback
 * when no external AI Image API key is configured or reachable.
 * Produces rich, colorful, stylized SVG artwork as a data URL.
 */

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PALETTES = [
  { bg1: '#1a2639', bg2: '#3e4a61', accent1: '#f96d00', accent2: '#f2f2f2', accent3: '#ffd166' },
  { bg1: '#fef6e4', bg2: '#f3d2c1', accent1: '#f582ae', accent2: '#001858', accent3: '#8bd3dd' },
  { bg1: '#0f2027', bg2: '#2c5364', accent1: '#00c9a7', accent2: '#ffbe0b', accent3: '#fb5607' },
  { bg1: '#2b2d42', bg2: '#8d99ae', accent1: '#ef233c', accent2: '#edf2f4', accent3: '#ffd166' },
  { bg1: '#1d3557', bg2: '#457b9d', accent1: '#e63946', accent2: '#f1faee', accent3: '#a8dadc' },
  { bg1: '#3d405b', bg2: '#e07a5f', accent1: '#f2cc8f', accent2: '#f4f1de', accent3: '#81b29a' },
];

function detectMotifs(prompt) {
  const p = (prompt || '').toLowerCase();
  const motifs = [];
  if (/(שמש|sun|בוקר|יום|מדבר|desert|קיץ|summer)/.test(p)) motifs.push('sun');
  if (/(ירח|moon|לילה|night|כוכב|star|חלל|space|גלקסיה)/.test(p)) motifs.push('night');
  if (/(ים|ocean|sea|גל|wave|חוף|beach|דג|fish|סירה|boat|מים)/.test(p)) motifs.push('ocean');
  if (/(הר|mountain|טבע|nature|נוף|landscape|שלג|snow)/.test(p)) motifs.push('mountain');
  if (/(עץ|tree|יער|forest|פרח|flower|צמח|גן|garden)/.test(p)) motifs.push('tree');
  if (/(עיר|city|בניין|building|רחוב|street|מגדל|tower|בית|house)/.test(p)) motifs.push('city');
  if (/(חתול|cat|כלב|dog|חיה|animal|ציפור|bird|דוב|אריה)/.test(p)) motifs.push('creature');
  if (/(רובוט|robot|מחשב|computer|טכנולוגיה|עתיד|future)/.test(p)) motifs.push('robot');
  if (/(פיצה|pizza|אוכל|food|עוגה|cake|קפה|coffee|גלידה|ice)/.test(p)) motifs.push('food');
  if (/(אש|fire|דרקון|dragon|הר געש|volcano|פיצוץ)/.test(p)) motifs.push('fire');
  if (/(מכונית|car|רכבת|train|מטוס|plane|טיל|rocket)/.test(p)) motifs.push('vehicle');
  return motifs;
}

function generateFallbackSVG(prompt) {
  const seed = hashString(prompt + Date.now().toString().slice(-4));
  const rand = seededRandom(seed);
  const motifs = detectMotifs(prompt);

  let palette = PALETTES[Math.floor(rand() * PALETTES.length)];
  if (motifs.includes('night')) palette = PALETTES[0];
  else if (motifs.includes('ocean')) palette = PALETTES[4];
  else if (motifs.includes('sun') && !motifs.includes('night')) palette = PALETTES[5];

  const elements = [];

  // Background gradient
  elements.push(`
    <defs>
      <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${palette.bg1}" />
        <stop offset="100%" stop-color="${palette.bg2}" />
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="40%" r="50%">
        <stop offset="0%" stop-color="${palette.accent3}" stop-opacity="0.45" />
        <stop offset="100%" stop-color="${palette.accent3}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="800" height="800" fill="url(#sky)" />
    <rect width="800" height="800" fill="url(#glow)" />
  `);

  // Stars if night
  if (motifs.includes('night') || rand() > 0.65) {
    for (let i = 0; i < 28; i++) {
      const sx = Math.floor(rand() * 760) + 20;
      const sy = Math.floor(rand() * 420) + 20;
      const sr = (rand() * 2.8 + 1).toFixed(1);
      elements.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="#ffffff" opacity="${(rand() * 0.6 + 0.3).toFixed(2)}" />`);
    }
  }

  // Sun or Moon
  if (motifs.includes('night')) {
    const mx = 580 + Math.floor(rand() * 100);
    const my = 150 + Math.floor(rand() * 60);
    elements.push(`<circle cx="${mx}" cy="${my}" r="68" fill="${palette.accent3}" opacity="0.92" />`);
    elements.push(`<circle cx="${mx - 22}" cy="${my - 12}" r="60" fill="${palette.bg1}" />`);
  } else if (motifs.includes('sun') || rand() > 0.4) {
    const sx = 200 + Math.floor(rand() * 400);
    const sy = 150 + Math.floor(rand() * 100);
    elements.push(`<circle cx="${sx}" cy="${sy}" r="110" fill="${palette.accent3}" opacity="0.22" />`);
    elements.push(`<circle cx="${sx}" cy="${sy}" r="72" fill="${palette.accent1}" opacity="0.9" />`);
  }

  // Mountains
  if (motifs.includes('mountain') || motifs.includes('tree') || motifs.length === 0) {
    elements.push(`<polygon points="0,600 190,340 410,600" fill="${palette.bg1}" opacity="0.55" />`);
    elements.push(`<polygon points="240,600 490,290 760,600" fill="${palette.bg1}" opacity="0.72" />`);
    elements.push(`<polygon points="480,600 670,360 800,600" fill="${palette.bg1}" opacity="0.5" />`);
  }

  // Ocean waves
  if (motifs.includes('ocean')) {
    elements.push(`<rect x="0" y="520" width="800" height="280" fill="${palette.bg1}" opacity="0.85" />`);
    for (let w = 0; w < 4; w++) {
      const y = 535 + w * 55;
      elements.push(`<path d="M0,${y} Q200,${y - 30} 400,${y} T800,${y} L800,800 L0,800 Z" fill="${palette.accent3}" opacity="${0.18 + w * 0.08}" />`);
    }
  } else {
    // Ground plane
    elements.push(`<path d="M0,580 Q400,530 800,580 L800,800 L0,800 Z" fill="${palette.bg1}" opacity="0.85" />`);
  }

  // City skyline
  if (motifs.includes('city')) {
    let bx = 60;
    while (bx < 720) {
      const bw = 65 + Math.floor(rand() * 55);
      const bh = 140 + Math.floor(rand() * 220);
      const by = 580 - bh;
      elements.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6" fill="${palette.bg1}" stroke="${palette.accent2}" stroke-opacity="0.2" stroke-width="2" />`);
      for (let wy = by + 20; wy < 560; wy += 30) {
        for (let wx = bx + 12; wx < bx + bw - 16; wx += 22) {
          if (rand() > 0.35) {
            elements.push(`<rect x="${wx}" y="${wy}" width="10" height="14" rx="2" fill="${palette.accent3}" opacity="0.8" />`);
          }
        }
      }
      bx += bw + 12;
    }
  }

  // Trees
  if (motifs.includes('tree')) {
    for (let t = 0; t < 4; t++) {
      const tx = 130 + t * 180 + Math.floor(rand() * 40 - 20);
      const ty = 560;
      elements.push(`<rect x="${tx - 10}" y="${ty - 80}" width="20" height="90" rx="4" fill="#5c3d2e" />`);
      elements.push(`<circle cx="${tx}" cy="${ty - 110}" r="55" fill="${palette.accent3}" opacity="0.9" />`);
      elements.push(`<circle cx="${tx - 28}" cy="${ty - 85}" r="40" fill="${palette.accent1}" opacity="0.75" />`);
    }
  }

  // Robot or Creature focal character
  if (motifs.includes('robot')) {
    elements.push(`
      <g transform="translate(310, 320)">
        <rect x="30" y="60" width="120" height="110" rx="18" fill="${palette.accent2}" />
        <rect x="45" y="10" width="90" height="60" rx="14" fill="${palette.accent3}" />
        <circle cx="72" cy="40" r="9" fill="${palette.bg1}" />
        <circle cx="108" cy="40" r="9" fill="${palette.bg1}" />
        <rect x="65" y="54" width="50" height="6" rx="3" fill="${palette.bg1}" />
        <line x1="90" y1="10" x2="90" y2="-15" stroke="${palette.accent1}" stroke-width="6" />
        <circle cx="90" cy="-20" r="9" fill="${palette.accent1}" />
      </g>
    `);
  } else if (motifs.includes('creature')) {
    elements.push(`
      <g transform="translate(320, 370)">
        <ellipse cx="80" cy="110" rx="68" ry="80" fill="${palette.accent1}" />
        <circle cx="80" cy="45" r="52" fill="${palette.accent1}" />
        <polygon points="36,15 48,-22 72,8" fill="${palette.accent1}" />
        <polygon points="124,15 112,-22 88,8" fill="${palette.accent1}" />
        <circle cx="62" cy="40" r="7" fill="${palette.bg1}" />
        <circle cx="98" cy="40" r="7" fill="${palette.bg1}" />
        <polygon points="74,54 86,54 80,62" fill="${palette.accent3}" />
      </g>
    `);
  } else if (motifs.includes('food')) {
    elements.push(`
      <g transform="translate(290, 330)">
        <circle cx="110" cy="110" r="105" fill="${palette.accent2}" />
        <circle cx="110" cy="110" r="85" fill="${palette.accent3}" />
        <circle cx="80" cy="85" r="14" fill="${palette.accent1}" />
        <circle cx="135" cy="95" r="16" fill="${palette.accent1}" />
        <circle cx="105" cy="140" r="15" fill="${palette.accent1}" />
      </g>
    `);
  } else if (motifs.includes('vehicle')) {
    elements.push(`
      <g transform="translate(260, 440)">
        <rect x="20" y="40" width="240" height="70" rx="20" fill="${palette.accent1}" />
        <path d="M60,40 L100,0 L200,0 L230,40 Z" fill="${palette.accent3}" />
        <circle cx="80" cy="115" r="28" fill="${palette.bg1}" stroke="${palette.accent2}" stroke-width="6" />
        <circle cx="210" cy="115" r="28" fill="${palette.bg1}" stroke="${palette.accent2}" stroke-width="6" />
      </g>
    `);
  } else if (motifs.includes('fire')) {
    elements.push(`
      <g transform="translate(320, 290)">
        <path d="M80,260 C10,220 0,130 55,80 C45,120 75,125 85,70 C105,10 155,60 140,120 C165,100 175,150 155,200 C140,240 110,260 80,260 Z" fill="${palette.accent1}" />
        <path d="M85,255 C45,230 45,175 75,145 C85,170 105,150 110,125 C135,155 135,215 85,255 Z" fill="${palette.accent3}" />
      </g>
    `);
  }

  // Expressive geometric accents for composition richness
  for (let i = 0; i < 6; i++) {
    const cx = Math.floor(rand() * 680) + 60;
    const cy = Math.floor(rand() * 520) + 80;
    const r = Math.floor(rand() * 34) + 12;
    const color = i % 2 === 0 ? palette.accent1 : palette.accent3;
    elements.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.18" />`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">${elements.join('')}</svg>`;
  const base64 = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

module.exports = { generateFallbackSVG };
