import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { useEventPolling } from '../useEventPolling.js';

function safeActivity(item) {
  if (!item || !Number.isInteger(item.cursor) || item.cursor < 1) return null;
  const title = typeof item.title === 'string' && item.title.trim() ? item.title : null;
  const summary = typeof item.summary === 'string' && item.summary.trim() ? item.summary : null;
  const occurredAt = typeof item.occurredAt === 'string' && item.occurredAt.trim() ? item.occurredAt : null;
  return title && summary && occurredAt ? { cursor: item.cursor, title, summary, occurredAt } : null;
}

export function ActivityPanel({ api, workstreamId }) {
  const [items, setItems] = useState([]);
  const seen = useRef(new Set());
  const selected = useRef(workstreamId);
  if (selected.current !== workstreamId) selected.current = workstreamId;

  useEffect(() => {
    selected.current = workstreamId;
    seen.current = new Set();
    setItems([]);
  }, [workstreamId]);

  const processPage = useCallback(async ({ workstreamId: pageWorkstreamId, afterCursor, nextCursor }) => {
    let result;
    try {
      result = await api.query('activity.list', { workstreamId: pageWorkstreamId, afterCursor, limit: 100 });
    } catch {
      return false;
    }
    if (result?.ok !== true || result.data?.nextCursor !== nextCursor) return false;
    const safeItems = (Array.isArray(result.data?.items) ? result.data.items : [])
      .map(safeActivity)
      .filter(Boolean);
    if (selected.current !== pageWorkstreamId) return false;
    setItems((current) => {
      const additions = safeItems.filter((item) => !seen.current.has(item.cursor));
      additions.forEach((item) => seen.current.add(item.cursor));
      return additions.length ? [...current, ...additions] : current;
    });
    return true;
  }, [api]);

  useEventPolling({ api, workstreamId, onPageProcessed: processPage });

  if (!workstreamId) return createElement('p', { className: 'muted' }, 'Select a workstream to view activity.');
  return createElement('div', { className: 'activity-panel', 'data-activity-panel': 'true' },
    items.length ? createElement('ul', null, items.map((item) => createElement('li', { key: item.cursor, className: 'activity-item' },
      createElement('strong', null, item.title),
      createElement('p', null, item.summary),
      createElement('time', { dateTime: item.occurredAt }, item.occurredAt)
    ))) : createElement('p', { className: 'muted' }, 'No activity yet.')
  );
}
