// Шаманский бубен на главной: нажатие — удар, кнопка «Ритм» — ровный
// «стук сердца», пока не нажмут снова. Звук синтезируется Web Audio прямо
// в браузере: без аудиофайлов и без изменений CSP. Браузеры разрешают звук
// только после действия человека, поэтому до первого нажатия тишина.
(() => {
  const drum = document.getElementById('hero-drum');
  const rhythmBtn = document.getElementById('hero-drum-rhythm');
  if (!drum) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let noise = null;
  let rhythmTimer = 0;
  let rhythmStop = 0;

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

  // Один удар: низкий гул обечайки с падающим тоном, шлепок кожи и
  // едва слышный звон подвесок. strength 0..1 — сила удара.
  function hit(strength = 1) {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.005;
    const out = ac.createGain();
    out.gain.value = 0.9 * strength;
    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800;
    out.connect(tone).connect(ac.destination);

    const body = ac.createOscillator();
    const bodyGain = ac.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(118, t);
    body.frequency.exponentialRampToValueAtTime(52, t + 0.32);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(1, t + 0.004);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    body.connect(bodyGain).connect(out);
    body.start(t); body.stop(t + 1.6);

    const over = ac.createOscillator();
    const overGain = ac.createGain();
    over.type = 'triangle';
    over.frequency.setValueAtTime(196, t);
    over.frequency.exponentialRampToValueAtTime(96, t + 0.2);
    overGain.gain.setValueAtTime(0.0001, t);
    overGain.gain.exponentialRampToValueAtTime(0.35, t + 0.003);
    overGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    over.connect(overGain).connect(out);
    over.start(t); over.stop(t + 0.5);

    const skin = ac.createBufferSource();
    const skinBand = ac.createBiquadFilter();
    const skinGain = ac.createGain();
    skin.buffer = noise;
    skinBand.type = 'bandpass';
    skinBand.frequency.value = 700;
    skinBand.Q.value = 0.9;
    skinGain.gain.setValueAtTime(0.5, t);
    skinGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    skin.connect(skinBand).connect(skinGain).connect(out);
    skin.start(t); skin.stop(t + 0.1);

    const bells = ac.createBufferSource();
    const bellsHigh = ac.createBiquadFilter();
    const bellsGain = ac.createGain();
    bells.buffer = noise;
    bellsHigh.type = 'highpass';
    bellsHigh.frequency.value = 5200;
    bellsGain.gain.setValueAtTime(0.0001, t + 0.02);
    bellsGain.gain.exponentialRampToValueAtTime(0.06, t + 0.05);
    bellsGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    bells.connect(bellsHigh).connect(bellsGain).connect(ac.destination);
    bells.start(t); bells.stop(t + 0.45);

    drum.classList.remove('is-hit');
    void drum.offsetWidth; // перезапуск анимации удара
    drum.classList.add('is-hit');
  }

  function stopRhythm() {
    clearTimeout(rhythmTimer);
    clearTimeout(rhythmStop);
    rhythmTimer = 0;
    if (rhythmBtn) {
      rhythmBtn.setAttribute('aria-pressed', 'false');
      rhythmBtn.textContent = 'Ритм';
    }
  }

  // «Стук сердца»: сильный удар и слабый отклик, около 60 ударов в минуту.
  // Сам останавливается через две минуты, чтобы не звучать бесконечно.
  function startRhythm() {
    let beat = 0;
    const step = () => {
      hit(beat % 2 === 0 ? 1 : 0.55);
      rhythmTimer = setTimeout(step, beat++ % 2 === 0 ? 260 : 740);
    };
    step();
    rhythmStop = setTimeout(stopRhythm, 120000);
    rhythmBtn.setAttribute('aria-pressed', 'true');
    rhythmBtn.textContent = 'Тише';
  }

  drum.addEventListener('click', () => hit(1));
  if (rhythmBtn) rhythmBtn.addEventListener('click', () => (rhythmTimer ? stopRhythm() : startRhythm()));
  // Ушли со страницы — ритм замолкает.
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopRhythm(); });
})();
