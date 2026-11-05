import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const number = '(?:0|[1-9][0-9]*)';
const identifier = '[0-9A-Za-z-]+';
const prerelease = `(?:${number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(`^${number}\\.${number}\\.${number}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+${identifier}(?:\\.${identifier})*)?$`);

function setVersion(version) {
  if (process.argv.length !== 3 || !semver.test(version)) {
    throw new Error('Usage: npm run set-version -- <version> (e.g. 0.2.0 or 0.2.0-beta.1)');
  }

  // Match only the app's declarations. Keep formatting and dependency versions intact.
  const rootJson = /^(  "version": ")[^"]+(")/m;
  const declarations = [
    ['package.json', [rootJson]],
    ['src-tauri/tauri.conf.json', [rootJson]],
    ['src-tauri/Cargo.toml', [/^(\[package\](?:\r?\n(?!\[|version\s*=)[^\r\n]*)*\r?\nversion = ")[^"]+(")/m]],
    ['package-lock.json', [rootJson, /^(    "": \{\r?\n      "name": "[^"]+",\r?\n      "version": ")[^"]+(")/m]],
    ['src-tauri/Cargo.lock', [/^(\[\[package\]\]\r?\nname = "tooldeck"\r?\nversion = ")[^"]+(")/m]],
  ];

  const changes = declarations.map(([file, patterns]) => {
    const path = fileURLToPath(new URL(file, root));
    const original = readFileSync(path, 'utf8');
    let updated = original;
    for (const pattern of patterns) {
      if (!pattern.test(updated)) throw new Error(`Missing version declaration in ${file}`);
      updated = updated.replace(pattern, (_, prefix, suffix) => prefix + version + suffix);
    }
    return { path, original, updated };
  });

  const written = [];
  try {
    for (const change of changes.filter(({ original, updated }) => original !== updated)) {
      written.push(change);
      writeFileSync(change.path, change.updated);
    }
  } catch (error) {
    for (const change of written.reverse()) writeFileSync(change.path, change.original);
    throw error;
  }
  console.log(`ToolDeck version: ${version}`);
}

try {
  setVersion(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
