/*
 * AhPah Video Pro - timeline editing operations (split, insert, overwrite, delete).
 * Clips that come from the same file (video + its audio) share a `linkId`.
 * Two clips are "partners" when they share a linkId and have the same start and duration.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const EPS = AVP.EPS;

  AVP.partners = function (c) {
    if (!c || !c.linkId) return [];
    return S.clips.filter(
      (o) =>
        o.id !== c.id &&
        o.linkId === c.linkId &&
        Math.abs(o.start - c.start) < EPS &&
        Math.abs(o.duration - c.duration) < EPS
    );
  };

  // Splits one clip object in two and returns the new right-hand piece.
  function cutPiece(c, t) {
    const right = Object.assign({}, c, {
      id: AVP.uid(),
      start: t,
      inPoint: c.inPoint + (t - c.start),
      duration: c.start + c.duration - t,
    });
    c.duration = t - c.start;
    S.clips.push(right);
    return right;
  }

  function makeClip(o) {
    return {
      id: AVP.uid(),
      mediaId: o.mediaId,
      track: o.track,
      start: o.start,
      inPoint: o.inPoint,
      duration: o.duration,
      opacity: 1,
      volume: 1,
      scale: 1,
      linkId: o.linkId || null,
    };
  }

  const E = {
    // Cut a clip into two at time t (absolute timeline seconds).
    // Linked partners (e.g. the audio of a video clip) are cut at the same time.
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

    // Razor the selected clips (or every track when nothing is selected) at the playhead.
    splitAtPlayhead() {
      const t = S.playhead;
      const sel = S.selection.map(AVP.findClip).filter(Boolean);
      const targets = sel.length ? sel : null;
      AVP.pushUndo();
      if (targets) {
        for (const c of targets) {
          if (c.start < t - EPS && c.start + c.duration > t + EPS) E.splitClip(c, t);
        }
      } else {
        Object.keys(S.tracks).forEach((tr) => E.splitTrackAt(tr, t));
      }
      AVP.refresh();
    },

    // Remove everything between a and b on one track (used by overwrite).
    clearRange(track, a, b) {
      E.splitTrackAt(track, a);
      E.splitTrackAt(track, b);
      S.clips = S.clips.filter(
        (c) => !(c.track === track && c.start >= a - EPS && c.start + c.duration <= b + EPS)
      );
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
          } else {
            const cut = b - g.start; // covered at its head
            g.inPoint += cut;
            g.duration = end - b;
            g.start = b;
          }
        });
      }
      if (remove.size) S.clips = S.clips.filter((c) => !remove.has(c.id));
    },

    // Open a gap of `len` at t on the given tracks and push later clips right (used by insert).
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

    /*
     * Place a bin item on the timeline.
     *   o.mediaId, o.start, o.inPoint, o.duration (optional), o.mode ('overwrite' | 'insert')
     *   o.videoTrack / o.audioTrack: destination track ids (or null)
     */
    placeMedia(o) {
      const m = AVP.findMedia(o.mediaId);
      if (!m) return;
      AVP.pushUndo();
      const inPoint = o.inPoint || 0;
      const dur = o.duration != null ? o.duration : m.type === 'image' ? 5 : m.duration;
      const start = Math.max(0, AVP.snapFrame(o.start));
      const vTrack = m.type === 'audio' ? null : o.videoTrack || null;
      const aTrack = m.type === 'image' ? null : o.audioTrack || null;
      const linkId = vTrack && aTrack ? AVP.uid() : null;

      const targets = [vTrack, aTrack].filter(Boolean);
      if (o.mode === 'insert') {
        E.insertGap(targets, start, dur);
      } else {
        targets.forEach((tr) => E.clearRange(tr, start, start + dur));
      }

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
  };

  AVP.edit = E;
})();
