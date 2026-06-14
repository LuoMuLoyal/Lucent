import { createServer } from 'node:http';

const CHECK_NAMES = ['auth_login', 'account_profile'];
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PORT = 9101;

const metricsPort = parsePositiveInteger(
  process.env.SYNTHETIC_METRICS_PORT,
  DEFAULT_PORT,
);
const intervalMs = parsePositiveInteger(
  process.env.SYNTHETIC_CHECK_INTERVAL_MS,
  DEFAULT_INTERVAL_MS,
);
const timeoutMs = parsePositiveInteger(
  process.env.SYNTHETIC_HTTP_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
);
const targetBaseUrl = stripTrailingSlash(
  process.env.SYNTHETIC_TARGET_BASE_URL ?? 'http://app:3000',
);

const state = Object.fromEntries(
  CHECK_NAMES.map((name) => [
    name,
    {
      configured: false,
      success: 0,
      durationMs: 0,
      statusCode: 0,
      lastRunAt: 0,
      failureCount: 0,
      lastError: null,
    },
  ]),
);

let lastLoopAt = 0;
let loopInFlight = false;

startServer();
void runLoop();

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function startServer() {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          targetBaseUrl,
          intervalMs,
          timeoutMs,
          lastLoopAt,
          checks: state,
        }),
      );
      return;
    }

    if (request.url === '/metrics') {
      response.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      });
      response.end(renderMetrics());
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  });

  server.listen(metricsPort, '0.0.0.0', () => {
    console.log(
      `[synthetic-checker] listening on 0.0.0.0:${metricsPort}, target=${targetBaseUrl}`,
    );
  });
}

async function runLoop() {
  while (true) {
    await runChecksOnce();
    await sleep(intervalMs);
  }
}

async function runChecksOnce() {
  if (loopInFlight) {
    return;
  }

  loopInFlight = true;

  try {
    const credentials = readCredentials();

    if (credentials === null) {
      for (const name of CHECK_NAMES) {
        const current = state[name];
        current.configured = false;
        current.success = 0;
        current.durationMs = 0;
        current.statusCode = 0;
        current.lastRunAt = Math.floor(Date.now() / 1000);
        current.lastError =
          'Missing SYNTHETIC_LOGIN_EMAIL or SYNTHETIC_LOGIN_PASSWORD';
      }

      lastLoopAt = Math.floor(Date.now() / 1000);
      return;
    }

    const loginResult = await executeCheck('auth_login', () =>
      performLogin(credentials),
    );

    if (loginResult.ok && typeof loginResult.accessToken === 'string') {
      await executeCheck('account_profile', () =>
        fetchAccountProfile(loginResult.accessToken),
      );
    } else {
      markSkippedAfterDependencyFailure('account_profile', 'auth_login failed');
    }

    lastLoopAt = Math.floor(Date.now() / 1000);
  } finally {
    loopInFlight = false;
  }
}

async function executeCheck(name, executor) {
  const startedAt = Date.now();
  const current = state[name];
  current.configured = true;

  try {
    const result = await executor();
    current.success = 1;
    current.durationMs = Date.now() - startedAt;
    current.statusCode = result.statusCode;
    current.lastRunAt = Math.floor(Date.now() / 1000);
    current.lastError = null;
    return { ok: true, ...result };
  } catch (error) {
    current.success = 0;
    current.durationMs = Date.now() - startedAt;
    current.statusCode =
      error instanceof SyntheticCheckError ? error.statusCode : 0;
    current.lastRunAt = Math.floor(Date.now() / 1000);
    current.failureCount += 1;
    current.lastError = formatError(error);
    console.error(`[synthetic-checker] ${name} failed: ${current.lastError}`);
    return { ok: false };
  }
}

function markSkippedAfterDependencyFailure(name, reason) {
  const current = state[name];
  current.configured = true;
  current.success = 0;
  current.durationMs = 0;
  current.statusCode = 0;
  current.lastRunAt = Math.floor(Date.now() / 1000);
  current.failureCount += 1;
  current.lastError = reason;
}

async function performLogin(credentials) {
  const response = await fetchWithTimeout(`${targetBaseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });
  const body = await readJsonResponse(response, 'auth_login');
  const accessToken = body?.data?.tokens?.accessToken;

  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new SyntheticCheckError(
      'auth_login',
      response.status,
      'Response does not include access token',
    );
  }

  return {
    statusCode: response.status,
    accessToken,
  };
}

async function fetchAccountProfile(accessToken) {
  const response = await fetchWithTimeout(`${targetBaseUrl}/api/v1/account`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await readJsonResponse(response, 'account_profile');
  const accountId = body?.data?.id;

  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new SyntheticCheckError(
      'account_profile',
      response.status,
      'Response does not include account id',
    );
  }

  return {
    statusCode: response.status,
  };
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SyntheticCheckError('request', 0, `Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function readJsonResponse(response, checkName) {
  const raw = await response.text();
  let parsedBody;

  try {
    parsedBody = raw.length === 0 ? null : JSON.parse(raw);
  } catch {
    throw new SyntheticCheckError(
      checkName,
      response.status,
      'Response is not valid JSON',
    );
  }

  if (!response.ok) {
    throw new SyntheticCheckError(
      checkName,
      response.status,
      readEnvelopeMessage(parsedBody) ??
        `Unexpected HTTP ${response.status}`,
    );
  }

  if (parsedBody?.code !== 0) {
    throw new SyntheticCheckError(
      checkName,
      response.status,
      readEnvelopeMessage(parsedBody) ?? 'API envelope code is not success',
    );
  }

  return parsedBody;
}

function readEnvelopeMessage(body) {
  return typeof body?.message === 'string' && body.message.length > 0
    ? body.message
    : null;
}

function readCredentials() {
  const email = process.env.SYNTHETIC_LOGIN_EMAIL?.trim();
  const password = process.env.SYNTHETIC_LOGIN_PASSWORD?.trim();

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

function renderMetrics() {
  const lines = [
    '# HELP lucent_synthetic_check_configured Whether the synthetic check is configured.',
    '# TYPE lucent_synthetic_check_configured gauge',
    '# HELP lucent_synthetic_check_success Whether the last synthetic check run succeeded.',
    '# TYPE lucent_synthetic_check_success gauge',
    '# HELP lucent_synthetic_check_duration_milliseconds Duration of the last synthetic check run in milliseconds.',
    '# TYPE lucent_synthetic_check_duration_milliseconds gauge',
    '# HELP lucent_synthetic_check_status_code Last HTTP status code observed by the synthetic check.',
    '# TYPE lucent_synthetic_check_status_code gauge',
    '# HELP lucent_synthetic_check_last_run_timestamp_seconds Unix timestamp of the last synthetic check run.',
    '# TYPE lucent_synthetic_check_last_run_timestamp_seconds gauge',
    '# HELP lucent_synthetic_check_failures_total Total synthetic check failures since process start.',
    '# TYPE lucent_synthetic_check_failures_total counter',
  ];

  for (const name of CHECK_NAMES) {
    const current = state[name];
    const labels = `{check="${escapeLabelValue(name)}"}`;
    lines.push(
      `lucent_synthetic_check_configured${labels} ${current.configured ? '1' : '0'}`,
    );
    lines.push(
      `lucent_synthetic_check_success${labels} ${String(current.success)}`,
    );
    lines.push(
      `lucent_synthetic_check_duration_milliseconds${labels} ${String(current.durationMs)}`,
    );
    lines.push(
      `lucent_synthetic_check_status_code${labels} ${String(current.statusCode)}`,
    );
    lines.push(
      `lucent_synthetic_check_last_run_timestamp_seconds${labels} ${String(current.lastRunAt)}`,
    );
    lines.push(
      `lucent_synthetic_check_failures_total${labels} ${String(current.failureCount)}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function escapeLabelValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function parsePositiveInteger(input, fallbackValue) {
  if (input === undefined || input.trim() === '') {
    return fallbackValue;
  }

  const parsed = Number.parseInt(input, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function stripTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function shutdown() {
  process.exit(0);
}

class SyntheticCheckError extends Error {
  constructor(checkName, statusCode, message) {
    super(`[${checkName}] ${message}`);
    this.name = 'SyntheticCheckError';
    this.statusCode = statusCode;
  }
}
