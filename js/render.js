/*
 * AhPah Video Pro - frame compositor.
 * Draws the timeline at time t onto a 2D canvas, tracks bottom-up. Clips are painted
 * straight onto the canvas, unless they use an effect that works on the whole picture
 * (mosaic, glow, vignette, grain); those are painted into a layer first.
 * The per-track clip index (with transition windows) is cached and rebuilt only when
 * AVP.dataVersion changes, so playback does not re-sort the timeline on every frame.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  const HAS_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
  const POST_EFFECTS = {
    mosaic: true,
    glow: true,
    vignette: true,
    grain: true,
    tint: true,
    'light-leak': true,
    'lens-flare': true,
    'scan-lines': true,
    letterbox: true,
  };

  let layer = null;
  let lctx = null;
  let scratch = null;
  let sctx = null;
  let grain = null;
  let index = { version: -1, tracks: {} };

  // Per-track list of { c, R } sorted by start, rebuilt when the data changes.
  function trackIndex() {
    if (index.version === AVP.dataVersion) return index.tracks;
    const tracks = {};
    S.trackOrder.forEach((id) => {
      const tr = S.tracks[id];
      if (!tr) return;
      const list = S.clips.filter((c) => c.track === id).sort((a, b) => a.start - b.start);
      tracks[id] = {
        id,
        kind: tr.kind,
        hidden: !!tr.hidden,
        muted: !!tr.muted,
        items: list.map((c) => ({ c, R: AVP.roleWindows(c, list) })),
      };
    });
    index = { version: AVP.dataVersion, tracks };
    return tracks;
  }
  AVP.trackIndex = trackIndex;

  function ensureLayer(W, H) {
    if (!layer) {
      layer = document.createElement('canvas');
      lctx = layer.getContext('2d');
      scratch = document.createElement('canvas');
      sctx = scratch.getContext('2d');
    }
    if (layer.width !== W || layer.height !== H) {
      layer.width = W;
      layer.height = H;
    }
  }

  function grainPattern() {
    if (grain) return grain;
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    const g = cv.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grain = cv;
    return grain;
  }

  function overlay(ctx, W, H, o) {
    ctx.globalAlpha = clamp01(o.alpha);
    ctx.fillStyle = o.color;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  /* ---------- titles ---------- */

  function drawTitle(L, c, t, cx, cy, sc, rot, W, H) {
    const T = c.text || AVP.TEXT_DEFAULTS;
    const unit = H / 1080;
    const size = T.size * unit;
    const weight = (T.bold ? 'bold ' : '') + (T.italic ? 'italic ' : '');
    L.save();
    L.translate(cx, cy);
    L.rotate(rot);
    L.scale(sc, sc);
    L.font = `${weight}${size}px "${T.font || 'Arial'}", Arial, sans-serif`;
    L.textBaseline = 'middle';

    // Word wrap to the title's maximum width.
    const maxW = (T.maxWidth / 100) * W;
    const lines = [];
    String(T.text || '')
      .split('\n')
      .forEach((para) => {
        let line = '';
        para.split(' ').forEach((word) => {
          const test = line ? line + ' ' + word : word;
          if (line && L.measureText(test).width > maxW) {
            lines.push(line);
            line = word;
          } else line = test;
        });
        lines.push(line);
      });

    const lh = size * T.lineHeight;
    const blockH = lines.length * lh;
    let blockW = 0;
    lines.forEach((ln) => (blockW = Math.max(blockW, L.measureText(ln).width)));
    const pad = size * 0.25;

    if (T.bgOpacity > 0) {
      const prevAlpha = L.globalAlpha;
      L.globalAlpha = clamp01(T.bgOpacity / 100) * prevAlpha;
      L.fillStyle = T.bgColor;
      L.fillRect(-blockW / 2 - pad, -blockH / 2 - pad, blockW + pad * 2, blockH + pad * 2);
      L.globalAlpha = prevAlpha; // the text keeps the clip's own alpha
    }

    const align = T.align === 'left' || T.align === 'right' ? T.align : 'center';
    L.textAlign = align;
    lines.forEach((ln, i) => {
      const y = -blockH / 2 + lh * (i + 0.5);
      const x = align === 'left' ? -blockW / 2 : align === 'right' ? blockW / 2 : 0;
      if (T.shadow) {
        L.shadowColor = 'rgba(0,0,0,0.6)';
        L.shadowBlur = size * 0.12;
        L.shadowOffsetY = size * 0.05;
      }
      if (T.strokeWidth > 0) {
        L.lineWidth = T.strokeWidth * unit * 2;
        L.strokeStyle = T.stroke;
        L.lineJoin = 'round';
        L.strokeText(ln, x, y);
      }
      L.fillStyle = T.color;
      L.fillText(ln, x, y);
      L.shadowColor = 'transparent';
      L.shadowBlur = 0;
      L.shadowOffsetY = 0;
    });
    L.restore();
  }

  /* ---------- clips ---------- */

  // Source for a media clip: a video element or still image, once it can be drawn.
  function readySource(s) {
    if (!s) return null;
    if (s.img) {
      if (!s.img.complete || !s.img.naturalWidth) return null;
      return { src: s.img, w: s.img.naturalWidth, h: s.img.naturalHeight };
    }
    if (s.el && s.el.readyState >= 2 && s.el.videoWidth) {
      return { src: s.el, w: s.el.videoWidth, h: s.el.videoHeight };
    }
    return null;
  }

  // Post effects need the finished picture, so they force the layer path.
  function needsLayer(c) {
    return (c.fx || []).some((f) => f.enabled && (POST_EFFECTS[f.type] || f.type === 'lumetri'));
  }

  // Rectangles and ellipses from the Essential Graphics panel. Sizes are percentages of the frame.
  function roundRectPath(g, x, y, w, h, rad) {
    const rr = Math.max(0, Math.min(rad, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function drawShape(target, c, cx, cy, sc, rot, W, H, filter) {
    const sh = c.shape || AVP.defaultShape();
    const w = (sh.width / 100) * W * sc;
    const h = (sh.height / 100) * H * sc;
    const unit = H / 1080;
    target.save();
    target.filter = filter;
    target.translate(cx, cy);
    target.rotate(rot);
    target.fillStyle = sh.fill;
    target.strokeStyle = sh.stroke;
    target.lineWidth = sh.strokeWidth * unit * 2;
    if (sh.type === 'ellipse') {
      target.beginPath();
      target.ellipse(0, 0, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2);
    } else {
      roundRectPath(target, -w / 2, -h / 2, w, h, sh.radius * unit);
    }
    target.fill();
    if (sh.strokeWidth > 0) target.stroke();
    target.restore();
  }

  // Paints the clip's own content onto target. Returns false while media is not ready.
  function paintContent(target, c, t, v, getSource, W, H) {
    const px = AVP.propAt(c, 'x', t) / 100;
    const py = AVP.propAt(c, 'y', t) / 100;
    const sc = (AVP.propAt(c, 'scale', t) / 100) * v.scale;
    const rot = ((AVP.propAt(c, 'rotation', t) + (v.rot || 0)) * Math.PI) / 180;
    const cx = W / 2 + (px + v.dx) * W;
    const cy = H / 2 + (py + v.dy) * H;
    // Transitions can add blur (Blur Dissolve, Whip Pan) on top of the clip's own filters.
    const baseFilter = HAS_FILTER ? AVP.buildFilter(c, t) : 'none';
    const filter = HAS_FILTER && v.blur > 0.05
      ? (baseFilter === 'none' ? '' : baseFilter + ' ') + 'blur(' + v.blur.toFixed(2) + 'px)'
      : baseFilter;
    const fxOf = (type) => (c.fx || []).find((f) => f.type === type && f.enabled) || null;
    const P = (f, k) => AVP.fxParamAt(c, f, k, t);

    if (c.kind === 'title') {
      target.filter = filter;
      drawTitle(target, c, t, cx, cy, sc, rot, W, H);
      target.filter = 'none';
      return true;
    }

    if (c.kind === 'shape') {
      drawShape(target, c, cx, cy, sc, rot, W, H, filter);
      return true;
    }

    const s = readySource(getSource(c));
    if (!s) return false;
    const k = Math.min(W / s.w, H / s.h) * sc;
    const dw = s.w * k;
    const dh = s.h * k;
    target.save();
    target.translate(cx, cy);
    target.rotate(rot);
    const flip = fxOf('flip');
    if (flip) target.scale(P(flip, 'h') ? -1 : 1, P(flip, 'v') ? -1 : 1);
    const crop = fxOf('crop');
    if (crop) {
      const l = P(crop, 'left') / 100;
      const r = P(crop, 'right') / 100;
      const tp = P(crop, 'top') / 100;
      const bt = P(crop, 'bottom') / 100;
      target.beginPath();
      target.rect(-dw / 2 + l * dw, -dh / 2 + tp * dh, dw * (1 - l - r), dh * (1 - tp - bt));
      target.clip();
    }
    target.filter = filter;
    const ds = fxOf('drop-shadow');
    if (ds && P(ds, 'opacity') > 0) {
      // Shadow offset and softness are in frame pixels (1080p-based), not in the clip's rotated space.
      const a = (P(ds, 'angle') * Math.PI) / 180;
      const d = P(ds, 'distance') * (H / 1080);
      target.shadowColor = `rgba(0, 0, 0, ${(P(ds, 'opacity') / 100).toFixed(3)})`;
      target.shadowBlur = P(ds, 'softness') * (H / 1080);
      target.shadowOffsetX = Math.cos(a) * d;
      target.shadowOffsetY = Math.sin(a) * d;
    }
    target.drawImage(s.src, -dw / 2, -dh / 2, dw, dh);
    target.restore();
    return true;
  }

  // Clips drawing to a wipe rectangle, or to a transition mask (diagonal wipe, box wipe, iris).
  // The diagonal wipe keeps the part of the frame where x + y is below a sweeping line.
  function halfPlane(poly, s) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const fa = s - (a[0] + a[1]);
      const fb = s - (b[0] + b[1]);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {
        const k = fa / (fa - fb);
        out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
      }
    }
    return out;
  }

  // Transition shapes drawn as paths: each fills the frame at progress p (0 to 1).
  const NEW_MASKS = {
    'clock-wipe': (g, p, W, H) => {
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.hypot(W, H) / 2;
      const a0 = -Math.PI / 2;
      g.moveTo(cx, cy);
      if (p > 0.0005) g.arc(cx, cy, R, a0, a0 + p * Math.PI * 2);
      g.closePath();
    },
    'checker-wipe': (g, p, W, H) => {
      // Even squares grow first, then the odd ones, so the picture appears in a checkerboard.
      const cols = 8;
      const rows = 5;
      const cw = W / cols;
      const ch = H / rows;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const phase = (i + j) % 2;
          const q = clamp01(2 * p - phase);
          if (q <= 0) continue;
          const w = cw * q;
          const h = ch * q;
          g.rect(i * cw + (cw - w) / 2, j * ch + (ch - h) / 2, w, h);
        }
      }
    },
    'random-blocks': (g, p, W, H) => {
      // Blocks appear in a fixed scattered order, so each transition looks the same every time it plays.
      const cols = 16;
      const rows = 9;
      const cw = W / cols;
      const ch = H / rows;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const h = Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1;
          if (h < p) g.rect(i * cw, j * ch, cw + 1, ch + 1);
        }
      }
    },
    blinds: (g, p, W, H) => {
      // Horizontal slats that open from the left, one after another down the frame.
      const n = 12;
      const sh = H / n;
      for (let k = 0; k < n; k++) {
        const q = clamp01(p * 1.5 - (k / n) * 0.5);
        if (q > 0) g.rect(0, k * sh, W * q, sh + 1);
      }
    },
  };

  function clipToVisual(ctx, v, W, H) {
    if (v.clip) {
      ctx.beginPath();
      ctx.rect(v.clip.x * W, v.clip.y * H, v.clip.w * W, v.clip.h * H);
      ctx.clip();
    }
    const m = v.mask;
    if (!m) return;
    if (NEW_MASKS[m.type]) {
      ctx.beginPath();
      NEW_MASKS[m.type](ctx, m.p, W, H);
      ctx.clip();
      return;
    }
    ctx.beginPath();
    if (m.type === 'iris') {
      ctx.arc(W / 2, H / 2, Math.max(0.001, Math.hypot(W / 2, H / 2) * m.p), 0, Math.PI * 2);
    } else if (m.type === 'wipe-box') {
      const hw = (W / 2) * m.p;
      const hh = (H / 2) * m.p;
      ctx.rect(W / 2 - hw, H / 2 - hh, 2 * hw, 2 * hh);
    } else if (m.type === 'wipe-diag') {
      const poly = halfPlane(
        [
          [0, 0],
          [W, 0],
          [W, H],
          [0, H],
        ],
        (W + H) * m.p
      );
      if (poly.length >= 3) {
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
        ctx.closePath();
      }
    }
    ctx.clip();
  }

  // Paints an effect on the picture only where the picture has content, so transparent areas stay clear.
  function overlayOnPicture(W, H, paint, blend, alpha) {
    if (scratch.width !== W || scratch.height !== H) {
      scratch.width = W;
      scratch.height = H;
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, W, H);
    paint(sctx);
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(layer, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    lctx.save();
    lctx.globalCompositeOperation = blend;
    lctx.globalAlpha = alpha;
    lctx.drawImage(scratch, 0, 0);
    lctx.restore();
  }

  // Lumetri Color: grades the clip's layer on the GPU (no-op when WebGL is unavailable).
  // Curves and the LUT come from the effect's own data; the sliders are keyframeable.
  const lutAtlases = new WeakMap();
  function lutAtlas(lut) {
    if (!lutAtlases.has(lut)) {
      const data = Float32Array.from(lut.data);
      lutAtlases.set(lut, AVP.color.atlasFromLut({ size: lut.size, data }));
    }
    return lutAtlases.get(lut);
  }

  function applyLumetri(c, t, W, H) {
    if (!AVP.gpuOk) return;
    (c.fx || []).forEach((fx) => {
      if (fx.type !== 'lumetri' || !fx.enabled) return;
      const p = {};
      AVP.EFFECTS.lumetri.params.forEach((d) => (p[d.k] = AVP.fxParamAt(c, fx, d.k, t)));
      const extras = {};
      if (fx.curves) extras.curve = AVP.color.curveLut(fx.curves);
      if (fx.lut && fx.lut.data && fx.lut.data.length) {
        extras.lut = { size: fx.lut.size, atlas: lutAtlas(fx.lut) };
      }
      const graded = AVP.gpu.grade(layer, p, extras);
      if (!graded) return;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalAlpha = 1;
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, W, H);
      lctx.drawImage(graded, 0, 0);
    });
  }

  // Effects that work on the finished layer: mosaic, glow, vignette and film grain.
  function applyLayerEffects(c, t, W, H) {
    const L = lctx;
    const fxOf = (type) => (c.fx || []).find((f) => f.type === type && f.enabled) || null;
    const P = (f, k) => AVP.fxParamAt(c, f, k, t);

    const mosaic = fxOf('mosaic');
    if (mosaic) {
      const block = Math.max(1, Math.round(P(mosaic, 'size') * (W / 1920)));
      if (block > 1) {
        const w = Math.max(1, Math.round(W / block));
        const h = Math.max(1, Math.round(H / block));
        scratch.width = w;
        scratch.height = h;
        sctx.imageSmoothingEnabled = false;
        sctx.clearRect(0, 0, w, h);
        sctx.drawImage(layer, 0, 0, w, h);
        L.clearRect(0, 0, W, H);
        L.imageSmoothingEnabled = false;
        L.drawImage(scratch, 0, 0, W, H);
        L.imageSmoothingEnabled = true;
      }
    }

    const glow = fxOf('glow');
    if (glow && HAS_FILTER && P(glow, 'amount') > 0) {
      if (scratch.width !== W || scratch.height !== H) {
        scratch.width = W;
        scratch.height = H;
      }
      sctx.clearRect(0, 0, W, H);
      sctx.filter = `blur(${P(glow, 'radius').toFixed(1)}px)`;
      sctx.drawImage(layer, 0, 0);
      sctx.filter = 'none';
      L.globalCompositeOperation = 'screen';
      L.globalAlpha = P(glow, 'amount') / 100;
      L.drawImage(scratch, 0, 0);
      L.globalAlpha = 1;
      L.globalCompositeOperation = 'source-over';
    }

    const vig = fxOf('vignette');
    if (vig && P(vig, 'amount') > 0) {
      const amt = P(vig, 'amount') / 100;
      const size = P(vig, 'size') / 100;
      const g = L.createRadialGradient(W / 2, H / 2, Math.min(W, H) * size * 0.5, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${amt.toFixed(3)})`);
      L.fillStyle = g;
      L.fillRect(0, 0, W, H);
    }

    const gr = fxOf('grain');
    if (gr && P(gr, 'amount') > 0) {
      const pat = L.createPattern(grainPattern(), 'repeat');
      L.save();
      L.globalCompositeOperation = 'overlay';
      L.globalAlpha = (P(gr, 'amount') / 100) * 0.6;
      L.setTransform(1, 0, 0, 1, Math.random() * 256, Math.random() * 256);
      L.fillStyle = pat;
      L.fillRect(-256, -256, W + 512, H + 512);
      L.restore();
    }

    const tint = fxOf('tint');
    if (tint && P(tint, 'amount') > 0) {
      const hue = P(tint, 'hue');
      overlayOnPicture(
        W,
        H,
        (g) => {
          g.drawImage(layer, 0, 0);
          g.globalCompositeOperation = 'color';
          g.fillStyle = `hsl(${hue.toFixed(1)}, 100%, 50%)`;
          g.fillRect(0, 0, W, H);
        },
        'source-over',
        P(tint, 'amount') / 100
      );
    }

    const leak = fxOf('light-leak');
    if (leak && P(leak, 'amount') > 0) {
      const hue = P(leak, 'hue');
      const cx = (P(leak, 'x') / 100) * W;
      const cy = (P(leak, 'y') / 100) * H;
      const r = (P(leak, 'size') / 100) * Math.max(W, H) * 0.5;
      const amt = P(leak, 'amount') / 100;
      overlayOnPicture(
        W,
        H,
        (g) => {
          const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, `hsla(${hue}, 100%, 62%, ${amt})`);
          grad.addColorStop(0.45, `hsla(${hue}, 100%, 50%, ${amt * 0.45})`);
          grad.addColorStop(1, `hsla(${hue}, 100%, 45%, 0)`);
          g.fillStyle = grad;
          g.fillRect(0, 0, W, H);
        },
        'screen',
        1
      );
    }

    const flare = fxOf('lens-flare');
    if (flare && P(flare, 'amount') > 0) {
      const cx = (P(flare, 'x') / 100) * W;
      const cy = (P(flare, 'y') / 100) * H;
      const r = (P(flare, 'size') / 100) * Math.max(W, H) * 0.5;
      overlayOnPicture(
        W,
        H,
        (g) => {
          const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, 'rgba(255, 250, 235, 1)');
          grad.addColorStop(0.18, 'rgba(255, 214, 150, 0.55)');
          grad.addColorStop(1, 'rgba(255, 170, 90, 0)');
          g.fillStyle = grad;
          g.fillRect(0, 0, W, H);
        },
        'screen',
        P(flare, 'amount') / 100
      );
    }

    const lines = fxOf('scan-lines');
    if (lines && P(lines, 'amount') > 0) {
      const step = Math.max(2, P(lines, 'spacing') * (H / 1080));
      L.save();
      L.fillStyle = `rgba(0, 0, 0, ${(P(lines, 'amount') / 100).toFixed(3)})`;
      for (let y = 0; y < H; y += step) L.fillRect(0, y, W, step / 2);
      L.restore();
    }

    const box = fxOf('letterbox');
    if (box && P(box, 'size') > 0) {
      const bar = (P(box, 'size') / 100) * H;
      L.save();
      L.fillStyle = '#000';
      L.fillRect(0, 0, W, bar);
      L.fillRect(0, H - bar, W, bar);
      L.restore();
    }
  }

  // Draws one visible clip. `alpha` already includes transitions and opacity.
  function paintClip(ctx, c, t, v, alpha, getSource, W, H) {
    if (!needsLayer(c)) {
      ctx.save();
      clipToVisual(ctx, v, W, H);
      ctx.globalAlpha = alpha;
      paintContent(ctx, c, t, v, getSource, W, H);
      ctx.restore();
      return;
    }
    ensureLayer(W, H);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    lctx.filter = 'none';
    lctx.clearRect(0, 0, W, H);
    if (!paintContent(lctx, c, t, v, getSource, W, H)) return;
    applyLumetri(c, t, W, H);
    applyLayerEffects(c, t, W, H);
    ctx.save();
    clipToVisual(ctx, v, W, H);
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  /* ---------- frame ---------- */

  /*
   * Draws the sequence at time t onto ctx (its canvas size is the output size).
   * getSource(clip) must return { el } for video or { img } for still images, or null.
   */
  function frame(ctx, t, getSource) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const tracks = trackIndex();
    // trackOrder runs top -> bottom, so draw the video tracks in reverse (bottom track first).
    const order = S.trackOrder.filter((id) => tracks[id] && tracks[id].kind === 'video' && !tracks[id].hidden).reverse();

    for (const id of order) {
      for (const { c, R } of tracks[id].items) {
        if (!c.enabled || !AVP.isVisibleAt(R, t)) continue;
        const v = AVP.visualAt(R, t);
        if (v.before) overlay(ctx, W, H, v.before);
        const alpha = clamp01(v.alpha * (AVP.propAt(c, 'opacity', t) / 100));
        if (alpha > 0.002) paintClip(ctx, c, t, v, alpha, getSource, W, H);
        if (v.after) overlay(ctx, W, H, v.after);
      }
    }

    if (S.showSafe) drawSafe(ctx, W, H);
  }

  function drawSafe(ctx, W, H) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, W / 1000);
    ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
    ctx.strokeStyle = 'rgba(255,200,0,0.5)';
    ctx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
    ctx.restore();
  }

  AVP.render = { frame, drawTitle };
})();
