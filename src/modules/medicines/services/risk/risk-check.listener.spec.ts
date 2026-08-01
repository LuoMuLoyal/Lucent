import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicineRiskCheckListener } from './risk-check.listener';
import { type MedicineRiskCheckService } from './risk-check.service';

describe('MedicineRiskCheckListener', () => {
  const runStaticCheck = vi.fn();
  const markStale = vi.fn();
  let listener: MedicineRiskCheckListener;

  beforeEach(() => {
    vi.useFakeTimers();
    runStaticCheck.mockReset();
    markStale.mockReset();
    runStaticCheck.mockResolvedValue(undefined);
    markStale.mockResolvedValue(undefined);
    const svc = {
      markStale,
      runStaticCheck,
    } as unknown as MedicineRiskCheckService;
    listener = new MedicineRiskCheckListener(svc);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks stale and schedules a debounced static check on health-context change', async () => {
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);

    expect(markStale).toHaveBeenCalledWith('u1');
    expect(runStaticCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(runStaticCheck).toHaveBeenCalledTimes(1);
    expect(runStaticCheck).toHaveBeenCalledWith('u1');
  });

  it('debounces a burst of events into a single check', async () => {
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);
    await vi.advanceTimersByTimeAsync(3000);
    await listener.handleReminderChanged({ userId: 'u1' } as never);
    await vi.advanceTimersByTimeAsync(5000);

    expect(runStaticCheck).toHaveBeenCalledTimes(1);
  });

  it('schedules even when markStale fails', async () => {
    markStale.mockRejectedValue(new Error('db down'));
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);
    await vi.advanceTimersByTimeAsync(5000);

    expect(runStaticCheck).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the async static check rejects', async () => {
    runStaticCheck.mockRejectedValue(new Error('boom'));
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);
    // timer 回调内 catch 吞掉 rejection，advance 不应抛错
    await vi.advanceTimersByTimeAsync(5000);
    expect(runStaticCheck).toHaveBeenCalledTimes(1);
  });

  it('clears pending timers on module destroy', async () => {
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);
    listener.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(5000);

    expect(runStaticCheck).not.toHaveBeenCalled();
  });
});
