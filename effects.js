// effects.js — 당첨 폭죽. 효과는 하나만, 1.5초 안에 끝낸다 (요구사항 10.2).
const Effects = (() => {
  const COLORS = ['#F5C842', '#5B2A86', '#C23B5E', '#F29BC4'];
  const BURST_DELAYS = [0, 250, 500];
  const PARTICLES_PER_BURST = 48;
  const PARTICLE_LIFE = 900;
  const DURATION = 1400;

  let frame = null;

  function stop(canvas) {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = null;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  function fireworks(canvas) {
    stop(canvas);
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const bursts = BURST_DELAYS.map((delay) => ({
      delay,
      x: w * (0.2 + Random.float() * 0.6),
      y: h * (0.15 + Random.float() * 0.3),
      fired: false,
    }));
    const particles = [];
    const start = performance.now();

    function tick(now) {
      const t = now - start;
      for (const b of bursts) {
        if (b.fired || t < b.delay) continue;
        b.fired = true;
        const color = COLORS[Random.int(COLORS.length)];
        for (let i = 0; i < PARTICLES_PER_BURST; i++) {
          const angle = (i / PARTICLES_PER_BURST) * Math.PI * 2;
          const speed = 2.5 + Random.float() * 3.5;
          particles.push({ x: b.x, y: b.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, born: t, color });
        }
      }

      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        // ponytail: 프레임 단위 물리라 주사율이 다르면 속도가 달라진다. 문제되면 경과 시간(dt) 기반으로 바꾼다.
        p.vy += 0.08;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.x += p.vx;
        p.y += p.vy;
        const life = 1 - (t - p.born) / PARTICLE_LIFE;
        if (life <= 0) continue;
        ctx.globalAlpha = life;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;

      if (t < DURATION) frame = requestAnimationFrame(tick);
      else stop(canvas);
    }
    frame = requestAnimationFrame(tick);
  }

  return { fireworks, stop };
})();
