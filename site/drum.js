// Шаманский бубен на главной. Нажатие запускает шаманский ритм, повторное
// нажатие плавно его останавливает. Звук синтезируется Web Audio прямо в
// браузере: без аудиофайлов и без изменений CSP. Браузеры разрешают звук
// только после действия человека, поэтому до первого нажатия тишина.
//
// Ритм — как у шаманского путешествия:
//   1. зов: редкие удары, разгоняющиеся до рабочего темпа;
//   2. путь: ровный монотонный бой около 4 ударов в секунду (~230 в минуту)
//      с акцентом на каждый четвёртый и живыми неровностями руки;
//   3. возврат: четыре серии по семь сильных ударов, быстрая дробь
//      и последний удар.
(() => {
  const drum = document.getElementById('hero-drum');
  const caption = document.getElementById('hero-drum-state');
  if (!drum) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const LOOKAHEAD = 0.12; // на сколько секунд вперёд ставить удары
  let ctx = null;
  let noise = null;
  let master = null;
  let beats = [];
  let next = 0;
  let startAt = 0;
  let timer = 0;
  let endTimer = 0;
  const hitTimers = new Set();

  function audio() {
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();
      // Полсекунды белого шума — для «кожи» и подвесок бубна.
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Партитура: список ударов { t: секунды от начала, v: сила 0..1 }.
  function score() {
    const out = [];
    const jitter = () => (Math.random() - 0.5) * 0.024;
    let t = 0;
    // 1. Зов: 12 ударов, интервал сжимается с 1,1 с до рабочих 0,26 с.
    for (let i = 0; i < 12; i++) {
      out.push({ t, v: 1 - i * 0.02 });
      t += 1.1 * Math.pow(0.26 / 1.1, (i + 1) / 12);
    }
    // 2. Путь: ровный бой ~40 секунд.
    const pulse = 0.26;
    for (let i = 0; t < 46; i++) {
      out.push({ t: t + jitter(), v: i % 4 === 0 ? 0.95 : 0.62 + Math.random() * 0.12 });
      t += pulse;
    }
    // 3. Возврат: 4 × 7 сильных ударов, быстрая дробь, последний удар.
    t += 0.9;
    for (let set = 0; set < 4; set++) {
      for (let i = 0; i < 7; i++) { out.push({ t, v: 1 }); t += 0.42; }
      t += 0.9;
    }
    const rollEnd = t + 3.2;
    for (let i = 0; t < rollEnd; i++) {
      out.push({ t: t + jitter() / 3, v: 0.45 + 0.35 * (t - rollEnd + 3.2) / 3.2 });
      t += 0.085;
    }
    out.push({ t: t + 0.7, v: 1 });
    return out;
  }

  // Один удар в момент when: низкий гул обечайки с падающим тоном, шлепок
  // кожи и едва слышный звон подвесок. v 0..1 — сила удара.
  function hit(when, v) {
    const ac = ctx;
    const out = ac.createGain();
    out.gain.value = 0.85 * v;
    out.connect(master);

    const body = ac.createOscillator();
    const bodyGain = ac.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(112 + 10 * v, when);
    body.frequency.exponentialRampToValueAtTime(52, when + 0.3);
    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.exponentialRampToValueAtTime(1, when + 0.004);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
    body.connect(bodyGain).connect(out);
    body.start(when); body.stop(when + 1);

    const over = ac.createOscillator();
    const overGain = ac.createGain();
    over.type = 'triangle';
    over.frequency.setValueAtTime(196, when);
    over.frequency.exponentialRampToValueAtTime(96, when + 0.18);
    overGain.gain.setValueAtTime(0.0001, when);
    overGain.gain.exponentialRampToValueAtTime(0.32, when + 0.003);
    overGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);
    over.connect(overGain).connect(out);
    over.start(when); over.stop(when + 0.4);

    const skin = ac.createBufferSource();
    const skinBand = ac.createBiquadFilter();
    const skinGain = ac.createGain();
    skin.buffer = noise;
    skin.playbackRate.value = 0.9 + Math.random() * 0.2;
    skinBand.type = 'bandpass';
    skinBand.frequency.value = 650 + 150 * v;
    skinBand.Q.value = 0.9;
    skinGain.gain.setValueAtTime(0.5, when);
    skinGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
    skin.connect(skinBand).connect(skinGain).connect(out);
    skin.start(when); skin.stop(when + 0.1);

    const bells = ac.createBufferSource();
    const bellsHigh = ac.createBiquadFilter();
    const bellsGain = ac.createGain();
    bells.buffer = noise;
    bellsHigh.type = 'highpass';
    bellsHigh.frequency.value = 5200;
    bellsGain.gain.setValueAtTime(0.0001, when + 0.015);
    bellsGain.gain.exponentialRampToValueAtTime(0.05 * v, when + 0.04);
    bellsGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
    bells.connect(bellsHigh).connect(bellsGain).connect(master);
    bells.start(when); bells.stop(when + 0.35);

    // Анимация удара — в тот же момент, когда прозвучит звук.
    const id = setTimeout(() => {
      hitTimers.delete(id);
      drum.classList.remove('is-hit');
      void drum.offsetWidth;
      drum.classList.add('is-hit');
    }, Math.max(0, (when - ac.currentTime) * 1000));
    hitTimers.add(id);
  }

  function schedule() {
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (next < beats.length && startAt + beats[next].t < horizon) {
      hit(Math.max(startAt + beats[next].t, ctx.currentTime), beats[next].v);
      next++;
    }
    if (next >= beats.length) {
      clearInterval(timer);
      timer = 0;
      const left = startAt + beats[beats.length - 1].t + 1.2 - ctx.currentTime;
      endTimer = setTimeout(() => stop(false), Math.max(0, left * 1000));
    }
  }

  function setPlaying(on) {
    drum.setAttribute('aria-pressed', String(on));
    drum.classList.toggle('is-playing', on);
    if (caption) caption.textContent = on ? 'Звучит ритм — нажмите, чтобы остановить' : 'Нажмите — зазвучит шаманский ритм';
  }

  function start() {
    const ac = audio();
    if (!ac) return;
    master = ac.createGain();
    master.gain.value = 1;
    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    master.connect(tone).connect(ac.destination);
    beats = score();
    next = 0;
    startAt = ac.currentTime + 0.06;
    schedule();
    timer = setInterval(schedule, 25);
    setPlaying(true);
  }

  // fade: плавно увести звук за полсекунды (остановка по нажатию).
  function stop(fade = true) {
    clearInterval(timer);
    clearTimeout(endTimer);
    timer = 0;
    hitTimers.forEach(clearTimeout);
    hitTimers.clear();
    if (master && ctx) {
      const m = master;
      if (fade) {
        m.gain.setValueAtTime(m.gain.value, ctx.currentTime);
        m.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      }
      setTimeout(() => m.disconnect(), fade ? 600 : 0);
      master = null;
    }
    setPlaying(false);
  }

  drum.addEventListener('click', () => (drum.getAttribute('aria-pressed') === 'true' ? stop() : start()));
  // Ушли со страницы — ритм замолкает.
  document.addEventListener('visibilitychange', () => { if (document.hidden && master) stop(); });
})();
