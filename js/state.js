/*
 * AhPah Video Pro - shared state, undo history and small helpers.
 * Every module hangs off the global `AVP` namespace. No build step needed.
 */
(function () {
  'use strict';

  const AVP = (window.AVP = window.AVP || {});

  AVP.APP_NAME = 'AhPah Video Pro';
  AVP.VERSION = '1.0.0';
  AVP.EPS = 1e-4;

  AVP.defaultTracks = function () {
    return {
      V3: { kind: 'video', hidden: false },
      V2: { kind: 'video', hidden: false },
      V1: { kind: 'video', hidden: false },
      A1: { kind: 'audio', muted: false },
      A2: { kind: 'audio', muted: false },
      A3: { kind: 'audio', muted: false },
    };
  };

  // Top-to-bottom display order of timeline rows.
  AVP.trackOrder = ['V3', 'V2', 'V1', 'A1', 'A2', 'A3'];

  AVP.state = {
    projectName: 'Untitled Project',
    fps: 30,
    seqWidth: 1920,
    seqHeight: 1080,
    media: [], // {id, name, type: 'video'|'audio'|'image', url, duration, width, height, thumb, error, offline}
    clips: [], // {id, mediaId, track, start, inPoint, duration, opacity, volume, scale, linkId}
    tracks: AVP.defaultTracks(),
    selection: [], // clip ids (linked partners are always selected together)
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
  };

  const S = AVP.state;

  /* ---------- ids & lookups ---------- */

  AVP.uid = function () {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  };
  AVP.findClip = (id) => S.clips.find((c) => c.id === id) || null;
  AVP.findMedia = (id) => S.media.find((m) => m.id === id) || null;
  AVP.seqEnd = () => S.clips.reduce((mx, c) => Math.max(mx, c.start + c.duration), 0);

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
  const snapshot = () => JSON.stringify({ clips: S.clips, tracks: S.tracks });

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

  /* ---------- selection ---------- */

  AVP.select = function (ids, additive) {
    const set = new Set(additive ? S.selection : []);
    for (const id of ids) {
      const c = AVP.findClip(id);
      if (!c) continue;
      set.add(id);
      AVP.partners(c).forEach((p) => set.add(p.id));
    }
    S.selection = [...set];
  };

  AVP.toggleSelect = function (id) {
    const c = AVP.findClip(id);
    if (!c) return;
    if (S.selection.includes(id)) {
      const drop = new Set([id, ...AVP.partners(c).map((p) => p.id)]);
      S.selection = S.selection.filter((x) => !drop.has(x));
    } else {
      AVP.select([id], true);
    }
  };

  /* ---------- UI helpers ---------- */

  AVP.toast = function (msg) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.classList.add('fade'), 2600);
    setTimeout(() => el.remove(), 3100);
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
