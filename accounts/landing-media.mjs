// Durable, public-read/admin-upload image library for landing pages.
// Uploaded images are immutable, content-addressed and stored outside dist/.
// Scripts, SVG, remote URLs and arbitrary file access are never accepted.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AccountError } from './store.mjs';

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_TOTAL = 350 * 1024 * 1024;
const NAMES = /^([a-f0-9]{64})\.(jpg|png|webp)$/;
const DATA = /^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/]+={0,2})$/;

function sniff(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

export function openLandingMedia(dir) {
  const root = path.resolve(dir);
  function file(name) {
    if (!NAMES.test(name)) throw new AccountError(404, 'Изображение не найдено.');
    return path.join(root, name);
  }
  function upload(dataUri) {
    if (typeof dataUri !== 'string' || dataUri.length > MAX_BYTES * 1.37 + 200) {
      throw new AccountError(413, 'Файл слишком большой (не более 3 МБ).');
    }
    const match = DATA.exec(dataUri);
    if (!match) throw new AccountError(400, 'Нужен JPG, PNG или WebP.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== match[2]) {
      throw new AccountError(400, 'Изображение повреждено либо слишком велико.');
    }
    const extension = sniff(bytes);
    if (!extension || (match[1] === 'jpeg' ? 'jpg' : match[1]) !== extension) {
      throw new AccountError(400, 'Формат содержимого не совпадает с файлом.');
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    const name = hash + '.' + extension;
    fs.mkdirSync(root, { recursive: true, mode: 0o750 });
    const target = file(name);
    if (!fs.existsSync(target)) {
      const existing = fs.readdirSync(root).filter(n => NAMES.test(n));
      if (existing.length >= MAX_FILES) throw new AccountError(413, 'Медиатека переполнена.');
      const sum = existing.reduce((total, n) => total + fs.statSync(file(n)).size, 0);
      if (sum + bytes.length > MAX_TOTAL) throw new AccountError(413, 'Не осталось места в медиатеке.');
      try { fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o640 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return { url: '/account/media/' + name, bytes: bytes.length };
  }
  function serve(req, res, name) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    const target = file(name);
    let data;
    try { data = fs.readFileSync(target); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new AccountError(404, 'Изображение не найдено.');
    }
    const ext = name.split('.').pop();
    res.writeHead(200, {
      'Content-Type': ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp',
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }
  return { upload, serve };
}
