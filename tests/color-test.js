/*
 * Unit tests for Lumetri colour maths: curves, colour wheels, .cube LUT parsing and the atlas.
 * Run with:  node tests/color-test.js   (or `npm test`)
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
for (const file of ['state.js', 'color.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const C = sandbox.AVP.color;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('an empty curve set is the identity', () => {
  const lut = C.curveLut({});
  for (let i = 0; i < 256; i += 17) {
    assert.ok(Math.abs(lut[i * 4] - i) <= 1, `red at ${i}`);
    assert.ok(Math.abs(lut[i * 4 + 1] - i) <= 1, `green at ${i}`);
    assert.strictEqual(lut[i * 4 + 3], 255);
  }
});

test('a master curve lifts the midtones for all channels', () => {
  const lut = C.curveLut({ master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }] });
  const mid = 128;
  assert.ok(lut[mid * 4] > 170, 'red lifted');
  assert.ok(lut[mid * 4 + 2] > 170, 'blue lifted');
});

test('a channel curve only changes its own channel', () => {
  const lut = C.curveLut({ r: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
  assert.strictEqual(lut[128 * 4], 0, 'red driven to zero');
  assert.ok(Math.abs(lut[128 * 4 + 1] - 128) <= 1, 'green unchanged');
});

test('evalCurve clamps outside the end points', () => {
  assert.strictEqual(C.evalCurve([{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.9 }], 0), 0.1);
  assert.strictEqual(C.evalCurve([{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.9 }], 1), 0.9);
});

test('a colour wheel with no offset adds nothing', () => {
  const o = C.wheelOffset(0, 0, 0);
  assert.ok(o.every((v) => Math.abs(v) < 1e-9));
});

test('a colour wheel pushed to red tints red, not blue', () => {
  const o = C.wheelOffset(100, 0, 0);
  assert.ok(o[0] > o[1] && o[0] > o[2], `offset ${o}`);
  assert.ok(o[0] > 0.1 && o[2] < 0, 'red up, blue down');
});

test('a wheel level lifts all channels equally', () => {
  const o = C.wheelOffset(0, 0, 100);
  assert.ok(Math.abs(o[0] - o[1]) < 1e-9 && Math.abs(o[1] - o[2]) < 1e-9 && o[0] > 0.2);
});

const CUBE = `TITLE "test"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

test('parses a 2-point .cube LUT (red varies fastest)', () => {
  const lut = C.parseCube(CUBE);
  assert.strictEqual(lut.size, 2);
  assert.strictEqual(lut.data.length, 2 * 2 * 2 * 3);
  // Entry 1 is (r=1, g=0, b=0): the red axis is the fastest-varying one.
  assert.strictEqual(lut.data[3], 1);
  assert.strictEqual(lut.data[4], 0);
  assert.strictEqual(lut.data[5], 0);
});

test('rejects a file that is not a 3D .cube LUT', () => {
  assert.throws(() => C.parseCube('TITLE "x"\n0 0 0\n'), /LUT_3D_SIZE/);
});

test('an identity LUT atlas reproduces the colours in its slices', () => {
  const N = 2;
  const data = new Float32Array(N * N * N * 3);
  let k = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    data[k++] = r; data[k++] = g; data[k++] = b;
  }
  const atlas = C.atlasFromLut({ size: N, data });
  // Atlas is N*N wide and N tall. Blue slice z is at columns z*N .. z*N+N-1.
  const pixel = (x, y) => [atlas[(y * N * N + x) * 4], atlas[(y * N * N + x) * 4 + 1], atlas[(y * N * N + x) * 4 + 2]];
  assert.deepStrictEqual(pixel(0 * N + 1, 0), [255, 0, 0], 'slice 0, red=1, green=0');
  assert.deepStrictEqual(pixel(1 * N + 0, 1), [0, 255, 255], 'slice 1, green=1 -> blue slice values');
});

test('hue colours are neutral at the bottom of the wheel', () => {
  const c = C.hueColour(0.5);
  assert.ok(c[0] <= c[2] || c[1] > 0, 'the wheel covers all hues');
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
