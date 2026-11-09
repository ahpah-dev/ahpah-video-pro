/*
 * AhPah Video Pro - shared state, undo history and small helpers.
 * Every module hangs off the global `AVP` namespace. No build step needed.
 */
(function () {
  'use strict';

  const AVP = (window.AVP = window.AVP || {});

  AVP.APP_NAME = 'AhPah Video Pro';
  AVP.VERSION = '1.11.0';
  AVP.EPS = 1e-4;

  /* ---------- tracks ---------- */

  AVP.newTrackSet = function () {
    const tracks = {};
    ['V1', 'V2', 'V3'].forEach((id) => (tracks[id] = { id, kind: 'video', hidden: false, locked: false, volume: 0, pan: 0, send: 0, keys: {} }));
    ['A1', 'A2', 'A3'].forEach((id) => (tracks[id] = { id, kind: 'audio', muted: false, solo: false, locked: false, volume: 0, pan: 0, send: 0, keys: {} }));
    // CC holds caption clips. It sits above the video, so captions never overwrite the picture.
    tracks.CC = { id: 'CC', kind: 'video', caption: true, hidden: false, locked: false, volume: 0, pan: 0, send: 0, keys: {} };
    return { tracks, order: ['CC', 'V3', 'V2', 'V1', 'A1', 'A2', 'A3'] };
  };

  const initialTracks = AVP.newTrackSet();

  AVP.state = {
    projectName: 'Untitled Project',
    seqWidth: 1920,
    seqHeight: 1080,
    fps: 30,
    media: [], // {id,name,type,url,duration,width,height,thumb,wave,hasAudio,error,offline}
    clips: [], // see AVP.normalizeClip
    tracks: initialTracks.tracks,
    trackOrder: initialTracks.order, // top -> bottom display order
    markers: [], // {id,t,label}
    workIn: null,
    workOut: null,
    selection: [],
    linkedSelection: true, // clicking a clip also selects its linked partner (video + audio)
    clipboard: null,
    playhead: 0,
    tool: 'select', // select | razor | hand
    snap: true,
    zoom: 60, // timeline pixels per second
    target: { video: 'V1', audio: 'A1' },
    binSelected: null,
    srcMediaId: null,
    srcIn: null,
    srcOut: null,
    playing: false,
    playDir: 0, // 1 forward, -1 reverse, 0 stopped
    exporting: false,
    panel: 'controls', // controls | effects
    effectsQuery: '',
    showSafe: false,
    previewScale: 0.5, // Program monitor render size: 1 = full, 0.5 = half, 0.25 = quarter
  };

  // Bumped whenever clips, tracks or transitions change; caches key off it.
  AVP.dataVersion = 0;
  AVP.touchData = function () {
    AVP.dataVersion++;
  };

  const S = AVP.state;

  /* ---------- ids & lookups ---------- */

  AVP.uid = function () {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  };
  AVP.findClip = (id) => S.clips.find((c) => c.id === id) || null;
  AVP.findMedia = (id) => S.media.find((m) => m.id === id) || null;
  AVP.clipEnd = (c) => c.start + c.duration;
  AVP.seqEnd = () => S.clips.reduce((mx, c) => Math.max(mx, c.start + c.duration), 0);
  AVP.trackKind = (id) => (S.tracks[id] ? S.tracks[id].kind : null);
  AVP.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- time helpers ---------- */

  AVP.snapFrame = (t) => Math.round(t * S.fps) / S.fps;

  AVP.fmtTC = function (t) {
    const fps = S.fps;
    const f = Math.max(0, Math.round((t || 0) * fps));
    const frames = f % fps;
    const totalSec = Math.floor(f / fps);
    const ss = totalSec % 60;
    const mm = Math.floor(totalSec / 60) % 60;
    const hh = Math.floor(totalSec / 3600);
    return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':') + ':' + String(frames).padStart(2, '0');
  };

  AVP.esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ---------- undo / redo ---------- */

  const undoStack = [];
  const redoStack = [];

  const snapshot = () =>
    JSON.stringify({
      clips: S.clips,
      tracks: S.tracks,
      trackOrder: S.trackOrder,
      markers: S.markers,
      workIn: S.workIn,
      workOut: S.workOut,
    });

  // Call BEFORE changing the timeline. Returns false when nothing new was stored.
  AVP.pushUndo = function () {
    const s = snapshot();
    if (undoStack.length && undoStack[undoStack.length - 1] === s) return false;
    undoStack.push(s);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    return true;
  };

  AVP.popUndo = function () {
    undoStack.pop();
  };

  function restore(json) {
    const d = JSON.parse(json);
    S.clips = d.clips;
    S.tracks = d.tracks;
    S.trackOrder = d.trackOrder;
    S.markers = d.markers || [];
    S.workIn = d.workIn == null ? null : d.workIn;
    S.workOut = d.workOut == null ? null : d.workOut;
    S.selection = S.selection.filter((id) => S.clips.some((c) => c.id === id));
    AVP.refresh();
  }

  AVP.undo = function () {
    if (!undoStack.length) return AVP.toast('Nothing to undo');
    redoStack.push(snapshot());
    restore(undoStack.pop());
  };

  AVP.redo = function () {
    if (!redoStack.length) return AVP.toast('Nothing to redo');
    undoStack.push(snapshot());
    restore(redoStack.pop());
  };

  AVP.resetHistory = function () {
    undoStack.length = 0;
    redoStack.length = 0;
  };

  /* ---------- markers ---------- */

  // The marker closest to time t, if it lies within tol seconds of it.
  AVP.nearestMarker = function (t, tol) {
    let best = null;
    let bestDist = tol;
    for (const m of S.markers) {
      const d = Math.abs(m.t - t);
      if (d <= bestDist) {
        best = m;
        bestDist = d;
      }
    }
    return best;
  };

  /* ---------- selection ---------- */

  // Linked partners are selected with a clip only while linked selection is on.
  AVP.selectionPartners = function (c) {
    return S.linkedSelection !== false ? AVP.partners(c) : [];
  };

  AVP.select = function (ids, additive) {
    const set = new Set(additive ? S.selection : []);
    for (const id of ids) {
      const c = AVP.findClip(id);
      if (!c) continue;
      set.add(id);
      AVP.selectionPartners(c).forEach((p) => set.add(p.id));
    }
    S.selection = [...set];
  };

  AVP.toggleSelect = function (id) {
    const c = AVP.findClip(id);
    if (!c) return;
    if (S.selection.includes(id)) {
      const drop = new Set([id, ...AVP.selectionPartners(c).map((p) => p.id)]);
      S.selection = S.selection.filter((x) => !drop.has(x));
    } else {
      AVP.select([id], true);
    }
  };

  AVP.selectedClips = () => S.selection.map((id) => AVP.findClip(id)).filter(Boolean);

  /* ---------- UI helpers ---------- */

  AVP.toast = function (msg, kind) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.classList.add('fade'), 3200);
    setTimeout(() => el.remove(), 3700);
  };

  AVP.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  AVP.safeName = (name) => String(name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Untitled';
})();
