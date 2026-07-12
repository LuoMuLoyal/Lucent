import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || '';

const endpointFailures = new Rate('authenticated_endpoint_failures');
const accountDuration = new Trend('account_duration', true);
const healthContextDuration = new Trend('health_context_duration', true);
const dashboardDuration = new Trend('dashboard_duration', true);
const suggestionsDuration = new Trend('suggestions_duration', true);

export const options = {
  scenarios: {
    authenticated_load: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '5s', target: 3 },
        { duration: '10s', target: 5 },
        { duration: '5s', target: 5 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
    http_req_failed: ['rate<0.02'],
    authenticated_endpoint_failures: ['rate<0.05'],
    account_duration: ['p(95)<200'],
    health_context_duration: ['p(95)<300'],
    dashboard_duration: ['p(95)<800'],
    suggestions_duration: ['p(95)<1500'],
  },
};

const authHeaders = {
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
};

export default function () {
  if (!ACCESS_TOKEN) {
    console.error('ACCESS_TOKEN environment variable is required');
    return;
  }

  // ── GET /api/v1/account ─────────────────────────────────
  group('account', () => {
    const res = http.get(`${BASE_URL}/api/v1/account`, {
      headers: authHeaders,
      tags: { endpoint: 'account' },
    });

    accountDuration.add(res.timings.duration);

    const ok = check(res, {
      'account: status 200': (r) => r.status === 200,
      'account: has user data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.code === 0 && body.data?.id !== undefined;
        } catch {
          return false;
        }
      },
    });

    endpointFailures.add(!ok);
  });

  sleep(0.2);

  // ── GET /api/v1/user/health-context ─────────────────────
  group('health-context', () => {
    const res = http.get(`${BASE_URL}/api/v1/user/health-context`, {
      headers: authHeaders,
      tags: { endpoint: 'health_context' },
    });

    healthContextDuration.add(res.timings.duration);

    const ok = check(res, {
      'health-context: status 200': (r) => r.status === 200,
      'health-context: has summary': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.code === 0 && body.data?.summary !== undefined;
        } catch {
          return false;
        }
      },
    });

    endpointFailures.add(!ok);
  });

  sleep(0.2);

  // ── GET /api/v1/user/reports/dashboard ──────────────────
  group('dashboard', () => {
    const res = http.get(`${BASE_URL}/api/v1/user/reports/dashboard`, {
      headers: authHeaders,
      tags: { endpoint: 'dashboard' },
    });

    dashboardDuration.add(res.timings.duration);

    const ok = check(res, {
      'dashboard: status 200': (r) => r.status === 200,
      'dashboard: has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.code === 0 && body.data !== null;
        } catch {
          return false;
        }
      },
    });

    endpointFailures.add(!ok);
  });

  sleep(0.3);

  // ── GET /api/v1/user/today/suggestions ──────────────────
  group('today-suggestions', () => {
    const res = http.get(`${BASE_URL}/api/v1/user/today/suggestions`, {
      headers: authHeaders,
      tags: { endpoint: 'today_suggestions' },
    });

    suggestionsDuration.add(res.timings.duration);

    const ok = check(res, {
      'today-suggestions: status 200': (r) => r.status === 200,
      'today-suggestions: has suggestions array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.code === 0 && Array.isArray(body.data?.suggestions);
        } catch {
          return false;
        }
      },
    });

    endpointFailures.add(!ok);
  });

  sleep(0.5);
}
