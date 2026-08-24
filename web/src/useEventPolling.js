import { useEffect, useRef } from 'react';

export const EVENT_POLL_INTERVAL_MS = 3000;

function pageCursor(page, previous) {
  const cursor = page?.nextCursor;
  return Number.isInteger(cursor) && cursor > previous ? cursor : null;
}

/**
 * Reads Event pages in cursor order. The cursor is committed only after the
 * consumer confirms that the corresponding page has been handled.
 */
export function useEventPolling({ api, workstreamId, onPageProcessed, interval = EVENT_POLL_INTERVAL_MS }) {
  const cursor = useRef(0);
  const timer = useRef(null);
  const generation = useRef(0);
  const processingGeneration = useRef(null);
  const callback = useRef(onPageProcessed);

  useEffect(() => { callback.current = onPageProcessed; }, [onPageProcessed]);

  useEffect(() => {
    cursor.current = 0;
    const requestGeneration = ++generation.current;
    let disposed = false;

    const clear = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const schedule = () => {
      clear();
      if (disposed || document.hidden || !workstreamId) return;
      timer.current = setTimeout(() => { void poll(); }, interval);
    };

    const poll = async () => {
      if (disposed || document.hidden || !workstreamId || processingGeneration.current === requestGeneration) return;
      processingGeneration.current = requestGeneration;
      try {
        let more = true;
        while (more && !disposed && !document.hidden && generation.current === requestGeneration) {
          const afterCursor = cursor.current;
          let result;
          try {
            result = await api.events('event.list', { workstreamId, afterCursor, limit: 100 });
          } catch {
            break;
          }
          if (result?.ok !== true || disposed || generation.current !== requestGeneration) break;
          const page = result.data;
          const nextCursor = pageCursor(page, afterCursor);
          if (!nextCursor) break;
          let processed = false;
          try {
            processed = await callback.current?.({
              workstreamId, afterCursor, events: Array.isArray(page?.items) ? page.items : [],
              nextCursor, hasMore: page?.hasMore === true
            }) === true;
          } catch {
            processed = false;
          }
          if (!processed || disposed || generation.current !== requestGeneration) break;
          cursor.current = nextCursor;
          more = page?.hasMore === true;
        }
      } finally {
        if (processingGeneration.current === requestGeneration) processingGeneration.current = null;
        schedule();
      }
    };

    const visibilityChanged = () => {
      if (document.hidden) clear();
      else void poll();
    };

    document.addEventListener('visibilitychange', visibilityChanged);
    if (workstreamId && !document.hidden) void poll();
    return () => {
      disposed = true;
      ++generation.current;
      if (processingGeneration.current === requestGeneration) processingGeneration.current = null;
      clear();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [api, interval, workstreamId]);
}
