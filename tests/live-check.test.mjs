import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyLiveVersion, waitForLiveVersion } from '../scripts/check-live.mjs';

const run = promisify(execFile);
const expectedSha = 'a'.repeat(40);
const previousSha = 'b'.repeat(40);
const version = commit => ({ project: 'sila-roda', commit, builtAt: '2026-09-30T00:00:00Z' });

async function server(t, handler) {
  const app = createServer(handler);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  return 'http://127.0.0.1:' + app.address().port;
}

test('читает фактический SHA и отправляет запрет кэша', async t => {
  let requested;
  const baseUrl = await server(t, (req, res) => {
    requested = req;
    res.setHeader('Cache-Control', 'no-cache');
    res.end(JSON.stringify(version(expectedSha)));
  });
  const result = await verifyLiveVersion({ expectedSha, baseUrl });
  assert.equal(result.liveSha, expectedSha);
  assert.equal(result.status, 200);
  assert.equal(result.cacheControl, 'no-cache');
  assert.equal(requested.headers['cache-control'], 'no-cache');
  assert.match(requested.url, new RegExp('audit=' + expectedSha));
});

test('ждёт публикации, сохраняя старый и новый SHA в диагностике', async t => {
  let calls = 0;
  const baseUrl = await server(t, (_req, res) => {
    res.end(JSON.stringify(version(++calls === 1 ? previousSha : expectedSha)));
  });
  const checks = [];
  await waitForLiveVersion({ expectedSha, baseUrl, attempts: 3, intervalMs: 0, onAttempt: x => checks.push(x) });
  assert.equal(calls, 2);
  assert.equal(checks[0].code, 'LIVE_SHA_MISMATCH');
  assert.equal(checks[0].liveSha, previousSha);
  assert.equal(checks[1].ok, true);
});

test('не принимает старую или уже более новую сборку вместо ожидаемого SHA', async t => {
  let calls = 0;
  const baseUrl = await server(t, (_req, res) => {
    calls++;
    res.end(JSON.stringify(version(previousSha)));
  });
  await assert.rejects(waitForLiveVersion({ expectedSha, baseUrl, attempts: 2, intervalMs: 0 }),
    error => error.code === 'LIVE_SHA_MISMATCH' && error.evidence.liveSha === previousSha);
  assert.equal(calls, 2);
});

test('отделяет HTTP-ошибку, неверный JSON и чужую версию от mismatch', async t => {
  for (const [status, body, code] of [
    [503, 'maintenance', 'LIVE_HTTP_ERROR'],
    [200, '<html>fallback</html>', 'LIVE_VERSION_INVALID'],
    [200, JSON.stringify({ project: 'another-site', commit: expectedSha }), 'LIVE_VERSION_INVALID'],
    [200, JSON.stringify({ project: 'sila-roda', commit: 'unknown' }), 'LIVE_VERSION_INVALID'],
  ]) {
    const baseUrl = await server(t, (_req, res) => { res.statusCode = status; res.end(body); });
    await assert.rejects(verifyLiveVersion({ expectedSha, baseUrl }), error => error.code === code);
  }
});

test('сетевой timeout ограничивает ожидание; редирект не подменяет production', async t => {
  const hanging = await server(t, () => {});
  await assert.rejects(verifyLiveVersion({ expectedSha, baseUrl: hanging, timeoutMs: 40 }),
    error => error.code === 'LIVE_HTTP_ERROR');
  const redirect = await server(t, (_req, res) => { res.writeHead(302, { Location: '/other' }); res.end(); });
  await assert.rejects(verifyLiveVersion({ expectedSha, baseUrl: redirect }),
    error => error.code === 'LIVE_HTTP_ERROR');
});

test('невалидный SHA отклоняется до сетевого запроса', async () => {
  let calls = 0;
  await assert.rejects(verifyLiveVersion({
    expectedSha: 'main\n::error::fake',
    fetchImpl: async () => { calls++; },
  }), error => error.code === 'LIVE_SHA_INVALID');
  assert.equal(calls, 0);
});

test('CLI сохраняет артефакт и не выдаёт success-output при смене версии', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prod-live-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baseUrl = await server(t, (_req, res) => res.end(JSON.stringify(version(previousSha))));
  const reportPath = path.join(directory, 'report.json');
  const outputPath = path.join(directory, 'output');
  const error = await run(process.execPath, ['scripts/check-live.mjs'], {
    env: { ...process.env, EXPECTED_SHA: expectedSha, LIVE_BASE_URL: baseUrl,
      LIVE_ATTEMPTS: '1', LIVE_PHASE: 'after-audit', LIVE_REPORT_PATH: reportPath, GITHUB_OUTPUT: outputPath },
  }).then(() => null, error => error);
  assert.equal(error.code, 1);
  assert.match(error.stderr, /::error title=LIVE_VERSION_CHANGED::/);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(report.checks[0].liveSha, previousSha);
  await assert.rejects(readFile(outputPath), { code: 'ENOENT' });
});

test('CLI публикует expected_sha только после подтверждения live', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prod-live-output-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baseUrl = await server(t, (_req, res) => res.end(JSON.stringify(version(expectedSha))));
  const outputPath = path.join(directory, 'output');
  await run(process.execPath, ['scripts/check-live.mjs'], {
    env: { ...process.env, EXPECTED_SHA: expectedSha, LIVE_BASE_URL: baseUrl, LIVE_ATTEMPTS: '1',
      LIVE_PHASE: '', LIVE_REPORT_PATH: path.join(directory, 'report.json'), GITHUB_OUTPUT: outputPath },
  });
  assert.equal(await readFile(outputPath, 'utf8'), 'expected_sha=' + expectedSha + '\n');
});
