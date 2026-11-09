/*
 * Unit tests for speed ramps (time remapping) and the title animations added in 1.25.
 * Run with:  node tests/ramp-test.js   (or `npm test`)
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
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg || ''} expected ${b}, got ${a}`);
const clip = (o) => Object.assign({ start: 0, inPoint: 0, duration: 4, speed: 1, keys: {} }, o);

/* ---------- speed ramps ---------- */

test('with no ramp the source time is simply time x speed', () => {
  const c = clip({ speed: 2 });
  assert.strictEqual(AVP.hasRamp(c), false);
  near(AVP.srcOffset(c, 1.5), 3);
  near(AVP.speedAt(c, 1), 2);
  near(AVP.timeForSrc(c, 6), 3);
});

test('a flat ramp scales the speed; the base speed multiplies the ramp', () => {
  const c = clip({ speed: 2, keys: { speed: [{ t: 0, v: 50 }, { t: 4, v: 50 }] } });
  near(AVP.speedAt(c, 2), 1, 'half of 2x is 1x');
  near(AVP.srcOffset(c, 3), 3);
});

test('a straight ramp from 100% to 300% uses the area under the line', () => {
  const c = clip({ keys: { speed: [{ t: 0, v: 100 }, { t: 4, v: 300 }] } });
  near(AVP.speedAt(c, 2), 2, 'speed at the middle');
  near(AVP.srcOffset(c, 2), 3, 'first half: average speed 1.5 for 2 s');
  near(AVP.srcOffset(c, 4), 8, 'whole clip: average speed 2 for 4 s');
});

test('the speed holds before the first key and after the last', () => {
  const c = clip({ keys: { speed: [{ t: 1, v: 200 }, { t: 3, v: 200 }] } });
  near(AVP.srcOffset(c, 0.5), 1, 'held at 200% before the first key');
  near(AVP.srcOffset(c, 4), 8, '200% all the way');
  near(AVP.srcOffset(c, -1), -2, 'a negative time (a head trimmed longer) holds the first speed');
});

test('srcOffset is continuous and increasing, and timeForSrc undoes it', () => {
  const c = clip({ duration: 6, keys: { speed: [{ t: 0, v: 100 }, { t: 1.5, v: 400 }, { t: 3, v: 25 }, { t: 6, v: 150 }] } });
  let prev = -1;
  for (let t = 0; t <= 6; t += 0.1) {
    const v = AVP.srcOffset(c, t);
    assert.ok(v > prev, 'strictly increasing at ' + t);
    prev = v;
  }
  [0.4, 1, 2.2, 5].forEach((span) => near(AVP.srcOffset(c, AVP.timeForSrc(c, span)), span, 'inverse of ' + span, 1e-6));
});

test('cutting a ramped clip loses no source time and shows no jump at the cut', () => {
  const c = clip({ duration: 6, inPoint: 2, keys: { speed: [{ t: 0, v: 100 }, { t: 2, v: 300 }, { t: 6, v: 40 }] } });
  const at = 2.7;
  const right = clip({ start: at, duration: 6 - at, inPoint: c.inPoint + AVP.srcOffset(c, at), keys: AVP.rangeKeys(c.keys, at, null) });
  const left = clip({ duration: at, inPoint: c.inPoint, keys: AVP.rangeKeys(c.keys, 0, at) });
  near(AVP.srcOffset(left, at) + AVP.srcOffset(right, 6 - at), AVP.srcOffset(c, 6), 'both halves use the whole clip source');
  near(AVP.speedAt(right, 0), AVP.speedAt(c, at), 'speed matches across the cut');
  near(right.inPoint, left.inPoint + AVP.srcOffset(left, at), 'the right piece starts where the left one ends');
});

test('every preset starts at 0, ends at the clip length, stays in range and in order', () => {
  assert.ok(AVP.SPEED_RAMPS.length >= 6);
  [1, 4, 12.5].forEach((d) => {
    AVP.SPEED_RAMPS.forEach((r) => {
      const k = r.make(d);
      assert.ok(r.name && k.length >= 2, r.name);
      near(k[0].t, 0, r.name + ' starts at 0');
      near(k[k.length - 1].t, d, r.name + ' ends at the clip length', 1e-3);
      k.forEach((p, i) => {
        assert.ok(p.v >= AVP.RAMP_MIN && p.v <= AVP.RAMP_MAX, `${r.name}: ${p.v}% in range`);
        if (i) assert.ok(p.t > k[i - 1].t, r.name + ' times increase');
      });
    });
  });
});

test('presets change how much source a clip uses: slow-down uses less, speed-up uses more', () => {
  const slow = clip({ keys: { speed: AVP.SPEED_RAMPS[0].make(4) } });
  const fast = clip({ keys: { speed: AVP.SPEED_RAMPS[1].make(4) } });
  assert.ok(AVP.srcOffset(slow, 4) < 4, 'slow down uses under 4 s of the file');
  assert.ok(AVP.srcOffset(fast, 4) > 4, 'speed up uses over 4 s');
});

/* ---------- title animations ---------- */

const ALL = AVP.TEXT_ANIMATIONS.map((a) => a.v).filter((v) => v !== 'none' && v !== 'wipe-reveal');
const opts = { dur: 0.5, delay: 0, stagger: 0.05, size: 100, total: 6 };

test('there are many more title animations, each with a label', () => {
  assert.ok(AVP.TEXT_ANIMATIONS.length >= 22, 'at least 22 entrance animations (was 11)');
  AVP.TEXT_ANIMATIONS.forEach((a) => assert.ok(a.v && a.label));
  assert.strictEqual(new Set(AVP.TEXT_ANIMATIONS.map((a) => a.v)).size, AVP.TEXT_ANIMATIONS.length, 'no duplicates');
  assert.ok(AVP.TEXT_OUT_ANIMATIONS.length >= 18);
  assert.ok(AVP.TEXT_OUT_ANIMATIONS.every((a) => ['wave', 'jitter', 'rainbow'].indexOf(a.v) < 0), 'no endless motion as an exit');
  assert.strictEqual(AVP.TEXT_DEFAULTS.animOut, 'none');
  assert.ok(AVP.TEXT_DEFAULTS.animOutDur > 0);
});

test('every animation hides a letter before its turn and shows it settled afterwards', () => {
  ALL.forEach((type) => {
    if (type === 'wave') return; // wave never hides
    const before = AVP.textUnitState(type, 0, 3, opts); // letter 3 starts at 0.15 s
    assert.ok(before.alpha < 0.01 || before.s === 0 || before.sx === 0 || before.alpha <= 0.15, `${type} is hidden before its turn`);
    const after = AVP.textUnitState(type, 5, 3, opts);
    assert.ok(Math.abs(after.alpha - 1) < 1e-9, `${type} ends fully visible`);
    if (type !== 'jitter' && type !== 'rainbow') {
      assert.ok(Math.abs(after.dx) < 1e-6 && Math.abs(after.dy) < 1e-6, `${type} ends in place`);
      assert.ok(Math.abs(after.s - 1) < 1e-6 && Math.abs(after.sx - 1) < 1e-6 && after.blur < 1e-6 && Math.abs(after.rot) < 1e-6, `${type} ends at full size, sharp`);
    }
  });
});

test('the new animations are the same every time a moment is drawn', () => {
  ['neon-flicker', 'jitter', 'rainbow', 'glitch'].forEach((type) => {
    assert.deepStrictEqual(AVP.textUnitState(type, 0.33, 2, opts), AVP.textUnitState(type, 0.33, 2, opts), type);
  });
});

test('slide, zoom, flip, blur and spread start where they should', () => {
  const s = (type, k) => AVP.textUnitState(type, 0.0001, k === undefined ? 0 : k, opts);
  assert.ok(s('letter-slide-left').dx < -100 && s('letter-slide-right').dx > 100, 'slides start off to the side');
  assert.ok(s('letter-zoom').s > 3, 'zoom starts big');
  assert.ok(s('letter-flip').sx < 0.01, 'flip starts edge-on');
  assert.ok(s('blur-in').blur > 20, 'blur starts blurred');
  assert.ok(s('spread', 0).dx < 0 && s('spread', 5).dx > 0, 'spread: left letters start to the left, right ones to the right');
  assert.ok(Math.abs(s('rainbow').hue) >= 0 || s('rainbow').hue === null, 'rainbow has a hue field');
});

test('rainbow cycles the colour over time and gives each letter its own shade', () => {
  const a = AVP.textUnitState('rainbow', 1, 0, opts).hue;
  const b = AVP.textUnitState('rainbow', 1.5, 0, opts).hue;
  const c2 = AVP.textUnitState('rainbow', 1, 3, opts).hue;
  assert.ok(typeof a === 'number' && a !== b && a !== c2);
});

test('word animations are marked as word based', () => {
  ['word-pop', 'word-rise', 'word-fade'].forEach((t) => assert.strictEqual(AVP.textAnimByWord(t), true));
  ['letter-pop', 'typewriter', 'none'].forEach((t) => assert.strictEqual(AVP.textAnimByWord(t), false));
});

test('an exit is an entrance played backwards: fully shown at its start, gone at its end', () => {
  const dur = 0.5;
  const stagger = 0.05;
  const total = 6;
  const len = (total - 1) * stagger + dur;
  const o = { dur, delay: 0, stagger, size: 100, total };
  AVP.TEXT_OUT_ANIMATIONS.filter((a) => ['none', 'wipe-reveal'].indexOf(a.v) < 0).forEach((a) => {
    for (let k = 0; k < total; k++) {
      const first = AVP.textUnitState(a.v, len - 0, total - 1 - k, o); // moment the exit begins
      assert.ok(Math.abs(first.alpha - 1) < 1e-9, `${a.v}: letter ${k} is fully shown when the exit begins`);
      const last = AVP.textUnitState(a.v, len - len, total - 1 - k, o); // moment the exit ends (local time 0)
      assert.ok(last.alpha < 0.01 || last.s === 0 || last.sx < 0.01 || last.alpha <= 0.15, `${a.v}: letter ${k} is gone when the exit ends`);
    }
  });
});

test('the first letter leaves first on an exit', () => {
  const o = { dur: 0.4, delay: 0, stagger: 0.1, size: 100, total: 5 };
  const len = 4 * 0.1 + 0.4;
  // A short way into the exit, letter 0 (mirrored index 4) is further along than the last letter.
  const x = 0.3;
  const first = AVP.textUnitState('letter-fade', len - x, 4, o).alpha;
  const lastL = AVP.textUnitState('letter-fade', len - x, 0, o).alpha;
  assert.ok(first < lastL, 'letter 0 fades before letter 4');
});

test('title presets use real animations', () => {
  const known = new Set(AVP.TEXT_ANIMATIONS.map((a) => a.v));
  const out = new Set(AVP.TEXT_OUT_ANIMATIONS.map((a) => a.v));
  assert.ok(AVP.TITLE_PRESETS.length >= 13);
  AVP.TITLE_PRESETS.forEach((p) => {
    if (p.text.anim) assert.ok(known.has(p.text.anim), p.name + ' entrance');
    if (p.text.animOut) assert.ok(out.has(p.text.animOut), p.name + ' exit');
  });
  assert.ok(AVP.TITLE_PRESETS.filter((p) => p.text.animOut).length >= 3, 'some presets have an exit');
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
