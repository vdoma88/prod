// Шаманский бубен на главной: нажатие — медитативный шаманский ритм, повторное
// нажатие плавно его гасит. Звук и ритм — как у бубна со страницы мистерии
// «Сталь, Соль и Огонь»: медленный шаг 66 ударов в минуту, рисунок
// «сильная, эхо, средняя, эхо…», отзвук зала и тихий гул под бубном.
// Всё синтезируется Web Audio прямо в браузере: без аудиофайлов и без
// изменений CSP. До первого нажатия тишина — так требуют браузеры.
(() => {
  const drum = document.getElementById('hero-drum');
  const caption = document.getElementById('hero-drum-state');
  const vol = document.getElementById('hero-drum-vol');
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!drum || !AudioCtx) return;

  const BPM = 66;
  const INT = 60 / BPM; // медленный шаманский шаг
  const PATTERN = [1, 0.35, 0.8, 0.35, 1, 0.35, 0.8, 0]; // сильная, эхо, средняя, эхо…
  let ctx = null;
  let master = null;
  let verb = null;
  let noise = null;
  let playing = false;
  let nextT = 0;
  let step = 0;
  let timer = 0;
  const hitTimers = new Set();

  // Отзвук зала: затухающий шум 3,2 с как импульс свёртки.
  function impulse(sec) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * sec);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  function init() {
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    verb = ctx.createConvolver();
    verb.buffer = impulse(3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    verb.connect(wet);
    wet.connect(master);
    // Тихий дрон под бубном: две медленно плывущие низкие ноты.
    const drone = ctx.createGain();
    drone.gain.value = 0.05;
    drone.connect(master);
    [55, 82.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.07 + i * 0.05;
      lfoGain.gain.value = 0.6;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);
      o.connect(drone);
      o.start();
      lfo.start();
    });
    // 0,2 с шума для удара колотушки — один буфер на все удары.
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function hit(t, v) {
    if (v <= 0) return;
    const out = ctx.createGain();
    out.connect(master);
    out.connect(verb);
    // Тело бубна: низкий тон с падением высоты.
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const f = 78 + Math.random() * 4;
    o.frequency.setValueAtTime(f * 1.9, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 1.4);
    // Обертон кожи.
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'triangle';
    o2.frequency.value = f * 2.7;
    g2.gain.setValueAtTime(0.12 * v, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o2.connect(g2);
    g2.connect(out);
    o2.start(t);
    o2.stop(t + 0.4);
    // Удар колотушки: шум через фильтр.
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35 * v, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(lp);
    lp.connect(ng);
    ng.connect(out);
    n.start(t);
    n.stop(t + 0.2);
    // Сильные и средние удары видны на бубне — в момент звука.
    if (v >= 0.7) {
      const id = setTimeout(() => {
        hitTimers.delete(id);
        drum.classList.remove('is-hit');
        void drum.offsetWidth;
        drum.classList.add('is-hit');
      }, Math.max(0, (t - ctx.currentTime) * 1000));
      hitTimers.add(id);
    }
  }

  function sched() {
    while (nextT < ctx.currentTime + 0.25) {
      const v = PATTERN[step % PATTERN.length] * (0.9 + Math.random() * 0.1);
      hit(nextT, v);
      nextT += INT / 2;
      step++;
    }
  }

  function volume() {
    return vol ? Number(vol.value) : 0.6;
  }

  function setUi(on) {
    playing = on;
    drum.setAttribute('aria-pressed', String(on));
    drum.classList.toggle('is-playing', on);
    if (vol) vol.hidden = !on;
    if (caption) caption.textContent = on ? 'Бубен звучит — нажмите, чтобы остановить' : 'Нажмите — зазвучит шаманский бубен';
  }

  function start() {
    // iPhone по умолчанию глушит Web Audio беззвучным режимом (переключатель
    // сбоку). Тип «playback» — как у плеера: бубен слышен и при нём.
    // Safari 16.4+; где свойства нет, ничего не меняется.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* нет — и ладно */ }
    if (!ctx) init();
    // Телеметрия (brand/sr-pulse.js): заиграл ли звук на живом телефоне.
    const report = () => window.srPulse?.('drum', ctx.state + (navigator.audioSession ? ' session' : ''));
    const resumed = ctx.resume();
    if (resumed && resumed.then) resumed.then(report, report); else report();
    nextT = ctx.currentTime + 0.1;
    step = 0;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(volume(), ctx.currentTime, 0.8); // плавное нарастание
    sched();
    timer = setInterval(sched, 60);
    setUi(true);
  }

  function stop() {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.5); // плавное затихание
    clearInterval(timer);
    hitTimers.forEach(clearTimeout);
    hitTimers.clear();
    setUi(false);
  }

  drum.addEventListener('click', () => (playing ? stop() : start()));
  if (vol) vol.addEventListener('input', () => { if (playing) master.gain.setTargetAtTime(volume(), ctx.currentTime, 0.1); });
  // Ушли со страницы — бубен замолкает.
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) stop(); });
})();
