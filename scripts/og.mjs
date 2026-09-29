// Картинки для соцсетей (og:image) — по одной на страницу сайта, 1200×630.
//
//   node scripts/og.mjs
//
// Карточка собирается из фотографии страницы, заголовка и описания
// (<meta name="description">) и снимается Chromium в site/assets/og/<страница>.jpg.
// Результат лежит в репозитории: на сервере Chromium не нужен. Запускать
// заново, когда меняются фотография, заголовок или описание страницы.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, SITE } from './lib.mjs';

const OUT = path.join(SITE, 'assets', 'og');
const FONTS = path.join(ROOT, 'brand', 'fonts');
// Для главной — свой заголовок: <title> у неё про бренд, а не про страницу.
const TITLES = { 'index.html': 'Практики, которые возвращают к себе' };

async function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs', '/usr/local/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(c); } catch { /* следующий */ }
  }
  throw new Error('Нужен Playwright: npm i -g playwright или PLAYWRIGHT_MODULE=путь');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const font = (file) => pathToFileURL(path.join(FONTS, file)).href;

function card({ title, text, photo }) {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><style>
@font-face{font-family:Cormorant;src:url(${font('cormorant-garamond-cyrillic-500-normal.woff2')});unicode-range:U+0400-04FF}
@font-face{font-family:Cormorant;src:url(${font('cormorant-garamond-latin-500-normal.woff2')});unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:Manrope;src:url(${font('manrope-cyrillic-wght-normal.woff2')});font-weight:200 800;unicode-range:U+0400-04FF}
@font-face{font-family:Manrope;src:url(${font('manrope-latin-wght-normal.woff2')});font-weight:200 800;unicode-range:U+0000-00FF,U+2000-206F}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;display:grid;grid-template-columns:600px 600px;background:#f7f0e7;color:#33251d;font-family:Manrope,sans-serif}
.text{position:relative;padding:58px 56px 50px 64px;display:flex;flex-direction:column;background:radial-gradient(circle at 20% 10%,#fffaf4,#f1e3d3)}
.mono{width:62px;height:62px;border:1.5px solid #d7ae70;border-radius:50%;display:grid;place-items:center;font:500 30px Cormorant,serif;color:#a66b2d}
.kicker{margin-top:30px;font-size:15px;letter-spacing:.2em;color:#9f6429;font-weight:600}
h1{margin-top:16px;font:500 64px/1.02 Cormorant,serif;letter-spacing:-.01em}
p{margin-top:22px;font-size:21px;line-height:1.5;color:#6b5646}
.site{margin-top:auto;font-size:17px;letter-spacing:.14em;color:#9f6429;font-weight:600}
.photo{background:url(${photo}) center/cover}
.photo::after{content:"";display:block;height:100%;background:linear-gradient(90deg,rgba(241,227,211,.35),transparent 18%)}
</style><div class="text"><div class="mono">ЕБ</div><div class="kicker">ЕКАТЕРИНА БЕЛАЯ · СИЛА РОДА</div><h1>${esc(title)}</h1><p>${esc(text)}</p><div class="site">BELAYAROD.RU</div></div><div class="photo"></div></html>`;
}

function shorten(text, max = 120) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,:;—–-]\s*$/, '') + '…';
}

const pages = readdirSync(SITE).filter((f) => f.endsWith('.html') && f !== '404.html');
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
mkdirSync(OUT, { recursive: true });
// Страница карточки — файлом: из about:blank Chromium не открывает локальные картинки.
const tmp = mkdtempSync(path.join(os.tmpdir(), 'og-'));
const tmpFile = path.join(tmp, 'card.html');
for (const file of pages) {
  const html = readFileSync(path.join(SITE, file), 'utf8');
  const img = /<img[^>]*\ssrc="([^"]+\.webp)"/.exec(html)?.[1];
  if (!img) { console.warn(`${file}: нет фотографии — пропускаю`); continue; }
  const title = TITLES[file] || /<title>([^<]+?)\s+—/.exec(html)?.[1] || file;
  const text = shorten(/<meta name="description" content="([^"]+)"/.exec(html)?.[1] || '');
  writeFileSync(tmpFile, card({ title, text, photo: pathToFileURL(path.join(SITE, img)).href }));
  await page.goto(pathToFileURL(tmpFile).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(OUT, file.replace(/\.html$/, '.jpg'));
  await page.screenshot({ path: out, type: 'jpeg', quality: 84 });
  console.log(`✓ ${path.relative(ROOT, out)}  ${title}`);
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });
