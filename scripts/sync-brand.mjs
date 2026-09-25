// Копирует общий бренд в папку приложения, чтобы тот раздавался с его же
// адреса: так не нужно ослаблять CSP приложения и нет зависимости от
// доступности belayarod.ru.
//
//   node scripts/sync-brand.mjs ../runes-belaya/src/brand
//   node scripts/sync-brand.mjs ../runes-belaya/src/brand --check   ← только сверить
//
// Куда копировать в каждом приложении — docs/integration.md.
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BRAND, BRAND_FILES, readBrand } from './lib.mjs';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const target = args.find(arg => !arg.startsWith('--'));
if (!target) {
  console.error('Укажите папку назначения: node scripts/sync-brand.mjs <папка> [--check]');
  process.exit(2);
}

const { version } = readBrand();
const dir = path.resolve(target);
let stale = 0;
if (!checkOnly) await mkdir(dir, { recursive: true });
for (const name of BRAND_FILES) {
  const from = path.join(BRAND, name);
  const to = path.join(dir, name);
  const same = existsSync(to) && (await readFile(to, 'utf8')) === (await readFile(from, 'utf8'));
  if (same) continue;
  stale++;
  if (checkOnly) console.log(`  устарел: ${name}`);
  else { await copyFile(from, to); console.log(`  обновлён: ${name}`); }
}
if (checkOnly && stale) {
  console.error(`${dir}: бренд не совпадает с v${version} — запустите без --check`);
  process.exit(1);
}
console.log(`${dir}: бренд v${version}${stale && !checkOnly ? '' : ' — актуален'}`);
