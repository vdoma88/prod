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
    // Внешние шрифты и CDN в песочнице могут быть недоступны; для проверки
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

  console.log('Редактор фотографий и объектов');
  await check('редактирование фото и блоков: предпросмотр, публикация, показ посетителям',async()=>{
    const ctx=await browser.newContext({viewport:{width:1440,height:900}});
    let published={page:'index.html',revision:0,changes:{}};
    await ctx.route('**/account/api/**',async route=>{
      const url=new URL(route.request().url()), pathname=url.pathname;
      if(pathname==='/account/api/me')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:{role:'admin',name:'Admin'}})});
      if(pathname==='/account/api/landing')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(published)});
      if(pathname==='/account/api/admin/landing'&&route.request().method()==='POST'){
        const next=route.request().postDataJSON();
        assert.equal(next.revision,published.revision);
        published={page:'index.html',revision:published.revision+1,changes:next.changes};
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(published)});
      }
      return route.fulfill({status:404,contentType:'application/json',body:'{}'});
    });
    const p=await ctx.newPage();
    p.on('pageerror',err=>{throw err;});
    await p.goto(origin+'/?edit=1',{waitUntil:'load'});
    await p.locator('.sr-visual-editor select').first().waitFor({timeout:5000});
    const imageKey=await p.locator('.bc-emblem img').getAttribute('data-sr-visual-key');
    assert.match(imageKey,/^@image:/);
    await p.locator('.sr-visual-editor select').first().selectOption(imageKey);
    await p.locator('.sr-visual-options input[type=range]').first().evaluate(input=>{
      input.value='125';input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    assert.match(await p.locator('.bc-emblem img').evaluate(e=>e.style.transform),/scale\(1\.25\)/);
    const blockKey=await p.locator('#services').getAttribute('data-sr-visual-key');
    assert.match(blockKey,/^@block:/);
    await p.locator('.sr-visual-editor select').first().selectOption(blockKey);
    await p.locator('.sr-visual-options input[type=checkbox]').check();
    assert.equal(await p.locator('#services').evaluate(e=>e.style.display),'none');
    await p.locator('.sr-copy-actions button.sr-copy-primary').click();
    assert.equal(published.revision,1);
    assert.equal(published.changes[imageKey].zoom,125);
    assert.equal(published.changes[blockKey].hidden,true);
    await p.goto(origin+'/',{waitUntil:'load'});
    await p.waitForFunction(()=>document.querySelector('#services')?.style.display==='none');
    assert.match(await p.locator('.bc-emblem img').evaluate(e=>e.style.transform),/scale\(1\.25\)/);
    await ctx.close();
  });

  await check('загрузка фото в Safari: WebP не сохраняется — уходит JPEG, а не огромный PNG',async()=>{
    const ctx=await browser.newContext({viewport:{width:1440,height:900}});
    // Как Safari: toBlob('image/webp') молча отдаёт PNG
    await ctx.addInitScript(()=>{
      const orig=HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob=function(cb,type,q){return orig.call(this,cb,type==='image/webp'?'image/png':type,q);};
    });
    let uploaded=null;
    await ctx.route('**/account/api/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(pathname==='/account/api/me')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:{role:'admin',name:'Admin'}})});
      if(pathname==='/account/api/landing')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({page:'index.html',revision:0,changes:{}})});
      if(pathname==='/account/api/admin/landing/media'){
        uploaded=route.request().postDataJSON().image;
        return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({url:'/account/media/'+'a'.repeat(64)+'.jpg',bytes:1})});
      }
      return route.fulfill({status:404,contentType:'application/json',body:'{}'});
    });
    const p=await ctx.newPage();
    p.on('pageerror',err=>{throw err;});
    await p.goto(origin+'/?edit=1',{waitUntil:'load'});
    await p.locator('.sr-visual-editor select').first().waitFor({timeout:5000});
    const imageKey=await p.locator('.bc-emblem img').getAttribute('data-sr-visual-key');
    await p.locator('.sr-visual-editor select').first().selectOption(imageKey);
    // Фото с шумом: в PNG оно было бы много больше 3 МБ
    const png=await p.evaluate(async()=>{
      const c=document.createElement('canvas');c.width=1800;c.height=1200;const x=c.getContext('2d');
      const d=x.createImageData(c.width,c.height);for(let i=0;i<d.data.length;i++)d.data[i]=(i%4===3)?255:(Math.random()*255)|0;x.putImageData(d,0,0);
      const blob=await new Promise(ok=>c.toBlob(ok,'image/png'));const buf=new Uint8Array(await blob.arrayBuffer());
      let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode(...buf.subarray(i,i+0x8000));return btoa(s);
    });
    await p.locator('.sr-visual-editor input[type=file]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await p.locator('.sr-visual-editor .sr-copy-primary',{hasText:'Загрузить изображение'}).click();
    await p.waitForFunction(()=>document.querySelector('.bc-emblem img')?.getAttribute('src')?.startsWith('/account/media/'),null,{timeout:15000})
      .catch(async e=>{throw new Error(e.message+' · '+await p.locator('.sr-copy-panel [role=status], .sr-copy-status').allInnerTexts().catch(()=>''))});
    assert.match(uploaded,/^data:image\/jpeg;base64,/);
    assert.ok(uploaded.length<3*1024*1024*1.37,'после сжатия — не больше 3 МБ');
    await ctx.close();
  });

  console.log('Компактная главная');
  await check('каталог, подробности и существующая форма заявки', async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const p = await ctx.newPage();
    await p.goto(`${origin}/index.html`);
    assert.equal(await p.locator('[data-compact-service]:visible').count(), 6);
    await p.locator('#bc-more').click();
    assert.equal(await p.locator('[data-compact-service]:visible').count(), 9);
    await p.locator('[data-filter="group"]').click();
    assert.equal(await p.locator('[data-compact-service]:visible').count(), 2);
    await p.locator('[data-filter="all"]').click();
    const expected = { consult: 'Индивидуальные консультации', ancestors: 'Подношения духам предков', tarot: 'Карта как зеркало' };
    for (const [id, name] of Object.entries(expected)) {
      await p.locator(`[data-compact-service="${id}"]`).click();
      assert.equal(await p.locator('#bc-service-detail').isVisible(), true);
      await p.locator('#bc-inquire').click();
      assert.equal(await p.locator('#request-dialog').isVisible(), true);
      assert.equal(await p.locator('#request-service').inputValue(), name);
      await p.keyboard.press('Escape');
      await p.locator('#bc-back').click();
      assert.equal(await p.locator(`[data-compact-service="${id}"]`).evaluate(e => e === document.activeElement), true);
    }
    await p.locator('#bc-more').click();
    for (const width of [320, 375, 736, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `главная: прокрутка ${overflow}px при ${width}px`);
    }
    assert.equal(await p.locator('.portal-symbol-svg').evaluate(e => getComputedStyle(e).color), 'rgb(181, 45, 40)');
    assert.equal(await p.locator('.bc-emblem img').evaluate(e => e.complete && e.naturalWidth > 0), true);
    await ctx.close();
  });
  await check('без JavaScript доступны все направления и изображения', async () => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
    const p = await ctx.newPage();
    await p.goto(`${origin}/index.html`);
    assert.equal(await p.locator('[data-compact-service]:visible').count(), 9);
    assert.equal(await p.locator('.bc-filters').isVisible(), false);
    assert.equal(await p.locator('[data-compact-service="consult"]').getAttribute('href'), 'consultations.html');
    await p.locator('[data-compact-service="consult"]').click();
    assert.match(p.url(), /\/consultations\.html$/);
    await ctx.close();
  });

  console.log('Страница 404');
  await check('на вложенном адресе — с оформлением и без битых ссылок', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const failed = [];
    p.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/a/b/c')) failed.push(r.url()); });
    const res = await p.goto(`${origin}/a/b/c`, { waitUntil: 'load' });
    const styled = await p.evaluate(() => getComputedStyle(document.body).fontFamily);
    await ctx.close();
    assert.equal(res.status(), 404);
    assert.deepEqual(failed, []);
    assert.match(styled, /Manrope/);
  });

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
    assert.deepEqual(titles, ['Связь с Родом', 'Карта как зеркало', 'Руны']);
  });
  await context.close();

  // Телеметрия (brand/sr-pulse.js): приём подменяется, проверяется, что уходит.
  // Под Playwright скрипт молчит; ?pulse=1 включает его для этой проверки.
  console.log('Телеметрия');
  const pulseContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pulseContext.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net)\//, route => route.abort());
  const batches = [];
  await pulseContext.route('**/account/pulse', route => { batches.push(JSON.parse(route.request().postData())); route.fulfill({ status: 204 }); });
  const pulsePage = await pulseContext.newPage();
  const events = () => batches.flatMap(b => b.ev);
  await check('после загрузки уходят визит и сведения об экране', async () => {
    await pulsePage.goto(`${origin}/index.html?pulse=1`, { waitUntil: 'load' });
    await pulsePage.waitForTimeout(300);
    const view = events().find(e => e.k === 'view');
    assert.ok(view && view.load > 0, 'нет события view');
    assert.equal(batches[0].path, '/index.html');
    assert.match(batches[0].id, /^[0-9a-f]{16}$/);
    assert.equal(batches[0].env.vw, 390);
    assert.equal(batches[0].env.storage, 'ok');
  });
  await check('ошибка скрипта и шаг заявки доходят', async () => {
    await pulsePage.evaluate(() => setTimeout(() => { throw new Error('проверка телеметрии'); }));
    await pulsePage.locator('[data-open-request]:visible').first().tap();
    await pulsePage.waitForTimeout(2600);
    assert.ok(events().some(e => e.k === 'error' && /проверка телеметрии/.test(e.msg)), 'нет ошибки');
    assert.ok(events().some(e => e.k === 'step' && e.name === 'dialog' && e.info === 'open'), 'нет шага dialog');
  });
  await check('без ?pulse=1 под Playwright скрипт молчит', async () => {
    const before = batches.length;
    await pulsePage.goto(`${origin}/courses.html`, { waitUntil: 'load' });
    await pulsePage.waitForTimeout(300);
    assert.equal(batches.length, before);
  });
  await pulseContext.close();

  // Курс на поддомене: скрипт из его копии бренда, CSP курса с connect-src
  // https://belayarod.ru (docs/integration.md) — данные уходят на belayarod.ru.
  await check('курс на поддомене шлёт на belayarod.ru и CSP это пропускает', async () => {
    const ctx = await browser.newContext();
    const got = [];
    const csp = [];
    const { readFileSync } = await import('node:fs');
    const script = readFileSync(new URL('../brand/sr-pulse.js', import.meta.url));
    await ctx.route('https://taro.belayarod.ru/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/brand/sr-pulse.js') return route.fulfill({ body: script, contentType: 'text/javascript' });
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self' https://belayarod.ru" },
        body: '<!doctype html><title>Таро</title><script src="/brand/sr-pulse.js"></script><p>урок</p>',
      });
    });
    await ctx.route('https://belayarod.ru/account/pulse', route => { got.push(JSON.parse(route.request().postData())); route.fulfill({ status: 204 }); });
    const p = await ctx.newPage();
    p.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) csp.push(m.text()); });
    await p.goto('https://taro.belayarod.ru/lesson?pulse=1', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    await ctx.close();
    assert.deepEqual(csp, []);
    assert.equal(got[0]?.path, '/lesson');
    assert.ok(got[0].ev.some(e => e.k === 'view'));
  });
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\nНе прошло: ${failures.length}`);
  process.exit(1);
}
console.log('\nВсё прошло.');

