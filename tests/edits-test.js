/*
 * Unit tests for the timeline edit rules (split, carve, insert, overwrite).
 * Run with:  node tests/edits-test.js
 * Loads the real browser modules into a sandbox, so no browser is needed.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'js');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['state.js', 'edits.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

const AVP = sandbox.AVP;
const S = AVP.state;
const E = AVP.edit;

let uid = 0;
function clip(track, start, duration, linkId, inPoint) {
  return {
    id: 'c' + ++uid,
    mediaId: 'm1',
    track,
    start,
    inPoint: inPoint || 0,
    duration,
    opacity: 1,
    volume: 1,
    scale: 1,
    linkId: linkId || null,
  };
}

// Compact description: "V1 0-2 | A1 0-2" (linked pairs share a letter tag).
function describe() {
  return S.clips
    .slice()
    .sort((a, b) => a.track.localeCompare(b.track) || a.start - b.start)
    .map((c) => `${c.track} ${+c.start.toFixed(3)}-${+(c.start + c.duration).toFixed(3)}`)
    .join(' | ');
}

function reset(clips) {
  S.clips = clips;
  S.selection = [];
  S.tracks = AVP.defaultTracks();
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('splitClip cuts linked partners at the same time', () => {
  reset([clip('V1', 0, 4, 'L', 0), clip('A1', 0, 4, 'L', 0)]);
  E.splitClip(S.clips[0], 1);
  assert.strictEqual(describe(), 'A1 0-1 | A1 1-4 | V1 0-1 | V1 1-4');
  const pieces = S.clips.filter((c) => c.track === 'V1' && c.start === 1);
  assert.strictEqual(pieces[0].inPoint, 1, 'right piece keeps source position');
  assert.strictEqual(AVP.partners(S.clips.find((c) => c.track === 'V1' && c.start === 0)).length, 1);
});

test('carveRange trims, splits and removes what a dropped clip covers', () => {
  const big = clip('V1', 0, 6, null, 0);
  const dropped = clip('V1', 2, 2, null, 0);
  const headOverlap = clip('V1', 8, 2, null, 0); // untouched
  reset([big, dropped, headOverlap]);
  E.carveRange('V1', 2, 4, new Set([dropped.id]));
  // big is split around the dropped clip; the dropped clip and the far clip are untouched.
  assert.strictEqual(describe(), 'V1 0-2 | V1 2-4 | V1 4-6 | V1 8-10');
});

test('carveRange trims the head and tail of covered clips', () => {
  const a = clip('V1', 0, 3, null, 0); // tail covered
  const b = clip('V1', 5, 3, null, 0); // head covered
  const k = clip('V1', 2, 4, null, 0); // dropped over both
  reset([a, b, k]);
  E.carveRange('V1', 2, 6, new Set([k.id]));
  assert.strictEqual(describe(), 'V1 0-2 | V1 2-6 | V1 6-8');
  const bPiece = S.clips.find((c) => c.id === b.id);
  assert.strictEqual(bPiece.inPoint, 1, 'head trim advances the source in point');
});

test('carveRange keeps linked audio in step with a cut video clip', () => {
  const v = clip('V1', 0, 4, 'L', 0);
  const a = clip('A1', 0, 4, 'L', 0);
  const k = clip('V2', 1, 1, null, 0);
  reset([v, a, k]);
  E.carveRange('V1', 1, 2, new Set([k.id]));
  const v1 = S.clips.filter((c) => c.track === 'V1').map((c) => c.start + '-' + (c.start + c.duration));
  const a1 = S.clips.filter((c) => c.track === 'A1').map((c) => c.start + '-' + (c.start + c.duration));
  assert.deepStrictEqual(v1.sort(), ['0-1', '2-4']);
  assert.deepStrictEqual(a1.sort(), ['0-1', '2-4'], 'linked audio is cut exactly like the video');
});

test('insertGap pushes later clips on every given track, partners included', () => {
  const v = clip('V1', 0, 2, 'L', 0);
  const a = clip('A1', 0, 2, 'L', 0);
  const v2 = clip('V1', 2, 2, 'M', 0);
  const a2 = clip('A1', 2, 2, 'M', 0);
  reset([v, a, v2, a2]);
  E.insertGap(['V1', 'A1'], 1, 1);
  assert.strictEqual(describe(), 'A1 0-1 | A1 2-3 | A1 3-5 | V1 0-1 | V1 2-3 | V1 3-5');
});

test('insertGap on one track moves linked partners on the other track too', () => {
  const v = clip('V1', 0, 4, 'L', 0);
  const a = clip('A1', 0, 4, 'L', 0);
  reset([v, a]);
  E.insertGap(['V1'], 2, 1);
  const vs = S.clips.filter((c) => c.track === 'V1').map((c) => c.start).sort();
  const as = S.clips.filter((c) => c.track === 'A1').map((c) => c.start).sort();
  assert.deepStrictEqual(vs, [0, 3]);
  assert.deepStrictEqual(as, [0, 3], 'audio stays in sync with the video');
});

test('clearRange removes a span and splits its edges', () => {
  reset([clip('V1', 0, 10, null, 0)]);
  E.clearRange('V1', 3, 5);
  assert.strictEqual(describe(), 'V1 0-3 | V1 5-10');
});

test('removeClips with ripple closes the gap', () => {
  const a = clip('V1', 0, 2, null, 0);
  const b = clip('V1', 2, 3, null, 0);
  const c = clip('V1', 5, 1, null, 0);
  reset([a, b, c]);
  E.removeClips([a.id], true);
  assert.strictEqual(describe(), 'V1 0-3 | V1 3-4');
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log('ok   - ' + t.name);
  } catch (err) {
    failed++;
    console.log('FAIL - ' + t.name);
    console.log('       ' + err.message.split('\n').join('\n       '));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
