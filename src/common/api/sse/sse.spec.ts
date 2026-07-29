import type { ServerResponse } from 'node:http';
import { prepareSse, writeSseEvent, endSse } from './sse';

describe('sse', () => {
  function createMockResponse(): vi.Mocked<
    Pick<ServerResponse, 'writeHead' | 'write' | 'end'>
  > {
    return {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as vi.Mocked<
      Pick<ServerResponse, 'writeHead' | 'write' | 'end'>
    >;
  }

  describe('prepareSse', () => {
    it('calls writeHead with 200 and SSE headers', () => {
      const res = createMockResponse();
      prepareSse(res as unknown as ServerResponse);
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    });
  });

  describe('writeSseEvent', () => {
    it('writes event and data lines', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as ServerResponse, {
        event: 'summary',
        data: { text: 'hello' },
      });

      expect(res.write).toHaveBeenCalledWith('event: summary\n');
      expect(res.write).toHaveBeenCalledWith('data: {"text":"hello"}\n\n');
    });

    it('serializes string data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as ServerResponse, {
        event: 'chunk',
        data: 'plain text',
      });

      expect(res.write).toHaveBeenCalledWith('event: chunk\n');
      expect(res.write).toHaveBeenCalledWith('data: "plain text"\n\n');
    });

    it('serializes number data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as ServerResponse, {
        event: 'result',
        data: 42,
      });

      expect(res.write).toHaveBeenCalledWith('data: 42\n\n');
    });

    it('serializes null data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as ServerResponse, {
        event: 'done',
        data: null,
      });

      expect(res.write).toHaveBeenCalledWith('data: null\n\n');
    });

    it('serializes boolean data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as ServerResponse, {
        event: 'result',
        data: true,
      });

      expect(res.write).toHaveBeenCalledWith('data: true\n\n');
    });

    it('serializes undefined data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as ServerResponse, {
        event: 'done',
        data: undefined,
      });

      // JSON.stringify(undefined) returns undefined (not a string),
      // so the data line becomes 'data: undefined\n\n'
      expect(res.write).toHaveBeenCalledWith('data: undefined\n\n');
    });

    it('serializes nested object data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as ServerResponse, {
        event: 'summary',
        data: { nested: { key: 'value' } },
      });

      expect(res.write).toHaveBeenCalledWith(
        'data: {"nested":{"key":"value"}}\n\n',
      );
    });

    it('serializes array data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as ServerResponse, {
        event: 'chunk',
        data: [1, 'two', false],
      });

      expect(res.write).toHaveBeenCalledWith('data: [1,"two",false]\n\n');
    });

    it('writes event name before data', () => {
      const res = createMockResponse();
      const callOrder: string[] = [];
      (res.write as vi.Mock).mockImplementation((chunk: string) => {
        callOrder.push(chunk);
      });

      writeSseEvent(res as unknown as ServerResponse, {
        event: 'summary',
        data: 'test',
      });

      expect(callOrder).toEqual(['event: summary\n', 'data: "test"\n\n']);
    });
  });

  describe('endSse', () => {
    it('calls response.end', () => {
      const res = createMockResponse();
      endSse(res as unknown as ServerResponse);
      expect(res.end).toHaveBeenCalled();
    });
  });
});
