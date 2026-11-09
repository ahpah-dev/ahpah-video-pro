/*
 * AhPah Video Pro - effect, transition and title definitions plus the pure
 * timing / keyframe maths they depend on. No DOM access here, so it is unit-tested
 * in Node (see tests/).
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const EPS = AVP.EPS;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clamp01 = (v) => clamp(v, 0, 1);

  /* ---------- transform properties (keyframeable) ---------- */

  AVP.PROP_DEFS = {
    x: { label: 'Position X', min: -100, max: 100, def: 0, unit: '%' },
    y: { label: 'Position Y', min: -100, max: 100, def: 0, unit: '%' },
    scale: { label: 'Scale', min: 0, max: 400, def: 100, unit: '%' },
    rotation: { label: 'Rotation', min: -360, max: 360, def: 0, unit: '°' },
    opacity: { label: 'Opacity', min: 0, max: 100, def: 100, unit: '%' },
    volume: { label: 'Volume', min: 0, max: 200, def: 100, unit: '%' },
  };

  AVP.defaultProps = () => ({ x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, volume: 100 });

  /* ---------- video effects ---------- */

  AVP.EFFECTS = {
    brightness: {
      name: 'Brightness & Contrast',
      cat: 'Color Correction',
      params: [
        { k: 'brightness', label: 'Brightness', min: -100, max: 100, def: 0 },
        { k: 'contrast', label: 'Contrast', min: -100, max: 100, def: 0 },
      ],
    },
    saturation: {
      name: 'Saturation',
      cat: 'Color Correction',
      params: [{ k: 'amount', label: 'Saturation', min: 0, max: 300, def: 100, unit: '%' }],
    },
    hue: {
      name: 'Hue Rotate',
      cat: 'Color Correction',
      params: [{ k: 'angle', label: 'Angle', min: -180, max: 180, def: 0, unit: '°' }],
    },
    grayscale: {
      name: 'Black & White',
      cat: 'Color Correction',
      params: [{ k: 'amount', label: 'Amount', min: 0, max: 100, def: 100, unit: '%' }],
    },
    sepia: {
      name: 'Sepia',
      cat: 'Color Correction',
      params: [{ k: 'amount', label: 'Amount', min: 0, max: 100, def: 100, unit: '%' }],
    },
    invert: {
      name: 'Invert',
      cat: 'Color Correction',
      params: [{ k: 'amount', label: 'Amount', min: 0, max: 100, def: 100, unit: '%' }],
    },
    blur: {
      name: 'Gaussian Blur',
      cat: 'Blur & Sharpen',
      params: [{ k: 'radius', label: 'Blurriness', min: 0, max: 60, def: 0, unit: 'px' }],
    },
    glow: {
      name: 'Glow',
      cat: 'Stylize',
      params: [
        { k: 'amount', label: 'Amount', min: 0, max: 100, def: 0, unit: '%' },
        { k: 'radius', label: 'Radius', min: 1, max: 60, def: 12, unit: 'px' },
      ],
    },
    mosaic: {
      name: 'Mosaic',
      cat: 'Stylize',
      params: [{ k: 'size', label: 'Block size', min: 1, max: 120, def: 1, unit: 'px' }],
    },
    vignette: {
      name: 'Vignette',
      cat: 'Stylize',
      params: [
        { k: 'amount', label: 'Amount', min: 0, max: 100, def: 0, unit: '%' },
        { k: 'size', label: 'Size', min: 10, max: 100, def: 60, unit: '%' },
      ],
    },
    grain: {
      name: 'Film Grain',
      cat: 'Stylize',
      params: [{ k: 'amount', label: 'Amount', min: 0, max: 100, def: 0, unit: '%' }],
    },
    crop: {
      name: 'Crop',
      cat: 'Transform',
      params: [
        { k: 'left', label: 'Left', min: 0, max: 49, def: 0, unit: '%' },
        { k: 'right', label: 'Right', min: 0, max: 49, def: 0, unit: '%' },
        { k: 'top', label: 'Top', min: 0, max: 49, def: 0, unit: '%' },
        { k: 'bottom', label: 'Bottom', min: 0, max: 49, def: 0, unit: '%' },
      ],
    },
    lumetri: {
      name: 'Lumetri Color',
      cat: 'Color',
      params: [
        { k: 'exposure', label: 'Exposure', min: -5, max: 5, def: 0, step: 0.1, unit: ' EV' },
        { k: 'contrast', label: 'Contrast', min: -100, max: 100, def: 0 },
        { k: 'highlights', label: 'Highlights', min: -100, max: 100, def: 0 },
        { k: 'shadows', label: 'Shadows', min: -100, max: 100, def: 0 },
        { k: 'whites', label: 'Whites', min: -100, max: 100, def: 0 },
        { k: 'blacks', label: 'Blacks', min: -100, max: 100, def: 0 },
        { k: 'saturation', label: 'Saturation', min: 0, max: 200, def: 100, unit: '%' },
        { k: 'temperature', label: 'Temperature', min: -100, max: 100, def: 0 },
        { k: 'tint', label: 'Tint', min: -100, max: 100, def: 0 },
        { k: 'vibrance', label: 'Vibrance', min: -100, max: 100, def: 0 },
        { k: 'fade', label: 'Faded film', min: 0, max: 100, def: 0, unit: '%' },
        { k: 'sharpen', label: 'Sharpen', min: 0, max: 100, def: 0, unit: '%' },
        { k: 'sx', label: 'Shadow wheel X', min: -100, max: 100, def: 0 },
        { k: 'sy', label: 'Shadow wheel Y', min: -100, max: 100, def: 0 },
        { k: 'sl', label: 'Shadow level', min: -100, max: 100, def: 0 },
        { k: 'mx', label: 'Midtone wheel X', min: -100, max: 100, def: 0 },
        { k: 'my', label: 'Midtone wheel Y', min: -100, max: 100, def: 0 },
        { k: 'ml', label: 'Midtone level', min: -100, max: 100, def: 0 },
        { k: 'hx', label: 'Highlight wheel X', min: -100, max: 100, def: 0 },
        { k: 'hy', label: 'Highlight wheel Y', min: -100, max: 100, def: 0 },
        { k: 'hl', label: 'Highlight level', min: -100, max: 100, def: 0 },
        { k: 'hslOn', label: 'HSL secondary on', min: 0, max: 1, def: 0 },
        { k: 'hslHue', label: 'HSL hue', min: 0, max: 360, def: 0, unit: '°' },
        { k: 'hslRange', label: 'HSL range', min: 0, max: 100, def: 30, unit: '%' },
        { k: 'hslSoft', label: 'HSL softness', min: 0, max: 100, def: 20, unit: '%' },
        { k: 'hslShift', label: 'HSL hue shift', min: -180, max: 180, def: 0, unit: '°' },
        { k: 'hslSat', label: 'HSL saturation', min: -100, max: 100, def: 0 },
        { k: 'hslLum', label: 'HSL luminance', min: -100, max: 100, def: 0 },
        { k: 'lutAmount', label: 'LUT strength', min: 0, max: 100, def: 100, unit: '%' },
      ],
    },
    flip: {
      name: 'Flip',
      cat: 'Transform',
      params: [
        { k: 'h', label: 'Horizontal (1 = on)', min: 0, max: 1, def: 0 },
        { k: 'v', label: 'Vertical (1 = on)', min: 0, max: 1, def: 0 },
      ],
    },
    tint: {
      name: 'Tint',
      cat: 'Color Correction',
      params: [
        { k: 'hue', label: 'Colour (hue)', min: 0, max: 360, def: 30, unit: '°' },
        { k: 'amount', label: 'Amount', min: 0, max: 100, def: 0, unit: '%' },
      ],
    },
    'drop-shadow': {
      name: 'Drop Shadow',
      cat: 'Stylize',
      params: [
        { k: 'opacity', label: 'Opacity', min: 0, max: 100, def: 0, unit: '%' },
        { k: 'angle', label: 'Direction', min: 0, max: 360, def: 135, unit: '°' },
        { k: 'distance', label: 'Distance', min: 0, max: 100, def: 12, unit: 'px' },
        { k: 'softness', label: 'Softness', min: 0, max: 60, def: 10, unit: 'px' },
      ],
    },
    'light-leak': {
      name: 'Light Leak',
      cat: 'Stylize',
      params: [
        { k: 'amount', label: 'Amount', min: 0, max: 100, def: 0, unit: '%' },
        { k: 'hue', label: 'Colour (hue)', min: 0, max: 360, def: 25, unit: '°' },
        { k: 'x', label: 'Position X', min: 0, max: 100, def: 0, unit: '%' },
        { k: 'y', label: 'Position Y', min: 0, max: 100, def: 50, unit: '%' },
        { k: 'size', label: 'Size', min: 10, max: 150, def: 70, unit: '%' },
      ],
    },
    'lens-flare': {
      name: 'Lens Flare',
      cat: 'Stylize',
      params: [
        { k: 'amount', label: 'Brightness', min: 0, max: 100, def: 0, unit: '%' },
        { k: 'x', label: 'Centre X', min: 0, max: 100, def: 75, unit: '%' },
        { k: 'y', label: 'Centre Y', min: 0, max: 100, def: 25, unit: '%' },
        { k: 'size', label: 'Size', min: 5, max: 100, def: 30, unit: '%' },
      ],
    },
    'scan-lines': {
      name: 'Scan Lines',
      cat: 'Stylize',
      params: [
        { k: 'amount', label: 'Darkness', min: 0, max: 100, def: 0, unit: '%' },
        { k: 'spacing', label: 'Spacing', min: 2, max: 20, def: 4, unit: 'px' },
      ],
    },
    letterbox: {
      name: 'Letterbox',
      cat: 'Transform',
      params: [{ k: 'size', label: 'Bar height', min: 0, max: 40, def: 0, unit: '%' }],
    },
  };

  AVP.effectParamDef = function (type, k) {
    const def = AVP.EFFECTS[type];
    return def ? def.params.find((p) => p.k === k) || null : null;
  };

  // Creates a new effect instance with default parameter values.
  AVP.createEffect = function (type) {
    const def = AVP.EFFECTS[type];
    if (!def) return null;
    const params = {};
    def.params.forEach((p) => (params[p.k] = p.def));
    return { id: AVP.uid(), type, enabled: true, params };
  };

  /* ---------- transitions ---------- */

  AVP.TRANSITIONS = {
    dissolve: { name: 'Cross Dissolve', cat: 'Dissolve', dur: 1, audio: false },
    'dip-black': { name: 'Dip to Black', cat: 'Dissolve', dur: 1, audio: false },
    'dip-white': { name: 'Dip to White', cat: 'Dissolve', dur: 1, audio: false },
    'wipe-lr': { name: 'Wipe Left to Right', cat: 'Wipe', dur: 1, audio: false },
    'wipe-rl': { name: 'Wipe Right to Left', cat: 'Wipe', dur: 1, audio: false },
    'wipe-tb': { name: 'Wipe Top to Bottom', cat: 'Wipe', dur: 1, audio: false },
    'slide-in-right': { name: 'Slide In From Right', cat: 'Motion', dur: 1, audio: false },
    'slide-in-left': { name: 'Slide In From Left', cat: 'Motion', dur: 1, audio: false },
    zoom: { name: 'Zoom', cat: 'Motion', dur: 1, audio: false },
    'slide-in-bottom': { name: 'Slide In From Bottom', cat: 'Motion', dur: 1, audio: false },
    'slide-in-top': { name: 'Slide In From Top', cat: 'Motion', dur: 1, audio: false },
    spin: { name: 'Spin', cat: 'Motion', dur: 1, audio: false },
    'wipe-diag': { name: 'Diagonal Wipe', cat: 'Wipe', dur: 1, audio: false },
    'wipe-box': { name: 'Box Wipe (from centre)', cat: 'Wipe', dur: 1, audio: false },
    iris: { name: 'Iris (circle)', cat: 'Wipe', dur: 1, audio: false },
    'audio-fade': { name: 'Constant Gain (Audio Fade)', cat: 'Audio', dur: 1, audio: true },
  };

  /* ---------- title / text ---------- */

  AVP.TEXT_DEFAULTS = {
    text: 'Title',
    font: 'Arial',
    size: 96, // px at 1080p; scales with frame height
    color: '#ffffff',
    bold: false,
    italic: false,
    align: 'center',
    stroke: '#000000',
    strokeWidth: 0,
    shadow: true,
    bgColor: '#000000',
    bgOpacity: 0,
    lineHeight: 1.2,
    maxWidth: 80, // % of frame width
  };

  /* ---------- fonts ---------- */

  // Fonts offered for titles. Only the ones installed on this computer are listed, plus any font
  // the project imported, so the list matches what the picture will show.
  AVP.FONT_CANDIDATES = [
    'Arial', 'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Book Antiqua', 'Bookman Old Style', 'Calibri',
    'Cambria', 'Candara', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
    'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Gill Sans MT', 'Impact', 'Lucida Console',
    'Lucida Sans Unicode', 'Palatino Linotype', 'Rockwell', 'Segoe UI', 'Segoe UI Black', 'Segoe UI Light',
    'Segoe UI Semibold', 'Segoe Print', 'Segoe Script', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
    'Brush Script MT', 'Monotype Corsiva', 'Cooper Black', 'Gabriola', 'Ink Free', 'Papyrus', 'Bodoni MT',
    'Eras ITC', 'Agency FB', 'Stencil', 'Harlow Solid Italic', 'Helvetica', 'Helvetica Neue', 'Avenir',
    'Avenir Next', 'Futura', 'Didot', 'Baskerville', 'Gill Sans', 'Optima', 'Menlo', 'Marker Felt', 'Noteworthy',
    'Chalkboard', 'American Typewriter', 'Hoefler Text', 'Copperplate', 'Apple Chancery',
  ];

  // Fonts the project imported from files: { name, data } where data is a data URL. Saved with the project.
  AVP.customFonts = [];

  const fontCache = {};
  // A font is installed when its width differs from the generic fallbacks for the same text.
  AVP.fontInstalled = function (name) {
    if (fontCache[name] !== undefined) return fontCache[name];
    if (typeof document === 'undefined') return false;
    const g = document.createElement('canvas').getContext('2d');
    const sample = 'mmmmmmmmmmlliWWW@@0123';
    const width = (family) => {
      g.font = `72px ${family}`;
      return g.measureText(sample).width;
    };
    const missing = width(`"${name}", monospace`) === width('monospace') && width(`"${name}", serif`) === width('serif');
    fontCache[name] = !missing;
    return !missing;
  };

  AVP.fontList = function () {
    const names = new Set(AVP.FONT_CANDIDATES.filter((n) => AVP.fontInstalled(n)));
    AVP.customFonts.forEach((f) => names.add(f.name));
    return [...names].sort((a, b) => a.localeCompare(b));
  };

  function loadFontFace(name, dataUrl) {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
    const face = new FontFace(name, `url("${dataUrl}")`);
    return face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        if (AVP.refresh) AVP.refresh();
        return true;
      })
      .catch(() => false);
  }

  // Imports a font file (.ttf, .otf, .woff, .woff2) under its file name.
  AVP.addCustomFont = function (name, dataUrl) {
    AVP.customFonts = AVP.customFonts.filter((f) => f.name !== name);
    AVP.customFonts.push({ name, data: dataUrl });
    return loadFontFace(name, dataUrl);
  };

  // Restores the fonts saved with a project.
  AVP.restoreCustomFonts = function (list) {
    AVP.customFonts = (list || []).filter((f) => f && f.name && f.data);
    return Promise.all(AVP.customFonts.map((f) => loadFontFace(f.name, f.data)));
  };

  AVP.TITLE_PRESETS = [
    { name: 'Basic Title', text: { text: 'Your Title', size: 120, bold: true }, props: {} },
    {
      name: 'Lower Third',
      text: { text: 'Name Surname\nRole or subtitle', size: 62, align: 'left', bgColor: '#000000', bgOpacity: 60, bold: true },
      props: { x: -36, y: 34 },
    },
    {
      name: 'Centered Subtitle',
      text: { text: 'Subtitle text', size: 56, color: '#ffe066', stroke: '#000000', strokeWidth: 6 },
      props: { y: 36 },
    },
    { name: 'Big Number', text: { text: '3', size: 360, bold: true }, props: {} },
    { name: 'Credits', text: { text: 'Directed by\nYour Name', size: 72, lineHeight: 1.5 }, props: {} },
    {
      name: 'Caption Box',
      text: { text: 'Caption text here', size: 50, bgColor: '#000000', bgOpacity: 75, maxWidth: 70 },
      props: { y: 38 },
    },
  ];

  /* ---------- shapes (Essential Graphics) ---------- */

  // Shape clips are drawn in the frame. Width and height are percentages of the frame.
  AVP.defaultShape = function (type) {
    return { type: type || 'rect', fill: '#4ea1ff', stroke: '#000000', strokeWidth: 0, width: 40, height: 20, radius: 0 };
  };

  /* ---------- clip model ---------- */

  AVP.cloneClip = function (c, overrides) {
    return Object.assign(JSON.parse(JSON.stringify(c)), overrides || {});
  };

  // Fills in every field a clip needs, so older project files keep working.
  AVP.normalizeClip = function (c) {
    const out = Object.assign(
      {
        id: AVP.uid(),
        kind: 'media',
        mediaId: null,
        track: 'V1',
        start: 0,
        inPoint: 0,
        duration: 1,
        speed: 1,
        linkId: null,
        enabled: true,
        props: AVP.defaultProps(),
        keys: {},
        fx: [],
        transIn: null,
        transOut: null,
        text: null,
      },
      c
    );
    // v1.0 projects stored opacity/scale/volume as fractions.
    if (c.opacity !== undefined || c.scale !== undefined || c.volume !== undefined) {
      out.props = Object.assign(AVP.defaultProps(), out.props, {
        opacity: c.opacity !== undefined ? c.opacity * 100 : 100,
        scale: c.scale !== undefined ? c.scale * 100 : 100,
        volume: c.volume !== undefined ? c.volume * 100 : 100,
      });
      delete out.opacity;
      delete out.scale;
      delete out.volume;
    }
    out.props = Object.assign(AVP.defaultProps(), out.props || {});
    out.keys = out.keys || {};
    out.fx = out.fx || [];
    out.speed = out.speed || 1;
    if (out.kind === 'title') out.text = Object.assign({}, AVP.TEXT_DEFAULTS, out.text || {});
    if (out.kind === 'shape') out.shape = Object.assign(AVP.defaultShape(), out.shape || {});
    return out;
  };

  // Keyframe times are clip-local; when a clip is cut, keys move with the right-hand piece.
  AVP.shiftKeys = function (keys, offset) {
    const out = {};
    Object.keys(keys || {}).forEach((k) => {
      const list = keys[k] || [];
      if (!list.length) return;
      const shifted = [];
      if (offset > EPS) {
        // Cutting away the start: keep the value at the new start as the first key.
        shifted.push({ t: 0, v: AVP.evalKeys(list, offset, list[0].v) });
      }
      list.forEach((p) => {
        if (offset > EPS && p.t <= offset + EPS) return;
        shifted.push({ t: p.t - offset, v: p.v });
      });
      out[k] = shifted;
    });
    return out;
  };

  /* ---------- keyframes ---------- */

  AVP.evalKeys = function (keys, localT, base) {
    if (!keys || !keys.length) return base;
    if (localT <= keys[0].t) return keys[0].v;
    const last = keys[keys.length - 1];
    if (localT >= last.t) return last.v;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (localT >= a.t && localT <= b.t) {
        const k = (localT - a.t) / (b.t - a.t || 1);
        return a.v + (b.v - a.v) * k;
      }
    }
    return last.v;
  };

  // Adds or updates a keyframe at local time t (keeps the list sorted).
  AVP.setKey = function (keys, t, v) {
    const i = keys.findIndex((k) => Math.abs(k.t - t) < 1e-3);
    if (i >= 0) keys[i].v = v;
    else {
      keys.push({ t, v });
      keys.sort((a, b) => a.t - b.t);
    }
  };

  AVP.propAt = function (c, key, absT) {
    const def = AVP.PROP_DEFS[key];
    const base = c.props[key] !== undefined ? c.props[key] : def ? def.def : 0;
    return AVP.evalKeys(c.keys && c.keys[key], absT - c.start, base);
  };

  AVP.fxParamAt = function (c, fx, name, absT) {
    const def = AVP.effectParamDef(fx.type, name);
    const base = fx.params[name] !== undefined ? fx.params[name] : def ? def.def : 0;
    return AVP.evalKeys(c.keys && c.keys['fx:' + fx.id + ':' + name], absT - c.start, base);
  };

  /* ---------- transitions: timing ---------- */

  // Shared boundary between a clip and the one after it. Duration is the shorter of the
  // transition length and both clips, so a transition never runs past a clip.
  function boundary(prev, cur) {
    const tin = cur.transIn;
    return { type: tin.type, d: Math.min(tin.duration, prev.duration, cur.duration) };
  }

  /*
   * Works out when a clip is fading or wiping in and out. `sameTrack` holds the clips on
   * this clip's track. A transition lives on the incoming clip (`transIn`). When a clip
   * has a neighbour touching its start, the transition is centred on that edge; otherwise
   * it runs from the start of the clip (fade in from black or nothing).
   */
  AVP.roleWindows = function (c, sameTrack) {
    const end = c.start + c.duration;
    const prev = sameTrack.find((o) => o.id !== c.id && Math.abs(AVP.clipEnd(o) - c.start) < EPS);
    const next = sameTrack.find((o) => o.id !== c.id && Math.abs(o.start - end) < EPS);
    let inRole = null;
    let outRole = null;

    if (c.transIn) {
      if (prev) {
        const b = boundary(prev, c);
        inRole = { type: b.type, centered: true, a: c.start - b.d / 2, b: c.start + b.d / 2 };
      } else {
        const d = Math.min(c.transIn.duration, c.duration);
        inRole = { type: c.transIn.type, centered: false, a: c.start, b: c.start + d };
      }
    }
    if (next) {
      if (next.transIn) {
        const b = boundary(c, next);
        outRole = { type: b.type, centered: true, a: end - b.d / 2, b: end + b.d / 2 };
      }
    } else if (c.transOut) {
      const d = Math.min(c.transOut.duration, c.duration);
      outRole = { type: c.transOut.type, centered: false, a: end - d, b: end };
    }

    return {
      in: inRole,
      out: outRole,
      ext0: inRole && inRole.centered ? inRole.a : c.start,
      ext1: outRole && outRole.centered ? outRole.b : end,
    };
  };

  AVP.isVisibleAt = function (R, t) {
    return t >= R.ext0 - EPS && t < R.ext1 - EPS;
  };

  function applyIn(v, role, p) {
    switch (role.type) {
      case 'dissolve':
        v.alpha *= p;
        break;
      case 'dip-black':
      case 'dip-white': {
        const col = role.type === 'dip-black' ? '#000000' : '#ffffff';
        if (role.centered) {
          v.alpha *= Math.max(0, 2 * p - 1);
          v.before = { color: col, alpha: 1 - Math.abs(2 * p - 1) };
        } else {
          v.alpha *= p;
          v.before = { color: col, alpha: 1 - p };
        }
        break;
      }
      case 'wipe-lr':
        v.clip = { x: 0, y: 0, w: p, h: 1 };
        break;
      case 'wipe-rl':
        v.clip = { x: 1 - p, y: 0, w: p, h: 1 };
        break;
      case 'wipe-tb':
        v.clip = { x: 0, y: 0, w: 1, h: p };
        break;
      case 'slide-in-right':
        v.dx += 1 - p;
        break;
      case 'slide-in-left':
        v.dx -= 1 - p;
        break;
      case 'zoom':
        v.scale *= 0.5 + 0.5 * p;
        v.alpha *= p;
        break;
      case 'slide-in-bottom':
        v.dy += 1 - p;
        break;
      case 'slide-in-top':
        v.dy -= 1 - p;
        break;
      case 'spin':
        v.alpha *= p;
        v.rot += (p - 1) * 180;
        break;
      case 'wipe-diag':
      case 'wipe-box':
      case 'iris':
        v.mask = { type: role.type, p };
        break;
      default:
        break; // audio-fade and unknown types leave the picture alone
    }
  }

  function applyOut(v, role, p) {
    switch (role.type) {
      case 'dissolve':
        v.alpha *= 1 - p;
        break;
      case 'dip-black':
      case 'dip-white': {
        const col = role.type === 'dip-black' ? '#000000' : '#ffffff';
        if (role.centered) v.alpha *= Math.max(0, 1 - 2 * p);
        else {
          v.alpha *= 1 - p;
          v.after = { color: col, alpha: p };
        }
        break;
      }
      case 'wipe-lr':
      case 'wipe-rl':
      case 'wipe-tb':
        if (!role.centered) v.alpha *= 1 - p;
        break;
      case 'slide-in-right':
        v.dx -= p;
        break;
      case 'slide-in-left':
        v.dx += p;
        break;
      case 'zoom':
        v.scale *= 1 - 0.2 * p;
        v.alpha *= 1 - p;
        break;
      case 'slide-in-bottom':
        v.dy -= p;
        break;
      case 'slide-in-top':
        v.dy += p;
        break;
      case 'spin':
        v.alpha *= 1 - p;
        v.rot += p * 180;
        break;
      case 'wipe-diag':
      case 'wipe-box':
      case 'iris':
        if (!role.centered) v.alpha *= 1 - p;
        break;
      default:
        break;
    }
  }

  /*
   * Visual state of one clip at absolute time t. Returns alpha (0..1), frame-fraction
   * offsets dx/dy, a scale multiplier, an optional wipe rectangle (fractions of the frame),
   * and optional full-frame colour overlays drawn before / after the clip.
   */
  AVP.visualAt = function (R, t) {
    const v = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, clip: null, mask: null, before: null, after: null };
    if (R.in && t >= R.in.a - EPS && t < R.in.b) {
      applyIn(v, R.in, clamp01((t - R.in.a) / (R.in.b - R.in.a)));
    }
    if (R.out && t >= R.out.a - EPS && t < R.out.b + EPS) {
      applyOut(v, R.out, clamp01((t - R.out.a) / (R.out.b - R.out.a)));
    }
    return v;
  };

  // Audio gain multiplier from constant-gain transitions at time t.
  AVP.audioRamp = function (R, t) {
    let g = 1;
    if (R.in && R.in.type === 'audio-fade' && t >= R.in.a - EPS && t < R.in.b) {
      g *= clamp01((t - R.in.a) / (R.in.b - R.in.a));
    }
    if (R.out && R.out.type === 'audio-fade' && t >= R.out.a - EPS && t < R.out.b + EPS) {
      g *= 1 - clamp01((t - R.out.a) / (R.out.b - R.out.a));
    }
    return g;
  };

  /* ---------- filters ---------- */

  // Builds a CSS filter string for the colour / blur effects on a clip.
  AVP.buildFilter = function (c, absT) {
    const parts = [];
    (c.fx || []).forEach((fx) => {
      if (!fx.enabled) return;
      const P = (k) => AVP.fxParamAt(c, fx, k, absT);
      switch (fx.type) {
        case 'brightness': {
          const b = P('brightness');
          const ct = P('contrast');
          if (b) parts.push(`brightness(${(1 + b / 100).toFixed(3)})`);
          if (ct) parts.push(`contrast(${(1 + ct / 100).toFixed(3)})`);
          break;
        }
        case 'saturation': {
          const s = P('amount');
          if (s !== 100) parts.push(`saturate(${(s / 100).toFixed(3)})`);
          break;
        }
        case 'hue': {
          const a = P('angle');
          if (a) parts.push(`hue-rotate(${a.toFixed(1)}deg)`);
          break;
        }
        case 'grayscale': {
          const a = P('amount');
          if (a) parts.push(`grayscale(${(a / 100).toFixed(3)})`);
          break;
        }
        case 'sepia': {
          const a = P('amount');
          if (a) parts.push(`sepia(${(a / 100).toFixed(3)})`);
          break;
        }
        case 'invert': {
          const a = P('amount');
          if (a) parts.push(`invert(${(a / 100).toFixed(3)})`);
          break;
        }
        case 'lumetri': {
          if (AVP.gpuOk) break; // the shader does the work
          const e = P('exposure');
          const ct = P('contrast');
          const sat = P('saturation');
          if (e) parts.push(`brightness(${Math.pow(2, e).toFixed(3)})`);
          if (ct) parts.push(`contrast(${(1 + ct / 100).toFixed(3)})`);
          if (sat !== 100) parts.push(`saturate(${(sat / 100).toFixed(3)})`);
          break;
        }
        case 'blur': {
          const r = P('radius');
          if (r > 0) parts.push(`blur(${r.toFixed(2)}px)`);
          break;
        }
        default:
          break;
      }
    });
    return parts.length ? parts.join(' ') : 'none';
  };

  // Transition types that can sit on a clip on this track kind.
  AVP.transitionsFor = function (kind) {
    return Object.keys(AVP.TRANSITIONS).filter((k) => (kind === 'audio' ? AVP.TRANSITIONS[k].audio : !AVP.TRANSITIONS[k].audio));
  };
  /* ---------- Essential Sound ---------- */

  // Each audio type sets a starting point. Targets are integrated loudness in LUFS (BS.1770).
  AVP.SOUND_PRESETS = {
    dialogue: { label: 'Dialogue', lowCut: 90, presence: 4, compress: true, target: -16, duck: 0 },
    music: { label: 'Music', lowCut: 40, presence: 0, compress: false, target: -20, duck: 6 },
    sfx: { label: 'Sound Effects', lowCut: 60, presence: 2, compress: false, target: -16, duck: 0 },
    ambience: { label: 'Ambience', lowCut: 50, presence: -2, compress: false, target: -24, duck: 4 },
  };

  // Settings for a clip's sound. Clips without any change get neutral settings.
  //   lowCut (Hz), presence (dB), compress, target (LUFS), autoMatch (loudness match on/off),
  //   noiseReduce (0..100, a gate that closes between speech), reverb (0..100, a send to a room),
  //   duck (dB to lower this clip while any dialogue clip plays).
  AVP.soundOf = function (c) {
    return Object.assign(
      {
        type: 'dialogue',
        enabled: true,
        autoMatch: false,
        lowCut: 20,
        presence: 0,
        compress: false,
        target: -16,
        noiseReduce: 0,
        reverb: 0,
        duck: 0,
      },
      c.sound || {}
    );
  };

  // Applies a preset, keeping the enabled, loudness-match, noise, reverb choices.
  AVP.applySoundPreset = function (c, type) {
    const p = AVP.SOUND_PRESETS[type] || AVP.SOUND_PRESETS.dialogue;
    const cur = AVP.soundOf(c);
    c.sound = Object.assign({}, cur, {
      type,
      lowCut: p.lowCut,
      presence: p.presence,
      compress: p.compress,
      target: p.target,
      duck: p.duck,
    });
  };
})();
