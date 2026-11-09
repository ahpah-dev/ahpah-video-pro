/*
 * AhPah Video Pro - audio analysis (pure functions, no DOM): integrated loudness in LUFS
 * (ITU-R BS.1770-4 K-weighting with gating), a short-term level envelope for the noise
 * gate, and a synthetic room impulse for the reverb. Used by the Essential Sound panel.
 */
(function () {
  'use strict';

  const AVP = window.AVP || (window.AVP = {});

  // K-weighting = a high shelf (head effect) followed by a high-pass (RLB), both as biquads.
  function kWeightCoefficients(fs) {
    // Stage 1: high shelf, +4 dB around 1.68 kHz.
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const A = Math.pow(10, G / 40);
    const w0 = (2 * Math.PI * f0) / fs;
    const cw = Math.cos(w0);
    const al = Math.sin(w0) / (2 * Q);
    const sA = Math.sqrt(A);
    let b = [A * (A + 1 + (A - 1) * cw + 2 * sA * al), -2 * A * (A - 1 + (A + 1) * cw), A * (A + 1 + (A - 1) * cw - 2 * sA * al)];
    let a = [A + 1 - (A - 1) * cw + 2 * sA * al, 2 * (A - 1 - (A + 1) * cw), A + 1 - (A - 1) * cw - 2 * sA * al];
    const stage1 = { b: b.map((x) => x / a[0]), a: [1, a[1] / a[0], a[2] / a[0]] };

    // Stage 2: high-pass at 38 Hz (RLB weighting).
    const f1 = 38.13547087602444;
    const Q2 = 0.5003270373238773;
    const w1 = (2 * Math.PI * f1) / fs;
    const c1 = Math.cos(w1);
    const al2 = Math.sin(w1) / (2 * Q2);
    const a0 = 1 + al2;
    const stage2 = { b: [(1 + c1) / 2 / a0, (-(1 + c1)) / a0, (1 + c1) / 2 / a0], a: [1, (-2 * c1) / a0, (1 - al2) / a0] };
    return [stage1, stage2];
  }

  // Runs a direct-form-I biquad over x, returning a new array.
  function biquad(x, c) {
    const y = new Float32Array(x.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = c.b[0] * xi + c.b[1] * x1 + c.b[2] * x2 - c.a[1] * y1 - c.a[2] * y2;
      y[i] = yi;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = yi;
    }
    return y;
  }

  /*
   * Integrated loudness (LUFS) of a set of channels (arrays of samples at rate fs).
   * Uses 400 ms blocks at 100 ms steps, the absolute gate (-70 LUFS) and the relative
   * gate (-10 LU). Returns null for silence.
   */
  function integratedLufs(channels, fs) {
    const [s1, s2] = kWeightCoefficients(fs);
    const weighted = channels.map((ch) => biquad(biquad(ch, s1), s2));
    const block = Math.round(0.4 * fs);
    const hop = Math.round(0.1 * fs);
    const n = weighted[0].length;
    if (n < block) {
      // Shorter than one block: measure what there is as a single block.
      const ms = meanSquare(weighted, 0, n);
      return ms > 0 ? -0.691 + 10 * Math.log10(ms) : null;
    }
    const blocks = [];
    for (let start = 0; start + block <= n; start += hop) {
      blocks.push(meanSquare(weighted, start, start + block));
    }
    const toLoud = (ms) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);
    const abs = blocks.filter((ms) => toLoud(ms) > -70);
    if (!abs.length) return null;
    const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
    const relThreshold = toLoud(meanAbs) - 10;
    const gated = abs.filter((ms) => toLoud(ms) > relThreshold);
    if (!gated.length) return null;
    const meanGated = gated.reduce((a, b) => a + b, 0) / gated.length;
    return toLoud(meanGated);
  }

  // Sum over channels of the mean square in [from, to), with BS.1770 channel weights (1 each).
  function meanSquare(channels, from, to) {
    let total = 0;
    for (const ch of channels) {
      let s = 0;
      for (let i = from; i < to; i++) s += ch[i] * ch[i];
      total += s / Math.max(1, to - from);
    }
    return total;
  }

  /*
   * Short-term level envelope: RMS in dB for each 20 ms hop, across the channel average.
   * The noise gate looks this up by time. Also returns the noise floor (10th percentile).
   */
  function levelEnvelope(channels, fs) {
    const hop = Math.max(1, Math.round(0.02 * fs));
    const n = channels[0].length;
    const count = Math.ceil(n / hop);
    const env = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      const from = k * hop;
      const to = Math.min(n, from + hop);
      let s = 0;
      for (const ch of channels) {
        for (let i = from; i < to; i++) s += ch[i] * ch[i];
      }
      const rms = Math.sqrt(s / Math.max(1, (to - from) * channels.length));
      env[k] = rms > 0 ? 20 * Math.log10(rms) : -120;
    }
    const sorted = Array.from(env).sort((a, b) => a - b);
    const floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : -120;
    return { env, hop: 0.02, floor };
  }

  /*
   * Synthetic room impulse response for the reverb: exponentially decaying noise, with
   * the early part slightly denser. Returns { left, right } arrays of samples.
   */
  function roomImpulse(fs, seconds, decay) {
    const n = Math.max(1, Math.round(fs * seconds));
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296 * 2 - 1;
    };
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const env = Math.exp((-decay * t) / Math.max(0.05, seconds));
      left[i] = rnd() * env * (i === 0 ? 1 : 0.8);
      right[i] = rnd() * env * (i === 0 ? 1 : 0.8);
    }
    return { left, right };
  }

  AVP.loudness = { integratedLufs, levelEnvelope, roomImpulse, kWeightCoefficients };
})();
