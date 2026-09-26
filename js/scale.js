// The balance: the top two choices on the pans, each pan stacked with what every criterion put in,
// tipping towards the one that weighs more.

const W = 360, H = 322;
const PIVOT = { x: 180, y: 46 };
const ARM = 108;         // pivot to each end of the beam
const DROP = 150;        // end of the beam down to the pan
const STACK_W = 50;
const STACK_MAX = 118;   // stack height for a perfect score
const MAX_TILT = 16;     // degrees

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// A name under a pan: up to two lines of about 16 letters, broken between words.
function lines(name, n = 16) {
  const out = [''];
  for (const word of name.split(/\s+/)) {
    const line = out[out.length - 1];
    if (!line || (line + ' ' + word).length <= n) out[out.length - 1] = line ? line + ' ' + word : word;
    else out.push(word);
  }
  const two = out.slice(0, 2).map(l => (l.length > n + 2 ? l.slice(0, n).trimEnd() + '…' : l));
  if (out.length > 2 && !two[1].endsWith('…')) two[1] = two[1].slice(0, n).trimEnd() + '…';
  return two;
}

export function tiltFor(left, right) {
  return MAX_TILT * Math.tanh((left - right) * 7);
}

// Where the end of each arm is at a given tilt (degrees, positive = left side down).
function ends(tilt) {
  const a = (tilt * Math.PI) / 180;
  const dx = ARM * Math.cos(a), dy = ARM * Math.sin(a);
  return [{ x: PIVOT.x - dx, y: PIVOT.y + dy }, { x: PIVOT.x + dx, y: PIVOT.y - dy }];
}

function roundTop(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function pan(side, option, criteria, name) {
  let y = DROP - 3;
  const blocks = [];
  const parts = criteria.map(c => ({ c, h: option.parts[c.id] * STACK_MAX })).filter(p => p.h > 0.5);
  parts.forEach(({ c, h }, i) => {
    const top = i === parts.length - 1;
    const hh = Math.max(1, h - 2); // a 2px gap between blocks
    const x = -STACK_W / 2, yy = y - hh;
    const tip = `${esc(c.name)}: ${Math.round(option.parts[c.id] * 100)} of ${esc(name)}’s ${Math.round(option.total * 100)}`;
    blocks.push(top
      ? `<path d="${roundTop(x, yy, STACK_W, hh, 4)}" fill="var(--c${c.color})"><title>${tip}</title></path>`
      : `<rect x="${x}" y="${yy}" width="${STACK_W}" height="${hh}" fill="var(--c${c.color})"><title>${tip}</title></rect>`);
    y -= h;
  });
  return `
    <g class="hang hang-${side}">
      <path class="string" d="M0,0L-58,${DROP}M0,0L58,${DROP}"/>
      ${blocks.join('')}
      <path class="pan" d="M-66,${DROP}H66Q60,${DROP + 16} 40,${DROP + 18}H-40Q-60,${DROP + 16} -66,${DROP}Z"/>
      <text class="pan-name" x="0" y="${DROP + 40}">${lines(name).map((l, i) => `<tspan x="0" dy="${i ? 17 : 0}">${esc(l)}</tspan>`).join('')}</text>
      <text class="pan-score" x="0" y="${DROP + 60 + (lines(name).length - 1) * 17}">${Math.round(option.total * 100)}</text>
    </g>`;
}

// The little dial above the pivot that the needle points at.
function dial() {
  const at = (deg, r) => {
    const a = (deg * Math.PI) / 180;
    return `${(PIVOT.x + r * Math.sin(a)).toFixed(1)},${(PIVOT.y - r * Math.cos(a)).toFixed(1)}`;
  };
  const ticks = [-26, -13, 0, 13, 26].map(d => `M${at(d, 34)}L${at(d, d ? 38 : 41)}`).join('');
  return `<path class="dial" d="M${at(-34, 38)}A38,38 0 0 1 ${at(34, 38)}"/><path class="tick" d="${ticks}"/>`;
}

// left and right are rows from ranking(); names maps option id to name.
export function scaleSVG(left, right, criteria, names, label) {
  return `<svg class="scale" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <path class="stand" d="M${PIVOT.x - 4},${PIVOT.y}V${H - 22}h8V${PIVOT.y}Z"/>
    <path class="foot" d="M${PIVOT.x - 46},${H - 8}Q${PIVOT.x - 44},${H - 24} ${PIVOT.x - 20},${H - 24}H${PIVOT.x + 20}Q${PIVOT.x + 44},${H - 24} ${PIVOT.x + 46},${H - 8}Z"/>
    ${dial()}
    <g class="beam">
      <path class="needle" d="M${PIVOT.x - 2.5},${PIVOT.y}L${PIVOT.x},${PIVOT.y - 31}L${PIVOT.x + 2.5},${PIVOT.y}Z"/>
      <rect class="arm" x="${PIVOT.x - ARM - 4}" y="${PIVOT.y - 3.5}" width="${2 * ARM + 8}" height="7" rx="3.5"/>
      <circle class="knob" cx="${PIVOT.x - ARM}" cy="${PIVOT.y}" r="5"/>
      <circle class="knob" cx="${PIVOT.x + ARM}" cy="${PIVOT.y}" r="5"/>
    </g>
    ${pan('left', left, criteria, names[left.id])}
    ${right ? pan('right', right, criteria, names[right.id]) : ''}
    <circle class="pivot" cx="${PIVOT.x}" cy="${PIVOT.y}" r="8"/>
    <circle class="pivot-dot" cx="${PIVOT.x}" cy="${PIVOT.y}" r="2.5"/>
  </svg>`;
}

// Sets the tilt. The pans hang straight down from the ends of the beam, whatever its angle.
export function setTilt(svg, tilt) {
  const [l, r] = ends(tilt);
  svg.querySelector('.beam').style.transform = `rotate(${-tilt}deg)`;
  svg.querySelector('.hang-left').style.transform = `translate(${l.x}px, ${l.y}px)`;
  const right = svg.querySelector('.hang-right');
  if (right) right.style.transform = `translate(${r.x}px, ${r.y}px)`;
}
