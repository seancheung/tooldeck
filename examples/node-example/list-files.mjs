import { readdir } from 'node:fs/promises';

export async function main(ctx) {
  const {folder, sourceFile} = ctx.params;
  let entries;
  try {
    entries = folder ? await readdir(folder, {withFileTypes: true}) : [];
  } catch (error) {
    ctx.updateParams({sourceFile: {options: [], unset: true, visible: true}});
    ctx.log(`Cannot read folder: ${error.message}`, 'error');
    return;
  }
  const names = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort();
  const selected = names.includes(sourceFile) ? sourceFile : names[0];
  ctx.updateParams({
    sourceFile: {
      options: names.map(value => ({value, label: value})),
      visible: names.length > 0,
      ...(selected === undefined ? {unset: true} : {value: selected}),
    },
  });
}
