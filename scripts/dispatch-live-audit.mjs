// Вызов после успешной публикации на VPS. Токен не передаётся аргументом CLI.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSha } from './check-live.mjs';

export async function dispatchLiveAudit({
  expectedSha,
  token,
  fetchImpl = fetch,
}) {
  validateSha(expectedSha);
  if (!token?.trim()) throw new Error('Не задан токен для запуска live-аудита.');
  const response = await fetchImpl(
    'https://api.github.com/repos/vdoma88/prod/actions/workflows/live-check.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token.trim(),
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { expected_sha: expectedSha } }),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    },
  );
  // Тело ошибки может содержать данные сервиса. В журнал пишем только HTTP status.
  if (response.status !== 204) throw new Error('GitHub не принял live-аудит: HTTP ' + response.status);
}

async function main() {
  const expectedSha = validateSha(process.env.EXPECTED_SHA);
  let token = process.env.PROD_AUDIT_GITHUB_TOKEN?.trim();
  if (!token) {
    const tokenFile = process.env.PROD_AUDIT_TOKEN_FILE || '/etc/prod/live-audit.token';
    try { token = (await readFile(tokenFile, 'utf8')).trim(); } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Не удалось прочитать файл токена live-аудита.');
    }
  }
  if (!token) {
    console.warn('Публикация подтверждена, но post-deploy аудит не настроен: нет PROD_AUDIT_GITHUB_TOKEN или /etc/prod/live-audit.token.');
    console.warn('Проверка по push остаётся резервной. Не включайте LIVE_AUDIT_MODE=post-deploy до проверки callback.');
    return;
  }
  await dispatchLiveAudit({ expectedSha, token });
  console.log('Live-аудит запрошен для ' + expectedSha + '. Результат: https://github.com/vdoma88/prod/actions/workflows/live-check.yml');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    // Не печатаем исходную ошибку fetch: пользовательские transports могут включать headers.
    console.error('Сайт уже опубликован; post-deploy аудит не запущен. ' +
      (error.message.startsWith('GitHub не принял') ? error.message : 'Проверьте доступ к GitHub, токен и expected SHA.'));
    process.exitCode = 1;
  }
}
