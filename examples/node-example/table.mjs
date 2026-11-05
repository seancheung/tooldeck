import path from 'node:path';
import { stat } from 'node:fs/promises';

export async function main(ctx) {
  const readme = path.join(ctx.paths.tool, 'README.md');
  ctx.table({
    columns: [{ key: 'name', label: 'File' }, { key: 'size', label: 'Size (bytes)' }],
    rows: [
      { name: { kind: 'file', target: readme, label: 'User guide' }, size: (await stat(readme)).size },
      { name: { kind: 'directory', target: ctx.paths.tool, label: 'Tool directory' }, size: null },
    ],
  });
}
