import type { Response } from 'express';
import { prepareSse, writeSseEvent, endSse } from './sse';

describe('sse', () => {
  function createMockResponse(): jest.Mocked<
    Pick<Response, 'status' | 'setHeader' | 'flushHeaders' | 'write' | 'end'>
  > {
    return {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<Response, 'status' | 'setHeader' | 'flushHeaders' | 'write' | 'end'>
    >;
  }

  describe('prepareSse', () => {
    it('sets status to 200', () => {
      const res = createMockResponse();
      prepareSse(res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('sets Content-Type header', () => {
      const res = createMockResponse();
      prepareSse(res as unknown as Response);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream; charset=utf-8',
      );
    });

    it('sets Cache-Control header', () => {
      const res = createMockResponse();
      prepareSse(res as unknown as Response);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache, no-transform',
      );
    });

    it('sets Connection header', () => {
      const res = createMockResponse();
      prepareSse(res as unknown as Response);
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    });

    it('sets X-Accel-Buffering header', () => {
      const res = createMockResponse();
      prepareSse(res as unknown as Response);
      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    });

    it('calls flushHeaders', () => {
      const res = createMockResponse();
      prepareSse(res as unknown as Response);
      expect(res.flushHeaders).toHaveBeenCalled();
    });
  });

  describe('writeSseEvent', () => {
    it('writes event and data lines', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as Response, {
        event: 'summary',
        data: { text: 'hello' },
      });

      expect(res.write).toHaveBeenCalledWith('event: summary\n');
      expect(res.write).toHaveBeenCalledWith('data: {"text":"hello"}\n\n');
    });

    it('serializes string data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as Response, {
        event: 'chunk',
        data: 'plain text',
      });

      expect(res.write).toHaveBeenCalledWith('event: chunk\n');
      expect(res.write).toHaveBeenCalledWith('data: "plain text"\n\n');
    });

    it('serializes number data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as Response, {
        event: 'result',
        data: 42,
      });

      expect(res.write).toHaveBeenCalledWith('data: 42\n\n');
    });

    it('serializes null data', () => {
      const res = createMockResponse();
      writeSseEvent(res as unknown as Response, {
        event: 'done',
        data: null,
      });

      expect(res.write).toHaveBeenCalledWith('data: null\n\n');
    });
  });

  describe('endSse', () => {
    it('calls response.end', () => {
      const res = createMockResponse();
      endSse(res as unknown as Response);
      expect(res.end).toHaveBeenCalled();
    });
  });
});
