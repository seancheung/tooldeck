import path from 'node:path';
import { stat } from 'node:fs/promises';

export async function main(ctx) {
  const {folder, sourceFile} = ctx.params;
  if (sourceFile === undefined) {
    ctx.log('The folder contains no regular files.');
    return;
  }
  const target = path.join(folder, sourceFile);
  const file = await stat(target);
  ctx.output({name: sourceFile, bytes: file.size});
  ctx.link({kind: 'file', target, label: sourceFile});
}
