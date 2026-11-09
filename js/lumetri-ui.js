/*
 * AhPah Video Pro - Lumetri Color controls that need more than a slider: the Curves editor,
 * the three colour wheels, and the 3D LUT loader. They are mounted into placeholders in the
 * Lumetri Color panel and always work on the clip and effect they were mounted for.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const CHANNELS = [
    { k: 'master', label: 'RGB', color: '#dddddd' },
    { k: 'r', label: 'R', color: '#ff6b6b' },
    { k: 'g', label: 'G', color: '#6bdc7a' },
    { k: 'b', label: 'B', color: '#6ba8ff' },
  ];
  const WHEELS = [
    { key: 'shadow', label: 'Shadows', x: 'sx', y: 'sy', l: 'sl' },
    { key: 'mid', label: 'Midtones', x: 'mx', y: 'my', l: 'ml' },
    { key: 'high', label: 'Highlights', x: 'hx', y: 'hy', l: 'hl' },
  ];

  let mounted = null; // { clipId, fxId }
  let curveChannel = 'master';
  let dragPoint = null;

  function target() {
    if (!mounted) return null;
    const c = AVP.findClip(mounted.clipId);
    const fx = c && c.fx.find((f) => f.id === mounted.fxId);
    return c && fx ? { c, fx } : null;
  }

  function ensureCurves(fx) {
    fx.curves = fx.curves || {};
    CHANNELS.forEach((ch) => {
      if (!fx.curves[ch.k]) fx.curves[ch.k] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    });
    return fx.curves;
  }

  // Premiere-style collapsible section: a header with a disclosure triangle, then the body.
  // Collapsed state is kept in the project's UI state, so sections stay closed after a redraw.
  function section(title, body) {
    const key = title.toLowerCase().replace(/[^a-z]+/g, '-');
    const closed = (S.lumCollapsed || {})[key] ? ' collapsed' : '';
    return (
      '<section class="lum-sec' + closed + '" data-sec="' + key + '">' +
      '<header class="lum-head" data-key="' + key + '"><span class="lum-tri"></span>' + title + '</header>' +
      '<div class="lum-body">' + body + '</div></section>'
    );
  }

  /* ---------- Curves ---------- */

  function curvesHtml() {
    return section(
      'Curves',
      '<div class="curve-tabs">' +
        CHANNELS.map((ch) => '<button class="btn tiny' + (ch.k === curveChannel ? ' active' : '') + '" data-curve="' + ch.k + '">' + ch.label + '</button>').join('') +
        '<button class="btn tiny" id="curveReset">Reset</button></div>' +
        '<canvas class="curve-canvas" id="curveCanvas" width="232" height="232"></canvas>' +
        '<div class="fx-note">Click to add a point. Drag points to shape the curve. Double-click a point to remove it.</div>'
    );
  }

  function drawCurve() {
    const cv = $('#curveCanvas');
    const t = target();
    if (!cv || !t) return;
    const curves = ensureCurves(t.fx);
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const pad = 8;
    const px = (x) => pad + x * (W - 2 * pad);
    const py = (y) => H - pad - y * (H - 2 * pad);
    g.fillStyle = '#151515';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2a2a2a';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(px(i / 4), py(0));
      g.lineTo(px(i / 4), py(1));
      g.moveTo(px(0), py(i / 4));
      g.lineTo(px(1), py(i / 4));
      g.stroke();
    }
    // Other channels, faint, for reference.
    CHANNELS.forEach((ch) => {
      if (ch.k === curveChannel) return;
      drawPath(g, curves[ch.k], px, py, ch.color + '55');
    });
    const cur = CHANNELS.find((ch) => ch.k === curveChannel);
    drawPath(g, curves[curveChannel], px, py, cur.color);
    curves[curveChannel].forEach((p) => {
      g.fillStyle = cur.color;
      g.beginPath();
      g.arc(px(p.x), py(p.y), 4, 0, Math.PI * 2);
      g.fill();
    });
  }

  function drawPath(g, pts, px, py, color) {
    const sorted = pts.slice().sort((a, b) => a.x - b.x);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    sorted.forEach((p, i) => (i ? g.lineTo(px(p.x), py(p.y)) : g.moveTo(px(p.x), py(p.y))));
    g.stroke();
  }

  function curvePoint(e) {
    const cv = $('#curveCanvas');
    const r = cv.getBoundingClientRect();
    const pad = 8 / cv.width;
    const x = (e.clientX - r.left) / r.width;
    const y = 1 - (e.clientY - r.top) / r.height;
    return { x: AVP.clamp((x - pad) / (1 - 2 * pad), 0, 1), y: AVP.clamp((y - pad) / (1 - 2 * pad), 0, 1) };
  }

  function nearestPoint(pts, p) {
    let best = -1;
    let bestD = 0.05;
    pts.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function bindCurves() {
    const cv = $('#curveCanvas');
    if (!cv) return;
    cv.addEventListener('pointerdown', (e) => {
      const t = target();
      if (!t) return;
      const pts = ensureCurves(t.fx)[curveChannel];
      const p = curvePoint(e);
      const i = nearestPoint(pts, p);
      AVP.pushUndo();
      if (i >= 0) {
        dragPoint = i;
      } else {
        pts.push(p);
        pts.sort((a, b) => a.x - b.x);
        dragPoint = pts.indexOf(p);
      }
      cv.setPointerCapture(e.pointerId);
      drawCurve();
      AVP.monitor.draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (dragPoint == null) return;
      const t = target();
      if (!t) return;
      const pts = ensureCurves(t.fx)[curveChannel];
      const p = curvePoint(e);
      const last = pts.length - 1;
      const cur = pts[dragPoint];
      if (!cur) return;
      // End points stay on the edges, so the curve always covers the full range.
      if (dragPoint === 0) p.x = 0;
      else if (dragPoint === last) p.x = 1;
      cur.x = dragPoint === 0 || dragPoint === last ? cur.x : AVP.clamp(p.x, 0.001, 0.999);
      cur.y = p.y;
      pts.sort((a, b) => a.x - b.x);
      dragPoint = pts.indexOf(cur);
      drawCurve();
      AVP.monitor.draw();
    });
    const end = () => {
      dragPoint = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('dblclick', (e) => {
      const t = target();
      if (!t) return;
      const pts = ensureCurves(t.fx)[curveChannel];
      const i = nearestPoint(pts, curvePoint(e));
      if (i > 0 && i < pts.length - 1) {
        AVP.pushUndo();
        pts.splice(i, 1);
        drawCurve();
        AVP.monitor.draw();
      }
    });
    document.querySelectorAll('[data-curve]').forEach((b) =>
      b.addEventListener('click', () => {
        curveChannel = b.dataset.curve;
        document.querySelectorAll('[data-curve]').forEach((x) => x.classList.toggle('active', x === b));
        drawCurve();
      })
    );
    $('#curveReset').addEventListener('click', () => {
      const t = target();
      if (!t) return;
      AVP.pushUndo();
      ensureCurves(t.fx)[curveChannel] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      drawCurve();
      AVP.monitor.draw();
    });
  }

  /* ---------- Colour wheels ---------- */

  function wheelsHtml() {
    return section(
      'Color Wheels',
      '<div class="wheel-row">' +
        WHEELS.map(
          (w) =>
            '<div class="wheel-cell"><canvas class="wheel" data-wheel="' + w.key + '" width="118" height="118"></canvas>' +
            '<div class="wheel-label">' + w.label + '</div>' +
            '<input type="range" class="wheel-level" data-wlevel="' + w.l + '" min="-100" max="100" step="1" title="Master level for ' + w.label.toLowerCase() + '">' +
            '<output data-wout="' + w.key + '">0</output></div>'
        ).join('') +
        '</div><div class="fx-note">Drag inside a wheel to tint that tonal range. Double-click to reset it. The slider below each wheel is the master level.</div>'
    );
  }

  function drawWheel(cv, x, y) {
    const g = cv.getContext('2d');
    const W = cv.width;
    const R = W / 2 - 3;
    const img = g.createImageData(W, W);
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const dx = (i - W / 2) / R;
        const dy = (j - W / 2) / R;
        const d = Math.hypot(dx, dy);
        const idx = (j * W + i) * 4;
        if (d > 1) {
          img.data[idx + 3] = 0;
          continue;
        }
        const hue = (Math.atan2(-dy, dx) / (2 * Math.PI) + 1) % 1;
        const c = AVP.color.hueColour(hue);
        // Saturation grows towards the rim; the centre is neutral.
        img.data[idx] = Math.round((0.5 + c[0] * d) * 255);
        img.data[idx + 1] = Math.round((0.5 + c[1] * d) * 255);
        img.data[idx + 2] = Math.round((0.5 + c[2] * d) * 255);
        img.data[idx + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.arc(W / 2, W / 2, R, 0, Math.PI * 2);
    g.stroke();
    // Crosshair through the centre, as in Premiere's wheels.
    g.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    g.beginPath();
    g.moveTo(W / 2, 4);
    g.lineTo(W / 2, W - 4);
    g.moveTo(4, W / 2);
    g.lineTo(W - 4, W / 2);
    g.stroke();
    // Current position.
    const cx = W / 2 + (x / 100) * R;
    const cy = W / 2 - (y / 100) * R;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx, cy, 4, 0, Math.PI * 2);
    g.fill();
  }

  function paintWheels() {
    const t = target();
    if (!t) return;
    WHEELS.forEach((w) => {
      const cv = document.querySelector(`[data-wheel="${w.key}"]`);
      if (!cv) return;
      drawWheel(cv, t.fx.params[w.x] || 0, t.fx.params[w.y] || 0);
      const out = document.querySelector(`[data-wout="${w.key}"]`);
      if (out) out.textContent = `${Math.round(t.fx.params[w.x] || 0)}, ${Math.round(t.fx.params[w.y] || 0)}`;
    });
  }

  function bindWheels() {
    WHEELS.forEach((w) => {
      const cv = document.querySelector(`[data-wheel="${w.key}"]`);
      if (!cv) return;
      const setFrom = (e) => {
        const t = target();
        if (!t) return;
        const r = cv.getBoundingClientRect();
        const R = r.width / 2;
        const x = ((e.clientX - r.left - R) / R) * 100;
        const y = -((e.clientY - r.top - R) / R) * 100;
        const d = Math.hypot(x, y);
        const k = d > 100 ? 100 / d : 1;
        t.fx.params[w.x] = AVP.clamp(x * k, -100, 100);
        t.fx.params[w.y] = AVP.clamp(y * k, -100, 100);
        paintWheels();
        AVP.monitor.draw();
      };
      let dragging = false;
      cv.addEventListener('pointerdown', (e) => {
        if (!target()) return;
        AVP.pushUndo();
        dragging = true;
        cv.setPointerCapture(e.pointerId);
        setFrom(e);
      });
      cv.addEventListener('pointermove', (e) => dragging && setFrom(e));
      cv.addEventListener('pointerup', () => (dragging = false));
      cv.addEventListener('dblclick', () => {
        const t = target();
        if (!t) return;
        AVP.pushUndo();
        t.fx.params[w.x] = 0;
        t.fx.params[w.y] = 0;
        paintWheels();
        AVP.monitor.draw();
      });
    });
    document.querySelectorAll('[data-wlevel]').forEach((inp) => {
      const key = inp.dataset.wlevel;
      const t0 = target();
      if (t0) inp.value = t0.fx.params[key] || 0;
      inp.addEventListener('pointerdown', () => AVP.pushUndo());
      inp.addEventListener('input', () => {
        const t = target();
        if (!t) return;
        t.fx.params[key] = +inp.value;
        AVP.monitor.draw();
      });
    });
  }

  /* ---------- LUT ---------- */

  function lutHtml() {
    return '<div id="lutSlot"></div>';
  }

  function paintLut() {
    const slot = $('#lutSlot');
    const t = target();
    if (!slot || !t) return;
    const lut = t.fx.lut;
    slot.innerHTML = lut
      ? `<div class="fx-kv"><span>${AVP.esc(lut.name)}</span><span><button class="btn tiny" id="lutRemove">Remove</button></span></div>` +
        `<div class="fx-kv"><span>Size</span><b>${lut.size}×${lut.size}×${lut.size}</b></div>`
      : '<button class="btn" id="lutLoad">Load .cube LUT…</button><div class="fx-note">Use Adobe-format 3D LUT files (.cube). The LUT is saved in the project.</div>';
    const load = $('#lutLoad');
    if (load) load.addEventListener('click', () => pickLut());
    const rm = $('#lutRemove');
    if (rm) rm.addEventListener('click', () => {
      const tt = target();
      if (!tt) return;
      AVP.pushUndo();
      tt.fx.lut = null;
      paintLut();
      AVP.monitor.draw();
    });
  }

  function pickLut() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cube';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = AVP.color.parseCube(reader.result);
          const t = target();
          if (!t) return;
          AVP.pushUndo();
          t.fx.lut = { name: file.name, size: parsed.size, data: Array.from(parsed.data) };
          paintLut();
          AVP.monitor.draw();
          AVP.toast(`Loaded LUT ${file.name}`, 'ok');
        } catch (err) {
          AVP.toast(err.message, 'error');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  /* ---------- mounting ---------- */

  // Places the custom controls in the Lumetri panel. panels.js renders the slots first.
  function mount(clipId, fxId) {
    mounted = { clipId, fxId };
    const wheels = $('#lumWheels');
    if (wheels) wheels.innerHTML = wheelsHtml();
    const curves = $('#lumCurves');
    if (curves) curves.innerHTML = curvesHtml();
    const lut = $('#lumLut');
    if (lut) lut.innerHTML = lutHtml();
    bindWheels();
    paintWheels();
    bindCurves();
    drawCurve();
    paintLut();
    AVP.monitor.draw();
  }

  AVP.lumetriUI = { mount, wheelsHtml, curvesHtml, lutHtml };
})();
