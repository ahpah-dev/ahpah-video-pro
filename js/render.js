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
  const POST_EFFECTS = { mosaic: true, glow: true, vignette: true, grain: true };

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

  // Paints the clip's own content onto target. Returns false while media is not ready.
  function paintContent(target, c, t, v, getSource, W, H) {
    const px = AVP.propAt(c, 'x', t) / 100;
    const py = AVP.propAt(c, 'y', t) / 100;
    const sc = (AVP.propAt(c, 'scale', t) / 100) * v.scale;
    const rot = (AVP.propAt(c, 'rotation', t) * Math.PI) / 180;
    const cx = W / 2 + (px + v.dx) * W;
    const cy = H / 2 + (py + v.dy) * H;
    const filter = HAS_FILTER ? AVP.buildFilter(c, t) : 'none';
    const fxOf = (type) => (c.fx || []).find((f) => f.type === type && f.enabled) || null;
    const P = (f, k) => AVP.fxParamAt(c, f, k, t);

    if (c.kind === 'title') {
      target.filter = filter;
      drawTitle(target, c, t, cx, cy, sc, rot, W, H);
      target.filter = 'none';
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
    target.drawImage(s.src, -dw / 2, -dh / 2, dw, dh);
    target.restore();
    return true;
  }

  // Lumetri Color: grades the clip's layer on the GPU (no-op when WebGL is unavailable).
  const LUMETRI_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'saturation', 'temperature', 'tint', 'vibrance', 'fade'];
  function applyLumetri(c, t, W, H) {
    if (!AVP.gpuOk) return;
    (c.fx || []).forEach((fx) => {
      if (fx.type !== 'lumetri' || !fx.enabled) return;
      const p = {};
      LUMETRI_KEYS.forEach((k) => (p[k] = AVP.fxParamAt(c, fx, k, t)));
      const graded = AVP.gpu.grade(layer, p);
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
  }

  // Draws one visible clip. `alpha` already includes transitions and opacity.
  function paintClip(ctx, c, t, v, alpha, getSource, W, H) {
    if (!needsLayer(c)) {
      ctx.save();
      if (v.clip) {
        ctx.beginPath();
        ctx.rect(v.clip.x * W, v.clip.y * H, v.clip.w * W, v.clip.h * H);
        ctx.clip();
      }
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
    if (v.clip) {
      ctx.beginPath();
      ctx.rect(v.clip.x * W, v.clip.y * H, v.clip.w * W, v.clip.h * H);
      ctx.clip();
    }
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
