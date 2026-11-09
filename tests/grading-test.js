/*
 * Unit tests for Lumetri Color and Essential Sound settings (the model, not the GPU code).
 * Run with:  node tests/grading-test.js   (or `npm test`)
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

function clip(extra) {
  return AVP.normalizeClip(Object.assign({ id: 'g' + Math.random(), track: 'V1', start: 0, duration: 4, inPoint: 0, mediaId: 'm' }, extra || {}));
}

test('Lumetri Color is a known effect with the grading controls', () => {
  const def = AVP.EFFECTS.lumetri;
  assert.ok(def, 'lumetri defined');
  const keys = def.params.map((p) => p.k);
  ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'saturation', 'temperature', 'tint', 'vibrance', 'fade'].forEach((k) =>
    assert.ok(keys.indexOf(k) >= 0, 'has ' + k)
  );
  assert.strictEqual(AVP.effectParamDef('lumetri', 'exposure').step, 0.1, 'exposure moves in tenths of a stop');
});

test('a new Lumetri effect starts neutral', () => {
  const fx = AVP.createEffect('lumetri');
  assert.strictEqual(fx.params.saturation, 100);
  assert.strictEqual(fx.params.exposure, 0);
  assert.strictEqual(fx.params.contrast, 0);
});

test('without WebGL, Lumetri falls back to CSS filters for exposure, contrast and saturation', () => {
  AVP.gpuOk = false;
  const c = clip({ fx: [{ id: 'l1', type: 'lumetri', enabled: true, params: { exposure: 1, contrast: 20, saturation: 50 } }] });
  const f = AVP.buildFilter(c, 0);
  assert.ok(f.indexOf('brightness(2.000)') >= 0, f);
  assert.ok(f.indexOf('contrast(1.200)') >= 0, f);
  assert.ok(f.indexOf('saturate(0.500)') >= 0, f);
});

test('with WebGL, Lumetri is left to the shader (no CSS filter duplication)', () => {
  AVP.gpuOk = true;
  const c = clip({ fx: [{ id: 'l1', type: 'lumetri', enabled: true, params: { exposure: 1, contrast: 20, saturation: 50 } }] });
  assert.strictEqual(AVP.buildFilter(c, 0), 'none');
  AVP.gpuOk = false;
});

test('Essential Sound defaults are neutral until something is changed', () => {
  const snd = AVP.soundOf(clip());
  assert.strictEqual(snd.enabled, true);
  assert.strictEqual(snd.lowCut, 20, 'low cut at the bottom of its range is transparent');
  assert.strictEqual(snd.presence, 0);
  assert.strictEqual(snd.compress, false);
});

test('applying a dialogue preset sets its values and keeps the enabled choice', () => {
  const c = clip({ sound: { enabled: false, autoMatch: true } });
  AVP.applySoundPreset(c, 'dialogue');
  const snd = AVP.soundOf(c);
  assert.strictEqual(snd.type, 'dialogue');
  assert.strictEqual(snd.lowCut, AVP.SOUND_PRESETS.dialogue.lowCut);
  assert.strictEqual(snd.presence, AVP.SOUND_PRESETS.dialogue.presence);
  assert.strictEqual(snd.compress, true);
  assert.strictEqual(snd.enabled, false, 'the on / off choice survives a preset change');
  assert.strictEqual(snd.autoMatch, true);
});

test('every Essential Sound type has a target loudness and a low cut', () => {
  Object.keys(AVP.SOUND_PRESETS).forEach((k) => {
    const p = AVP.SOUND_PRESETS[k];
    assert.ok(p.target <= 0 && p.target >= -40, k + ' target');
    assert.ok(p.lowCut >= 20 && p.lowCut <= 300, k + ' low cut');
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
