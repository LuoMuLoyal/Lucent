import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { VictoriaLogsStream } from './victorialogs-stream.js';

interface Captured {
  body: string;
  contentType: string | undefined;
}

/**
 * Starts a one-shot HTTP sink, feeds `lines` into a fresh stream, and resolves
 * with the request body the sink received.
 */
function captureIngest(lines: string[]): Promise<Captured> {
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
      const stream = new VictoriaLogsStream({
        url: `http://127.0.0.1:${port}/insert/jsonline`,
        batchCount: 100,
      });
      for (const line of lines) {
        stream.write(`${line}\n`);
      }
      stream.end();
    });
  });
}

function entries(body: string): Array<Record<string, unknown>> {
  return body
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('VictoriaLogsStream', () => {
  it('copies message onto _msg (VictoriaLogs requires the _msg field)', async () => {
    const { body } = await captureIngest([
      JSON.stringify({
        message: 'hello world',
        level: 'info',
        context: 'Test',
      }),
    ]);

    const [entry] = entries(body);
    expect(entry!['_msg']).toBe('hello world');
    // message stays for non-VictoriaLogs consumers of the same JSON lines.
    expect(entry!['message']).toBe('hello world');
    expect(entry!['level']).toBe('info');
  });

  it('maps timestamp onto _time for event-time indexing', async () => {
    const { body } = await captureIngest([
      JSON.stringify({
        message: 'timed',
        timestamp: '2026-09-15T12:00:00.000Z',
      }),
    ]);

    expect(entries(body)[0]!['_time']).toBe('2026-09-15T12:00:00.000Z');
  });

  it('does not overwrite an explicit _msg or _time supplied by the caller', async () => {
    const { body } = await captureIngest([
      JSON.stringify({
        message: 'from message',
        _msg: 'explicit',
        timestamp: '2026-09-15T12:00:00.000Z',
        _time: 'explicit-time',
      }),
    ]);

    const [entry] = entries(body);
    expect(entry!['_msg']).toBe('explicit');
    expect(entry!['_time']).toBe('explicit-time');
  });

  it('falls back to an empty _msg when message is absent', async () => {
    const { body } = await captureIngest([JSON.stringify({ level: 'info' })]);

    expect(entries(body)[0]!['_msg']).toBe('');
  });

  it('batches multiple entries as newline-delimited JSON', async () => {
    const { body, contentType } = await captureIngest([
      JSON.stringify({ message: 'one', timestamp: '2026-09-15T12:00:01.000Z' }),
      JSON.stringify({ message: 'two', timestamp: '2026-09-15T12:00:02.000Z' }),
    ]);

    expect(contentType).toBe('application/x-ndjson');
    const parsed = entries(body);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!['_msg']).toBe('one');
    expect(parsed[1]!['_msg']).toBe('two');
  });

  it('forwards a non-JSON line instead of dropping it', async () => {
    const { body } = await captureIngest(['not json at all']);

    const [entry] = entries(body);
    expect(entry!['_msg']).toBe('not json at all');
    expect(typeof entry!['_time']).toBe('string');
  });
});
