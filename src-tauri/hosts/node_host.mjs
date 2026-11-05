import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const socket = net.createConnection({ host: '127.0.0.1', port: Number(process.argv[3]) });
const lines = createInterface({ input: socket })[Symbol.asyncIterator]();
let channelError;
socket.on('error', error => { channelError = error; });
let sequence = 0;
let queue = Promise.resolve();

function serializable(value) {
  const seen = new Set();
  function visit(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || seen.has(v)) throw new TypeError('ctx.output requires JSON values');
    seen.add(v);
    for (const item of Object.values(v)) visit(item);
    seen.delete(v);
  }
  visit(value);
}

try {
  const initial = await lines.next();
  if (initial.done) throw new Error('Host context unavailable');
  const context = JSON.parse(initial.value);
  const emit = (type, payload) => {
    serializable(payload);
    const message = JSON.stringify({ version: 1, runId: context.runId, seq: ++sequence, type, payload });
    queue = queue.then(async () => {
      if (channelError) throw channelError;
      socket.write(message + '\n');
      const ack = await lines.next();
      if (ack.done || ack.value !== 'ok') throw new Error(ack.value || 'Host did not acknowledge event');
    });
    queue.catch(() => {});
  };
  const { hookEvent, ...metadata } = context;
  const ctx = {
    ...metadata,
    clearOutput: hookEvent ? () => emit('clearOutput', null) : hookId => emit('clearOutput', {hookId}),
    updateParams: patch => emit('updateParams', patch),
    log(message, level = 'info') {
      if (typeof message !== 'string' || !['debug', 'info', 'warning', 'error'].includes(level)) throw new TypeError('Invalid log');
      emit('log', { message, level });
    },
    output(value) { emit('output', value); },
    details({id, title, text}) {
      if (typeof id !== 'string' || !id.trim() || typeof title !== 'string' || !title.trim() || typeof text !== 'string') {
        throw new TypeError('Details require an id, title and text');
      }
      emit('details', {id, title, text});
    },
    table(value) {
      const { columns, rows } = value ?? {};
      if (!Array.isArray(columns) || !columns.length || columns.some(c => !c || typeof c.key !== 'string' || !c.key || (c.label !== undefined && typeof c.label !== 'string')) || new Set(columns.map(c => c.key)).size !== columns.length) throw new TypeError('Table needs unique column keys');
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new TypeError('Table rows must be objects');
      emit('table', { columns, rows });
    },
    progress(update) {
      const { value, total, message } = update;
      if (value !== undefined || total !== undefined) {
        if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0 || value < 0 || value > total) throw new TypeError('Invalid progress');
      } else if (typeof message !== 'string') throw new TypeError('Progress needs value/total or message');
      emit('progress', update);
    },
    link(link) {
      if (!['file', 'directory', 'url'].includes(link.kind) || typeof link.target !== 'string') throw new TypeError('Invalid link');
      emit('link', link);
    },
  };
  const module = await import(pathToFileURL(process.argv[2]).href);
  if (typeof module.main !== 'function') throw new Error('Entry must export main(ctx)');
  if (hookEvent) await module.main(ctx, hookEvent);
  else await module.main(ctx);
  await queue;
  await new Promise(resolve => socket.end(resolve));
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  socket.destroy();
}
