/*
 * AhPah Video Pro - colour maths for Lumetri Color (pure functions, no DOM):
 * curve lookup tables, colour-wheel offsets, and parsing of .cube 3D LUT files.
 * The GPU shader in gpu.js consumes what these functions produce.
 */
(function () {
  'use strict';

  const AVP = window.AVP || (window.AVP = {});
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Piecewise-linear value of a curve (points are {x, y} in 0..1) at x.
  function evalCurve(points, x) {
    if (!points || points.length < 2) return x;
    const p = points.slice().sort((a, b) => a.x - b.x);
    if (x <= p[0].x) return p[0].y;
    if (x >= p[p.length - 1].x) return p[p.length - 1].y;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / (b.x - a.x || 1);
        return a.y + (b.y - a.y) * t;
      }
    }
    return x;
  }

  /*
   * 256-entry RGBA table for the Curves controls. The master curve is applied first, then each
   * channel's own curve: out.r = red(master(x)), out.g = green(master(x)), out.b = blue(master(x)).
   */
  function curveLut(curves) {
    const out = new Uint8Array(256 * 4);
    const master = curves && curves.master;
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      const m = clamp(evalCurve(master, x), 0, 1);
      const r = clamp(evalCurve(curves && curves.r, m), 0, 1);
      const g = clamp(evalCurve(curves && curves.g, m), 0, 1);
      const b = clamp(evalCurve(curves && curves.b, m), 0, 1);
      out[i * 4] = Math.round(r * 255);
      out[i * 4 + 1] = Math.round(g * 255);
      out[i * 4 + 2] = Math.round(b * 255);
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  // A full-saturation colour for a hue (0..1), at mid lightness, centred on zero.
  function hueColour(h) {
    const r = clamp(Math.abs(6 * h - 3) - 1, 0, 1);
    const g = clamp(2 - Math.abs(6 * h - 2), 0, 1);
    const b = clamp(2 - Math.abs(6 * h - 4), 0, 1);
    return [r - 0.5, g - 0.5, b - 0.5];
  }

  /*
   * Colour wheel: x and y (-100..100) pick a hue and an amount; level (-100..100) lifts or
   * drops the whole range. Returns an RGB offset added to the pixels in that tonal range.
   */
  function wheelOffset(x, y, level) {
    const nx = clamp(x / 100, -1, 1);
    const ny = clamp(y / 100, -1, 1);
    const mag = Math.min(1, Math.hypot(nx, ny));
    const angle = Math.atan2(ny, nx);
    const hue = (angle / (2 * Math.PI) + 1) % 1;
    const tint = hueColour(hue);
    const lift = clamp(level / 100, -1, 1) * 0.25;
    return [tint[0] * mag * 0.36 + lift, tint[1] * mag * 0.36 + lift, tint[2] * mag * 0.36 + lift];
  }

  /*
   * Parses an Adobe .cube 3D LUT. Returns { size, data } where data is a Float32Array of
   * size^3 RGB triples, red varying fastest. Throws when the file has no LUT_3D_SIZE.
   */
  function parseCube(text) {
    let size = 0;
    const values = [];
    String(text)
      .split(/\r?\n/)
      .forEach((raw) => {
        const line = raw.trim();
        if (!line || line[0] === '#') return;
        const parts = line.split(/\s+/);
        const key = parts[0].toUpperCase();
        if (key === 'LUT_3D_SIZE') {
          size = parseInt(parts[1], 10);
          return;
        }
        if (key === 'TITLE' || key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX' || key === 'LUT_1D_SIZE') return;
        if (parts.length >= 3 && !isNaN(parseFloat(parts[0]))) {
          values.push(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
        }
      });
    if (!size || size < 2) throw new Error('This is not a 3D .cube LUT (no LUT_3D_SIZE)');
    const count = size * size * size;
    if (values.length < count * 3) throw new Error('The .cube LUT has fewer entries than its size needs');
    return { size, data: Float32Array.from(values.slice(0, count * 3)) };
  }

  /*
   * Lays a 3D LUT out as a 2D RGBA atlas for the shader: width size*size, height size. The blue
   * slice z occupies columns z*size .. z*size+size-1; red is x within a slice, green is y.
   */
  function atlasFromLut(lut) {
    const N = lut.size;
    const width = N * N;
    const out = new Uint8Array(width * N * 4);
    for (let b = 0; b < N; b++) {
      for (let g = 0; g < N; g++) {
        for (let r = 0; r < N; r++) {
          const src = (r + g * N + b * N * N) * 3;
          const dst = (g * width + b * N + r) * 4;
          out[dst] = Math.round(clamp(lut.data[src], 0, 1) * 255);
          out[dst + 1] = Math.round(clamp(lut.data[src + 1], 0, 1) * 255);
          out[dst + 2] = Math.round(clamp(lut.data[src + 2], 0, 1) * 255);
          out[dst + 3] = 255;
        }
      }
    }
    return out;
  }

  AVP.color = { evalCurve, curveLut, wheelOffset, parseCube, atlasFromLut, hueColour };
})();
