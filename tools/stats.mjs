#!/usr/bin/env node
// Keeps the clone count for the stats line on the Pages site.
//
//   node tools/stats.mjs
//
// Needs the `gh` CLI, signed in with push access to the repo (GitHub only shows
// traffic to people who can push). Stars, forks and downloads are public, so the
// page reads those live; clones are not, so this script saves them for it.
//
// GitHub keeps clone counts for 14 days only. Every run merges what it sees into
// ~/.foldline/clones-history.json (outside the repo, so a fresh clone can be
// thrown away without losing days) and writes the running total to
// docs/stats.json, which the page reads. Run it at least once every two weeks so
// no day is lost. Running it twice on one day just refreshes that day.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = 'alireza12t/foldline';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const historyFile = process.env.FOLDLINE_STATS_HISTORY
  || path.join(os.homedir(), '.foldline', 'clones-history.json');
const outFile = path.join(root, 'docs', 'stats.json');

const traffic = JSON.parse(
  execFileSync('gh', ['api', `repos/${REPO}/traffic/clones`], { encoding: 'utf8' }),
);

let history = {};
try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch {}
for (const d of traffic.clones) {
  history[d.timestamp.slice(0, 10)] = { count: d.count, uniques: d.uniques };
}
fs.mkdirSync(path.dirname(historyFile), { recursive: true });
fs.writeFileSync(historyFile, JSON.stringify(history, null, 2) + '\n');

const days = Object.keys(history).sort().filter((d) => history[d].count > 0);
const clones = days.reduce((sum, d) => sum + history[d].count, 0);
const stats = {
  clones,
  since: days[0] ?? null,
  updated: new Date().toISOString().slice(0, 10),
};
fs.writeFileSync(outFile, JSON.stringify(stats, null, 2) + '\n');
console.log(`clones ${clones} since ${stats.since}, written to docs/stats.json`);
