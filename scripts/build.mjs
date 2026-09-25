// Сборка belayarod.ru в dist/: страницы лендинга из site/ плюс общий бренд
// в dist/brand/ (оттуда же его можно подключать напрямую), sitemap и robots.
//
// Собирается во временную папку и подменяет dist/ переименованием: nginx,
// который отдаёт dist/ на сервере, не видит наполовину собранный сайт.
import { cp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { BRAND, DIST, HUB, SITE, readBrand } from './lib.mjs';

const { version } = readBrand();
const gitCommit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.dirname(DIST), encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
const builtAt = new Date().toISOString();

const OUT = `${DIST}.next`;
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(SITE, OUT, { recursive: true, filter: src => path.basename(src) !== 'README.md' });
await cp(BRAND, path.join(OUT, 'brand'), { recursive: true, filter: src => path.basename(src) !== 'README.md' });

const pages = (await readdir(SITE)).filter(name => name.endsWith('.html') && name !== '404.html').sort();
const urls = pages.map(name => `  <url><loc>${HUB}/${name === 'index.html' ? '' : name}</loc></url>`);
await writeFile(path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
await writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /brand/preview.html\n\nSitemap: ${HUB}/sitemap.xml\n`);
await writeFile(path.join(OUT, 'version.json'), JSON.stringify({ project: 'sila-roda', commit: gitCommit, builtAt, brandVersion: version }, null, 2) + '\n');

const OLD = `${DIST}.old`;
await rm(OLD, { recursive: true, force: true });
await rename(DIST, OLD).catch(error => { if (error.code !== 'ENOENT') throw error; });
await rename(OUT, DIST);
await rm(OLD, { recursive: true, force: true });

console.log(`dist/: ${pages.length} страниц, бренд v${version}, commit ${gitCommit.slice(0, 8)}`);
