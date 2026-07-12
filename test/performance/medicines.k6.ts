import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL ?? 'http://127.0.0.1:3000';

const searchFailureRate = new Rate('medicine_search_failures');
const searchDuration = new Trend('medicine_search_duration', true);

export const options = {
  scenarios: {
    medicine_search: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '5s', target: 5 },
        { duration: '15s', target: 10 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    medicine_search_failures: ['rate<0.05'],
    medicine_search_duration: ['p(95)<300'],
  },
};

interface SearchQuery {
  q: string;
  source: string;
}

const searchQueries: SearchQuery[] = [
  { q: 'ibuprofen', source: 'drugbank' },
  { q: '布洛芬', source: 'cn' },
  { q: 'aspirin', source: 'drugbank' },
  { q: '阿莫西林', source: 'cn' },
  { q: 'metformin', source: 'drugbank' },
];

let queryIndex = 0;

export default function (): void {
  // ── Medicine search ─────────────────────────────────────
  const query = searchQueries[queryIndex % searchQueries.length];
  if (query === undefined) return;
  queryIndex++;

  const searchRes = http.get(`${BASE_URL}/api/v1/medicines`, {
    searchParams: {
      q: query.q,
      source: query.source,
      page: 1,
      pageSize: 10,
    },
    tags: { endpoint: 'medicine_search' },
  });

  searchDuration.add(searchRes.timings.duration);

  const searchOk = check(searchRes, {
    'search: status 200': (r) => r.status === 200,
    'search: has envelope': (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return body.code === 0 && Array.isArray(body.data);
      } catch {
        return false;
      }
    },
    'search: has pagination meta': (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return body.meta?.pagination !== undefined;
      } catch {
        return false;
      }
    },
  });

  searchFailureRate.add(!searchOk);

  sleep(0.3);

  // ── Safety tips ─────────────────────────────────────────
  const tipsRes = http.get(`${BASE_URL}/api/v1/medicines/safety-tips`, {
    tags: { endpoint: 'safety_tips' },
  });

  check(tipsRes, {
    'safety-tips: status 200': (r) => r.status === 200,
    'safety-tips: has data array': (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return Array.isArray(body.data);
      } catch {
        return false;
      }
    },
  });

  sleep(0.5);
}
