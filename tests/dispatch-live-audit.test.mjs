import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchLiveAudit } from '../scripts/dispatch-live-audit.mjs';

const expectedSha = 'a'.repeat(40);

test('post-deploy callback передаёт точный SHA в workflow main', async () => {
  let captured;
  await dispatchLiveAudit({ expectedSha, token: 'test-token', fetchImpl: async (url, options) => {
    captured = { url, options };
    return new Response(null, { status: 204 });
  } });
  assert.equal(captured.url, 'https://api.github.com/repos/vdoma88/prod/actions/workflows/live-check.yml/dispatches');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.redirect, 'error');
  assert.deepEqual(JSON.parse(captured.options.body), { ref: 'main', inputs: { expected_sha: expectedSha } });
  assert.equal(captured.options.headers.Authorization, 'Bearer test-token');
});

test('отказ GitHub не объявляется успешным запуском и не раскрывает тело ответа', async () => {
  await assert.rejects(dispatchLiveAudit({ expectedSha, token: 'test-token', fetchImpl: async () =>
    new Response('sensitive server response', { status: 403 })
  }), error => error.message === 'GitHub не принял live-аудит: HTTP 403');
});

test('не отправляет callback без токена или с неверным SHA', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; };
  await assert.rejects(dispatchLiveAudit({ expectedSha, token: '', fetchImpl }));
  await assert.rejects(dispatchLiveAudit({ expectedSha: 'main', token: 'test-token', fetchImpl }));
  assert.equal(calls, 0);
});
