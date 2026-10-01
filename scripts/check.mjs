// Проверки проекта без браузера. Запуск: node scripts/build.mjs && node scripts/check.mjs
//
//  • у каждого курса из PROJECTS (brand/sr-brand.js) есть страница на лендинге,
//    ссылка «войти» на ней и карточка на «Моих курсах»;
//  • ядро перенесённого лендинга (главная + 8 направлений) остаётся на месте;
//  • все локальные ссылки и картинки страниц ведут на существующие файлы;
//  • список направлений в окне заявки одинаков на всех страницах и покрывает
//    все кнопки data-service;
//  • нет inline-стилей и inline-скриптов (иначе их заблокирует CSP);
//  • версия бренда одна в package.json, sr-brand.js и tokens.css;
//  • JS-файлы синтаксически корректны.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { BRAND, DIST, ROOT, SITE, readBrand } from './lib.mjs';

const errors = [];
const fail = message => errors.push(message);
const read = p => readFileSync(p, 'utf8');

const { version, projects, source } = readBrand();
const pages = readdirSync(SITE).filter(name => name.endsWith('.html')).sort();
const html = Object.fromEntries(pages.map(name => [name, read(path.join(SITE, name))]));

// --- ядро перенесённого лендинга ---
const requiredLandingPages = [
  'index.html',
  'therapy.html',
  'mystery.html',
  'game.html',
  'offerings.html',
  'candle-course.html',
  'tarot-course.html',
  'massage.html',
  'consultations.html',
  '404.html',
];
for (const name of requiredLandingPages) {
  if (!html[name]) fail(`site/: после интеграции отсутствует обязательная страница ${name}`);
}
for (const asset of ['styles.css', 'app.js', 'favicon.svg', 'touch-icon.png', 'site.webmanifest']) {
  if (!existsSync(path.join(SITE, asset))) fail(`site/: после интеграции отсутствует обязательный файл ${asset}`);
}
// iPhone не берёт SVG-иконку и иконки из манифеста: без PNG на экране «Домой»
// вместо знака будет снимок страницы. Имя не apple-touch-icon.png: этот адрес
// nginx отправляет в школу (иконки её прежнего приложения).
// Телеметрия (brand/sr-pulse.js) — на каждой странице и раньше app.js, чтобы видеть его ошибки.
for (const [name, source] of Object.entries(html)) {
  if (!/<link rel="apple-touch-icon" href="\/?touch-icon\.png">/.test(source)) fail(`site/${name}: нет apple-touch-icon для iPhone`);
  const pulseAt = source.search(/<script src="\/?brand\/sr-pulse\.js"><\/script>/);
  if (pulseAt < 0) fail(`site/${name}: не подключён brand/sr-pulse.js`);
  const appAt = source.indexOf('<script src="app.js">');
  if (appAt >= 0 && pulseAt > appAt) fail(`site/${name}: sr-pulse.js должен стоять раньше app.js`);
}
// Картинки и файлы страниц: есть и не пустые. Пустой consult.webp из PR #40
// проходил все проверки, а iPhone с плотным экраном выбирал именно его — фото
// не показывалось. Пустой файл в assets/ — ошибка, даже если на него нет ссылки.
for (const [name, source] of Object.entries(html)) {
  const refs = [...source.matchAll(/\s(?:src|href)="([^"#?]+)"/g)].map(m => m[1])
    .concat([...source.matchAll(/\ssrcset="([^"]+)"/g)].flatMap(m => m[1].split(',').map(part => part.trim().split(/\s+/)[0])));
  for (const ref of new Set(refs)) {
    if (/^(https?:|mailto:|tel:|data:|\/\/)/.test(ref) || !/\.(webp|jpe?g|png|svg|gif|avif|css|js|woff2)$/i.test(ref)) continue;
    const file = path.join(SITE, ref.replace(/^\//, ''));
    const inBrand = ref.replace(/^\//, '').startsWith('brand/') && existsSync(path.join(BRAND, ref.replace(/^\/?brand\//, '')));
    if (inBrand) continue;
    if (!existsSync(file)) fail(`site/${name}: нет файла ${ref}`);
    else if (statSync(file).size === 0) fail(`site/${name}: пустой файл ${ref}`);
  }
}
// 404.html nginx отдаёт на любом адресе, в том числе вложенном (/a/b): относительная
// ссылка там ведёт в /a/styles.css, и страница остаётся без оформления.
for (const m of (html['404.html'] || '').matchAll(/\s(?:src|href)="([^"]+)"/g)) {
  if (!/^(\/|https?:|mailto:|tel:|#|data:)/.test(m[1])) fail(`site/404.html: ссылка ${m[1]} должна начинаться с /`);
}
(function emptyAssets(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) emptyAssets(full);
    else if (statSync(full).size === 0) fail(`${path.relative(ROOT, full)}: пустой файл`);
  }
})(path.join(SITE, 'assets'));
const landingHome = html['index.html'] || '';
for (const id of ['services', 'start', 'faq']) {
  if (!landingHome.includes(`id="${id}"`)) fail(`site/index.html: после интеграции отсутствует секция #${id}`);
}
const appSource = existsSync(path.join(SITE, 'app.js')) ? read(path.join(SITE, 'app.js')) : '';
if (!/telegramUsername:\s*["']BelayaKatrin["']/.test(appSource)) {
  fail('site/app.js: прямой Telegram @BelayaKatrin не настроен');
}
if (/whatsapp|wa\.me/i.test(Object.values(html).join('\n') + appSource)) {
  fail('site/: обнаружен WhatsApp — для заявок используется только Telegram');
}

// --- курсы ---
const ids = new Set();
for (const project of projects) {
  for (const key of ['id', 'title', 'note', 'url', 'about', 'accent']) {
    if (!project[key]) fail(`PROJECTS: у курса ${project.id || '?'} нет поля ${key}`);
  }
  if (ids.has(project.id)) fail(`PROJECTS: повторяется id ${project.id}`);
  ids.add(project.id);
  if (!/^https:\/\/[a-z0-9-]+\.belayarod\.ru\/$/.test(project.url)) fail(`PROJECTS: ${project.id}: адрес ${project.url} — ожидался https://<поддомен>.belayarod.ru/`);
  const about = project.about.replace(/^\//, '');
  if (!html[about]) { fail(`PROJECTS: ${project.id}: нет страницы site/${about}`); continue; }
  if (!html[about].includes(`href="${project.url}"`)) fail(`site/${about}: нет ссылки «войти» на ${project.url}`);
  if (!html['courses.html']?.includes(`href="${project.url}"`)) fail(`site/courses.html: нет карточки ${project.id} (${project.url})`);
  if (!html['courses.html']?.includes(`course-card--${project.id}`)) fail(`site/courses.html: нет класса course-card--${project.id}`);
  if (!new RegExp(`--sr-${project.id}:\\s*${project.accent}`, 'i').test(read(path.join(BRAND, 'tokens.css')))) {
    fail(`brand/tokens.css: цвет --sr-${project.id} не совпадает с accent ${project.accent} в sr-brand.js`);
  }
}

// --- ссылки ---
for (const [name, text] of Object.entries(html)) {
  for (const [, attr, raw] of text.matchAll(/\s(href|src)="([^"]*)"/g)) {
    if (/^(https?:|mailto:|tel:|#|data:)/.test(raw) || raw === '') continue;
    const clean = raw.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = clean.startsWith('/') ? path.join(SITE, clean) : path.join(SITE, path.dirname(name), clean);
    const inBrand = clean.replace(/^\//, '').startsWith('brand/') && existsSync(path.join(ROOT, clean.replace(/^\//, '')));
    if (!existsSync(target) && !inBrand) fail(`site/${name}: ${attr}="${raw}" — файла нет`);
  }
  for (const [, id] of text.matchAll(/href="#([^"]+)"/g)) {
    if (id !== 'top' && !text.includes(`id="${id}"`)) fail(`site/${name}: якорь #${id} не найден на странице`);
  }
  // --- превью в соцсетях (scripts/og.mjs) ---
  if (name !== '404.html') {
    const og = /<meta property="og:image" content="https:\/\/belayarod\.ru\/([^"]+)"/.exec(text)?.[1];
    if (!og) fail(`site/${name}: нет og:image`);
    else if (!existsSync(path.join(SITE, og))) fail(`site/${name}: og:image ${og} — файла нет (node scripts/og.mjs)`);
    if (!text.includes('<meta name="twitter:card" content="summary_large_image">')) fail(`site/${name}: twitter:card не summary_large_image`);
  }
  // --- CSP ---
  if (/\sstyle="/.test(text)) fail(`site/${name}: inline-атрибут style заблокирует CSP`);
  for (const [, attrs] of text.matchAll(/<script([^>]*)>(?!<\/script>)/g)) {
    if (!/\ssrc=/.test(attrs) && !/type="application\/ld\+json"/.test(attrs)) fail(`site/${name}: inline-скрипт заблокирует CSP`);
  }
  if (/\son[a-z]+="/.test(text)) fail(`site/${name}: обработчик on*="…" в разметке заблокирует CSP`);
}

// --- окно заявки ---
const optionSets = new Map();
for (const [name, text] of Object.entries(html)) {
  const select = text.match(/<select id="request-service">([\s\S]*?)<\/select>/);
  const services = [...text.matchAll(/data-service="([^"]+)"/g)].map(m => m[1]);
  if (!select) { if (services.length) fail(`site/${name}: есть кнопки заявки, но нет окна`); continue; }
  const options = [...select[1].matchAll(/<option>([^<]+)<\/option>/g)].map(m => m[1]);
  optionSets.set(name, options.join('|'));
  for (const service of services) if (!options.includes(service)) fail(`site/${name}: направления «${service}» нет в списке заявки`);
}
if (new Set(optionSets.values()).size > 1) fail(`списки направлений в окне заявки различаются: ${[...optionSets].map(([n, o]) => `${n}: ${o.split('|').length}`).join(', ')}`);

// --- версии ---
const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
if (pkg.version !== version) fail(`версия: package.json ${pkg.version}, sr-brand.js ${version}`);
if (!source.startsWith(`/*! Сила Рода · общий бренд v${version} `)) fail('brand/sr-brand.js: версия в первой строке не совпадает с VERSION');
if (!read(path.join(BRAND, 'tokens.css')).startsWith(`/* Сила Рода · общие дизайн-токены v${version}`)) fail('brand/tokens.css: версия в первой строке не совпадает с VERSION');

// --- бренд: CSP-совместимость ---
for (const name of readdirSync(BRAND).filter(n => n.endsWith('.html'))) {
  const text = read(path.join(BRAND, name));
  if (/\sstyle="/.test(text) || /<style/.test(text)) fail(`brand/${name}: inline-стили заблокирует CSP`);
}
if (/innerHTML|insertAdjacentHTML|\.style\s*=\s*['"`]|setAttribute\('style'/.test(source)) fail('brand/sr-brand.js: разметку и стили ставить только через DOM/CSSOM');

// --- синтаксис JS ---
const jsFiles = [
  ...['app.js', 'drum.js'].map(n => path.join(SITE, n)),
  path.join(BRAND, 'sr-brand.js'),
  path.join(BRAND, 'sr-pulse.js'),
  ...readdirSync(path.join(ROOT, 'scripts')).map(n => path.join(ROOT, 'scripts', n)),
  ...readdirSync(path.join(ROOT, 'tests')).map(n => path.join(ROOT, 'tests', n)),
  ...readdirSync(path.join(ROOT, 'bot')).filter(n => n.endsWith('.mjs')).map(n => path.join(ROOT, 'bot', n)),
];
for (const file of jsFiles) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); } catch (error) {
    fail(`${path.relative(ROOT, file)}: ${String(error.stderr).split('\n').find(Boolean)}`);
  }
}

// --- сборка --- (--sources: только исходники, до сборки)
if (!process.argv.includes('--sources')) {
  if (!existsSync(path.join(DIST, 'brand', 'sr-brand.js'))) fail('dist/ не собран или без brand/ — сначала node scripts/build.mjs');
  const versionFile = path.join(DIST, 'version.json');
  if (!existsSync(versionFile)) fail('dist/version.json отсутствует — сборка не оставила идентификатор версии');
  else {
    try {
      const info = JSON.parse(read(versionFile));
      if (info.project !== 'sila-roda' || !info.commit || !info.builtAt) fail('dist/version.json: неполные данные версии');
    } catch {
      fail('dist/version.json: некорректный JSON');
    }
  }
}

if (errors.length) {
  console.error(`Найдено проблем: ${errors.length}\n` + errors.map(e => `  ✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${pages.length} страниц, ${projects.length} курса, бренд v${version} — всё в порядке`);
