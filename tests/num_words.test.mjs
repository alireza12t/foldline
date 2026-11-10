// The Qwen voice spells English digits as words before speaking (core/tts/num_words.py), and its Whisper check
// (core/tts/take_check.py) reads Whisper's digits back as words. Both must give the same words, or a good take
// is redone until it is marked STILL FAILING. Pure Python for the speller; the agreement test needs numpy and skips without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TTS = path.join(ROOT, 'core/tts');
const PY = [process.env.FOLDLINE_PYTHON, path.join(ROOT, '.venv/bin/python'), 'python3'].find(p => p && (p === 'python3' || fs.existsSync(p)));
const py = (code, ...args) => spawnSync(PY, ['-I', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(TTS)})\n${code}`, ...args], { encoding: 'utf8' });

const SPELL = {
  'In 1947.': 'In nineteen forty-seven.',
  '2000 people came in 2000.': 'two thousand people came in two thousand.',
  '$5 million, 10%': 'five million dollars, ten percent',
  'It cost $1.50.': 'It cost one dollar and fifty cents.',
  '$0.99': 'ninety-nine cents',
  '$1': 'one dollar',
  "the 1990s and '90s": 'the nineteen nineties and nineties',
  'on the 19th at 9:30, 9:05 and 10:00': "on the nineteenth at nine thirty, nine oh five and ten o'clock",
  'Doors at 10:00pm, 7:30 p.m. and 6 AM.': 'Doors at ten p.m., seven thirty p.m. and six a.m.',
  '1939-1945': 'nineteen thirty-nine to nineteen forty-five',
  '1,200 copies by 1999': 'one thousand two hundred copies by nineteen ninety-nine',
  '21st, 22nd, 100th': 'twenty-first, twenty-second, one hundredth',
  'I am 5 and 2 amps': 'I am five and two amps',
};

test('num_words spells digits the way a narrator says them', () => {
  for (const [line, want] of Object.entries(SPELL)) {
    assert.equal(execFileSync(PY, ['-I', path.join(TTS, 'num_words.py'), line], { encoding: 'utf8' }).trim(), want, line);
  }
});

test('the Whisper check hears the same words the speller wrote', t => {
  if (py('import numpy').status !== 0) return t.skip('numpy not installed');
  const pairs = [['In 1947.', 'In 1947.'], ['about 1,200 copies by 1999', 'about 1,200 copies by 1999'], ['$5 million', '$5 million'],
    ['It cost $1.50.', 'It cost $1.50.'], ['It cost $0.99.', 'It cost 99 cents.'], ['the 19th', 'the 19th'], ['the 1990s', 'the 1990s'],
    ['at 9:30', 'at 9:30'], ['Doors at 10:00pm.', 'Doors at 10 p.m.'], ['Doors at 7:30 pm.', 'Doors at 7.30pm.'], ['GTA 6', 'GTA VI'],
    ['from 1939-1945', 'from 1939 to 1945']];
  const r = py(`import json
from num_words import spell
from take_check import words
bad = []
for line, heard in json.loads(sys.argv[1]):
    ref = words(spell(line)); hyp = words(heard, ref)
    if ref != hyp: bad.append(f'{line!r} heard as {heard!r}: {ref} vs {hyp}')
print('\\n'.join(bad))`, JSON.stringify(pairs));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '');
});
