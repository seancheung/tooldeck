import fs from 'node:fs/promises';
import path from 'node:path';

export async function main(ctx) {
  ctx.progress({ value: 0, total: 1, message: 'Preparing to write' });
  let message = ctx.settings.prefix + ', ' + ctx.params.name + '!';
  if (ctx.settings.uppercase) message = message.toUpperCase();
  const destination = ctx.params.destination;
  if (!path.isAbsolute(destination)) throw new Error('destination must be an absolute path');
  await fs.writeFile(destination, message + '\n', { encoding: 'utf8', flag: 'wx' });
  ctx.json({ message, savedTo: destination });
  ctx.link({ kind: 'file', target: destination, label: 'Open greeting file' });
  ctx.link({ kind: 'directory', target: path.dirname(destination), label: 'Open containing directory' });
  ctx.progress({ value: 1, total: 1, message: 'Done' });
}
