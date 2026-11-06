import type { Event } from './types';

let sequence = 0;
// Stamp at ingress, outside React state updaters. A sequence also orders events
// received within the same millisecond or across a system-clock adjustment.
export function stampOutputEvent(event: Event): Event {
  if (event.sequence !== undefined) return event;
  const receivedAt = Date.now();
  return {...event, receivedAt, sequence: ++sequence,
    time: new Date(receivedAt).toLocaleTimeString(typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en', {hour12:false})};
}

export function chronologicalOutput(events: Event[]): Event[] {
  return [...events].sort((a,b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

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
