// Проверка в настоящем браузере (Chromium через Playwright): все страницы
// открываются без ошибок и нарушений CSP, не дают горизонтальной прокрутки
// на телефоне, а общая шапка работает с клавиатуры и мышью.
//
//   node scripts/build.mjs && node tests/e2e.mjs
//
// Playwright в зависимости проекта не входит: берётся установленный
// глобально (npm i -g playwright) или через PLAYWRIGHT_MODULE=путь.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { startServer } from '../scripts/serve.mjs';
import { SITE } from '../scripts/lib.mjs';

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs', '/usr/local/lib/node_modules/playwright/index.mjs'];
  for (const candidate of candidates.filter(Boolean)) {
    try { return await import(candidate); } catch { /* следующий */ }
  }
  return null;
}

const playwright = await loadPlaywright();
if (!playwright) {
  console.log('Playwright не найден — браузерная проверка пропущена (npm i -g playwright).');
  process.exit(0);
}

const server = await startServer(0);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch();
const failures = [];
const check = async (label, fn) => {
  try { await fn(); console.log(`  ✓ ${label}`); } catch (error) { failures.push(label); console.log(`  ✗ ${label}\n    ${error.message.split('\n')[0]}`); }
};

try {
  const pages = readdirSync(SITE).filter(n => n.endsWith('.html')).concat('brand/preview.html');
  for (const [width, height, label] of [[1440, 900, 'компьютер'], [375, 812, 'телефон']]) {
    console.log(`Страницы — ${label} ${width}px`);
    const context = await browser.newContext({ viewport: { width, height } });
    // Внешние шрифты и three.js в песочнице могут быть недоступны; для проверки
    // вёрстки и CSP они не нужны.
    await context.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net)\//, route => route.abort());
    for (const name of pages) {
      await check(name, async () => {
        const page = await context.newPage();
        const problems = [];
        page.on('pageerror', error => problems.push(`ошибка JS: ${error.message}`));
        page.on('console', message => {
          if (message.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(message.text())) problems.push(message.text());
        });
        await page.goto(`${origin}/${name}`, { waitUntil: 'load' });
        await page.waitForTimeout(150);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        await page.close();
        assert.deepEqual(problems, []);
        assert.ok(overflow <= 0, `горизонтальная прокрутка ${overflow}px`);
      });
    }
    await context.close();
  }

  console.log('Общая шапка');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net)\//, route => route.abort());
  const page = await context.newPage();
  await page.goto(`${origin}/brand/preview.html`);
  const bar = page.locator('sr-brand-bar').first();
  const toggle = bar.locator('button.toggle');
  const menu = bar.locator('.menu');

  await check('стили загружены и шапка видима', async () => {
    await page.waitForFunction(() => {
      const root = document.querySelector('sr-brand-bar')?.shadowRoot?.querySelector('.root');
      return root && getComputedStyle(root).visibility === 'visible' && root.getBoundingClientRect().height >= 44;
    }, null, { timeout: 3000 });
  });
  await check('меню открывается и показывает 4 курса', async () => {
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await menu.isVisible(), true);
    assert.equal(await bar.locator('.item').count(), 4);
  });
  await check('текущий курс отмечен aria-current', async () => {
    assert.equal(await bar.locator('[aria-current="page"]').getAttribute('href'), 'https://runes.belayarod.ru/');
  });
  await check('меню помещается в экран телефона', async () => {
    const box = await menu.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, `меню ${Math.round(box.x)}…${Math.round(box.x + box.width)}px`);
  });
  await check('Escape закрывает меню и возвращает фокус', async () => {
    await bar.locator('.item').first().focus();
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false);
    assert.equal(await page.evaluate(() => document.querySelector('sr-brand-bar').shadowRoot.activeElement?.className), 'toggle');
  });
  await check('щелчок вне шапки закрывает меню', async () => {
    await toggle.click();
    await page.mouse.click(200, 600);
    assert.equal(await menu.isVisible(), false);
  });
  await check('«Другие курсы» не показывают текущий курс', async () => {
    const titles = await page.locator('sr-courses').first().locator('.course b').allTextContents();
    assert.deepEqual(titles, ['Связь с Родом', 'Карты Таро', 'Руны']);
  });
  await context.close();
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\nНе прошло: ${failures.length}`);
  process.exit(1);
}
console.log('\nВсё прошло.');
