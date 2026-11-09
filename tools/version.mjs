// One version for every place that publishes Foldline. package.json is the source; the others must match it:
//   package-lock.json (its own version), server.json (the MCP Registry entry and its npm package).
// The Claude directory copy (github alireza12t/foldline-claude-plugin) follows with tools/sync-claude-plugin.sh, and its own CI checks it against this repo.
//   node tools/version.mjs check        exit 1 and list every place that differs
//   node tools/version.mjs set 1.2.0    write the version everywhere (three parts; only bump when the owner asks)
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const write = (f, o) => fs.writeFileSync(path.join(ROOT, f), JSON.stringify(o, null, 2) + '\n');

// [file, label, get(json), set(json, v)]
const PLACES = [
  ['package-lock.json', 'version', j => j.version, (j, v) => { j.version = v; }],
  ['package-lock.json', 'packages[""].version', j => j.packages?.['']?.version, (j, v) => { j.packages[''].version = v; }],
  ['server.json', 'version', j => j.version, (j, v) => { j.version = v; }],
  ['server.json', 'packages[foldline-mcp].version', j => j.packages?.find(p => p.identifier === 'foldline-mcp')?.version,
    (j, v) => { j.packages.find(p => p.identifier === 'foldline-mcp').version = v; }],
];

export function mismatches() {
  const v = read('package.json').version, out = [];
  for (const [f, label, get] of PLACES) { const got = get(read(f)); if (got !== v) out.push(`${f} ${label} is ${got}, package.json is ${v}`); }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, v] = process.argv.slice(2);
  if (cmd === 'check') {
    const bad = mismatches();
    if (bad.length) { for (const l of bad) console.error(l); console.error('Fix with: node tools/version.mjs set <x.y.z>'); process.exit(1); }
    console.log(`ok: every place says ${read('package.json').version}`);
  } else if (cmd === 'set' && /^\d+\.\d+\.\d+$/.test(v || '')) {
    const pkg = read('package.json'); pkg.version = v; write('package.json', pkg);
    const files = {}; for (const [f, , , set] of PLACES) { files[f] ??= read(f); set(files[f], v); }
    for (const [f, j] of Object.entries(files)) write(f, j);
    console.log(`set ${v} in package.json, ${Object.keys(files).join(', ')}. Then: npm test, commit, and after publishing run sh tools/sync-claude-plugin.sh`);
  } else { console.error('usage: node tools/version.mjs check | set <x.y.z>'); process.exit(2); }
}
