import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { VictoriaLogsTransport } from './victorialogs-transport.js';

/**
 * Starts a one-shot HTTP sink that captures the raw request body POSTed to
 * it, then resolves with `{ body, contentType }`.
 */
function captureIngest(
  transport: VictoriaLogsTransport,
  entries: Array<Record<string, unknown>>,
): Promise<{ body: string; contentType: string | undefined }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(204);
        res.end();
        const contentType = req.headers['content-type'];
        server.close(() => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            contentType,
          });
        });
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      // Point the transport at the sink before any entries are buffered.
      (transport as unknown as { endpoint: URL }).endpoint = new URL(
        `http://127.0.0.1:${port}/insert/jsonline`,
      );
      for (const entry of entries) {
        transport.log(entry, () => {});
      }
      transport.close();
    });
  });
}

function makeTransport(): VictoriaLogsTransport {
  // Placeholder URL; captureIngest rewrites it before logging.
  return new VictoriaLogsTransport({
    url: 'http://127.0.0.1:9/insert/jsonline',
  });
}

describe('VictoriaLogsTransport', () => {
  it('copies message onto _msg (VictoriaLogs requires the _msg field)', async () => {
    const transport = makeTransport();
    const { body } = await captureIngest(transport, [
      { message: 'hello world', level: 'info', context: 'Test' },
    ]);

    const lines = body.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry['_msg']).toBe('hello world');
    // message stays for non-VictoriaLogs consumers of the same JSON lines.
    expect(entry['message']).toBe('hello world');
    expect(entry['level']).toBe('info');
  });

  it('maps timestamp onto _time for event-time indexing', async () => {
    const transport = makeTransport();
    const { body } = await captureIngest(transport, [
      { message: 'timed', timestamp: '2026-09-15T12:00:00.000Z' },
    ]);

    const entry = JSON.parse(body.trimEnd().split('\n')[0]!) as Record<
      string,
      unknown
    >;
    expect(entry['_time']).toBe('2026-09-15T12:00:00.000Z');
  });

  it('does not overwrite an explicit _msg supplied by the caller', async () => {
    const transport = makeTransport();
    const { body } = await captureIngest(transport, [
      {
        message: 'from message',
        _msg: 'explicit',
        timestamp: '2026-09-15T12:00:00.000Z',
        _time: 'explicit-time',
      },
    ]);

    const entry = JSON.parse(body.trimEnd().split('\n')[0]!) as Record<
      string,
      unknown
    >;
    expect(entry['_msg']).toBe('explicit');
    expect(entry['_time']).toBe('explicit-time');
  });

  it('falls back to an empty _msg when message is absent', async () => {
    const transport = makeTransport();
    const { body } = await captureIngest(transport, [{ level: 'info' }]);

    const entry = JSON.parse(body.trimEnd().split('\n')[0]!) as Record<
      string,
      unknown
    >;
    expect(entry['_msg']).toBe('');
  });

  it('batches multiple entries as newline-delimited JSON', async () => {
    const transport = makeTransport();
    const { body, contentType } = await captureIngest(transport, [
      { message: 'one', timestamp: '2026-09-15T12:00:01.000Z' },
      { message: 'two', timestamp: '2026-09-15T12:00:02.000Z' },
    ]);

    expect(contentType).toBe('application/x-ndjson');
    const lines = body.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)['_msg']).toBe('one');
    expect(JSON.parse(lines[1]!)['_msg']).toBe('two');
  });
});
