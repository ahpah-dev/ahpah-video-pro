/*
 * AhPah Video Pro - master audio meter at the right edge of the timeline.
 * Reads the level of the master bus (an AnalyserNode in monitor.js) and draws a
 * dB scale with a peak hold. Redraws a few times a second, which is enough for meters.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const FLOOR_DB = -60;
  const HOLD_MS = 1200;

  let canvas = null;
  let g = null;
  let buf = null;
  let peakDb = FLOOR_DB;
  let peakAt = 0;

  // Peak of the master bus in dBFS (0 = full scale).
  function currentDb(analyser) {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i]);
      if (v > peak) peak = v;
    }
    return peak > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(peak)) : FLOOR_DB;
  }

  function draw() {
    if (!canvas) return;
    const analyser = AVP.monitor.masterAnalyser && AVP.monitor.masterAnalyser();
    const cssH = canvas.clientHeight || 200;
    const cssW = canvas.clientWidth || 26;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const W = canvas.width;
    const H = canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#111';
    g.fillRect(0, 0, W, H);

    let db = FLOOR_DB;
    if (analyser) {
      if (!buf || buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize);
      db = currentDb(analyser);
    }
    const now = performance.now();
    if (db > peakDb || now - peakAt > HOLD_MS) {
      peakDb = db;
      peakAt = now;
    }

    // Bars: green up to -12 dB, yellow to -3 dB, red above.
    const frac = (d) => Math.max(0, Math.min(1, (d - FLOOR_DB) / -FLOOR_DB));
    const barH = frac(db) * H;
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#3fbf7f');
    grad.addColorStop(0.8, '#3fbf7f');
    grad.addColorStop(0.9, '#e6c84a');
    grad.addColorStop(1, '#e35d5d');
    g.fillStyle = grad;
    g.fillRect(2, H - barH, W - 4, barH);

    // Peak hold line.
    const py = H - frac(peakDb) * H;
    g.fillStyle = '#e8e8e8';
    g.fillRect(2, Math.max(0, py), W - 4, 1.5);

    // Scale marks at 0, -6, -12, -24, -48 dB.
    g.fillStyle = 'rgba(255,255,255,0.35)';
    [0, -6, -12, -24, -48].forEach((d) => g.fillRect(0, H - frac(d) * H, 2, 1));
  }

  function init() {
    canvas = document.getElementById('meterCanvas');
    if (!canvas) return;
    g = canvas.getContext('2d');
    setInterval(draw, 60);
  }

  AVP.meters = { init, draw };
})();
