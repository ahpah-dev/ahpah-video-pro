/*
 * Unit tests for the timeline model: edit rules (split, carve, insert, speed, transitions)
 * and the pure effect / keyframe / transition maths.
 * Run with:  node tests/edits-test.js   (or `npm test`)
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
for (const file of ['state.js', 'effects.js', 'edits.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
// Browser-only hooks used by some edit operations.
sandbox.AVP.refresh = () => {};
sandbox.AVP.toast = () => {};

const AVP = sandbox.AVP;
const S = AVP.state;
const E = AVP.edit;
const EPS = 1e-6;

let uid = 0;
function clip(track, start, duration, linkId, inPoint, extra) {
  return AVP.normalizeClip(
    Object.assign(
      { id: 'c' + ++uid, mediaId: 'm1', kind: 'media', track, start, inPoint: inPoint || 0, duration, linkId: linkId || null },
      extra || {}
    )
  );
}

// Compact description: "A1 0-1 | V1 0-2", sorted by track then start.
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
  S.tracks = AVP.newTrackSet().tracks;
  S.trackOrder = AVP.newTrackSet().order;
  S.markers = [];
  S.clipboard = null;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ---------- edit rules ---------- */

test('the nearest marker is found only within the tolerance', () => {
  S.markers = [{ id: 'm1', t: 2 }, { id: 'm2', t: 5 }];
  assert.strictEqual(AVP.nearestMarker(2.05, 0.1).id, 'm1', 'just past a marker');
  assert.strictEqual(AVP.nearestMarker(3, 0.1), null, 'between markers, far from both');
  assert.strictEqual(AVP.nearestMarker(4.95, 0.1).id, 'm2');
  S.markers = [];
});

test('only audio-track clips make sound; a video clip is picture only, linked or not', () => {
  reset([clip('V1', 0, 4, 'L', 0), clip('A1', 0, 4, 'L', 0), clip('V2', 0, 4, null, 0)]);
  assert.strictEqual(AVP.clipMakesSound(S.clips[0]), false, 'linked video clip is silent');
  assert.strictEqual(AVP.clipMakesSound(S.clips[1]), true, 'audio clip makes the sound');
  assert.strictEqual(AVP.clipMakesSound(S.clips[2]), false, 'unlinked video clip is silent too');
  S.clips[1].linkId = null;
  assert.strictEqual(AVP.clipMakesSound(S.clips[0]), false, 'after unlinking, the video still does not sound');
});

test('cutting a keyed clip leaves no keyframe past either piece, and the values meet at the cut', () => {
  reset([clip('V1', 0, 10, null, 0)]);
  S.clips[0].keys = { x: [{ t: 2, v: 0 }, { t: 8, v: 60 }] };
  E.splitClip(S.clips[0], 5);
  const left = S.clips.find((c) => c.start === 0);
  const right = S.clips.find((c) => c.start > 0);
  assert.ok(left.keys.x.every((k) => k.t >= 0 && k.t <= left.duration + EPS), 'left keys stay inside the left piece');
  assert.ok(right.keys.x.every((k) => k.t >= -EPS && k.t <= right.duration + EPS), 'right keys stay inside the right piece');
  const endLeft = left.keys.x[left.keys.x.length - 1];
  assert.ok(Math.abs(endLeft.t - 5) < EPS, 'left piece ends with a key at the cut');
  assert.ok(Math.abs(endLeft.v - 30) < 1e-6, 'the value at the cut is the curve value there');
  assert.ok(Math.abs(right.keys.x[0].v - 30) < 1e-6, 'the right piece starts at the same value');
});

test('trimming the tail removes keyframes past the new end', () => {
  reset([clip('V1', 0, 10, null, 0)]);
  const o = Object.assign({}, S.clips[0], { keys: { x: [{ t: 2, v: 0 }, { t: 8, v: 60 }] } });
  S.clips[0].keys = o.keys;
  AVP.trimApply(S.clips[0], o, 'trim-out', -4);
  assert.ok(S.clips[0].keys.x.every((k) => k.t <= S.clips[0].duration + EPS), 'no key past the new end');
});

test('a speed change moves the linked audio with its video', () => {
  reset([clip('V1', 0, 10, 'L', 0), clip('A1', 0, 10, 'L', 0)]);
  E.setSpeed([S.clips[0].id], 2);
  const a = S.clips.find((c) => c.track === 'A1');
  assert.strictEqual(a.speed, 2, 'audio runs at the same speed');
  assert.ok(Math.abs(a.duration - 5) < EPS, 'and is the same length as the video');
});

test('split at each marker cuts the clip at every marker inside it, and its linked audio too', () => {
  reset([clip('V1', 0, 10, 'L', 0), clip('A1', 0, 10, 'L', 0)]);
  S.markers = [{ id: 'm1', t: 2 }, { id: 'm2', t: 5 }, { id: 'm3', t: 7 }, { id: 'm4', t: 12 }];
  const n = E.splitAtMarkers([S.clips[0].id]);
  assert.strictEqual(n, 3, 'three cuts; the marker past the clip end is ignored');
  assert.strictEqual(describe(), 'A1 0-2 | A1 2-5 | A1 5-7 | A1 7-10 | V1 0-2 | V1 2-5 | V1 5-7 | V1 7-10');
  S.markers = [];
});

test('markers on the edge of a clip do not cut it', () => {
  reset([clip('V1', 0, 10, null, 0)]);
  S.markers = [{ id: 'm1', t: 0 }, { id: 'm2', t: 10 }];
  assert.strictEqual(E.splitAtMarkers([S.clips[0].id]), 0);
  assert.strictEqual(describe(), 'V1 0-10');
  S.markers = [];
});

test('a transition goes on each piece cut at a marker', () => {
  reset([clip('V1', 0, 10, null, 0)]);
  S.markers = [{ id: 'm1', t: 4 }, { id: 'm2', t: 6 }];
  E.transitionAtMarkers([S.clips[0].id], 'dissolve');
  const starts = S.clips.filter((c) => c.track === 'V1' && c.transIn).map((c) => c.start).sort((a, b) => a - b);
  assert.deepStrictEqual(starts, [4, 6], 'the pieces starting at each marker have a dissolve');
  S.markers = [];
});

test('removing markers on a clip removes only those inside it', () => {
  reset([clip('V1', 2, 4, null, 0)]);
  S.markers = [{ id: 'in1', t: 3 }, { id: 'edge', t: 2 }, { id: 'out', t: 9 }];
  assert.strictEqual(E.removeMarkersOn([S.clips[0].id]), 1);
  assert.deepStrictEqual(S.markers.map((m) => m.id).sort(), ['edge', 'out']);
  S.markers = [];
});

test('keeping the part between the first and last marker trims the clip and its linked audio', () => {
  reset([clip('V1', 0, 10, 'L', 0), clip('A1', 0, 10, 'L', 0)]);
  S.markers = [{ id: 'm1', t: 2 }, { id: 'm2', t: 6 }];
  E.keepBetweenMarkers([S.clips[0].id]);
  assert.strictEqual(describe(), 'A1 2-6 | V1 2-6');
  S.markers = [];
});

test('partners are clips with the same link that overlap in time', () => {
  reset([clip('V1', 0, 4, 'L', 0), clip('A1', 0, 4, 'L', 0), clip('A1', 6, 2, 'L', 0), clip('A2', 0, 4, null, 0)]);
  const v = S.clips[0];
  assert.strictEqual(AVP.partners(v).length, 1, 'only the overlapping audio clip is a partner');
  assert.strictEqual(AVP.partners(v)[0].track, 'A1');
  assert.strictEqual(AVP.partners(S.clips[3]).length, 0, 'an unlinked clip has no partners');
});

test('a trimmed linked clip keeps its partner (the link survives a trim)', () => {
  reset([clip('V1', 0, 4, 'L', 0), clip('A1', 0, 4, 'L', 0)]);
  const v = S.clips[0];
  v.duration = 2.5; // trimmed on its own, as the timeline does when only the video is dragged
  assert.strictEqual(AVP.partners(v).length, 1, 'still linked to the audio');
  assert.strictEqual(AVP.partners(S.clips[1]).length, 1, 'and the audio is still linked to the video');
});

test('selecting a clip selects its partner only while linked selection is on', () => {
  reset([clip('V1', 0, 4, 'L', 0), clip('A1', 0, 4, 'L', 0)]);
  const v = S.clips[0];
  S.linkedSelection = true;
  AVP.select([v.id], false);
  assert.strictEqual(S.selection.length, 2, 'linked selection takes the audio too');
  S.linkedSelection = false;
  AVP.select([v.id], false);
  assert.strictEqual(S.selection.length, 1, 'with linked selection off only the clip is selected');
  S.linkedSelection = true;
});

test('splitClip cuts linked partners at the same time', () => {
  reset([clip('V1', 0, 4, 'L', 0), clip('A1', 0, 4, 'L', 0)]);
  E.splitClip(S.clips[0], 1);
  assert.strictEqual(describe(), 'A1 0-1 | A1 1-4 | V1 0-1 | V1 1-4');
  const right = S.clips.find((c) => c.track === 'V1' && c.start === 1);
  assert.strictEqual(right.inPoint, 1, 'right piece keeps its source position');
});

test('splitting a sped-up clip keeps source positions correct', () => {
  reset([clip('V1', 0, 4, null, 2, { speed: 2 })]); // covers source 2..10 in 4 seconds
  E.splitClip(S.clips[0], 1);
  const right = S.clips.find((c) => c.start === 1);
  assert.strictEqual(right.inPoint, 4, 'one timeline second at 2x is two source seconds');
});

test('carveRange trims, splits and removes what a dropped clip covers', () => {
  const big = clip('V1', 0, 6, null, 0);
  const dropped = clip('V1', 2, 2, null, 0);
  const far = clip('V1', 8, 2, null, 0);
  reset([big, dropped, far]);
  E.carveRange('V1', 2, 4, new Set([dropped.id]));
  assert.strictEqual(describe(), 'V1 0-2 | V1 2-4 | V1 4-6 | V1 8-10');
});

test('carveRange trims the head and tail of covered clips and moves head keys', () => {
  const a = clip('V1', 0, 3, null, 0);
  const b = clip('V1', 5, 3, null, 0, { keys: { x: [{ t: 0, v: 0 }, { t: 3, v: 30 }] } });
  const k = clip('V1', 2, 4, null, 0);
  reset([a, b, k]);
  E.carveRange('V1', 2, 6, new Set([k.id]));
  assert.strictEqual(describe(), 'V1 0-2 | V1 2-6 | V1 6-8');
  const bPiece = S.clips.find((c) => c.id === b.id);
  assert.strictEqual(bPiece.inPoint, 1, 'head trim advances the source in point');
  assert.strictEqual(bPiece.keys.x[0].t, 0);
});

test('carveRange keeps linked audio in step with a cut video clip', () => {
  const v = clip('V1', 0, 4, 'L', 0);
  const a = clip('A1', 0, 4, 'L', 0);
  const k = clip('V2', 1, 1, null, 0);
  reset([v, a, k]);
  E.carveRange('V1', 1, 2, new Set([k.id]));
  // V2 1-2 is the dropped clip itself, which must never be cut.
  assert.strictEqual(describe(), 'A1 0-1 | A1 2-4 | V1 0-1 | V1 2-4 | V2 1-2');
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
  reset([clip('V1', 0, 4, 'L', 0), clip('A1', 0, 4, 'L', 0)]);
  E.insertGap(['V1'], 2, 1);
  assert.strictEqual(describe(), 'A1 0-2 | A1 3-5 | V1 0-2 | V1 3-5');
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

test('setSpeed changes duration but keeps the source span', () => {
  const c = clip('V1', 0, 4, null, 0);
  reset([c]);
  E.setSpeed([c.id], 2);
  assert.strictEqual(c.speed, 2);
  assert.ok(Math.abs(c.duration - 2) < EPS, 'a 4 s clip at 200% lasts 2 s');
});

test('applyTransition puts the transition on the incoming clip and fades partner audio', () => {
  const v1 = clip('V1', 0, 2, 'L', 0);
  const a1 = clip('A1', 0, 2, 'L', 0);
  const v2 = clip('V1', 2, 2, 'M', 0);
  const a2 = clip('A1', 2, 2, 'M', 0);
  reset([v1, a1, v2, a2]);
  E.applyTransition(v2.id, 'dissolve', 'start');
  assert.strictEqual(v2.transIn.type, 'dissolve');
  assert.strictEqual(a2.transIn.type, 'audio-fade');
  assert.strictEqual(v1.transIn, null);
});

test('transitions cannot go on the wrong track kind', () => {
  const a = clip('A1', 0, 2, null, 0);
  reset([a]);
  assert.strictEqual(E.applyTransition(a.id, 'dissolve', 'start'), false);
});

test('copy and paste keep relative timing and link ids', () => {
  const v = clip('V1', 1, 2, 'L', 0);
  const a = clip('A1', 1, 2, 'L', 0);
  reset([v, a]);
  AVP.select([v.id], false);
  E.copySelection();
  E.paste(5, 'overwrite');
  const pasted = S.clips.filter((c) => c.start === 5);
  assert.strictEqual(pasted.length, 2);
  assert.ok(pasted[0].linkId && pasted[0].linkId === pasted[1].linkId, 'pasted pair is linked');
  assert.notStrictEqual(pasted[0].linkId, 'L', 'pasted pair gets a new link id');
});

test('markers stay sorted and reject duplicates', () => {
  reset([]);
  E.addMarker(5);
  E.addMarker(2);
  E.addMarker(2.001);
  assert.deepStrictEqual(S.markers.map((m) => m.t), [2, 5]);
});

test('adding and removing tracks keeps the order list consistent', () => {
  reset([]);
  const id = E.addTrack('video', 'V1', 'above');
  assert.ok(S.tracks[id] && S.trackOrder.indexOf(id) < S.trackOrder.indexOf('V1'));
  E.removeTrack(id);
  assert.strictEqual(S.tracks[id], undefined);
  assert.ok(S.trackOrder.indexOf(id) === -1);
});

/* ---------- effects, keyframes, transitions (pure maths) ---------- */

test('keyframes interpolate linearly and hold outside their range', () => {
  const keys = [{ t: 1, v: 0 }, { t: 3, v: 100 }];
  assert.strictEqual(AVP.evalKeys(keys, 0, 50), 0);
  assert.strictEqual(AVP.evalKeys(keys, 2, 50), 50);
  assert.strictEqual(AVP.evalKeys(keys, 9, 50), 100);
  assert.strictEqual(AVP.evalKeys(undefined, 2, 7), 7, 'no keys: base value');
});

test('setKey updates an existing key and keeps the list sorted', () => {
  const keys = [{ t: 2, v: 2 }];
  AVP.setKey(keys, 1, 1);
  AVP.setKey(keys, 2, 9);
  // JSON round trip: objects from the sandbox realm have a different prototype.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(keys)), [{ t: 1, v: 1 }, { t: 2, v: 9 }]);
});

test('a centred transition extends both clips around the cut', () => {
  const a = clip('V1', 0, 4, null, 0);
  const b = clip('V1', 4, 4, null, 0, { transIn: { type: 'dissolve', duration: 2 } });
  const list = [a, b];
  const Ra = AVP.roleWindows(a, list);
  const Rb = AVP.roleWindows(b, list);
  assert.ok(Math.abs(Rb.in.a - 3) < EPS && Math.abs(Rb.in.b - 5) < EPS, 'window is 3..5');
  assert.ok(Math.abs(Ra.ext1 - 5) < EPS, 'outgoing clip runs on to 5');
  assert.ok(Math.abs(Rb.ext0 - 3) < EPS, 'incoming clip starts at 3');
});

test('dissolve crossfades alpha from outgoing to incoming', () => {
  const a = clip('V1', 0, 4, null, 0);
  const b = clip('V1', 4, 4, null, 0, { transIn: { type: 'dissolve', duration: 2 } });
  const list = [a, b];
  const Ra = AVP.roleWindows(a, list);
  const Rb = AVP.roleWindows(b, list);
  assert.ok(Math.abs(AVP.visualAt(Ra, 4).alpha - 0.5) < 1e-6, 'outgoing half visible at the cut');
  assert.ok(Math.abs(AVP.visualAt(Rb, 4).alpha - 0.5) < 1e-6, 'incoming half visible at the cut');
  assert.ok(Math.abs(AVP.visualAt(Rb, 5).alpha - 1) < 1e-6, 'incoming fully visible after the window');
});

test('dip to black darkens the frame at the cut', () => {
  const a = clip('V1', 0, 4, null, 0);
  const b = clip('V1', 4, 4, null, 0, { transIn: { type: 'dip-black', duration: 2 } });
  const list = [a, b];
  const Rb = AVP.roleWindows(b, list);
  const mid = AVP.visualAt(Rb, 4);
  assert.ok(mid.before && mid.before.color === '#000000' && Math.abs(mid.before.alpha - 1) < 1e-6, 'black at the cut');
  assert.strictEqual(AVP.visualAt(Rb, 2.9).before, null, 'nothing before the window');
});

test('a single-sided fade in starts from the clip start', () => {
  const b = clip('V1', 0, 4, null, 0, { transIn: { type: 'dissolve', duration: 1 } });
  const R = AVP.roleWindows(b, [b]);
  assert.strictEqual(R.in.centered, false);
  assert.ok(Math.abs(AVP.visualAt(R, 0.5).alpha - 0.5) < 1e-6);
});

test('wipe reveals the incoming clip with a clip rectangle', () => {
  const a = clip('V1', 0, 4, null, 0);
  const b = clip('V1', 4, 4, null, 0, { transIn: { type: 'wipe-lr', duration: 2 } });
  const Rb = AVP.roleWindows(b, [a, b]);
  const v = AVP.visualAt(Rb, 4);
  assert.ok(v.clip && Math.abs(v.clip.w - 0.5) < 1e-6, 'half the frame is revealed at the cut');
});

test('audio fade ramps gain across the boundary', () => {
  const a = clip('A1', 0, 4, null, 0);
  const b = clip('A1', 4, 4, null, 0, { transIn: { type: 'audio-fade', duration: 2 } });
  const list = [a, b];
  assert.ok(Math.abs(AVP.audioRamp(AVP.roleWindows(b, list), 4) - 0.5) < 1e-6);
  assert.ok(Math.abs(AVP.audioRamp(AVP.roleWindows(a, list), 4) - 0.5) < 1e-6);
});

test('filter string combines colour and blur effects in order', () => {
  const c = clip('V1', 0, 4, null, 0, {
    fx: [
      { id: 'f1', type: 'brightness', enabled: true, params: { brightness: 20, contrast: 0 } },
      { id: 'f2', type: 'blur', enabled: true, params: { radius: 4 } },
      { id: 'f3', type: 'grayscale', enabled: false, params: { amount: 100 } },
    ],
  });
  const f = AVP.buildFilter(c, 1);
  // contrast 0 is the neutral value, so it is left out of the filter.
  assert.strictEqual(f, 'brightness(1.200) blur(4.00px)');
  assert.strictEqual(AVP.buildFilter(clip('V1', 0, 1, null, 0), 0), 'none');
});

test('keyframed effect parameters animate the filter', () => {
  const fx = { id: 'f1', type: 'blur', enabled: true, params: { radius: 0 } };
  const c = clip('V1', 0, 4, null, 0, { fx: [fx], keys: { 'fx:f1:radius': [{ t: 0, v: 0 }, { t: 2, v: 10 }] } });
  assert.strictEqual(AVP.buildFilter(c, 1), 'blur(5.00px)');
});

test('old v1.0 projects migrate opacity, scale and volume to percentages', () => {
  const old = AVP.normalizeClip({ id: 'x', track: 'V1', start: 0, duration: 1, inPoint: 0, opacity: 0.5, scale: 2, volume: 0.25 });
  assert.strictEqual(old.props.opacity, 50);
  assert.strictEqual(old.props.scale, 200);
  assert.strictEqual(old.props.volume, 25);
  assert.strictEqual(old.speed, 1);
});

test('title presets and text defaults are complete', () => {
  assert.ok(AVP.TITLE_PRESETS.length >= 5);
  AVP.TITLE_PRESETS.forEach((p) => {
    const t = Object.assign({}, AVP.TEXT_DEFAULTS, p.text);
    assert.ok(t.text && t.size > 0, p.name);
  });
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
