/*
 * AhPah Video Pro - level meters: the master meter at the right of the timeline, and one
 * meter per track in the Audio Clip Mixer. Each reads an AnalyserNode from the audio graph
 * (monitor.js) and redraws a few times a second, which is enough for meters.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const FLOOR_DB = -60;
  const HOLD_MS = 1200;

  const peaks = new Map(); // canvas -> { db, at }
  let buf = null;

  // Peak level of an analyser in dBFS (0 = full scale).
  function levelDb(analyser) {
    if (!buf || buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i]);
      if (v > peak) peak = v;
    }
    return peak > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(peak)) : FLOOR_DB;
  }

  function drawMeter(canvas, analyser) {
    const cssH = canvas.clientHeight || 120;
    const cssW = canvas.clientWidth || 20;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#111';
    g.fillRect(0, 0, w, h);

    const db = analyser ? levelDb(analyser) : FLOOR_DB;
    const now = performance.now();
    let p = peaks.get(canvas);
    if (!p) peaks.set(canvas, (p = { db: FLOOR_DB, at: 0 }));
    if (db > p.db || now - p.at > HOLD_MS) {
      p.db = db;
      p.at = now;
    }

    // Bars: green up to -12 dB, yellow to -3 dB, red above.
    const frac = (d) => Math.max(0, Math.min(1, (d - FLOOR_DB) / -FLOOR_DB));
    const barH = frac(db) * h;
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, '#3fbf7f');
    grad.addColorStop(0.8, '#3fbf7f');
    grad.addColorStop(0.9, '#e6c84a');
    grad.addColorStop(1, '#e35d5d');
    g.fillStyle = grad;
    g.fillRect(2, h - barH, w - 4, barH);

    // Peak hold line.
    g.fillStyle = '#e8e8e8';
    g.fillRect(2, Math.max(0, h - frac(p.db) * h), w - 4, Math.max(1, dpr));

    // Scale marks at 0, -6, -12, -24, -48 dB.
    g.fillStyle = 'rgba(255,255,255,0.35)';
    [0, -6, -12, -24, -48].forEach((d) => g.fillRect(0, h - frac(d) * h, 2, 1));
  }

  function draw() {
    const master = document.getElementById('meterCanvas');
    if (master) drawMeter(master, AVP.monitor.masterAnalyser && AVP.monitor.masterAnalyser());
    document.querySelectorAll('[data-mixmeter]').forEach((cv) => {
      const id = cv.dataset.mixmeter;
      const analyser = id === 'master' ? AVP.monitor.masterAnalyser() : AVP.monitor.trackAnalyser(id);
      drawMeter(cv, analyser);
    });
  }

  function init() {
    setInterval(draw, 60);
  }

  AVP.meters = { init, draw };
})();
