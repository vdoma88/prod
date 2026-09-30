// Настоящий Safari в iOS Simulator (Mac-раннер GitHub, .github/workflows/ios-simulator.yml).
//
// Playwright-проверка iPhone гоняет WebKit на Linux — это не тот Safari, что
// в телефоне. Здесь открываем belayarod.ru в Simulator на двух айфонах,
// снимаем экран и ищем главную беду iPhone — белый экран: снимок почти
// целиком белый или однотонный. Снимки — в артефакте для глаз.
//
//   node scripts/ios-simulator.mjs              (только macOS с Xcode)
//   BASE=https://belayarod.ru PAGES=/,/runes.html node scripts/ios-simulator.mjs
//
// Метка ?iphoneAudit в адресе: телеметрия (brand/sr-pulse.js) такие визиты не считает.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE || 'https://belayarod.ru').replace(/\/$/, '');
const PAGES = (process.env.PAGES || '/,/courses.html,/therapy.html,/candle-course.html,/tarot-course.html,/runes.html,/mystery.html,/game.html,/offerings.html,/massage.html,/consultations.html').split(',');
const OUT = process.env.OUT || 'ios-simulator';
const WAIT_FIRST = 15000;
const WAIT = 8000;

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Два айфона: обычный последний из установленных в Xcode и маленький (SE или 16e).
function pickDevices() {
  const { devices } = JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', 'available', '--json']));
  const ios = Object.entries(devices)
    .filter(([runtime]) => /iOS/.test(runtime))
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true })) // новейшая iOS первой
    .flatMap(([runtime, list]) => list.map(d => ({ ...d, runtime: runtime.replace(/.*SimRuntime\./, '') })));
  // SE в Xcode 26 уже нет — его место занял 16e (маленький экран, без «острова»).
  const se = ios.find(d => /^iPhone SE/.test(d.name)) || ios.find(d => /^iPhone \d+e$/.test(d.name));
  const plain = ios.find(d => /^iPhone \d+$/.test(d.name)) || ios.find(d => /^iPhone/.test(d.name));
  return [plain, se].filter(Boolean);
}

// Снимок → 24-битный BMP 60×130 (sips есть в macOS) → доля почти белых и
// разброс яркости. Белый экран: ≥97% почти белых пикселей или всё однотонно.
function blankness(png) {
  const bmp = png.replace(/\.png$/, '.bmp');
  sh('sips', ['-s', 'format', 'bmp', '-z', '130', '60', png, '--out', bmp]);
  return bmpBlankness(readFileSync(bmp));
}

export function bmpBlankness(b) {
  const offset = b.readUInt32LE(10), w = b.readInt32LE(18), h = Math.abs(b.readInt32LE(22)), bpp = b.readUInt16LE(28);
  const step = bpp / 8, row = Math.ceil((w * step) / 4) * 4;
  // Верх экрана (строка статуса и адреса Safari) не считаем: он белый всегда.
  let white = 0, n = 0, sum = 0, sum2 = 0;
  for (let y = 0; y < h; y++) {
    const fromTop = b.readInt32LE(22) > 0 ? h - 1 - y : y;
    if (fromTop < h * 0.12 || fromTop > h * 0.9) continue;
    for (let x = 0; x < w; x++) {
      const i = offset + y * row + x * step;
      const l = (b[i] + b[i + 1] + b[i + 2]) / 3;
      n++; sum += l; sum2 += l * l;
      if (l > 245) white++;
    }
  }
  const mean = sum / n;
  return { white: white / n, spread: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

if (import.meta.url !== `file://${process.argv[1]}`) { /* импорт из теста */ } else await main();

async function main() {
mkdirSync(OUT, { recursive: true });
const report = [];
let failures = 0;
const devices = pickDevices();
if (!devices.length) throw new Error('В Xcode нет симуляторов iPhone');

for (const d of devices) {
  console.log(`\n${d.name} · ${d.runtime}`);
  try { sh('xcrun', ['simctl', 'boot', d.udid]); } catch { /* уже запущен */ }
  sh('xcrun', ['simctl', 'bootstatus', d.udid, '-b'], { timeout: 300000 });
  for (const [i, page] of PAGES.entries()) {
    const url = `${BASE}${page}${page.includes('?') ? '&' : '?'}iphoneAudit=sim-${Date.now()}`;
    sh('xcrun', ['simctl', 'openurl', d.udid, url]);
    await sleep(i === 0 ? WAIT_FIRST : WAIT);
    const name = `${d.name.replace(/\W+/g, '-')}${page === '/' ? '-home' : page.replace(/\W+/g, '-')}`.replace(/-+$/, '');
    const shot = path.join(OUT, `${name}.png`);
    // Белый снимок бывает и у страницы, которая ещё грузится (раннер в США,
    // сервер в России): Safari до первой отрисовки показывает белое. Такой
    // странице даём ещё до 30 секунд; белый экран — только если так и не появилась.
    const isBlank = ({ white, spread }) => white >= 0.97 || spread < 6;
    let m, waited = 0;
    for (;;) {
      sh('xcrun', ['simctl', 'io', d.udid, 'screenshot', shot]);
      m = blankness(shot);
      if (!isBlank(m) || waited >= 30000) break;
      await sleep(10000);
      waited += 10000;
    }
    const blank = isBlank(m);
    const slow = !blank && waited > 0;
    if (blank) failures++;
    const line = { device: d.name, ios: d.runtime, page, white: +m.white.toFixed(3), spread: +m.spread.toFixed(1), blank, slow, waitedMs: waited, screenshot: shot };
    report.push(line);
    console.log(`${blank ? '✗ БЕЛЫЙ ЭКРАН' : slow ? '⚠ медленно' : '✓'} ${page} — белого ${(m.white * 100).toFixed(0)}%, разброс ${m.spread.toFixed(0)}${waited ? `, ждали ещё ${waited / 1000} с` : ''}`);
  }
  try { sh('xcrun', ['simctl', 'shutdown', d.udid]); } catch { /* не мешает */ }
}

writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nБелых экранов: ${failures} из ${report.length}; медленных (появились после ${WAIT / 1000} с): ${report.filter(r => r.slow).length}`);
if (failures) process.exit(1);
}
