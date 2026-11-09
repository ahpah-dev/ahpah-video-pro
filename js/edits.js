/*
 * AhPah Video Pro - timeline editing operations.
 * Clips that come from the same file (video + its audio) share a `linkId`.
 * Two clips are "partners" when they share a linkId and overlap in time. Partners are cut and
 * moved together. Trimming moves only the clip you drag (see startClipDrag), so a trimmed video
 * keeps its link to the audio without changing the audio.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const EPS = AVP.EPS;

  AVP.partners = function (c) {
    if (!c || !c.linkId) return [];
    const end = c.start + c.duration;
    return S.clips.filter(
      (o) => o.id !== c.id && o.linkId === c.linkId && o.start < end - EPS && o.start + o.duration > c.start + EPS
    );
  };

  // Cuts clip c at absolute time t and returns the new right-hand piece.
  function cutPiece(c, t) {
    const sp = c.speed || 1;
    const off = t - c.start;
    const right = AVP.cloneClip(c, {
      id: AVP.uid(),
      start: t,
      inPoint: c.inPoint + off * sp,
      duration: c.start + c.duration - t,
      keys: AVP.shiftKeys(c.keys, off),
      transIn: null,
      transOut: c.transOut,
    });
    c.duration = off;
    c.transOut = null;
    S.clips.push(right);
    return right;
  }

  // Moves the start of clip g to time b (used when something is dropped over its head).
  function trimHead(g, b) {
    const cut = b - g.start;
    const end = g.start + g.duration;
    g.inPoint += cut * (g.speed || 1);
    g.keys = AVP.shiftKeys(g.keys, cut);
    g.start = b;
    g.duration = end - b;
    g.transIn = null;
  }

  // Applies a drag trim to clip c from its original state o (d = seconds moved).
  AVP.trimApply = function (c, o, mode, d) {
    const sp = o.speed || 1;
    if (mode === 'trim-in') {
      c.start = o.start + d;
      c.inPoint = o.inPoint + d * sp;
      c.duration = o.duration - d;
      c.keys = AVP.shiftKeys(o.keys, d);
    } else {
      c.duration = o.duration + d;
    }
  };

  function makeClip(o) {
    return AVP.normalizeClip({
      id: AVP.uid(),
      kind: 'media',
      mediaId: o.mediaId,
      track: o.track,
      start: o.start,
      inPoint: o.inPoint,
      duration: o.duration,
      linkId: o.linkId || null,
    });
  }

  // Positions of linked clips in one trackless pass, to keep ids unique on paste.
  const E = {
    /* ---------- cutting ---------- */

    // Cuts a clip into two at time t. Linked partners are cut at the same time.
    splitClip(c, t) {
      const partners = AVP.partners(c).filter((p) => t > p.start + EPS && t < p.start + p.duration - EPS);
      const right = cutPiece(c, t);
      partners.forEach((p) => cutPiece(p, t));
      return right;
    },

    splitTrackAt(track, t) {
      const hits = S.clips.filter((c) => c.track === track && c.start < t - EPS && c.start + c.duration > t + EPS);
      hits.forEach((c) => {
        // A previous split may already have cut this clip through its partner.
        if (c.start < t - EPS && c.start + c.duration > t + EPS) E.splitClip(c, t);
      });
    },

    // Razor the selected clips (or every unlocked track when nothing is selected) at the playhead.
    splitAtPlayhead() {
      const t = S.playhead;
      const sel = AVP.selectedClips();
      AVP.pushUndo();
      if (sel.length) {
        for (const c of sel) {
          if (c.start < t - EPS && c.start + c.duration > t + EPS && !S.tracks[c.track].locked) E.splitClip(c, t);
        }
      } else {
        Object.keys(S.tracks).forEach((tr) => !S.tracks[tr].locked && E.splitTrackAt(tr, t));
      }
      AVP.refresh();
    },

    /* ---------- range operations ---------- */

    // Removes everything between a and b on one track (overwrite).
    clearRange(track, a, b) {
      E.splitTrackAt(track, a);
      E.splitTrackAt(track, b);
      S.clips = S.clips.filter((c) => !(c.track === track && c.start >= a - EPS && c.start + c.duration <= b + EPS));
    },

    /*
     * After a clip is moved or trimmed, whatever it now covers on its track is trimmed,
     * split or removed (overwrite behaviour). `keepIds` are the moved clips and are never cut.
     */
    carveRange(track, a, b, keepIds) {
      const done = new Set();
      const remove = new Set();
      for (const o of S.clips.slice()) {
        if (done.has(o.id) || keepIds.has(o.id) || o.track !== track) continue;
        if (o.start + o.duration <= a + EPS || o.start >= b - EPS) continue;
        const group = [o].concat(AVP.partners(o).filter((p) => !keepIds.has(p.id) && !done.has(p.id)));
        group.forEach((g) => done.add(g.id));
        group.forEach((g) => {
          const end = g.start + g.duration;
          if (g.start >= a - EPS && end <= b + EPS) {
            remove.add(g.id); // fully covered
          } else if (g.start < a - EPS && end > b + EPS) {
            const mid = cutPiece(g, a); // g keeps the part before a
            cutPiece(mid, b); // mid now spans [a, b]
            remove.add(mid.id);
          } else if (g.start < a - EPS) {
            g.duration = a - g.start; // covered at its tail
            g.transOut = null;
          } else {
            trimHead(g, b); // covered at its head
          }
        });
      }
      if (remove.size) S.clips = S.clips.filter((c) => !remove.has(c.id));
    },

    // Opens a gap of `len` at t on the given tracks and pushes later clips right (insert).
    // Linked partners on other tracks move too, so audio and video stay in sync.
    insertGap(tracks, t, len) {
      tracks.forEach((tr) => E.splitTrackAt(tr, t));
      const moving = new Set();
      S.clips.forEach((c) => {
        if (!tracks.includes(c.track) || c.start < t - EPS) return;
        moving.add(c);
        AVP.partners(c).forEach((p) => moving.add(p));
      });
      moving.forEach((c) => (c.start += len));
    },

    removeClips(ids, ripple) {
      const idSet = new Set(ids);
      const removed = S.clips.filter((c) => idSet.has(c.id));
      S.clips = S.clips.filter((c) => !idSet.has(c.id));
      if (ripple) {
        removed.sort((a, b) => b.start - a.start);
        for (const r of removed) {
          const end = r.start + r.duration;
          S.clips.forEach((c) => {
            if (c.track === r.track && c.start >= end - EPS) c.start -= r.duration;
          });
        }
      }
      S.selection = [];
    },

    deleteSelection(ripple) {
      if (!S.selection.length) return AVP.toast('Select a clip first');
      AVP.pushUndo();
      E.removeClips(S.selection.slice(), ripple);
      AVP.refresh();
    },

    /* ---------- placing content ---------- */

    /*
     * Place a bin item on the timeline.
     *   o.mediaId, o.start, o.inPoint, o.duration (optional), o.mode ('overwrite' | 'insert')
     *   o.videoTrack / o.audioTrack: destination track ids (or null)
     */
    placeMedia(o) {
      const m = AVP.findMedia(o.mediaId);
      if (!m) return null;
      AVP.pushUndo();
      const inPoint = o.inPoint || 0;
      const dur = o.duration != null ? o.duration : m.type === 'image' ? 5 : m.duration;
      const start = Math.max(0, AVP.snapFrame(o.start));
      const vTrack = m.type === 'audio' ? null : o.videoTrack || null;
      const aTrack = m.type === 'image' ? null : o.audioTrack || null;
      const linkId = vTrack && aTrack && m.type === 'video' ? AVP.uid() : null;

      const targets = [vTrack, aTrack].filter(Boolean);
      if (o.mode === 'insert') E.insertGap(targets, start, dur);
      else targets.forEach((tr) => E.clearRange(tr, start, start + dur));

      const added = [];
      if (vTrack) {
        const c = makeClip({ mediaId: m.id, track: vTrack, start, inPoint, duration: dur, linkId });
        S.clips.push(c);
        added.push(c.id);
      }
      if (aTrack) {
        const c = makeClip({ mediaId: m.id, track: aTrack, start, inPoint, duration: dur, linkId });
        S.clips.push(c);
        added.push(c.id);
      }
      AVP.select(added, false);
      AVP.refresh();
      return added;
    },

    // Adds a titles clip (preset index into AVP.TITLE_PRESETS) on a video track.
    placeTitle(o) {
      AVP.pushUndo();
      const preset = AVP.TITLE_PRESETS[o.preset || 0] || AVP.TITLE_PRESETS[0];
      const dur = o.duration || 5;
      const start = Math.max(0, AVP.snapFrame(o.start));
      if (o.mode === 'insert') E.insertGap([o.track], start, dur);
      else E.clearRange(o.track, start, start + dur);
      const props = Object.assign(AVP.defaultProps(), preset.props || {});
      const c = AVP.normalizeClip({
        kind: 'title',
        mediaId: null,
        track: o.track,
        start,
        inPoint: 0,
        duration: dur,
        props,
        text: Object.assign({}, AVP.TEXT_DEFAULTS, preset.text),
      });
      S.clips.push(c);
      AVP.select([c.id], false);
      AVP.refresh();
      return c.id;
    },

    /* ---------- graphics ---------- */

    // Places a rectangle or ellipse shape on a video track.
    placeShape(o) {
      AVP.pushUndo();
      const dur = o.duration || 5;
      const start = Math.max(0, AVP.snapFrame(o.start));
      if (o.mode === 'insert') E.insertGap([o.track], start, dur);
      else E.clearRange(o.track, start, start + dur);
      const c = AVP.normalizeClip({
        kind: 'shape',
        mediaId: null,
        track: o.track,
        start,
        inPoint: 0,
        duration: dur,
        props: AVP.defaultProps(),
        shape: AVP.defaultShape(o.type),
      });
      S.clips.push(c);
      AVP.select([c.id], false);
      AVP.refresh();
      return c.id;
    },

    /* ---------- transitions ---------- */

    // Applies a transition to a clip edge. Video transitions also crossfade the partner audio.
    applyTransition(clipId, type, edge) {
      const c = AVP.findClip(clipId);
      const def = AVP.TRANSITIONS[type];
      if (!c || !def) return false;
      const kind = AVP.trackKind(c.track);
      if (def.audio !== (kind === 'audio')) {
        AVP.toast(def.audio ? 'Audio fades go on audio clips' : 'Video transitions go on video clips');
        return false;
      }
      AVP.pushUndo();
      const apply = (clip, where, tType) => {
        const spec = { type: tType, duration: def.dur };
        if (where === 'start') clip.transIn = spec;
        else {
          const end = clip.start + clip.duration;
          const next = S.clips.find((o) => o.track === clip.track && o.id !== clip.id && Math.abs(o.start - end) < EPS);
          if (next) next.transIn = spec;
          else clip.transOut = spec;
        }
      };
      apply(c, edge, type);
      if (!def.audio) {
        // The partner audio gets a matching constant-gain fade so sound does not click.
        AVP.partners(c).forEach((p) => apply(p, edge, 'audio-fade'));
      }
      AVP.refresh();
      return true;
    },

    removeTransition(clipId, edge) {
      const c = AVP.findClip(clipId);
      if (!c) return;
      AVP.pushUndo();
      if (edge === 'start') c.transIn = null;
      else {
        const end = c.start + c.duration;
        const next = S.clips.find((o) => o.track === c.track && o.id !== c.id && Math.abs(o.start - end) < EPS);
        if (next) next.transIn = null;
        else c.transOut = null;
      }
      AVP.refresh();
    },

    /* ---------- clip properties ---------- */

    setSpeed(ids, speed) {
      const sp = AVP.clamp(speed, 0.1, 16);
      const list = ids.map(AVP.findClip).filter(Boolean);
      if (!list.length) return;
      AVP.pushUndo();
      const keep = new Set(ids);
      list.forEach((c) => {
        const span = c.duration * (c.speed || 1);
        c.speed = sp;
        c.duration = span / sp;
      });
      list.forEach((c) => E.carveRange(c.track, c.start, c.start + c.duration, keep));
      AVP.refresh();
    },

    toggleEnabled(ids) {
      const list = ids.map(AVP.findClip).filter(Boolean);
      if (!list.length) return;
      AVP.pushUndo();
      const to = !list[0].enabled;
      list.forEach((c) => (c.enabled = to));
      AVP.refresh();
    },

    link(ids) {
      const list = ids.map(AVP.findClip).filter(Boolean);
      if (list.length < 2) return AVP.toast('Select a video and an audio clip to link them');
      AVP.pushUndo();
      const id = AVP.uid();
      list.forEach((c) => (c.linkId = id));
      AVP.refresh();
    },

    unlink(ids) {
      const list = ids.map(AVP.findClip).filter(Boolean);
      AVP.pushUndo();
      const drop = new Set();
      list.forEach((c) => {
        drop.add(c.id);
        AVP.partners(c).forEach((p) => drop.add(p.id));
      });
      S.clips.forEach((c) => {
        if (drop.has(c.id)) c.linkId = null;
      });
      AVP.refresh();
    },

    addFx(clipIds, type) {
      const list = clipIds.map(AVP.findClip).filter(Boolean);
      if (!list.length) return AVP.toast('Select a clip first');
      AVP.pushUndo();
      list.forEach((c) => c.fx.push(AVP.createEffect(type)));
      AVP.toast(`Added ${AVP.EFFECTS[type].name}`);
      AVP.refresh();
    },

    removeFx(clipId, fxId) {
      const c = AVP.findClip(clipId);
      if (!c) return;
      AVP.pushUndo();
      c.fx = c.fx.filter((f) => f.id !== fxId);
      Object.keys(c.keys).forEach((k) => k.indexOf('fx:' + fxId + ':') === 0 && delete c.keys[k]);
      AVP.refresh();
    },

    /* ---------- copy / paste ---------- */

    copySelection() {
      const list = AVP.selectedClips();
      if (!list.length) return AVP.toast('Select clips to copy');
      const base = Math.min(...list.map((c) => c.start));
      S.clipboard = { base, items: list.map((c) => JSON.parse(JSON.stringify(c))) };
      AVP.toast(`Copied ${list.length} clip${list.length > 1 ? 's' : ''}`);
    },

    paste(t, mode) {
      const cb = S.clipboard;
      if (!cb || !cb.items.length) return AVP.toast('Clipboard is empty');
      AVP.pushUndo();
      const links = {};
      const items = cb.items.map((it) => {
        const track = S.tracks[it.track] ? it.track : S.target[it.kind === 'audio' ? 'audio' : 'video'];
        const linkId = it.linkId ? (links[it.linkId] = links[it.linkId] || AVP.uid()) : null;
        return AVP.cloneClip(it, {
          id: AVP.uid(),
          track,
          start: t + (it.start - cb.base),
          linkId,
          kind: it.kind,
          transIn: null,
          transOut: null,
        });
      });
      const spans = {};
      items.forEach((c) => {
        const s = spans[c.track] || [Infinity, -Infinity];
        spans[c.track] = [Math.min(s[0], c.start), Math.max(s[1], c.start + c.duration)];
      });
      if (mode === 'insert') {
        const len = Math.max(...items.map((c) => c.start + c.duration)) - Math.min(...items.map((c) => c.start));
        E.insertGap(Object.keys(spans), t, len);
      } else {
        Object.keys(spans).forEach((tr) => E.clearRange(tr, spans[tr][0], spans[tr][1]));
      }
      items.forEach((c) => S.clips.push(c));
      AVP.select(items.map((c) => c.id), false);
      AVP.refresh();
    },

    duplicate() {
      const list = AVP.selectedClips();
      if (!list.length) return AVP.toast('Select clips to duplicate');
      E.copySelection();
      const end = Math.max(...list.map((c) => c.start + c.duration));
      E.paste(end, 'insert');
    },

    /* ---------- markers ---------- */

    addMarker(t, label) {
      const time = Math.max(0, AVP.snapFrame(t));
      if (S.markers.some((m) => Math.abs(m.t - time) < 1e-3)) return AVP.toast('A marker is already here');
      AVP.pushUndo();
      S.markers.push({ id: AVP.uid(), t: time, label: label || '' });
      S.markers.sort((a, b) => a.t - b.t);
      AVP.refresh();
    },

    removeMarker(id) {
      AVP.pushUndo();
      S.markers = S.markers.filter((m) => m.id !== id);
      AVP.refresh();
    },

    /* ---------- tracks ---------- */

    addTrack(kind, refId, pos) {
      const prefix = kind === 'video' ? 'V' : 'A';
      const nums = Object.keys(S.tracks)
        .filter((id) => id[0] === prefix)
        .map((id) => parseInt(id.slice(1), 10));
      const id = prefix + (Math.max(0, ...nums) + 1);
      AVP.pushUndo();
      S.tracks[id] = kind === 'video' ? { id, kind, hidden: false, locked: false } : { id, kind, muted: false, locked: false };
      let idx = refId ? S.trackOrder.indexOf(refId) + (pos === 'below' ? 1 : 0) : -1;
      if (idx < 0) idx = kind === 'video' ? 0 : S.trackOrder.length;
      S.trackOrder.splice(idx, 0, id);
      AVP.refresh();
      return id;
    },

    removeTrack(id) {
      if (S.clips.some((c) => c.track === id)) return AVP.toast('Track is not empty: clear it before deleting');
      AVP.pushUndo();
      delete S.tracks[id];
      S.trackOrder = S.trackOrder.filter((t) => t !== id);
      const kind = id[0] === 'V' ? 'video' : 'audio';
      if (S.target[kind] === id) S.target[kind] = S.trackOrder.find((t) => S.tracks[t].kind === kind);
      AVP.refresh();
    },

    // Deletes a media item from the project and every clip that uses it.
    removeMedia(id) {
      const m = AVP.findMedia(id);
      if (!m) return;
      AVP.pushUndo();
      S.clips = S.clips.filter((c) => c.mediaId !== id);
      S.selection = S.selection.filter((cid) => AVP.findClip(cid));
      S.media = S.media.filter((x) => x.id !== id);
      if (m.url) URL.revokeObjectURL(m.url);
      if (S.srcMediaId === id) S.srcMediaId = null;
      AVP.refresh();
      AVP.bin.renderBin();
    },
  };

  AVP.edit = E;
})();
