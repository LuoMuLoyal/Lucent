# Performance Tests (k6)

These are [k6](https://k6.io/) load test scripts for the Lucent backend.

## Prerequisites

1. Install k6:

   ```powershell
   # Windows (winget)
   winget install grafana.k6

   # Or via Chocolatey
   choco install k6

   # Or download from https://github.com/grafana/k6/releases
   ```

2. Ensure the Lucent backend is running (dev or staging):

   ```powershell
   cd Lucent
   pnpm dev:stack:up
   pnpm db:migrate:all
   pnpm start:dev
   ```

3. For authenticated tests, create a test user and export the access token:

   ```powershell
   # Register a test user via API
   curl -X POST http://127.0.0.1:3000/api/v1/auth/register `
     -H "Content-Type: application/json" `
     -d '{"email":"perf@test.com","password":"Test@123456","nickname":"PerfUser"}'

   # Login to get tokens
   curl -X POST http://127.0.0.1:3000/api/v1/auth/login `
     -H "Content-Type: application/json" `
     -d '{"email":"perf@test.com","password":"Test@123456"}'
   ```

## Running Tests

Set the base URL and (optionally) an access token via environment variables:

```powershell
# Health check load test (no auth needed)
k6 run -e BASE_URL=http://127.0.0.1:3000 test/performance/health.k6.ts

# Medicine search load test (no auth needed)
k6 run -e BASE_URL=http://127.0.0.1:3000 test/performance/medicines.k6.ts

# Authenticated endpoint load test (needs token)
k6 run `
  -e BASE_URL=http://127.0.0.1:3000 `
  -e ACCESS_TOKEN=<your-access-token> `
  test/performance/authenticated.k6.ts

# Daily records write-path load test (needs token)
k6 run `
  -e BASE_URL=http://127.0.0.1:3000 `
  -e ACCESS_TOKEN=<your-access-token> `
  test/performance/daily-records.k6.ts
```

## Test Scenarios

| Script                | Endpoint(s)                                                                                                          | VUs | Duration | Description                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | --- | -------- | ---------------------------------------------- |
| `health.k6.ts`        | `/api/v1/health`, `/api/v1/health/ready`, `/api/v1/health/live`                                                      | 20  | 30s      | Health check baseline                          |
| `medicines.k6.ts`     | `/api/v1/medicines`, `/api/v1/medicines/safety-tips`                                                                 | 10  | 30s      | Medicine search + safety tips                  |
| `authenticated.k6.ts` | `/api/v1/account`, `/api/v1/user/health-context`, `/api/v1/user/reports/dashboard`, `/api/v1/user/today/suggestions` | 5   | 20s      | Authenticated user endpoints                   |
| `daily-records.k6.ts` | `POST/PATCH/GET /api/v1/user/daily-records`                                                                          | 5   | 25s      | Daily records write-path (create/update/query) |

## Interpreting Results

k6 outputs several key metrics:

- **http_req_duration** — Response time (p90, p95, p99). Target: p95 < 500ms for most endpoints.
- **http_req_failed** — Percentage of non-2xx responses. Target: < 1%.
- **http_reqs** — Total requests made. Use to calculate throughput (req/s).
- **iterations** — Number of complete test iterations.

### Thresholds

Each script defines pass/fail thresholds. The test exits with non-zero code if thresholds are breached:

```javascript
thresholds: {
  http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
  http_req_failed: ['rate<0.01'],     // Less than 1% errors
}
```

## CI Integration

To run performance tests in CI against a staging environment:

```yaml
- name: Run k6 performance tests
  run: |
    k6 run \
      -e BASE_URL=https://staging.lucent.example.com \
      -e ACCESS_TOKEN=${{ secrets.STAGING_TEST_TOKEN }} \
      test/performance/authenticated.k6.ts
  continue-on-error: true # Don't block PRs on perf regressions
```
