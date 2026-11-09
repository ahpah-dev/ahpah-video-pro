/*
 * Unit tests for loudness (LUFS), the level envelope and the reverb impulse.
 * Run with:  node tests/audio-test.js   (or `npm test`)
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
for (const file of ['state.js', 'loudness.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const L = sandbox.AVP.loudness;
const FS = 48000;
const SECONDS = 5;

function sine(amp, hz, seconds) {
  hz = hz || 1000;
  const n = Math.round(FS * (seconds || SECONDS));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / FS);
  return x;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('loudness rises by 6 dB when the level doubles', () => {
  const a = L.integratedLufs([sine(1), sine(1)], FS);
  const b = L.integratedLufs([sine(0.5), sine(0.5)], FS);
  assert.ok(Math.abs(a - b - 6.02) < 0.05, `difference ${a - b}`);
});

test('a full-scale 1 kHz stereo sine measures near the BS.1770 reference', () => {
  // Two channels at full scale: -0.691 + 10 log10(2 * 0.5) = -0.69 LUFS before the K-weight shelf.
  const v = L.integratedLufs([sine(1), sine(1)], FS);
  assert.ok(v > -1.2 && v < 0.5, `value ${v}`);
});

test('silence has no loudness (null, not a number)', () => {
  assert.strictEqual(L.integratedLufs([new Float32Array(FS * 2)], FS), null);
});

test('very quiet passages below the absolute gate do not pull the loudness down', () => {
  const loud = sine(0.5);
  const quiet = new Float32Array(FS * 5).map((_, i) => (i % 2 ? 1e-6 : -1e-6));
  const both = new Float32Array(loud.length * 2);
  both.set(loud, 0);
  both.set(quiet.subarray(0, loud.length), loud.length);
  const alone = L.integratedLufs([loud], FS);
  const mixed = L.integratedLufs([both], FS);
  assert.ok(Math.abs(alone - mixed) < 0.6, `alone ${alone} mixed ${mixed}`);
});

test('the level envelope has 20 ms steps and a floor below the peak', () => {
  const env = L.levelEnvelope([sine(1)], FS);
  assert.strictEqual(env.hop, 0.02);
  assert.ok(Math.abs(env.env.length - SECONDS / 0.02) <= 1);
  assert.ok(env.floor < env.env[10] + 0.001 || env.floor <= Math.max(...env.env));
  assert.ok(env.env[10] > -6, 'a full-scale sine is loud in the envelope');
});

test('the envelope floor is quiet for a clip with a quiet noise floor', () => {
  const x = new Float32Array(FS * 4);
  for (let i = 0; i < x.length; i++) x[i] = i > FS * 2 ? 0.5 * Math.sin(i / 10) : 0.001 * Math.sin(i / 3);
  const env = L.levelEnvelope([x], FS);
  assert.ok(env.floor < -40, `floor ${env.floor}`);
});

test('the reverb impulse decays over its length', () => {
  const ir = L.roomImpulse(FS, 1.5, 4);
  assert.strictEqual(ir.left.length, Math.round(FS * 1.5));
  const energy = (a, from, to) => {
    let s = 0;
    for (let i = from; i < to; i++) s += a[i] * a[i];
    return s;
  };
  const early = energy(ir.left, 0, FS / 4);
  const late = energy(ir.left, Math.round(FS * 1.25), Math.round(FS * 1.5));
  assert.ok(late < early, 'late part is quieter than the early part');
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
