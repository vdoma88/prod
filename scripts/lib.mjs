// Общие помощники скриптов: пути проекта и список курсов из sr-brand.js.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SITE = path.join(ROOT, 'site');
export const BRAND = path.join(ROOT, 'brand');
export const DIST = path.join(ROOT, 'dist');
export const HUB = 'https://belayarod.ru';

// Файлы бренда, которые получают приложения (scripts/sync-brand.mjs).
export const BRAND_FILES = [
  'sr-brand.js', 'sr-brand.css', 'tokens.css', 'fonts.css',
  ...readdirSync(path.join(BRAND, 'fonts')).sort().map(name => `fonts/${name}`),
];

/** Список курсов — массив PROJECTS из brand/sr-brand.js, единственный источник. */
export function readBrand() {
  const source = readFileSync(path.join(BRAND, 'sr-brand.js'), 'utf8');
  const version = source.match(/const VERSION = '([^']+)'/)?.[1];
  const literal = source.match(/const PROJECTS = (\[[\s\S]*?\n  \]);/)?.[1];
  if (!version || !literal) throw new Error('brand/sr-brand.js: не найдены VERSION или PROJECTS');
  // Файл свой, из репозитория: литерал вычисляем как выражение.
  const projects = new Function(`return ${literal};`)();
  return { source, version, projects };
}
