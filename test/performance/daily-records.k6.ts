import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL ?? 'http://127.0.0.1:3000';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN ?? '';

const createFailures = new Rate('daily_record_create_failures');
const createDuration = new Trend('daily_record_create_duration', true);
const updateDuration = new Trend('daily_record_update_duration', true);
const queryDuration = new Trend('daily_record_query_duration', true);

export const options = {
  scenarios: {
    daily_records_write: {
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
    daily_record_create_failures: ['rate<0.05'],
    daily_record_create_duration: ['p(95)<500'],
    daily_record_update_duration: ['p(95)<500'],
    daily_record_query_duration: ['p(95)<400'],
  },
};

const authHeaders = {
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
};

const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
const today = new Date().toISOString().slice(0, 10);

let vuCounter = 0;

export default function (): void {
  if (!ACCESS_TOKEN) {
    console.error('ACCESS_TOKEN environment variable is required');
    return;
  }

  const mealType = mealTypes[vuCounter % mealTypes.length];
  vuCounter++;

  let recordId: string | undefined;

  // ── POST /api/v1/user/daily-records (create) ─────────────
  group('create', () => {
    const res = http.post(
      `${BASE_URL}/api/v1/user/daily-records`,
      JSON.stringify({
        occurredAt: today,
        kind: 'meal',
        payload: {
          mealType,
          items: [
            { name: 'rice', amount: 200, unit: 'g' },
            { name: 'chicken', amount: 150, unit: 'g' },
          ],
        },
      }),
      { headers: authHeaders, tags: { endpoint: 'create_daily_record' } },
    );

    createDuration.add(res.timings.duration);

    const ok = check(res, {
      'create: status 201': (r) => r.status === 201,
      'create: has id': (r) => {
        try {
          const body = JSON.parse(r.body as string);
          return body.code === 0 && body.data?.id !== undefined;
        } catch {
          return false;
        }
      },
    });

    if (ok) {
      try {
        recordId = JSON.parse(res.body as string).data.id;
      } catch {
        // ignore parse errors
      }
    }

    createFailures.add(!ok);
  });

  sleep(0.2);

  // ── PATCH /api/v1/user/daily-records/:id (update) ────────
  if (recordId) {
    group('update', () => {
      const res = http.patch(
        `${BASE_URL}/api/v1/user/daily-records/${recordId}`,
        JSON.stringify({
          payload: {
            mealType,
            items: [
              { name: 'rice', amount: 250, unit: 'g' },
              { name: 'chicken', amount: 200, unit: 'g' },
              { name: 'vegetables', amount: 100, unit: 'g' },
            ],
          },
        }),
        { headers: authHeaders, tags: { endpoint: 'update_daily_record' } },
      );

      updateDuration.add(res.timings.duration);

      check(res, {
        'update: status 200': (r) => r.status === 200,
      });
    });

    sleep(0.2);
  }

  // ── GET /api/v1/user/daily-records (query) ───────────────
  group('query', () => {
    const res = http.get(`${BASE_URL}/api/v1/user/daily-records`, {
      headers: authHeaders,
      searchParams: { date: today },
      tags: { endpoint: 'query_daily_records' },
    });

    queryDuration.add(res.timings.duration);

    check(res, {
      'query: status 200': (r) => r.status === 200,
      'query: has items array': (r) => {
        try {
          const body = JSON.parse(r.body as string);
          return body.code === 0 && body.data?.items !== undefined;
        } catch {
          return false;
        }
      },
    });
  });

  sleep(0.3);
}
