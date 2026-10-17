// selftest.mjs — 원판의 핵심 로직(공정성, 바늘-결과 일치, 글자 대비)을 DOM 없이 확인한다.
// 실행: node selftest.mjs  (요구사항 11장 T-09, T-10에 대응하는 자동 검증)
import assert from 'node:assert/strict';
import Random from './random.js';
globalThis.Random = Random; // wheel.js는 브라우저처럼 전역 Random을 참조한다
import Wheel from './wheel.js';

// T-10: 4칸 원판 10,000회에서 각 칸 22~28%
{
  const slices = [
    { id: 'a', label: '커피', isBlank: false },
    { id: 'b', label: '이어폰', isBlank: false },
    { id: 'c', label: '텀블러', isBlank: false },
    { id: 'blank', label: '꽝', isBlank: true },
  ];
  const counts = { a: 0, b: 0, c: 0, blank: 0 };
  const trials = 10000;
  for (let i = 0; i < trials; i++) {
    const picked = slices[Random.int(slices.length)];
    counts[picked.id]++;
  }
  for (const id of Object.keys(counts)) {
    const pct = (counts[id] / trials) * 100;
    assert.ok(pct >= 22 && pct <= 28, `칸 ${id}: ${pct.toFixed(2)}% (22~28% 범위 밖)`);
  }
  console.log('PASS: 공정성 (4칸, 10,000회) —', JSON.stringify(counts));
}

// T-09: 고른 멈춤 각도는 항상 그 칸 범위 안에 있어야 바늘=결과가 100% 일치한다
{
  for (let i = 0; i < 1000; i++) {
    const n = 2 + Random.int(29); // 2~30칸
    const slices = Array.from({ length: n }, (_, idx) => ({ id: `s${idx}`, label: `칸${idx}`, isBlank: idx === n - 1 }));
    const layout = Wheel.computeLayout(slices);
    const targetIndex = Random.int(n);
    const entry = layout[targetIndex];
    const stopAngle = Wheel.computeStopAngle(entry);
    assert.ok(stopAngle > entry.start && stopAngle < entry.end, `멈춤 각도 ${stopAngle}가 칸 범위 [${entry.start}, ${entry.end}] 밖`);
  }
  console.log('PASS: 바늘-결과 일치 (1,000회, 2~30칸)');
}

// 글자 대비 4.5:1 (9장) — 원판의 모든 칸 색과 꽝 무늬 두 색에서 실제로 쓰이는 글자색을 검사한다
{
  const { slices, blank, blankStripe } = Wheel.COLORS;
  for (const bg of [...slices, blank, blankStripe]) {
    const ratio = Wheel.contrastRatio(Wheel.labelColorFor(bg), bg);
    assert.ok(ratio >= 4.5, `배경 ${bg}: 글자 대비 ${ratio.toFixed(2)}:1`);
  }
  assert.equal(Wheel.labelColorFor('#0F7A78'), '#FFFFFF', '어두운 배경에서 흰 글자로 바뀌지 않음');
  console.log('PASS: 글자 대비 4.5:1');
}

console.log('모든 셀프테스트 통과');
