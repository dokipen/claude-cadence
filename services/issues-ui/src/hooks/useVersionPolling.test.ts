// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVersionPolling } from './useVersionPolling';

vi.mock('./usePageVisibility', () => ({ usePageVisibility: () => false }));

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
});
