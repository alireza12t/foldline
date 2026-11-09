// Every place that publishes Foldline (npm package, lock file, MCP Registry entry) carries the same version. See tools/version.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mismatches } from '../tools/version.mjs';

test('package.json, package-lock.json and server.json agree on the version', () => {
  assert.deepEqual(mismatches(), []);
});
