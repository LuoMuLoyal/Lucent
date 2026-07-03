# Report Export

Last updated: 2026-07-03

- Report export uses a shared `DataExportProcessorService` for both async (BullMQ) and inline
  fallback paths so the two execution modes run the same status, PDF generation, upload, and
  notification logic.
- When `REDIS_URL` is configured, `POST /api/v1/user/data-export-requests` enqueues a BullMQ job
  and immediately returns a `requested` row; otherwise it falls back to synchronous inline
  processing and returns the final state.
- Async worker failures mark the request `failed`, log the error, and let BullMQ retry the job with
  exponential backoff.
- Notification creation failures are swallowed so they do not break the export flow.
