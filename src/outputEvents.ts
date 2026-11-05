import type { Event } from './types';

export function appendOutputEvent(events: Event[], event: Event): Event[] {
  if (event.type === 'details') {
    if (typeof event.payload?.text !== 'string') return events;
    const index = events.findIndex(item => item.type === 'details' && item.runId === event.runId && item.payload.id === event.payload.id);
    if (index >= 0) {
      const next = events.slice();
      next[index] = {...events[index], payload: {...event.payload, text: events[index].payload.text + event.payload.text}};
      return next;
    }
  }
  const next = [...events, event];
  if (next.length > 5000) {
    const index = next.findIndex(item => item.type !== 'details' || item.runId !== event.runId);
    next.splice(Math.max(0, index), 1);
  }
  return next;
}
