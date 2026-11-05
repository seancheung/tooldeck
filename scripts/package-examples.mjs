import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
const root = path.resolve('examples');
fs.mkdirSync('artifacts/tools', { recursive: true });
for (const name of fs.readdirSync(root)) {
  const source = path.join(root, name);
  if (!fs.existsSync(path.join(source, 'manifest.yaml'))) continue;
  const entries = {};
  function add(dir, prefix = '') {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.venv', 'node_modules', '.tooldeck', '__pycache__'].includes(item.name)) continue;
      const relative = prefix + item.name;
      if (item.isDirectory()) add(path.join(dir, item.name), relative + '/');
      else entries[relative] = fs.readFileSync(path.join(dir, item.name));
    }
  }
  add(source);
  const target = `artifacts/tools/${name}.zip`;
  fs.writeFileSync(target, zipSync(entries));
  console.log(target);
}
