// Общая проверка SHA опубликованной сборки для deploy, freshness и Safari.
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class LiveCheckError extends Error {
  constructor(code, message, evidence = {}) {
    super(message);
    this.name = 'LiveCheckError';
    this.code = code;
    this.evidence = evidence;
  }
}

export function validateSha(value) {
  if (!/^[a-f0-9]{40}$/.test(value || '')) {
    throw new LiveCheckError('LIVE_SHA_INVALID', 'Ожидается полный commit SHA (40 строчных hex-символов).');
  }
  return value;
}

export function annotation(error) {
  const escape = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return '::error title=' + escape(error.code || 'LIVE_CHECK_ERROR') + '::' + escape(error.message);
}

export async function verifyLiveVersion({
  expectedSha,
  baseUrl = 'https://belayarod.ru',
  timeoutMs = 20000,
  fetchImpl = fetch,
}) {
  validateSha(expectedSha);
  const url = new URL('/version.json', baseUrl);
  url.searchParams.set('audit', expectedSha + '-' + Date.now());
  const evidence = { expectedSha, checkedAt: new Date().toISOString(), url: url.href };
  let response;
  let body;
  try {
    response = await fetchImpl(url, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    evidence.status = response.status;
    evidence.lastModified = response.headers.get('last-modified');
    evidence.cacheControl = response.headers.get('cache-control');
    body = await response.text();
  } catch (error) {
    throw new LiveCheckError('LIVE_HTTP_ERROR', 'Не удалось получить version.json: ' + error.message, evidence);
  }
  if (response.status !== 200) {
    throw new LiveCheckError('LIVE_HTTP_ERROR', 'version.json: HTTP ' + response.status, evidence);
  }
  let version;
  try { version = JSON.parse(body); } catch {
    throw new LiveCheckError('LIVE_VERSION_INVALID', 'version.json не является JSON.', evidence);
  }
  if (version?.project !== 'sila-roda' || !/^[a-f0-9]{40}$/.test(version?.commit || '')) {
    throw new LiveCheckError('LIVE_VERSION_INVALID', 'version.json не содержит версию проекта sila-roda.', evidence);
  }
  Object.assign(evidence, { liveSha: version.commit, builtAt: version.builtAt || null });
  if (version.commit !== expectedSha) {
    throw new LiveCheckError('LIVE_SHA_MISMATCH', 'Ожидали ' + expectedSha + ', опубликован ' + version.commit, evidence);
  }
  return evidence;
}

export async function waitForLiveVersion({
  attempts = 6,
  intervalMs = 20000,
  onAttempt = () => {},
  ...options
}) {
  validateSha(options.expectedSha);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60 ||
      !Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60000) {
    throw new LiveCheckError('LIVE_CONFIG_INVALID', 'Некорректный предел повторов или интервал проверки.');
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const evidence = await verifyLiveVersion(options);
      onAttempt({ attempt, ok: true, ...evidence });
      return evidence;
    } catch (error) {
      if (!(error instanceof LiveCheckError)) throw error;
      onAttempt({ attempt, ok: false, code: error.code, message: error.message, ...error.evidence });
      if (attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
}

async function main() {
  const expectedSha = process.env.EXPECTED_SHA;
  const report = { expectedSha, startedAt: new Date().toISOString(), checks: [], ok: false };
  try {
    await waitForLiveVersion({
      expectedSha,
      baseUrl: process.env.LIVE_BASE_URL || 'https://belayarod.ru',
      attempts: Number(process.env.LIVE_ATTEMPTS || 6),
      intervalMs: Number(process.env.LIVE_INTERVAL_MS || 20000),
      onAttempt: check => { report.checks.push(check); console.log(JSON.stringify(check)); },
    });
    report.ok = true;
    console.log('✓ Опубликован commit ' + expectedSha);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, 'expected_sha=' + expectedSha + '\n');
    }
  } catch (error) {
    if (process.env.LIVE_PHASE === 'after-audit' && error.code === 'LIVE_SHA_MISMATCH') {
      error.code = 'LIVE_VERSION_CHANGED';
      error.message = 'Версия сменилась во время аудита; результаты не подтверждают одну сборку. ' + error.message;
    }
    report.error = { code: error.code || 'LIVE_CHECK_ERROR', message: error.message };
    console.error(annotation(error));
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    const destination = process.env.LIVE_REPORT_PATH || 'live-check/report.json';
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
