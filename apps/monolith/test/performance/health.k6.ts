import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL ?? 'http://127.0.0.1:3000';

// Custom metric: track health check failures separately
const healthCheckFailures = new Rate('health_check_failures');

export const options = {
  scenarios: {
    health_checks: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '5s', target: 10 },
        { duration: '10s', target: 20 },
        { duration: '10s', target: 20 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
    health_check_failures: ['rate<0.01'],
  },
};

interface HealthEndpoint {
  path: string;
  name: string;
}

const endpoints: HealthEndpoint[] = [
  { path: '/api/v1/health', name: 'health' },
  { path: '/api/v1/health/live', name: 'health_live' },
  { path: '/api/v1/health/ready', name: 'health_ready' },
];

export default function (): void {
  for (const ep of endpoints) {
    const res = http.get(`${BASE_URL}${ep.path}`, {
      tags: { endpoint: ep.name },
    });

    const ok = check(res, {
      [`${ep.name}: status is 200`]: (r) => r.status === 200,
      [`${ep.name}: status is valid`]: (r) => {
        try {
          const body = JSON.parse(r.body as string);
          return body.status === 'ok' || body.status === 'error';
        } catch {
          return false;
        }
      },
    });

    healthCheckFailures.add(!ok);
  }

  sleep(0.5);
}
