// app.js — 상태 관리, 화면 전환, 설정값 검증, 저장/복구. 원판 그리기는 wheel.js에 맡긴다.
(() => {
  const STORAGE_KEY = 'luckydraw_v1';
  const MAX_SLOTS = 30;

  let state = null;
  let uiLocked = false;
  let idCounter = 0;
  const nextId = (prefix) => `${prefix}${++idCounter}`;

  const el = (id) => document.getElementById(id);

  function initialState() {
    return {
      phase: 'setup',
      setupConfig: { names: [], prizes: [] },
      participants: [],
      wheelSlices: [],
      turnOrder: [],
      winners: [],
      pendingSpin: null,
      undoSnapshot: null,
    };
  }

  // --- 저장/복구 (F-60~62: localStorage 못 써도 동작은 유지) ---

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 저장소를 못 쓰는 환경 — 추첨 자체는 계속 동작해야 한다 */
    }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearSaved() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* 지울 것도 없으니 무시 */
    }
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // --- 참가자/경품 입력 처리 ---

  function resolveNames(rawList) {
    const counts = {};
    const finalNames = [];
    const dupedOriginals = new Set();
    for (const raw of rawList) {
      const name = raw.trim();
      if (!name) continue;
      counts[name] = (counts[name] || 0) + 1;
      if (counts[name] > 1) dupedOriginals.add(name);
      finalNames.push(counts[name] === 1 ? name : `${name}(${counts[name]})`);
    }
    return { finalNames, dupedOriginals: [...dupedOriginals] };
  }

  // 한 줄에 경품 하나. "이름 x3"처럼 뒤에 수량을 붙일 수 있고, 없으면 1개. 같은 이름은 수량을 합친다.
  function parsePrizes(rawText) {
    const order = [];
    const totals = {};
    let qtyError = null;
    for (const raw of rawText.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(.+?)\s*[x×]\s*(\d+)\s*(?:개)?$/i);
      let name = line;
      let qty = 1;
      if (m) {
        name = m[1].trim();
        qty = parseInt(m[2], 10);
        if (qty <= 0) {
          qtyError = line;
          continue;
        }
      }
      if (!name) continue;
      if (!(name in totals)) {
        totals[name] = 0;
        order.push(name);
      }
      totals[name] += qty;
    }
    return { prizes: order.map((name) => ({ name, qty: totals[name] })), qtyError };
  }

  function validateSetup() {
    const mode = document.querySelector('input[name="participant-mode"]:checked').value;
    let rawNames = [];
    if (mode === 'names') {
      rawNames = el('participant-names').value.split(/[\n,]/);
    } else {
      const n = parseInt(el('participant-count').value, 10);
      if (Number.isInteger(n) && n >= 1 && n <= 500) {
        rawNames = Array.from({ length: n }, (_, i) => `${i + 1}번`);
      }
    }
    const { finalNames, dupedOriginals } = resolveNames(rawNames);

    const { prizes, qtyError } = parsePrizes(el('prize-text').value);
    const totalSlots = prizes.reduce((sum, p) => sum + p.qty, 0) + 1;

    let error = null;
    if (qtyError) {
      error = `경품 수량은 1 이상이어야 합니다. ("${qtyError}")`;
    } else if (finalNames.length === 0) {
      error = '참가자를 1명 이상 입력하세요.';
    } else if (prizes.length === 0) {
      error = '경품을 1개 이상 입력하세요.';
    } else if (totalSlots > MAX_SLOTS) {
      error = `원판은 최대 ${MAX_SLOTS}칸입니다. 지금 ${totalSlots}칸.`;
    }

    return { ok: !error, error, finalNames, dupedOriginals, prizes, totalSlots };
  }

  function updateSetupUI() {
    const mode = document.querySelector('input[name="participant-mode"]:checked').value;
    el('participant-names').hidden = mode !== 'names';
    el('participant-count').hidden = mode !== 'count';

    const v = validateSetup();

    el('participant-count-display').textContent = `${v.finalNames.length}명`;

    if (v.dupedOriginals.length > 0) {
      el('participant-dup-notice').hidden = false;
      el('participant-dup-notice').textContent = `같은 이름이 있어 번호를 붙였습니다: ${v.dupedOriginals.join(', ')}`;
    } else {
      el('participant-dup-notice').hidden = true;
    }

    const prizeSlots = v.prizes.reduce((s, p) => s + p.qty, 0);
    let summary = `원판: 경품 ${prizeSlots}칸 + 꽝 1칸`;
    if (v.ok && prizeSlots > v.finalNames.length) {
      const leftover = prizeSlots - v.finalNames.length;
      summary += ` · 경품 ${leftover}개는 남게 됩니다`;
    }
    el('slot-summary').textContent = summary;

    if (v.error) {
      el('setup-error').hidden = false;
      el('setup-error').textContent = v.error;
    } else {
      el('setup-error').hidden = true;
    }
    el('start-draw').disabled = !v.ok;

    return v;
  }

  // --- 게임 진행 로직 ---

  function buildWheelSlices(prizes) {
    const slices = [];
    for (const prize of prizes) {
      for (let i = 0; i < prize.qty; i++) {
        slices.push({ id: nextId('s'), label: prize.name, isBlank: false });
      }
    }
    slices.push({ id: 'blank', label: '꽝', isBlank: true });
    return slices;
  }

  function startGame(names, prizes) {
    state = initialState();
    state.setupConfig = { names, prizes };
    state.participants = names.map((name) => ({ id: nextId('p'), name }));
    state.wheelSlices = Random.shuffle(buildWheelSlices(prizes));
    state.turnOrder = Random.shuffle(state.participants.map((p) => p.id));
    state.phase = 'draw';
    save();
    render();
  }

  function arraysEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  // 당첨 칸 제거 후 재셔플. 결과가 직전 배치와 완전히 같으면 다시 섞는다 (F-42, 3칸 이상일 때).
  function removeOneSlice(slices, removeId) {
    const remaining = slices.filter((s) => s.id !== removeId);
    if (remaining.length < 2) return remaining;
    const prevOrder = remaining.map((s) => s.id);
    let shuffled = Random.shuffle(remaining);
    if (remaining.length >= 3) {
      let tries = 0;
      while (arraysEqual(shuffled.map((s) => s.id), prevOrder) && tries < 10) {
        shuffled = Random.shuffle(remaining);
        tries++;
      }
    }
    return shuffled;
  }

  function checkEndCondition() {
    const prizesLeft = state.wheelSlices.some((s) => !s.isBlank);
    if (!prizesLeft || state.participants.length === 0) {
      state.phase = 'result';
    }
  }

  // 당첨/꽝 결과를 상태에 반영. 실시간 회전 완료 뒤, 혹은 새로고침 복구 시 그대로 재사용한다.
  function applySpinResult(targetSliceId) {
    const slice = state.wheelSlices.find((s) => s.id === targetSliceId);
    const participantId = state.turnOrder[0];
    const participant = state.participants.find((p) => p.id === participantId);

    state.undoSnapshot = deepClone({
      participants: state.participants,
      wheelSlices: state.wheelSlices,
      turnOrder: state.turnOrder,
      winners: state.winners,
      phase: state.phase,
    });

    state.turnOrder = state.turnOrder.slice(1);

    let resultInfo;
    if (slice.isBlank) {
      resultInfo = { isBlank: true, name: participant.name };
    } else {
      state.winners = [
        ...state.winners,
        { seq: state.winners.length + 1, name: participant.name, prize: slice.label, time: new Date().toISOString() },
      ];
      state.participants = state.participants.filter((p) => p.id !== participant.id);
      state.wheelSlices = removeOneSlice(state.wheelSlices, targetSliceId);
      resultInfo = { isBlank: false, name: participant.name, prize: slice.label };
    }
    state.pendingSpin = null;
    checkEndCondition();
    save();
    return resultInfo;
  }

  function advanceTurn() {
    if (state.participants.length === 0) return;
    if (state.turnOrder.length === 0) {
      state.turnOrder = Random.shuffle(state.participants.map((p) => p.id));
    }
  }

  // --- 화면: 추첨 ---

  function currentParticipant() {
    const id = state.turnOrder[0];
    return state.participants.find((p) => p.id === id) || null;
  }

  function renderDrawSide() {
    const prizesLeft = state.wheelSlices.filter((s) => !s.isBlank).length;
    el('draw-status-counts').textContent = `남은 경품 ${prizesLeft} · 남은 사람 ${state.participants.length}`;

    const current = currentParticipant();
    el('current-turn-name').textContent = current ? current.name : '—';

    const nextIds = state.turnOrder.slice(1, 4);
    const nextNames = nextIds.map((id) => state.participants.find((p) => p.id === id)?.name).filter(Boolean);
    el('next-turn-names').textContent = nextNames.length ? nextNames.join(', ') : '—';

    el('winners-list').innerHTML = state.winners
      .map((w) => `<li>${w.seq}. ${escapeHtml(w.name)} — ${escapeHtml(w.prize)}</li>`)
      .join('');

    const playedThisRound = new Set(state.turnOrder);
    el('remaining-list').innerHTML = state.participants
      .map((p) => {
        const isCurrent = current && p.id === current.id;
        const selectable = playedThisRound.has(p.id) && !isCurrent;
        const cls = isCurrent ? 'current' : selectable ? 'selectable' : 'waiting';
        return `<li class="${cls}" data-id="${p.id}" tabindex="${selectable ? 0 : -1}">${escapeHtml(p.name)}</li>`;
      })
      .join('');

    el('undo-row').hidden = !state.undoSnapshot;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function setLocked(locked) {
    uiLocked = locked;
    el('spin-button').disabled = locked;
    el('back-to-setup').disabled = locked;
    el('end-draw').disabled = locked;
  }

  function announce(text) {
    el('live-region').textContent = text;
  }

  function showResultOverlay(resultInfo) {
    const text = resultInfo.isBlank ? `${resultInfo.name}: 꽝` : `${resultInfo.name} 님 당첨: ${resultInfo.prize}`;
    el('result-text').textContent = text;
    el('result-overlay').hidden = false;
    announce(text);
  }

  function hideResultOverlayAndAdvance() {
    el('result-overlay').hidden = true;
    if (state.phase === 'result') {
      render();
      return;
    }
    advanceTurn();
    save();
    renderDrawSide();
    setLocked(false);
    const current = currentParticipant();
    if (current) announce(`이번 차례: ${current.name}`);
  }

  function doSpin() {
    if (uiLocked) return;
    const targetIndex = Random.int(state.wheelSlices.length);
    const targetSliceId = state.wheelSlices[targetIndex].id;
    state.pendingSpin = { targetSliceId };
    save();
    setLocked(true);
    Wheel.spin(targetSliceId, () => {
      const resultInfo = applySpinResult(targetSliceId);
      if (resultInfo.isBlank) {
        showResultOverlay(resultInfo);
        renderDrawSide();
      } else {
        Wheel.rearrange(targetSliceId, state.wheelSlices, () => {
          showResultOverlay(resultInfo);
          renderDrawSide();
        });
      }
    });
  }

  function resolvePendingSpinOnLoad() {
    if (!state.pendingSpin) return;
    const targetSliceId = state.pendingSpin.targetSliceId;
    const resultInfo = applySpinResult(targetSliceId);
    Wheel.render(el('wheel-container'), state.wheelSlices);
    showResultOverlay(resultInfo);
    setLocked(true);
  }

  // --- 화면: 결과 ---

  function renderResultScreen() {
    const tbody = document.querySelector('#winners-table tbody');
    tbody.innerHTML = state.winners
      .map((w) => `<tr><td>${w.seq}</td><td>${escapeHtml(w.name)}</td><td>${escapeHtml(w.prize)}</td></tr>`)
      .join('');

    el('no-win-list').innerHTML = state.participants.map((p) => `<li>${escapeHtml(p.name)}</li>`).join('') || '<li>없음</li>';

    const leftoverCounts = {};
    state.wheelSlices.filter((s) => !s.isBlank).forEach((s) => {
      leftoverCounts[s.label] = (leftoverCounts[s.label] || 0) + 1;
    });
    const leftoverEntries = Object.entries(leftoverCounts);
    el('leftover-prize-list').innerHTML =
      leftoverEntries.map(([name, qty]) => `<li>${escapeHtml(name)} ${qty}개</li>`).join('') || '<li>없음</li>';

    el('copy-status').textContent = '';
  }

  function winnersToCsv() {
    const header = '순번,이름,경품';
    const rows = state.winners.map((w) => `${w.seq},${csvEscape(w.name)},${csvEscape(w.prize)}`);
    return '﻿' + [header, ...rows].join('\r\n');
  }

  function csvEscape(v) {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }

  function downloadCsv() {
    const blob = new Blob([winnersToCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '당첨자명단.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard() {
    const header = '순번\t이름\t경품';
    const rows = state.winners.map((w) => `${w.seq}\t${w.name}\t${w.prize}`);
    const text = [header, ...rows].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      el('copy-status').textContent = '복사했습니다.';
    } catch (e) {
      el('copy-status').textContent = '복사에 실패했습니다.';
    }
  }

  // --- 화면 전환 ---

  function render() {
    el('screen-setup').hidden = state.phase !== 'setup';
    el('screen-draw').hidden = state.phase !== 'draw';
    el('screen-result').hidden = state.phase !== 'result';

    if (state.phase === 'setup') {
      updateSetupUI();
    } else if (state.phase === 'draw') {
      Wheel.render(el('wheel-container'), state.wheelSlices);
      renderDrawSide();
      el('result-overlay').hidden = true;
      setLocked(false);
      if (state.pendingSpin) resolvePendingSpinOnLoad();
    } else if (state.phase === 'result') {
      renderResultScreen();
    }
  }

  // --- 이벤트 바인딩 ---

  function wireSetupScreen() {
    document.querySelectorAll('input[name="participant-mode"]').forEach((r) => r.addEventListener('change', updateSetupUI));
    el('participant-names').addEventListener('input', updateSetupUI);
    el('participant-count').addEventListener('input', updateSetupUI);
    el('prize-text').addEventListener('input', updateSetupUI);
    el('start-draw').addEventListener('click', () => {
      const v = validateSetup();
      if (!v.ok) return;
      startGame(v.finalNames, v.prizes);
    });
    updateSetupUI();
  }

  function wireDrawScreen() {
    el('spin-button').addEventListener('click', doSpin);
    el('next-person-button').addEventListener('click', hideResultOverlayAndAdvance);
    el('end-draw').addEventListener('click', () => {
      state.phase = 'result';
      save();
      render();
    });
    el('back-to-setup').addEventListener('click', () => {
      state.phase = 'setup';
      clearSaved();
      render();
    });
    el('undo-last').addEventListener('click', () => {
      if (!state.undoSnapshot) return;
      Object.assign(state, deepClone(state.undoSnapshot));
      state.undoSnapshot = null;
      save();
      render();
    });
    el('remaining-list').addEventListener('click', (ev) => {
      const li = ev.target.closest('li.selectable');
      if (!li || uiLocked) return;
      const id = li.dataset.id;
      state.turnOrder = [id, ...state.turnOrder.filter((x) => x !== id)];
      save();
      renderDrawSide();
    });
  }

  function wireResultScreen() {
    el('download-csv').addEventListener('click', downloadCsv);
    el('copy-clipboard').addEventListener('click', copyToClipboard);
    el('restart-same').addEventListener('click', () => {
      if (!confirm('같은 명단으로 다시 시작하시겠습니까?')) return;
      startGame(state.setupConfig.names, state.setupConfig.prizes);
    });
    el('restart-fresh').addEventListener('click', () => {
      if (!confirm('처음부터 다시 시작하시겠습니까? 지금까지 결과가 사라집니다.')) return;
      clearSaved();
      state = initialState();
      el('participant-names').value = '';
      el('prize-text').value = '';
      render();
    });
  }

  function wireKeyboard() {
    document.addEventListener('keydown', (ev) => {
      const tag = document.activeElement.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';

      if (ev.code === 'Space' && state.phase === 'draw' && !uiLocked && el('result-overlay').hidden && !typing) {
        ev.preventDefault();
        doSpin();
      } else if (ev.key === 'Enter' && state.phase === 'draw' && !el('result-overlay').hidden) {
        ev.preventDefault();
        hideResultOverlayAndAdvance();
      } else if (ev.key === 'Escape' && state.phase === 'draw' && !el('result-overlay').hidden) {
        ev.preventDefault();
        hideResultOverlayAndAdvance();
      } else if (ev.key === 'Enter' && document.activeElement.matches('li.selectable')) {
        document.activeElement.click();
      }
    });
  }

  function wireResumeOverlay(saved) {
    el('resume-overlay').hidden = false;
    el('resume-continue').addEventListener('click', () => {
      state = saved;
      el('resume-overlay').hidden = true;
      render();
    });
    el('resume-restart').addEventListener('click', () => {
      clearSaved();
      state = initialState();
      el('resume-overlay').hidden = true;
      render();
    });
  }

  function init() {
    wireSetupScreen();
    wireDrawScreen();
    wireResultScreen();
    wireKeyboard();

    const saved = loadSaved();
    if (saved && saved.phase !== 'setup') {
      state = initialState();
      render();
      wireResumeOverlay(saved);
    } else {
      state = initialState();
      render();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
