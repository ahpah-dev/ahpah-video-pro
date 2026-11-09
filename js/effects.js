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
    chromatic: {
      name: 'Chromatic Aberration',
      cat: 'Stylize',
      params: [
        { k: 'amount', label: 'Amount', min: 0, max: 100, def: 30, unit: '%' },
        { k: 'angle', label: 'Direction', min: 0, max: 360, def: 0, unit: '°' },
      ],
    },
    glitch: {
      name: 'Glitch',
      cat: 'Stylize',
      params: [
        { k: 'amount', label: 'Amount', min: 0, max: 100, def: 40, unit: '%' },
        { k: 'slices', label: 'Slices', min: 2, max: 40, def: 12 },
        { k: 'rate', label: 'Changes per second', min: 1, max: 30, def: 8 },
        { k: 'rgb', label: 'Colour split', min: 0, max: 100, def: 40, unit: '%' },
      ],
    },
    vhs: {
      name: 'VHS Tape',
      cat: 'Stylize',
      params: [{ k: 'amount', label: 'Amount', min: 0, max: 100, def: 50, unit: '%' }],
    },
    wave: {
      name: 'Wave Warp',
      cat: 'Distort',
      params: [
        { k: 'amount', label: 'Height', min: 0, max: 100, def: 20, unit: 'px' },
        { k: 'wavelength', label: 'Wavelength', min: 10, max: 100, def: 40, unit: '%' },
        { k: 'speed', label: 'Speed', min: 0, max: 10, def: 2, step: 0.1 },
      ],
    },
    mirror: {
      name: 'Mirror',
      cat: 'Distort',
      params: [{ k: 'side', label: 'Side (0 left, 1 right, 2 top, 3 bottom)', min: 0, max: 3, def: 0 }],
    },
    'radial-blur': {
      name: 'Radial Blur (Zoom)',
      cat: 'Blur & Sharpen',
      params: [
        { k: 'amount', label: 'Amount', min: 0, max: 100, def: 30, unit: '%' },
        { k: 'x', label: 'Centre X', min: 0, max: 100, def: 50, unit: '%' },
        { k: 'y', label: 'Centre Y', min: 0, max: 100, def: 50, unit: '%' },
      ],
    },
    duotone: {
      name: 'Duotone',
      cat: 'Color Correction',
      params: [
        { k: 'shadow', label: 'Shadow colour (hue)', min: 0, max: 360, def: 240, unit: '°' },
        { k: 'highlight', label: 'Highlight colour (hue)', min: 0, max: 360, def: 35, unit: '°' },
        { k: 'amount', label: 'Amount', min: 0, max: 100, def: 100, unit: '%' },
      ],
    },
    threshold: {
      name: 'Threshold (Black or White)',
      cat: 'Color Correction',
      params: [{ k: 'level', label: 'Level', min: 5, max: 95, def: 50, unit: '%' }],
    },
    'night-vision': {
      name: 'Night Vision',
      cat: 'Stylize',
      params: [{ k: 'gain', label: 'Gain', min: 50, max: 300, def: 140, unit: '%' }],
    },
    shake: {
      name: 'Camera Shake',
      cat: 'Transform',
      params: [
        { k: 'amount', label: 'Strength', min: 0, max: 30, def: 4, step: 0.1, unit: '%' },
        { k: 'speed', label: 'Speed', min: 1, max: 30, def: 12, unit: ' Hz' },
        { k: 'roll', label: 'Roll', min: 0, max: 10, def: 0.6, step: 0.1, unit: '°' },
      ],
    },
    'ken-burns': {
      name: 'Ken Burns (Slow Zoom)',
      cat: 'Transform',
      params: [
        { k: 'start', label: 'Start scale', min: 50, max: 300, def: 100, unit: '%' },
        { k: 'end', label: 'End scale', min: 50, max: 300, def: 125, unit: '%' },
        { k: 'panX', label: 'Drift X', min: -50, max: 50, def: 0, unit: '%' },
        { k: 'panY', label: 'Drift Y', min: -50, max: 50, def: 0, unit: '%' },
      ],
    },
  };

  /*
   * Looks: one click adds a stack of effects to a clip. Each entry is [effect type, parameter overrides].
   */
  AVP.LOOKS = [
    { name: 'Cinematic', fx: [['brightness', { contrast: 14 }], ['saturation', { amount: 92 }], ['tint', { hue: 200, amount: 12 }], ['vignette', { amount: 40, size: 55 }], ['letterbox', { size: 11 }]] },
    { name: 'Vintage Film', fx: [['sepia', { amount: 45 }], ['brightness', { brightness: 4, contrast: -8 }], ['grain', { amount: 35 }], ['vignette', { amount: 45, size: 50 }]] },
    { name: 'Film Noir', fx: [['grayscale', { amount: 100 }], ['brightness', { contrast: 30 }], ['vignette', { amount: 55, size: 45 }], ['grain', { amount: 25 }]] },
    { name: 'Dreamy Glow', fx: [['glow', { amount: 45, radius: 26 }], ['brightness', { brightness: 6 }], ['saturation', { amount: 115 }]] },
    { name: 'Cyberpunk', fx: [['tint', { hue: 300, amount: 22 }], ['saturation', { amount: 130 }], ['chromatic', { amount: 35, angle: 0 }], ['glow', { amount: 25, radius: 18 }], ['scan-lines', { amount: 18, spacing: 4 }]] },
    { name: 'Old VHS', fx: [['vhs', { amount: 60 }], ['saturation', { amount: 120 }], ['grain', { amount: 20 }]] },
    { name: 'Glitch Hit', fx: [['glitch', { amount: 60, slices: 14, rate: 10, rgb: 55 }], ['chromatic', { amount: 25, angle: 0 }]] },
    { name: 'Night Vision', fx: [['night-vision', { gain: 150 }], ['grain', { amount: 30 }], ['vignette', { amount: 50, size: 45 }]] },
    { name: 'Duotone Pop', fx: [['duotone', { shadow: 265, highlight: 20, amount: 100 }], ['brightness', { contrast: 10 }]] },
    { name: 'Slow Push In', fx: [['ken-burns', { start: 100, end: 122, panX: 0, panY: 0 }]] },
    { name: 'Handheld', fx: [['shake', { amount: 2.5, speed: 9, roll: 0.4 }]] },
  ];

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
    'zoom-through': { name: 'Zoom Through', cat: 'Motion', dur: 1, audio: false },
    'whip-pan': { name: 'Whip Pan', cat: 'Motion', dur: 1, audio: false },
    'blur-dissolve': { name: 'Blur Dissolve', cat: 'Dissolve', dur: 1, audio: false },
    'clock-wipe': { name: 'Clock Wipe', cat: 'Wipe', dur: 1, audio: false },
    'checker-wipe': { name: 'Checkerboard Wipe', cat: 'Wipe', dur: 1, audio: false },
    'random-blocks': { name: 'Random Blocks', cat: 'Wipe', dur: 1, audio: false },
    blinds: { name: 'Venetian Blinds', cat: 'Wipe', dur: 1, audio: false },
    flash: { name: 'Flash', cat: 'Dissolve', dur: 0.6, audio: false },
    // glow: how strongly the picture blooms at the middle of the transition, in percent. Editable per transition.
    'glow-dissolve': { name: 'Glow Dissolve', cat: 'Dissolve', dur: 1, audio: false, glow: 60 },
    'cross-zoom': { name: 'Cross Zoom', cat: 'Dissolve', dur: 1, audio: false },
    'barn-doors': { name: 'Barn Doors (open sideways)', cat: 'Wipe', dur: 1, audio: false },
    'barn-doors-v': { name: 'Barn Doors (open up and down)', cat: 'Wipe', dur: 1, audio: false },
    'diamond-wipe': { name: 'Diamond Wipe', cat: 'Wipe', dur: 1, audio: false },
    'star-wipe': { name: 'Star Wipe', cat: 'Wipe', dur: 1, audio: false },
    'bounce-in': { name: 'Bounce In', cat: 'Motion', dur: 1, audio: false },
    'spin-zoom': { name: 'Spin Zoom', cat: 'Motion', dur: 1, audio: false },
    'whip-pan-up': { name: 'Whip Pan Up', cat: 'Motion', dur: 1, audio: false },
    glitch: { name: 'Glitch', cat: 'Stylized', dur: 0.8, audio: false },
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
    anim: 'none', // text animation, see AVP.TEXT_ANIMATIONS
    animDur: 0.6, // seconds for one letter (or word, line) to finish its animation
    animDelay: 0, // seconds from the clip's start before the animation begins
    animStagger: 0.04, // seconds between one letter and the next
    animOut: 'none', // animation that plays at the end of the clip, see AVP.TEXT_OUT_ANIMATIONS
    animOutDur: 0.5, // seconds for one letter (or word) to finish leaving
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
    { name: 'Pop In, Fade Out', text: { text: 'Your Title', size: 130, bold: true, anim: 'elastic', animDur: 0.7, animStagger: 0.05, animOut: 'letter-fade', animOutDur: 0.4 }, props: {} },
    { name: 'Typewriter Caption', text: { text: 'Typed one letter at a time', size: 64, anim: 'typewriter', animStagger: 0.05, bgColor: '#000000', bgOpacity: 55 }, props: { y: 34 } },
    { name: 'Glitch Intro', text: { text: 'GLITCH', size: 190, bold: true, color: '#00f0ff', anim: 'glitch', animDur: 0.8, animStagger: 0.06, animOut: 'glitch', animOutDur: 0.5 }, props: {} },
    { name: 'Neon Sign', text: { text: 'OPEN', size: 220, bold: true, color: '#ff4fd8', stroke: '#ffffff', strokeWidth: 2, anim: 'neon-flicker', animDur: 0.8, animStagger: 0.12 }, props: {} },
    { name: 'Cinematic Spread', text: { text: 'A FILM BY YOU', size: 84, anim: 'spread', animDur: 1.4, animStagger: 0.02, animOut: 'letter-fade', animOutDur: 0.6 }, props: {} },
    { name: 'Rainbow Bounce', text: { text: 'Party time!', size: 150, bold: true, anim: 'rainbow', animStagger: 0.05 }, props: {} },
    { name: 'Slide-in Lower Third', text: { text: 'Name Surname\nRole or subtitle', size: 60, align: 'left', bold: true, bgColor: '#000000', bgOpacity: 60, anim: 'letter-slide-left', animDur: 0.5, animStagger: 0.015, animOut: 'letter-slide-right', animOutDur: 0.4 }, props: { x: -36, y: 34 } },
    { name: 'Credits', text: { text: 'Directed by\nYour Name', size: 72, lineHeight: 1.5 }, props: {} },
    {
      name: 'Caption Box',
      text: { text: 'Caption text here', size: 50, bgColor: '#000000', bgOpacity: 75, maxWidth: 70 },
      props: { y: 38 },
    },
  ];

  /* ---------- text animations ---------- */

  // Animations a title can play. The clip's text is split into letters (or words), and each one moves
  // on its own schedule: it starts after the delay plus its place in the sequence times the stagger.
  AVP.TEXT_ANIMATIONS = [
    { v: 'none', label: 'None' },
    { v: 'typewriter', label: 'Typewriter (letters in order, with cursor)' },
    { v: 'letter-pop', label: 'Letter pop (overshoot)' },
    { v: 'word-pop', label: 'Word pop' },
    { v: 'letter-fade', label: 'Letter fade' },
    { v: 'letter-rise', label: 'Letter rise' },
    { v: 'letter-drop', label: 'Letter drop (bounce)' },
    { v: 'letter-spin', label: 'Letter spin' },
    { v: 'glitch', label: 'Glitch in' },
    { v: 'wave', label: 'Wave (keeps moving)' },
    { v: 'letter-slide-left', label: 'Letter slide (from the left)' },
    { v: 'letter-slide-right', label: 'Letter slide (from the right)' },
    { v: 'letter-zoom', label: 'Letter zoom (shrinks into place)' },
    { v: 'letter-flip', label: 'Letter flip' },
    { v: 'elastic', label: 'Elastic (springy pop)' },
    { v: 'blur-in', label: 'Blur in (focus pull)' },
    { v: 'spread', label: 'Spread (letters fly out from the middle)' },
    { v: 'neon-flicker', label: 'Neon flicker on' },
    { v: 'jitter', label: 'Jitter (keeps shaking)' },
    { v: 'rainbow', label: 'Rainbow (keeps cycling colour)' },
    { v: 'word-rise', label: 'Word rise' },
    { v: 'word-fade', label: 'Word fade' },
    { v: 'wipe-reveal', label: 'Wipe reveal (whole text)' },
  ];

  // Animations that can play at the end of a title: the entrances played backwards, last letter in, first out.
  // The ones that keep moving (wave, jitter, rainbow) make no sense as an exit.
  AVP.TEXT_OUT_ANIMATIONS = AVP.TEXT_ANIMATIONS.filter((a) => ['wave', 'jitter', 'rainbow'].indexOf(a.v) < 0);

  // Animations that move whole words rather than letters.
  AVP.textAnimByWord = (type) => type === 'word-pop' || type === 'word-rise' || type === 'word-fade';

  // Easing curves. out: slows down at the end. back: overshoots and settles. bounce: drops and bounces.
  AVP.ease = {
    out: (p) => 1 - Math.pow(1 - p, 3),
    back: (p) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    },
    bounce: (p) => {
      const n = 7.5625;
      const d = 2.75;
      if (p < 1 / d) return n * p * p;
      if (p < 2 / d) {
        p -= 1.5 / d;
        return n * p * p + 0.75;
      }
      if (p < 2.5 / d) {
        p -= 2.25 / d;
        return n * p * p + 0.9375;
      }
      p -= 2.625 / d;
      return n * p * p + 0.984375;
    },
  };

  // Deterministic pseudo-random value in [0, 1), so glitch frames are the same each time a moment is drawn.
  const noise01 = (a, b) => {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };

  /*
   * The transform of one unit (letter or word) at local time localT. k is the unit's place among the
   * visible units, o holds { dur, delay, stagger, size } in the same units as localT. Returns
   * { alpha, s (scale), dx, dy (offsets in px), rot (radians) }.
   */
  AVP.textUnitState = function (type, localT, k, o) {
    const start = o.delay + k * o.stagger;
    const p = clamp01((localT - start) / o.dur);
    const st = { alpha: 1, s: 1, dx: 0, dy: 0, rot: 0, sx: 1, blur: 0, hue: null };
    switch (type) {
      case 'typewriter':
        st.alpha = localT > start ? 1 : 0; // strictly after, so played backwards (an exit) the last letter is gone at the end
        break;
      case 'letter-slide-left':
        st.dx = -(1 - AVP.ease.out(p)) * o.size * 1.4;
        st.alpha = clamp01(p * 2);
        break;
      case 'letter-slide-right':
        st.dx = (1 - AVP.ease.out(p)) * o.size * 1.4;
        st.alpha = clamp01(p * 2);
        break;
      case 'letter-zoom':
        st.s = 1 + (1 - AVP.ease.out(p)) * 2.5;
        st.alpha = p;
        break;
      case 'letter-flip':
        st.sx = Math.sin((AVP.ease.out(p) * Math.PI) / 2); // turns from edge-on to face-on
        st.alpha = clamp01(p * 3);
        break;
      case 'elastic':
        st.s = p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin(((p * 10 - 0.75) * 2 * Math.PI) / 3) + 1;
        st.alpha = clamp01(p * 5);
        break;
      case 'blur-in':
        st.blur = (1 - p) * o.size * 0.25;
        st.alpha = p;
        break;
      case 'spread':
        st.dx = (1 - AVP.ease.out(p)) * (k - ((o.total || 1) - 1) / 2) * o.size * 0.9;
        st.alpha = clamp01(p * 2);
        break;
      case 'neon-flicker':
        if (localT <= start) st.alpha = 0;
        else if (p < 1) st.alpha = noise01(k, Math.floor(localT * 30)) < p * 0.7 + 0.15 ? 1 : 0.1;
        break;
      case 'jitter':
        if (localT < start) st.alpha = 0;
        else {
          const f = Math.floor(localT * 20);
          st.dx = (noise01(k, f) - 0.5) * o.size * 0.07;
          st.dy = (noise01(k + 5, f) - 0.5) * o.size * 0.07;
        }
        break;
      case 'rainbow':
        if (localT < start) st.alpha = 0;
        else st.hue = (localT * 180 + k * 25) % 360;
        break;
      case 'word-rise':
        st.dy = (1 - AVP.ease.out(p)) * o.size * 0.6;
        st.alpha = p;
        break;
      case 'word-fade':
        st.alpha = p;
        break;
      case 'letter-pop':
      case 'word-pop':
        st.s = Math.max(0, AVP.ease.back(p));
        st.alpha = clamp01(p * 3);
        break;
      case 'letter-fade':
        st.alpha = p;
        break;
      case 'letter-rise':
        st.dy = (1 - AVP.ease.out(p)) * o.size * 0.6;
        st.alpha = p;
        break;
      case 'letter-drop':
        st.dy = -(1 - AVP.ease.bounce(p)) * o.size * 1.1;
        st.alpha = clamp01(p * 4);
        break;
      case 'letter-spin':
        st.rot = -(1 - AVP.ease.out(p)) * Math.PI * 2;
        st.s = AVP.ease.out(p);
        st.alpha = p;
        break;
      case 'glitch':
        if (localT < start) st.alpha = 0;
        else if (p < 1) {
          const f = Math.floor(localT * 24);
          st.dx = (noise01(k, f) - 0.5) * o.size * 0.5 * (1 - p);
          st.alpha = noise01(k + 7, f) < p * 0.6 + 0.3 ? 1 : 0.15;
        }
        break;
      case 'wave':
        if (localT >= start) st.dy = Math.sin((2 * Math.PI * (localT - start)) / (o.dur * 2) - k * 0.5) * o.size * 0.12;
        break;
      default:
        break; // none, and the whole-text wipe, which render.js handles
    }
    return st;
  };

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
  /*
   * Keyframes for the part of a clip between local times a and b (b may be null for the end), moved so
   * that a becomes 0. The values at both ends are worked out from the curve, so the picture does not jump
   * at a cut, a trim or a speed change, and no keyframe is left outside the clip.
   */
  AVP.rangeKeys = function (keys, a, b) {
    const out = {};
    Object.keys(keys || {}).forEach((k) => {
      const list = keys[k] || [];
      if (!list.length) return;
      const shifted = [{ t: 0, v: AVP.evalKeys(list, a, list[0].v) }];
      list.forEach((p) => {
        if (p.t > a + EPS && (b == null || p.t < b - EPS)) shifted.push({ t: p.t - a, v: p.v });
      });
      if (b != null && b - a > EPS) shifted.push({ t: b - a, v: AVP.evalKeys(list, b, list[list.length - 1].v) });
      out[k] = shifted;
    });
    return out;
  };

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

  /* ---------- speed ramps (time remapping) ---------- */

  /*
   * A clip plays at c.speed, times a ramp: the keyframes in c.keys.speed, in percent (100 = no change),
   * joined by straight lines, so the picture eases from one speed to the next. With no keys the clip plays
   * at the constant speed c.speed, exactly as before. Key times are clip-local seconds, so cuts, trims and
   * speed changes move them with the clip like any other keyframe.
   */
  AVP.RAMP_MIN = 10; // percent: slowest a ramp may go
  AVP.RAMP_MAX = 1600; // percent: fastest

  AVP.hasRamp = function (c) {
    return !!(c && c.keys && c.keys.speed && c.keys.speed.length);
  };

  // Speed (source seconds per timeline second) at clip-local time tl.
  AVP.speedAt = function (c, tl) {
    const sp = c.speed || 1;
    if (!AVP.hasRamp(c)) return sp;
    return (sp * AVP.evalKeys(c.keys.speed, tl, 100)) / 100;
  };

  // Source seconds used by the first tl seconds of the clip: the area under the speed curve.
  // Before the first key and after the last the speed holds, so a negative tl (a clip trimmed longer at its
  // head) is just as exact.
  AVP.srcOffset = function (c, tl) {
    const sp = c.speed || 1;
    if (!AVP.hasRamp(c)) return tl * sp;
    const list = c.keys.speed;
    const f = sp / 100;
    if (tl <= 0) return tl * f * list[0].v;
    let acc = 0;
    let t0 = 0;
    let v0 = list[0].v;
    if (list[0].t > 0) {
      const e = Math.min(tl, list[0].t);
      acc += e * v0;
      t0 = e;
      if (e >= tl) return acc * f;
    }
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (b.t <= t0 || a.t >= tl) continue;
      const from = Math.max(a.t, t0);
      const to = Math.min(b.t, tl);
      const span = b.t - a.t || 1;
      const va = a.v + ((b.v - a.v) * (from - a.t)) / span;
      const vb = a.v + ((b.v - a.v) * (to - a.t)) / span;
      acc += ((va + vb) / 2) * (to - from);
      t0 = to;
      if (to >= tl) return acc * f;
    }
    const last = list[list.length - 1];
    if (tl > Math.max(t0, last.t)) acc += (tl - Math.max(t0, last.t)) * last.v;
    return acc * f;
  };

  // How long the clip must run to use `span` source seconds (the inverse of srcOffset).
  AVP.timeForSrc = function (c, span) {
    if (!AVP.hasRamp(c)) return span / (c.speed || 1);
    const minV = Math.max(1, Math.min.apply(null, c.keys.speed.map((k) => k.v)));
    let lo = 0;
    let hi = span / (((c.speed || 1) * minV) / 100) + 1;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (AVP.srcOffset(c, mid) < span) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  // Speed ramps offered in the Time Remapping section. make(d) returns the keys for a clip d seconds long.
  const rampKeys = (d, pts) => pts.map(([f, v]) => ({ t: +(f * d).toFixed(4), v }));
  AVP.SPEED_RAMPS = [
    { name: 'Slow down (ease out)', make: (d) => rampKeys(d, [[0, 100], [1, 25]]) },
    { name: 'Speed up (ease in)', make: (d) => rampKeys(d, [[0, 100], [1, 300]]) },
    { name: 'Hero moment (fast, slow, fast)', make: (d) => rampKeys(d, [[0, 100], [0.3, 100], [0.4, 25], [0.65, 25], [0.75, 100], [1, 100]]) },
    { name: 'Impact (burst, then settle)', make: (d) => rampKeys(d, [[0, 400], [0.3, 100], [1, 100]]) },
    { name: 'Slow to a crawl', make: (d) => rampKeys(d, [[0, 100], [0.6, 100], [1, 10]]) },
    { name: 'Pulse (fast and slow, repeating)', make: (d) => rampKeys(d, [[0, 200], [0.17, 40], [0.33, 200], [0.5, 40], [0.67, 200], [0.83, 40], [1, 200]]) },
    { name: 'Rush through the middle', make: (d) => rampKeys(d, [[0, 100], [0.25, 100], [0.4, 500], [0.6, 500], [0.75, 100], [1, 100]]) },
  ];

  // Source seconds a clip uses, so the editor can warn when a ramp would run past the end of the file.
  AVP.sourceSpan = function (c) {
    return AVP.srcOffset(c, c.duration);
  };

  /* ---------- transitions: timing ---------- */

  // Shared boundary between a clip and the one after it. Duration is the shorter of the
  // transition length and both clips, so a transition never runs past a clip.
  function boundary(prev, cur) {
    const tin = cur.transIn;
    return { type: tin.type, d: Math.min(tin.duration, prev.duration, cur.duration), glow: tin.glow };
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
        inRole = { type: b.type, centered: true, a: c.start - b.d / 2, b: c.start + b.d / 2, glow: b.glow };
      } else {
        const d = Math.min(c.transIn.duration, c.duration);
        inRole = { type: c.transIn.type, centered: false, a: c.start, b: c.start + d, glow: c.transIn.glow };
      }
    }
    if (next) {
      if (next.transIn) {
        const b = boundary(c, next);
        outRole = { type: b.type, centered: true, a: end - b.d / 2, b: end + b.d / 2, glow: b.glow };
      }
    } else if (c.transOut) {
      const d = Math.min(c.transOut.duration, c.duration);
      outRole = { type: c.transOut.type, centered: false, a: end - d, b: end, glow: c.transOut.glow };
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

  // Glow Dissolve: the bloom at the middle of the transition, 0 to 1. A transition made before the setting existed gets the default.
  const glowAmount = (role) => clamp01((role.glow === undefined ? AVP.TRANSITIONS['glow-dissolve'].glow : role.glow) / 100);

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
      case 'zoom-through':
        v.scale *= 1.6 - 0.6 * p;
        v.alpha *= p;
        break;
      case 'whip-pan':
        v.dx += 1 - p;
        v.blur += Math.sin(Math.PI * p) * 24;
        break;
      case 'blur-dissolve':
        v.alpha *= p;
        v.blur += (1 - p) * 14;
        break;
      case 'clock-wipe':
      case 'checker-wipe':
      case 'random-blocks':
      case 'blinds':
      case 'barn-doors':
      case 'barn-doors-v':
      case 'diamond-wipe':
      case 'star-wipe':
        v.mask = { type: role.type, p };
        break;
      case 'glow-dissolve':
        v.alpha *= p;
        v.glow += glowAmount(role) * Math.sin(Math.PI * p);
        break;
      case 'flash':
        if (role.centered) {
          v.alpha *= p < 0.5 ? 0 : 1;
          v.before = { color: '#ffffff', alpha: Math.pow(Math.sin(Math.PI * p), 0.7) };
        } else {
          v.before = { color: '#ffffff', alpha: Math.pow(1 - p, 2) };
        }
        break;
      case 'cross-zoom':
        v.alpha *= p;
        v.scale *= 2 - p;
        v.blur += (1 - p) * 18;
        break;
      case 'bounce-in':
        v.dy -= 1 - AVP.ease.bounce(p);
        break;
      case 'spin-zoom':
        v.alpha *= clamp01(p * 2);
        v.rot += (p - 1) * 360;
        v.scale *= p;
        break;
      case 'whip-pan-up':
        v.dy += 1 - p;
        v.blur += Math.sin(Math.PI * p) * 24;
        break;
      case 'glitch': {
        const f = Math.floor(p * 14);
        v.alpha *= noise01(f, 3) >= p * 1.3 ? 0 : 1;
        v.dx += (noise01(f, 9) - 0.5) * 0.25 * (1 - p);
        break;
      }
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
      case 'zoom-through':
        v.scale *= 1 + 0.6 * p;
        v.alpha *= 1 - p;
        break;
      case 'whip-pan':
        v.dx -= p;
        v.blur += Math.sin(Math.PI * p) * 24;
        break;
      case 'blur-dissolve':
        v.alpha *= 1 - p;
        v.blur += p * 14;
        break;
      case 'clock-wipe':
      case 'checker-wipe':
      case 'random-blocks':
      case 'blinds':
      case 'barn-doors':
      case 'barn-doors-v':
      case 'diamond-wipe':
      case 'star-wipe':
        if (!role.centered) v.alpha *= 1 - p;
        break;
      case 'glow-dissolve':
        v.alpha *= 1 - p;
        v.glow += glowAmount(role) * Math.sin(Math.PI * p);
        break;
      case 'flash':
        if (role.centered) v.alpha *= p < 0.5 ? 1 : 0;
        else {
          v.alpha *= 1 - p;
          v.after = { color: '#ffffff', alpha: p };
        }
        break;
      case 'cross-zoom':
        v.alpha *= 1 - p;
        v.scale *= 1 + p;
        v.blur += p * 18;
        break;
      case 'bounce-in':
        v.dy += p * p;
        v.alpha *= 1 - p * 0.6;
        break;
      case 'spin-zoom':
        v.alpha *= 1 - p;
        v.rot += p * 180;
        v.scale *= 1 + p * 0.5;
        break;
      case 'whip-pan-up':
        v.dy -= p;
        v.blur += Math.sin(Math.PI * p) * 24;
        break;
      case 'glitch': {
        const f = Math.floor(p * 14);
        v.alpha *= noise01(f, 3) < (1 - p) * 1.3 ? 1 : 0;
        v.dx += (noise01(f, 9) - 0.5) * 0.25 * p;
        break;
      }
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
    const v = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, glow: 0, clip: null, mask: null, before: null, after: null };
    if (R.in && t >= R.in.a - EPS && t < R.in.b) {
      applyIn(v, R.in, clamp01((t - R.in.a) / (R.in.b - R.in.a)));
    }
    if (R.out && t >= R.out.a - EPS && t < R.out.b + EPS) {
      applyOut(v, R.out, clamp01((t - R.out.a) / (R.out.b - R.out.a)));
    }
    return v;
  };

  /*
   * Where a transition from the Effects library lands when it is dropped on a clip. `list` holds the clips
   * on the clip's track, `x` is the pointer's distance from the clip's left edge in `width` pixels, and
   * `cutPx` is how close to a cut (a touching clip) the pointer must be to take that cut. Returns the clip
   * and edge to apply to (what applyTransition takes) and the time span the transition will cover, which
   * the timeline shows as a preview. A cut is centred on the boundary; a clip end without a neighbour is
   * an edge transition that starts or ends at the clip's own edge.
   */
  AVP.transitionDropPlan = function (list, c, x, width, cutPx, dur) {
    const end = c.start + c.duration;
    const prev = list.find((o) => o.id !== c.id && Math.abs(o.start + o.duration - c.start) < EPS);
    const next = list.find((o) => o.id !== c.id && Math.abs(o.start - end) < EPS);
    const d = dur || 1;
    let edge;
    if (x < cutPx && prev) edge = 'start';
    else if (width - x < cutPx && next) edge = 'end';
    else edge = x < width / 2 ? 'start' : 'end';
    if (edge === 'start') {
      const centered = !!prev;
      const span = centered ? [c.start - d / 2, c.start + d / 2] : [c.start, c.start + Math.min(d, c.duration)];
      return { clipId: c.id, edge, centered, span };
    }
    const centered = !!next;
    const span = centered ? [end - d / 2, end + d / 2] : [end - Math.min(d, c.duration), end];
    return { clipId: c.id, edge, centered, span };
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
        case 'threshold': {
          // Brightness moves the chosen level to mid-grey, then a huge contrast pushes everything to black or white.
          const level = clamp(P('level'), 5, 95) / 100;
          parts.push('grayscale(1)', `brightness(${(0.5 / level).toFixed(3)})`, 'contrast(10000%)');
          break;
        }
        case 'night-vision':
          parts.push('grayscale(1)', 'contrast(1.25)', `brightness(${(P('gain') / 100).toFixed(3)})`, 'sepia(1)', 'hue-rotate(62deg)', 'saturate(3)');
          break;
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
