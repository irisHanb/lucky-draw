// random.js — crypto 기반 난수. Math.random을 쓰지 않는다 (요구사항 7장).
const Random = (() => {
  function uint32() {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0];
  }

  function float() {
    return uint32() / 0x100000000; // [0, 1)
  }

  // [0, n) 균등 정수. 모듈로 편향을 피하려고 거부 샘플링을 쓴다.
  function int(n) {
    if (n <= 1) return 0;
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do {
      x = uint32();
    } while (x >= limit);
    return x % n;
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  return { float, int, shuffle };
})();

if (typeof module !== 'undefined') module.exports = Random;
