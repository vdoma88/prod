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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
for (const asset of ['styles.css', 'app.js', 'tree.js', 'favicon.svg', 'site.webmanifest']) {
  if (!existsSync(path.join(SITE, asset))) fail(`site/: после интеграции отсутствует обязательный файл ${asset}`);
}
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
  ...['app.js', 'tree.js'].map(n => path.join(SITE, n)),
  path.join(BRAND, 'sr-brand.js'),
  ...readdirSync(path.join(ROOT, 'scripts')).map(n => path.join(ROOT, 'scripts', n)),
  ...readdirSync(path.join(ROOT, 'tests')).map(n => path.join(ROOT, 'tests', n)),
];
for (const file of jsFiles) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); } catch (error) {
    fail(`${path.relative(ROOT, file)}: ${String(error.stderr).split('\n').find(Boolean)}`);
  }
}

// --- сборка --- (--sources: только исходники, до сборки)
if (!process.argv.includes('--sources') && !existsSync(path.join(DIST, 'brand', 'sr-brand.js'))) fail('dist/ не собран или без brand/ — сначала node scripts/build.mjs');

if (errors.length) {
  console.error(`Найдено проблем: ${errors.length}\n` + errors.map(e => `  ✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${pages.length} страниц, ${projects.length} курса, бренд v${version} — всё в порядке`);
