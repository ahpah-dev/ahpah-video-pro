/*
 * Unit tests for effects, transitions and fonts (the model, not the drawing code).
 * Run with:  node tests/effects-test.js   (or `npm test`)
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
for (const file of ['state.js', 'effects.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const AVP = sandbox.AVP;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const NEW_EFFECTS = ['tint', 'drop-shadow', 'light-leak', 'lens-flare', 'scan-lines', 'letterbox'];
const NEW_TRANSITIONS = ['slide-in-bottom', 'slide-in-top', 'spin', 'wipe-diag', 'wipe-box', 'iris'];

test('each new effect has a name, a category and parameters with sensible defaults', () => {
  NEW_EFFECTS.forEach((type) => {
    const def = AVP.EFFECTS[type];
    assert.ok(def, type + ' is defined');
    assert.ok(def.name && def.cat, type + ' has a name and category');
    assert.ok(def.params.length > 0, type + ' has parameters');
    def.params.forEach((p) => {
      assert.ok(p.min <= p.def && p.def <= p.max, type + '.' + p.k + ' default is inside its range');
    });
  });
});

test('creating a new effect fills in its default parameters', () => {
  const fx = AVP.createEffect('light-leak');
  assert.strictEqual(fx.params.amount, 0, 'light leak starts switched off');
  assert.strictEqual(fx.params.size, 70);
  assert.strictEqual(fx.enabled, true);
});

test('each new transition is listed under a category and is a picture transition', () => {
  NEW_TRANSITIONS.forEach((type) => {
    const t = AVP.TRANSITIONS[type];
    assert.ok(t, type + ' is defined');
    assert.ok(t.name && t.cat, type + ' has a name and category');
    assert.strictEqual(t.audio, false, type + ' is not an audio transition');
  });
  const video = AVP.transitionsFor('video');
  NEW_TRANSITIONS.forEach((type) => assert.ok(video.indexOf(type) >= 0, type + ' is offered on video tracks'));
  assert.ok(AVP.transitionsFor('audio').indexOf('iris') < 0, 'picture transitions are not offered on audio tracks');
});

// A transition window running from a at time 0 to b at time 1 (a centred cut, the common case).
const windowRole = (type, centered) => ({ type, centered, a: 0, b: 1 });

test('slide-in-bottom moves the incoming picture up from below the frame', () => {
  const start = AVP.visualAt({ in: windowRole('slide-in-bottom', true), out: null }, 0);
  const end = AVP.visualAt({ in: windowRole('slide-in-bottom', true), out: null }, 0.999999);
  assert.ok(start.dy > 0.99, 'starts one frame below');
  assert.ok(Math.abs(end.dy) < 0.01, 'ends in place');
});

test('slide-in-top comes in from above', () => {
  const start = AVP.visualAt({ in: windowRole('slide-in-top', true), out: null }, 0);
  assert.ok(start.dy < -0.99, 'starts one frame above');
});

test('spin turns the incoming picture into place while it fades in', () => {
  const start = AVP.visualAt({ in: windowRole('spin', true), out: null }, 0);
  const mid = AVP.visualAt({ in: windowRole('spin', true), out: null }, 0.5);
  assert.ok(Math.abs(start.rot + 180) < 1e-6, 'starts turned back 180 degrees');
  assert.strictEqual(start.alpha, 0, 'starts invisible');
  assert.ok(Math.abs(mid.rot + 90) < 1e-6, 'halfway through it is 90 degrees out');
});

test('wipe and iris transitions carry a mask with their progress', () => {
  ['wipe-diag', 'wipe-box', 'iris'].forEach((type) => {
    const v = AVP.visualAt({ in: windowRole(type, true), out: null }, 0.25);
    assert.ok(v.mask, type + ' sets a mask');
    assert.strictEqual(v.mask.type, type, type + ' names its mask');
    assert.ok(Math.abs(v.mask.p - 0.25) < 1e-9, type + ' mask follows the progress');
  });
});

test('a picture with no transition has no mask and no rotation', () => {
  const v = AVP.visualAt({ in: null, out: null }, 0.5);
  assert.strictEqual(v.mask, null);
  assert.strictEqual(v.rot, 0);
});

test('font list is empty and no font counts as installed where there is no document', () => {
  assert.strictEqual(AVP.fontInstalled('Arial'), false, 'no canvas without a document');
  assert.ok(Array.isArray(AVP.fontList()), 'list is an array');
  assert.strictEqual(AVP.fontList().length, 0, 'nothing listed without a document');
});

test('the candidate font list has no duplicates', () => {
  const list = AVP.FONT_CANDIDATES;
  assert.strictEqual(new Set(list).size, list.length, 'each font is listed once');
  assert.ok(list.indexOf('Arial') >= 0 && list.indexOf('Segoe UI') >= 0, 'common Windows fonts are included');
});

test('restoring a project with no imported fonts leaves the list empty', async () => {
  const loaded = await AVP.restoreCustomFonts(undefined);
  assert.ok(Array.isArray(loaded));
  assert.strictEqual(AVP.customFonts.length, 0);
});

test('restoring a project keeps only entries that have a name and data', async () => {
  await AVP.restoreCustomFonts([{ name: 'Good', data: 'data:font/ttf;base64,AAAA' }, { name: '' }, null]);
  assert.strictEqual(AVP.customFonts.length, 1);
  assert.strictEqual(AVP.customFonts[0].name, 'Good');
  await AVP.restoreCustomFonts([]);
});

test('the new transitions are picture transitions with names and categories', () => {
  ['zoom-through', 'whip-pan', 'blur-dissolve', 'clock-wipe', 'checker-wipe', 'random-blocks', 'blinds'].forEach((type) => {
    const t = AVP.TRANSITIONS[type];
    assert.ok(t && t.name && t.cat, type + ' is defined');
    assert.strictEqual(t.audio, false);
  });
  assert.ok(AVP.transitionsFor('video').indexOf('blinds') >= 0, 'offered on video tracks');
});

test('blur dissolve fades and blurs the incoming clip, and the outgoing one the other way', () => {
  const inV = AVP.visualAt({ in: windowRole('blur-dissolve', true), out: null }, 0.5);
  assert.ok(Math.abs(inV.alpha - 0.5) < 1e-9, 'incoming alpha follows progress');
  assert.ok(Math.abs(inV.blur - 7) < 1e-9, 'incoming blur is 14 px at the start, 0 at the end');
  const outV = AVP.visualAt({ in: null, out: windowRole('blur-dissolve', true) }, 0.5);
  assert.ok(Math.abs(outV.alpha - 0.5) < 1e-9);
  assert.ok(Math.abs(outV.blur - 7) < 1e-9);
});

test('zoom through scales the incoming clip in from larger, and the outgoing clip out to larger', () => {
  const start = AVP.visualAt({ in: windowRole('zoom-through', true), out: null }, 0);
  const end = AVP.visualAt({ in: windowRole('zoom-through', true), out: null }, 0.999999);
  assert.ok(Math.abs(start.scale - 1.6) < 1e-6, 'starts at 1.6 times');
  assert.ok(Math.abs(end.scale - 1) < 1e-3, 'ends at the normal size');
  const out = AVP.visualAt({ in: null, out: windowRole('zoom-through', true) }, 0.5);
  assert.ok(Math.abs(out.scale - 1.3) < 1e-9, 'outgoing grows to 1.6 times over the transition');
});

test('whip pan moves the picture and blurs most in the middle of the transition', () => {
  const start = AVP.visualAt({ in: windowRole('whip-pan', true), out: null }, 0);
  const mid = AVP.visualAt({ in: windowRole('whip-pan', true), out: null }, 0.5);
  assert.ok(Math.abs(start.dx - 1) < 1e-9, 'starts one frame to the side');
  assert.ok(Math.abs(mid.blur - 24) < 1e-6, 'most blur halfway');
  assert.strictEqual(AVP.visualAt({ in: windowRole('whip-pan', true), out: null }, 0.999999).blur < 0.01, true, 'no blur at the end');
});

test('the wipe shapes set a mask with their progress', () => {
  ['clock-wipe', 'checker-wipe', 'random-blocks', 'blinds'].forEach((type) => {
    const v = AVP.visualAt({ in: windowRole(type, true), out: null }, 0.4);
    assert.ok(v.mask && v.mask.type === type, type + ' sets its mask');
    assert.ok(Math.abs(v.mask.p - 0.4) < 1e-9, type + ' mask follows progress');
  });
});

test('a drop next to a cut is centred on the cut, a drop elsewhere is at the clip edge', () => {
  const a = { id: 'a', track: 'V1', start: 0, duration: 4 };
  const b = { id: 'b', track: 'V1', start: 4, duration: 4 };
  const list = [a, b];
  const nearCut = AVP.transitionDropPlan(list, b, 3, 100, 12, 1); // pointer 3 px into b, b touches a
  assert.strictEqual(nearCut.edge, 'start');
  assert.strictEqual(nearCut.centered, true);
  assert.ok(Math.abs(nearCut.span[0] - 3.5) < 1e-9 && Math.abs(nearCut.span[1] - 4.5) < 1e-9, 'centred on 4 s, 1 s long');
  const endOfA = AVP.transitionDropPlan(list, a, 97, 100, 12, 1); // 3 px from a's right edge, b touches it
  assert.strictEqual(endOfA.edge, 'end');
  assert.strictEqual(endOfA.centered, true);
  assert.ok(Math.abs(endOfA.span[0] - 3.5) < 1e-9, 'the same cut, seen from the left clip');
  const single = { id: 'c', track: 'V1', start: 0, duration: 10 };
  const start = AVP.transitionDropPlan([single], single, 20, 100, 12, 1);
  assert.strictEqual(start.edge, 'start', 'left half is the start');
  assert.strictEqual(start.centered, false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(start.span)), [0, 1]);
  const end = AVP.transitionDropPlan([single], single, 80, 100, 12, 1);
  assert.strictEqual(end.edge, 'end', 'right half is the end');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(end.span)), [9, 10]);
});

test('a drop in the middle of a clip with no neighbour still lands on its nearer edge', () => {
  const solo = { id: 'd', track: 'V1', start: 2, duration: 6 };
  const p = AVP.transitionDropPlan([solo], solo, 49, 100, 12, 1);
  assert.strictEqual(p.edge, 'start');
  assert.ok(Math.abs(p.span[0] - 2) < 1e-9);
});

// Tests run one after another, so the async font tests cannot see each other's changes.
(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('ok   - ' + t.name);
    } catch (err) {
      failed++;
      console.log('FAIL - ' + t.name);
      console.log('       ' + err.message.split('\n').join('\n       '));
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exitCode = failed ? 1 : 0;
})();
