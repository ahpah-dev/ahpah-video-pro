/*
 * Unit tests for captions: SRT reading and writing, and placing caption clips on the CC track.
 * Run with:  node tests/captions-test.js   (or `npm test`)
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
for (const file of ['state.js', 'effects.js', 'edits.js', 'captions.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
sandbox.AVP.refresh = () => {};
sandbox.AVP.toast = () => {};

const AVP = sandbox.AVP;
const S = AVP.state;
const EPS = 1e-3;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function reset() {
  S.clips = [];
  S.selection = [];
  S.tracks = AVP.newTrackSet().tracks;
  S.trackOrder = AVP.newTrackSet().order;
  S.markers = [];
  S.fps = 30;
  S.media = [];
}

const SAMPLE = '1\n00:00:01,000 --> 00:00:03,500\nHello there\n\n2\n00:00:04,000 --> 00:00:06,250\nSecond line one\nsecond line two\n';

test('reads SRT blocks with times in seconds and multi-line text', () => {
  const items = AVP.parseSRT(SAMPLE);
  assert.strictEqual(items.length, 2);
  assert.ok(Math.abs(items[0].start - 1) < EPS && Math.abs(items[0].end - 3.5) < EPS, 'first caption times');
  assert.strictEqual(items[0].text, 'Hello there');
  assert.strictEqual(items[1].text, 'Second line one\nsecond line two', 'two lines stay in one caption');
});

test('reads BOM, Windows line endings, dots before milliseconds and missing index numbers', () => {
  const src = '﻿00:00:02.500 --> 00:00:04.000\r\nNo index here\r\n\r\n3\r\n00:00:05,1 --> 00:00:06,0\r\nShort ms\r\n';
  const items = AVP.parseSRT(src);
  assert.strictEqual(items.length, 2);
  assert.ok(Math.abs(items[0].start - 2.5) < EPS, 'dot before milliseconds');
  assert.strictEqual(items[0].text, 'No index here');
  assert.ok(Math.abs(items[1].start - 5.1) < EPS, 'one-digit milliseconds mean tenths');
});

test('ignores blocks without a time line and captions that end before they start', () => {
  const items = AVP.parseSRT('hello\n\n1\n00:00:04,000 --> 00:00:02,000\nbackwards\n\n2\n00:00:07,000 --> 00:00:08,000\nfine\n');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].text, 'fine');
});

test('writes SRT that reads back to the same captions', () => {
  const items = AVP.parseSRT(SAMPLE);
  const back = AVP.parseSRT(AVP.formatSRT(items));
  assert.strictEqual(back.length, items.length);
  back.forEach((b, i) => {
    assert.ok(Math.abs(b.start - items[i].start) < EPS && Math.abs(b.end - items[i].end) < EPS, 'times');
    assert.strictEqual(b.text, items[i].text);
  });
  assert.ok(AVP.formatSRT(items).startsWith('1\n00:00:01,000 --> 00:00:03,500\nHello there'), 'SRT layout');
});

test('captions go on the CC track above the video and never overwrite it', () => {
  reset();
  S.clips.push(AVP.normalizeClip({ kind: 'media', mediaId: 'm1', track: 'V1', start: 0, duration: 10, inPoint: 0 }));
  AVP.captions.placeCaption(2, 3, 'Over the picture');
  const video = S.clips.find((c) => c.track === 'V1');
  assert.strictEqual(video.duration, 10, 'the video clip is untouched');
  const cap = AVP.captions.list()[0];
  assert.strictEqual(cap.track, 'CC');
  assert.strictEqual(S.trackOrder[0], 'CC', 'the caption track is the top track');
  assert.strictEqual(cap.text.text, 'Over the picture');
});

test('older projects without a CC track get one when a caption is added', () => {
  reset();
  delete S.tracks.CC;
  S.trackOrder = S.trackOrder.filter((id) => id !== 'CC');
  AVP.captions.placeCaption(0, 2, 'Added later');
  assert.ok(S.tracks.CC && S.tracks.CC.caption, 'CC track created');
  assert.strictEqual(AVP.captions.list().length, 1);
});

test('captions are listed in time order', () => {
  reset();
  AVP.captions.placeCaption(5, 1, 'late');
  AVP.captions.placeCaption(1, 1, 'early');
  assert.deepStrictEqual(AVP.captions.list().map((c) => c.text.text), ['early', 'late']);
});

test('moving a caption over another cuts that other caption back', () => {
  reset();
  AVP.captions.placeCaption(0, 4, 'first');
  const second = AVP.captions.placeCaption(6, 2, 'second');
  AVP.captions.setTimes(second.id, 2, 5);
  const list = AVP.captions.list();
  assert.strictEqual(list.length, 2);
  assert.ok(Math.abs(list[0].start + list[0].duration - 2) < EPS, 'the first caption now ends where the second starts');
  assert.ok(Math.abs(list[1].start - 2) < EPS && Math.abs(list[1].duration - 3) < EPS, 'the moved caption has its new times');
});

test('a caption keeps the style chosen for new captions', () => {
  reset();
  AVP.captionStyle.size = 64;
  AVP.captionStyle.position = 'top';
  const c = AVP.captions.placeCaption(0, 2, 'styled');
  assert.strictEqual(c.text.size, 64);
  assert.strictEqual(c.props.y, -38, 'top position');
  AVP.captionStyle.size = 50;
  AVP.captionStyle.position = 'bottom';
});

let failed = 0;
(async () => {
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
