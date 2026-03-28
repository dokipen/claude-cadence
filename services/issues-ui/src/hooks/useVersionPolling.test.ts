// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVersionPolling } from './useVersionPolling';

const mockUsePageVisibility = vi.fn(() => false);
vi.mock('./usePageVisibility', () => ({ usePageVisibility: () => mockUsePageVisibility() }));

const INTERVAL = 1000;

function makeFetchResponse(sha: string, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve({ sha }),
  } as Response);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('__BUILD_SHA__', 'test-sha');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockUsePageVisibility.mockReturnValue(false);
});

describe('useVersionPolling', () => {
  it('starts with updateAvailable false', () => {
    vi.stubGlobal('fetch', vi.fn(() => makeFetchResponse('test-sha')));
    const { result } = renderHook(() => useVersionPolling(INTERVAL));
    expect(result.current.updateAvailable).toBe(false);
  });

  it('sets updateAvailable to true when server returns a different SHA', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeFetchResponse('new-sha')));
    const { result } = renderHook(() => useVersionPolling(INTERVAL));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });

    expect(result.current.updateAvailable).toBe(true);
  });

  it('keeps updateAvailable false when server returns matching SHA', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeFetchResponse('test-sha')));
    const { result } = renderHook(() => useVersionPolling(INTERVAL));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it('stops polling after updateAvailable becomes true', async () => {
    const fetchMock = vi.fn(() => makeFetchResponse('new-sha'));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useVersionPolling(INTERVAL));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });

    expect(result.current.updateAvailable).toBe(true);
    const callsAfterDetection = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    });

    expect(fetchMock.mock.calls.length).toBe(callsAfterDetection);
  });

  it('clears interval on unmount and does not call fetch after unmount', async () => {
    const fetchMock = vi.fn(() => makeFetchResponse('test-sha'));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderHook(() => useVersionPolling(INTERVAL));

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently ignores network errors and keeps updateAvailable false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network error'))));
    const { result } = renderHook(() => useVersionPolling(INTERVAL));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it('silently ignores non-ok responses and keeps updateAvailable false', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeFetchResponse('new-sha', false)));
    const { result } = renderHook(() => useVersionPolling(INTERVAL));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it('pauses polling when tab is hidden and resumes when visible', async () => {
    const fetchMock = vi.fn(() => makeFetchResponse('test-sha'));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = renderHook(() => useVersionPolling(INTERVAL));

    // Advance — should poll while visible
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Tab goes hidden
    mockUsePageVisibility.mockReturnValue(true);
    await act(async () => { rerender(); });

    const callsBeforeHidden = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });
    expect(fetchMock.mock.calls.length).toBe(callsBeforeHidden);

    // Tab becomes visible again
    mockUsePageVisibility.mockReturnValue(false);
    await act(async () => { rerender(); });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeHidden);
  });

  it('keeps updateAvailable false when sha field is missing or null', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response)
    ));
    const { result } = renderHook(() => useVersionPolling(INTERVAL));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it('fetches from /version.json', async () => {
    const fetchMock = vi.fn(() => makeFetchResponse('test-sha'));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useVersionPolling(INTERVAL));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });

    expect(fetchMock).toHaveBeenCalledWith('/version.json');
  });
});

describe('backoff behavior', () => {
  it('retries after intervalMs * 2 following a single failure, not at intervalMs', async () => {
    // With backoff: failure at t=1000, next retry scheduled at t=3000 (delay=2000).
    // At t=2000 the retry should NOT have fired yet.
    const fetchMock = vi.fn(() => Promise.reject(new Error('Network error')));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useVersionPolling(INTERVAL));

    // First fetch fires and fails at t=INTERVAL
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance another INTERVAL (total t=2000). With backoff the next retry is
    // not due until t=3000 (delay = INTERVAL * 2). Expect no additional call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance to t=3000 (one more INTERVAL). Now the backoff delay has elapsed
    // and the retry should fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('doubles the backoff delay on each consecutive failure', async () => {
    // Failure 1 at t=1000 → next at t=3000 (delay=2000)
    // Failure 2 at t=3000 → next at t=7000 (delay=4000)
    // At t=6000 the 3rd call should NOT have fired yet.
    const fetchMock = vi.fn(() => Promise.reject(new Error('Network error')));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useVersionPolling(INTERVAL));

    // Failure 1 at t=1000
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Failure 2 at t=3000
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // At t=6000 (3000ms since failure 2): next retry is at t=7000. Expect still 2 calls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Advance to t=7000. Now the third retry fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('caps the backoff delay at 300_000ms after many consecutive failures', async () => {
    // Use intervalMs=100_000 so the cap (300_000ms) is reachable quickly.
    // Failure 1 at t=100_000: next delay = 200_000 → next at t=300_000
    // Failure 2 at t=300_000: next delay = min(400_000, 300_000) = 300_000 → next at t=600_000
    // At t=599_999 the third call should NOT have fired yet (cap in effect).
    // At t=600_000 the third call fires.
    const CAP_INTERVAL = 100_000;
    const fetchMock = vi.fn(() => Promise.reject(new Error('Network error')));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useVersionPolling(CAP_INTERVAL));

    // Failure 1 at t=100_000
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAP_INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Failure 2 at t=300_000
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAP_INTERVAL * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // At t=599_999 — 1ms before the cap delay elapses — no third call yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000 - 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // At t=600_000 — cap delay fully elapsed — third call fires
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('resets the retry interval to intervalMs after a successful fetch following failures', async () => {
    // Timeline with backoff:
    //   t=1000 fail 1: next delay=2000 → next at t=3000
    //   t=3000 fail 2: next delay=4000 → next at t=7000
    //   t=7000 success: failureCount resets → next delay=1000 → next at t=8000
    //   t=8000 fail 3: next delay=2000 → next at t=10000
    //   At t=9999 (1999ms since fail 3): no 5th call yet (backoff=2000, not elapsed)
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('fail 1')))
      .mockImplementationOnce(() => Promise.reject(new Error('fail 2')))
      .mockImplementationOnce(() => makeFetchResponse('test-sha')) // success, same SHA
      .mockImplementation(() => Promise.reject(new Error('fail 3+')));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useVersionPolling(INTERVAL));

    // t=1000: fail 1
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // t=3000: fail 2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // t=7000: success — resets backoff
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 4);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // t=8000: fail 3 (first fail after recovery, delay should reset to INTERVAL * 2 = 2000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // t=9999: 1999ms since fail 3. Backoff delay = 2000ms, NOT yet elapsed — expect no 5th call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // t=10000: 2000ms since fail 3. Backoff elapsed — 5th call fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('uses a configurable intervalMs as the base polling interval with backoff', async () => {
    // With intervalMs=2000, first success at t=2000, next at t=4000.
    // After a failure at t=4000, backoff delay = 2000 * 2 = 4000 → next at t=8000.
    // At t=5999 (1999ms since failure): no 3rd call yet.
    const CUSTOM_INTERVAL = 2000;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => makeFetchResponse('test-sha')) // success
      .mockImplementationOnce(() => makeFetchResponse('test-sha')) // success
      .mockImplementationOnce(() => Promise.reject(new Error('fail'))) // fail at t=4000
      .mockImplementation(() => makeFetchResponse('test-sha'));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useVersionPolling(CUSTOM_INTERVAL));

    // t=2000: 1st call (success)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CUSTOM_INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // t=4000: 2nd call (success)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CUSTOM_INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // t=6000: 3rd call (fails) — wait, mock order is success, success, fail...
    // Actually with setInterval and no backoff: t=2000 call1, t=4000 call2, t=6000 call3(fail)
    // We need to test backoff from a failure. Let's advance to trigger the fail:
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CUSTOM_INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 3rd call (fails)

    // With backoff: next retry at t = 6000 + CUSTOM_INTERVAL * 2 = 6000 + 4000 = 10000.
    // At t=9999 (3999ms since failure): expect no 4th call yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CUSTOM_INTERVAL * 2 - 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // At t=10000: backoff delay elapsed — 4th call fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
