/*
 * Unit tests for the effects, transitions and looks added in 1.24 (the model, not the drawing code).
 * Run with:  node tests/newfx-test.js   (or `npm test`)
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

const EFFECTS = ['chromatic', 'glitch', 'vhs', 'wave', 'mirror', 'radial-blur', 'duotone', 'threshold', 'night-vision', 'shake', 'ken-burns'];
const TRANSITIONS = ['flash', 'cross-zoom', 'barn-doors', 'barn-doors-v', 'diamond-wipe', 'star-wipe', 'bounce-in', 'spin-zoom', 'whip-pan-up', 'glitch'];
const MASKS = ['barn-doors', 'barn-doors-v', 'diamond-wipe', 'star-wipe'];

// A transition window running from 0 to 1 (a centred cut) or from the clip's edge.
const win = (type, centered) => ({ type, centered: !!centered, a: 0, b: 1 });
const inV = (type, p, centered) => AVP.visualAt({ in: win(type, centered), out: null }, p);
const outV = (type, p, centered) => AVP.visualAt({ in: null, out: win(type, centered) }, p);

test('each new effect has a name, a category and parameters whose defaults are in range', () => {
  EFFECTS.forEach((type) => {
    const def = AVP.EFFECTS[type];
    assert.ok(def, type + ' is defined');
    assert.ok(def.name && def.cat, type + ' has a name and category');
    assert.ok(def.params.length > 0, type + ' has parameters');
    def.params.forEach((p) => assert.ok(p.min <= p.def && p.def <= p.max, `${type}.${p.k} default is inside its range`));
  });
});

test('new effects start visible: their main amount is not zero', () => {
  ['chromatic', 'glitch', 'vhs', 'wave', 'radial-blur', 'duotone', 'shake'].forEach((type) => {
    const fx = AVP.createEffect(type);
    const main = fx.params.amount;
    assert.ok(main > 0, type + ' has a default amount above zero');
  });
  assert.ok(AVP.createEffect('ken-burns').params.end > AVP.createEffect('ken-burns').params.start, 'Ken Burns zooms in by default');
});

test('each new transition is a picture transition with a name and category', () => {
  TRANSITIONS.forEach((type) => {
    const t = AVP.TRANSITIONS[type];
    assert.ok(t && t.name && t.cat, type + ' is defined');
    assert.strictEqual(t.audio, false, type + ' is not an audio transition');
    assert.ok(AVP.transitionsFor('video').indexOf(type) >= 0, type + ' is offered on video tracks');
    assert.ok(AVP.transitionsFor('audio').indexOf(type) < 0, type + ' is not offered on audio tracks');
  });
});

test('the new wipe shapes set a mask that follows the progress, in and out', () => {
  MASKS.forEach((type) => {
    const v = inV(type, 0.3, true);
    assert.ok(v.mask && v.mask.type === type && Math.abs(v.mask.p - 0.3) < 1e-9, type + ' mask on the incoming clip');
    assert.strictEqual(outV(type, 0.3, true).mask, null, type + ' leaves the outgoing clip unmasked at a cut');
    assert.ok(Math.abs(outV(type, 0.25, false).alpha - 0.75) < 1e-9, type + ' fades out an edge transition');
  });
});

test('flash: the picture switches at the middle under a white pulse that peaks there', () => {
  assert.strictEqual(inV('flash', 0.25, true).alpha, 0);
  assert.strictEqual(inV('flash', 0.75, true).alpha, 1);
  assert.strictEqual(outV('flash', 0.25, true).alpha, 1);
  assert.strictEqual(outV('flash', 0.75, true).alpha, 0);
  const peak = inV('flash', 0.5, true).before;
  assert.ok(peak && peak.color === '#ffffff' && Math.abs(peak.alpha - 1) < 1e-9, 'fully white at the cut');
  assert.ok(inV('flash', 0.05, true).before.alpha < 0.5, 'dark at the start of the pulse');
});

test('cross zoom dissolves while zooming and blurring, and ends clean', () => {
  const start = inV('cross-zoom', 0, true);
  assert.ok(Math.abs(start.scale - 2) < 1e-9 && start.alpha === 0 && Math.abs(start.blur - 18) < 1e-9, 'starts 2x, invisible, blurred');
  const end = inV('cross-zoom', 0.999999, true);
  assert.ok(Math.abs(end.scale - 1) < 1e-3 && end.blur < 0.01 && end.alpha > 0.99, 'ends at normal size, sharp, opaque');
  const out = outV('cross-zoom', 0.5, true);
  assert.ok(Math.abs(out.scale - 1.5) < 1e-9 && Math.abs(out.alpha - 0.5) < 1e-9, 'outgoing grows and fades');
});

test('bounce in drops the picture from above and settles in place', () => {
  assert.ok(inV('bounce-in', 0, true).dy < -0.99, 'starts one frame above');
  assert.ok(Math.abs(inV('bounce-in', 0.999999, true).dy) < 0.01, 'ends in place');
});

test('spin zoom grows the incoming picture from nothing while it turns', () => {
  const start = inV('spin-zoom', 0, true);
  assert.strictEqual(start.scale, 0);
  assert.ok(Math.abs(start.rot + 360) < 1e-9, 'starts a full turn back');
  const end = inV('spin-zoom', 0.999999, true);
  assert.ok(Math.abs(end.scale - 1) < 1e-3 && Math.abs(end.rot) < 0.01);
});

test('whip pan up moves vertically and blurs most halfway', () => {
  assert.ok(Math.abs(inV('whip-pan-up', 0, true).dy - 1) < 1e-9, 'starts one frame below');
  assert.ok(Math.abs(inV('whip-pan-up', 0.5, true).blur - 24) < 1e-6, 'most blur halfway');
  assert.ok(inV('whip-pan-up', 0.999999, true).blur < 0.01, 'sharp at the end');
});

test('glitch transition is the same every time a moment is drawn, and settles at the end', () => {
  const a = inV('glitch', 0.37, true);
  const b = inV('glitch', 0.37, true);
  assert.deepStrictEqual(a, b, 'deterministic');
  const end = inV('glitch', 0.999999, true);
  assert.strictEqual(end.alpha, 1, 'fully visible at the end');
  assert.ok(Math.abs(end.dx) < 0.01, 'no jitter at the end');
  const flickers = new Set();
  for (let i = 0; i < 40; i++) flickers.add(inV('glitch', i / 40, true).alpha);
  assert.ok(flickers.has(0) && flickers.has(1), 'flickers between hidden and visible');
});

test('threshold and night vision build CSS filters; the level moves the threshold', () => {
  const clip = (type, params) => {
    const fx = AVP.createEffect(type);
    Object.assign(fx.params, params);
    return { start: 0, fx: [fx], keys: {} };
  };
  const lo = AVP.buildFilter(clip('threshold', { level: 25 }), 0);
  const hi = AVP.buildFilter(clip('threshold', { level: 75 }), 0);
  assert.ok(/grayscale\(1\)/.test(lo) && /contrast\(10000%\)/.test(lo));
  const b = (f) => parseFloat(/brightness\(([\d.]+)\)/.exec(f)[1]);
  assert.ok(Math.abs(b(lo) - 2) < 1e-3, 'level 25% brightens 2x so 25% grey lands on mid-grey');
  assert.ok(b(hi) < b(lo), 'a higher level darkens first');
  const nv = AVP.buildFilter(clip('night-vision', { gain: 200 }), 0);
  assert.ok(/hue-rotate/.test(nv) && /brightness\(2\.000\)/.test(nv), 'night vision is green with the chosen gain');
});

test('every look refers to real effects and parameters inside their ranges', () => {
  assert.ok(AVP.LOOKS.length >= 8);
  const names = new Set();
  AVP.LOOKS.forEach((look) => {
    assert.ok(look.name && !names.has(look.name), 'looks have unique names');
    names.add(look.name);
    assert.ok(look.fx.length > 0, look.name + ' has effects');
    look.fx.forEach(([type, params]) => {
      assert.ok(AVP.EFFECTS[type], `${look.name}: ${type} is an effect`);
      Object.keys(params).forEach((k) => {
        const d = AVP.effectParamDef(type, k);
        assert.ok(d, `${look.name}: ${type}.${k} is a parameter`);
        assert.ok(params[k] >= d.min && params[k] <= d.max, `${look.name}: ${type}.${k} is in range`);
      });
    });
  });
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log('ok   - ' + t.name);
  } catch (e) {
    failed++;
    console.log('FAIL - ' + t.name + '\n       ' + (e && e.message));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
