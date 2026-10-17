// wheel.js — 원판 SVG 그리기와 회전 애니메이션. 당첨 칸을 "정하는" 책임은 app.js에 있고,
// 여기는 주어진 칸으로 시각적으로 멈추는 것만 담당한다 (결정과 애니메이션 분리).
// random.js가 만든 전역 Random을 그대로 쓴다. Node(selftest)에서는 selftest.mjs가 globalThis.Random을 미리 채워준다.
const Wheel = (() => {
  const COLORS = {
    slices: ['#E3D3F5', '#FFFFFF', '#F7D3E6', '#D3DAF5'],
    blank: '#ECE8F0',
    blankStripe: '#D9D2E3',
    ink: '#3B2350',
    rim: '#5B2A86',
    rimEdge: '#3E1A63',
    dot: '#F5C842',
    accent: '#C23B5E',
  };

  // 위쪽에 핀 바늘이 들어갈 자리를 남기려고 세로를 40 더 둔다.
  const W = 600;
  const H = 640;
  const CX = W / 2;
  const CY = 330;
  const R = 262;
  const RIM_R = 278;
  const RIM_W = 32;
  const DOT_COUNT = 16;
  const HUB_R = 58;

  let containerEl = null;
  let rotorEl = null;
  let currentRotation = 0;
  let currentSlices = [];

  // --- 순수 함수: DOM 없이 테스트 가능 (selftest.mjs에서 재사용) ---

  function computeLayout(slices) {
    const n = slices.length;
    const width = 360 / n;
    return slices.map((s, i) => ({ ...s, start: i * width, end: (i + 1) * width, width }));
  }

  // 칸 가장자리 10%를 뺀 범위에서 임의 지점을 고른다 (경계선에 걸치지 않도록, 7장).
  function computeStopAngle(layoutEntry) {
    const inset = layoutEntry.width * 0.1;
    const span = layoutEntry.width - inset * 2;
    return layoutEntry.start + inset + Random.float() * span;
  }

  function srgbToLinear(c) {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  function contrastRatio(hexA, hexB) {
    const la = relativeLuminance(hexA);
    const lb = relativeLuminance(hexB);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // 글자 대비 4.5:1 이상 (9장). 기본 글자색이 기준에 못 미치는 배경에서만 흰색으로 바꾼다.
  function labelColorFor(bgHex) {
    return contrastRatio(COLORS.ink, bgHex) >= 4.5 ? COLORS.ink : '#FFFFFF';
  }

  // 색을 순서대로 돌려 쓰면 칸 수가 (색 수 × k + 1)일 때 마지막 칸과 첫 칸이 같은 색으로 붙는다. 그때만 마지막 칸 색을 바꾼다.
  function colorForIndex(i, n) {
    const len = COLORS.slices.length;
    if (n > 1 && i === n - 1 && i % len === 0) return COLORS.slices[2];
    return COLORS.slices[i % len];
  }

  // 0 = 12시, 시계방향 증가.
  function polar(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function wedgePath(cx, cy, r, startDeg, endDeg) {
    const p1 = polar(cx, cy, r, startDeg);
    const p2 = polar(cx, cy, r, endDeg);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z`;
  }

  function fontSizeFor(n) {
    return n > 20 ? 16 : 24;
  }

  function truncateLabel(label, widthDeg) {
    const arcLen = ((widthDeg * Math.PI) / 180) * (R * 0.5);
    const maxChars = Math.max(2, Math.floor(arcLen / 15));
    if (label.length <= maxChars) return { text: label, truncated: false };
    return { text: label.slice(0, Math.max(1, maxChars - 1)) + '…', truncated: true };
  }

  // --- DOM 관련 ---

  function escapeXml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function labelMarkup(entry, i, n) {
    const mid = (entry.start + entry.end) / 2;
    const textR = R * 0.84; // 핀 바늘 끝과 겹치지 않을 만큼 안쪽에서 시작
    const p = polar(CX, CY, textR, mid);
    const rot = mid + 90; // 텍스트 로컬 +x가 중심 쪽을 향하게 (바깥→안쪽 읽기, 7장)
    const fill = entry.isBlank ? labelColorFor(COLORS.blank) : labelColorFor(colorForIndex(i, n));
    const fontSize = fontSizeFor(n);
    const { text, truncated } = truncateLabel(entry.label, entry.width);
    const title = truncated ? `<title>${escapeXml(entry.label)}</title>` : '';
    return `<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" transform="rotate(${rot.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)})" fill="${fill}" font-size="${fontSize}" text-anchor="start" dominant-baseline="middle" class="wheel-label">${escapeXml(text)}${title}</text>`;
  }

  function stripeDefs() {
    return `<defs><pattern id="stripe-pattern" width="14" height="14" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="14" height="14" fill="${COLORS.blank}"/>
      <rect width="7" height="14" fill="${COLORS.blankStripe}"/>
    </pattern></defs>`;
  }

  function rimMarkup() {
    let svg = `<circle cx="${CX}" cy="${CY}" r="${RIM_R}" fill="none" stroke="${COLORS.rim}" stroke-width="${RIM_W}"/>`;
    svg += `<circle cx="${CX}" cy="${CY}" r="${RIM_R + RIM_W / 2}" fill="none" stroke="${COLORS.rimEdge}" stroke-width="3"/>`;
    const step = 360 / DOT_COUNT;
    for (let k = 0; k < DOT_COUNT; k++) {
      const p = polar(CX, CY, RIM_R, k * step + step / 2); // 반 칸 밀어서 12시 핀 아래에는 점이 없게
      svg += `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="6" fill="${COLORS.dot}"/>`;
    }
    return svg;
  }

  // 12시 방향 고정 핀. 끝이 칸 안쪽을 가리킨다.
  function pinMarkup() {
    const headY = 44;
    const tipY = 98;
    const r = 26;
    const d = `M ${CX} ${tipY} C ${CX - 10} ${tipY - 22}, ${CX - r} ${headY + 16}, ${CX - r} ${headY} A ${r} ${r} 0 1 1 ${CX + r} ${headY} C ${CX + r} ${headY + 16}, ${CX + 10} ${tipY - 22}, ${CX} ${tipY} Z`;
    return `<path d="${d}" fill="${COLORS.accent}" stroke="#FFFFFF" stroke-width="3"/><circle cx="${CX}" cy="${headY}" r="9" fill="#FFFFFF"/>`;
  }

  function hubMarkup() {
    return `<g class="wheel-hub">
      <circle cx="${CX}" cy="${CY}" r="${HUB_R}" fill="#FFFFFF" stroke="${COLORS.rim}" stroke-width="8"/>
      <text x="${CX}" y="${CY}" fill="${COLORS.rim}" font-size="26" text-anchor="middle" dominant-baseline="central">돌리기</text>
    </g>`;
  }

  function buildSvg(slices) {
    const layout = computeLayout(slices);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="wheel-svg" role="img" aria-label="추첨 원판">`;
    svg += stripeDefs();
    // SVG 요소의 CSS transform 기준점은 기본값이 (0,0)이라 중심을 명시해야 테두리와 겹친다.
    svg += `<g id="wheel-rotor" style="transform-origin:${CX}px ${CY}px;transform:rotate(${currentRotation}deg)">`;
    layout.forEach((entry, i) => {
      const fill = entry.isBlank ? 'url(#stripe-pattern)' : colorForIndex(i, layout.length);
      svg += `<path d="${wedgePath(CX, CY, R, entry.start, entry.end)}" fill="${fill}" stroke="#FFFFFF" stroke-width="3"/>`;
    });
    layout.forEach((entry, i) => {
      svg += labelMarkup(entry, i, layout.length);
    });
    svg += `</g>`;
    svg += rimMarkup();
    svg += hubMarkup();
    svg += pinMarkup();
    svg += `</svg>`;
    return svg;
  }

  function render(container, slices) {
    containerEl = container;
    currentSlices = slices;
    container.innerHTML = buildSvg(slices);
    rotorEl = container.querySelector('#wheel-rotor');
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // targetSliceId로 멈추도록 회전시킨 뒤 onDone 호출. 결과는 호출 전에 이미 정해져 있다 (app.js).
  function spin(targetSliceId, onDone) {
    const layout = computeLayout(currentSlices);
    const entry = layout.find((s) => s.id === targetSliceId);
    const stopAngle = computeStopAngle(entry);
    const targetMod = (360 - stopAngle) % 360;
    const extraSpins = 5 + Random.int(4); // 5~8바퀴
    const delta = (((targetMod - (currentRotation % 360)) % 360) + 360) % 360;
    const newRotation = currentRotation + extraSpins * 360 + delta;
    const reduced = prefersReducedMotion();
    const duration = reduced ? 0.5 : 4 + Random.float() * 2;

    rotorEl.style.transition = `transform ${duration}s cubic-bezier(0.12, 0.72, 0.18, 1)`;
    // 강제 reflow 후 적용해야 transition이 먹힌다.
    void rotorEl.getBoundingClientRect();
    rotorEl.style.transform = `rotate(${newRotation}deg)`;

    let timer;
    const finish = () => {
      rotorEl.removeEventListener('transitionend', finish);
      clearTimeout(timer);
      currentRotation = newRotation;
      onDone();
    };
    rotorEl.addEventListener('transitionend', finish);
    // transitionend가 안 오는 극단적 상황(탭 비활성 등) 대비 안전장치.
    timer = setTimeout(finish, duration * 1000 + 400);
  }

  // 당첨으로 빠진 칸을 강조했다가 새 배치로 다시 그린다 (F-43, 0.6초 안팎).
  function rearrange(removedSliceId, newSlices, onDone) {
    const removedWedgeIndex = currentSlices.findIndex((s) => s.id === removedSliceId);
    const paths = containerEl.querySelectorAll('.wheel-svg > #wheel-rotor > path');
    if (paths[removedWedgeIndex]) {
      paths[removedWedgeIndex].style.transition = 'fill 0.2s';
      paths[removedWedgeIndex].setAttribute('fill', COLORS.accent);
    }
    rotorEl.style.transition = 'opacity 0.25s';
    setTimeout(() => {
      rotorEl.style.opacity = '0';
      setTimeout(() => {
        render(containerEl, newSlices);
        rotorEl.style.opacity = '0';
        rotorEl.style.transition = 'opacity 0.25s';
        void rotorEl.getBoundingClientRect();
        rotorEl.style.opacity = '1';
        setTimeout(onDone, 250);
      }, 250);
    }, 200);
  }

  return {
    COLORS,
    render,
    spin,
    rearrange,
    computeLayout,
    computeStopAngle,
    contrastRatio,
    labelColorFor,
  };
})();

if (typeof module !== 'undefined') module.exports = Wheel;
