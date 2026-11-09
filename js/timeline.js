/*
 * AhPah Video Pro - Timeline panel: track rows, clips, ruler, markers, work area,
 * transition badges, mouse editing, drag and drop, and context menus.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const EPS = AVP.EPS;

  const HEAD_W = 150;
  const RULER_H = 30;
  const TRACK_H = { video: 62, audio: 50 };
  const SNAP_PX = 8;
  const EDGE_PX = 7;
  const DRAG_MIME = 'application/x-avp-media';
  const LIB_MIME = 'application/x-avp-effect';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const ICON_EYE =
    '<svg viewBox="0 0 16 16"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>';
  const ICON_SPK =
    '<svg viewBox="0 0 16 16"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor"/><path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.6 3.6a6.2 6.2 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const ICON_LOCK =
    '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="7" rx="1.2" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

  const dom = {};
  let drag = null;
  let hoverClipEl = null;

  function setTool(tool) {
    S.tool = tool;
    if (tool !== 'razor') hideRazorLine();
    dom.scroll.classList.toggle('tool-razor', tool === 'razor');
    dom.scroll.classList.toggle('tool-hand', tool === 'hand');
    dom.scroll.classList.toggle('tool-zoom', tool === 'zoom');
    dom.scroll.classList.toggle('tool-type', tool === 'type');
    updateToolbar();
  }

  function updateToolbar() {
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
    const snap = $('#tlSnap');
    if (snap) snap.classList.toggle('active', S.snap);
    const linked = $('#tlLinked');
    if (linked) linked.classList.toggle('active', S.linkedSelection !== false);
    const zoom = $('#tlZoom');
    if (zoom && +zoom.value !== S.zoom) zoom.value = S.zoom;
    const tc = $('#tlTC');
    if (tc) tc.textContent = AVP.fmtTC(S.playhead);
  }

  /* ---------- rendering ---------- */

  function fmtShort(t, step) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    let label = `${m}:${String(s).padStart(2, '0')}`;
    if (step < 1) label += ':' + String(Math.round((t - Math.floor(t)) * S.fps)).padStart(2, '0');
    return label;
  }

  function laneWidth() {
    return Math.max(dom.scroll.clientWidth - HEAD_W, Math.ceil((AVP.seqEnd() + 60) * S.zoom));
  }

  function drawRuler(laneW) {
    const cv = dom.content.querySelector('.ruler-canvas');
    if (!cv) return;
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    g.fillStyle = '#232323';
    g.fillRect(0, 0, W, H);

    // Work area: dim what is outside the in / out points.
    if (S.workIn != null || S.workOut != null) {
      const a = S.workIn != null ? S.workIn * S.zoom : 0;
      const b = S.workOut != null ? S.workOut * S.zoom : W;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      if (a > 0) g.fillRect(0, 0, a, H);
      if (b < W) g.fillRect(b, 0, W - b, H);
      g.fillStyle = 'rgba(78,161,255,0.85)';
      g.fillRect(a, H - 3, Math.max(0, b - a), 3);
    }

    const steps = [1 / S.fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => s * S.zoom >= 70) || 600;
    g.font = '10px "Segoe UI", system-ui, sans-serif';
    g.lineWidth = 1;
    const minor = 4; // minor ticks between two labelled ones
    const minorGap = step * S.zoom / minor;
    for (let k = 0; k * step * S.zoom <= laneW; k++) {
      const t = k * step;
      const x = Math.round(t * S.zoom) + 0.5;
      g.strokeStyle = '#8a8a8a';
      g.beginPath();
      g.moveTo(x, H - 9);
      g.lineTo(x, H);
      g.stroke();
      if (minorGap >= 8) {
        g.strokeStyle = '#555555';
        g.beginPath();
        for (let j = 1; j < minor; j++) {
          const mx = Math.round(x + j * minorGap) + 0.5;
          g.moveTo(mx, H - (j === minor / 2 ? 6 : 4));
          g.lineTo(mx, H);
        }
        g.stroke();
      }
      g.fillStyle = '#b4b4b4';
      g.fillText(fmtShort(t, step), x + 4, 11);
    }
  }

  function clipHtml(c, list) {
    const m = AVP.findMedia(c.mediaId);
    // Clips on an audio track are drawn as audio, even when they come from a video file (its sound).
    const kind =
      c.kind === 'shape' ? 'shape' : c.kind === 'title' ? 'title' : S.tracks[c.track] && S.tracks[c.track].kind === 'audio' ? 'audio' : m ? m.type : 'video';
    const cls = [
      'clip',
      kind,
      S.selection.includes(c.id) ? 'selected' : '',
      m && m.offline ? 'offline' : '',
      c.enabled ? '' : 'disabled',
      S.tracks[c.track] && S.tracks[c.track].locked ? 'locked' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const left = c.start * S.zoom;
    const width = Math.max(3, c.duration * S.zoom);
    let style = `left:${left}px;width:${width}px;`;
    // Only clips on an audio track show the waveform. A video clip shows its picture; its sound is
    // the separate audio clip next to it, so the video clip must not look like a second sound.
    let wave = '';
    const onAudioTrack = !!(S.tracks[c.track] && S.tracks[c.track].kind === 'audio');
    if (m && m.wave && onAudioTrack && kind !== 'image' && kind !== 'title') {
      const sp = c.speed || 1;
      const full = (m.duration / sp) * S.zoom;
      wave = ' wv-' + m.id;
      style += `background-size:${full}px 100%;background-position:${-(c.inPoint / sp) * S.zoom}px 0;`;
    }
    // Video and image clips show their frames: a filmstrip of the source, moved with the clip's in point.
    if (m && m.strip && !onAudioTrack && kind !== 'title' && kind !== 'shape') {
      wave = ' fs-' + m.id;
      if (kind === 'image') style += 'background-size:auto 100%;background-position:0 0;background-repeat:repeat-x;';
      else {
        const sp = c.speed || 1;
        const full = (m.duration / sp) * S.zoom;
        style += `background-size:${full}px 100%;background-position:${-(c.inPoint / sp) * S.zoom}px 0;background-repeat:no-repeat;`;
      }
    }
    let label = kind === 'title' ? c.text.text.split('\n')[0] || 'Title' : kind === 'shape' ? (c.shape.type === 'ellipse' ? 'Ellipse' : 'Rectangle') : m ? m.name : 'Missing media';
    if (c.speed && c.speed !== 1) label += `  ${Math.round(c.speed * 100)}%`;
    if (AVP.hasRamp(c)) label += '  ramp';
    if (c.fx && c.fx.length) label += `  fx${c.fx.length}`;
    const name = m ? m.name : c.kind === 'title' ? 'Title' : 'Missing media';
    return (
      `<div class="${cls}${wave}" data-id="${c.id}" style="${style}" title="${AVP.esc(name)}">` +
      `<span class="clip-label">${AVP.esc(label)}</span></div>`
    );
  }

  // Transition badges sit on the cut they belong to. Each badge has handles at its edges:
  // drag a handle to change the transition's duration.
  function transitionsHtml(list, track) {
    let html = '';
    const kind = S.tracks[track].kind;
    list.forEach((c) => {
      const R = AVP.roleWindows(c, list);
      if (c.transIn && R.in) {
        const d = R.in.b - R.in.a;
        const label = AVP.TRANSITIONS[R.in.type] ? AVP.TRANSITIONS[R.in.type].name : R.in.type;
        // A centred transition grows both ways; one that starts at the clip grows to the right only.
        const leftOn = R.in.centered;
        html +=
          `<div class="tr-badge ${kind}" data-trans-clip="${c.id}" data-edge="in" data-centered="${R.in.centered ? 1 : 0}" ` +
          `style="left:${R.in.a * S.zoom}px;width:${Math.max(4, d * S.zoom)}px" title="${AVP.esc(label)}: ${d.toFixed(2)} s">` +
          `<span class="tr-h l${leftOn ? '' : ' fixed'}" data-th="l"></span><span class="tr-h r" data-th="r"></span></div>`;
      }
      if (c.transOut && R.out && !R.out.centered) {
        const d = R.out.b - R.out.a;
        const label = AVP.TRANSITIONS[R.out.type] ? AVP.TRANSITIONS[R.out.type].name : R.out.type;
        html +=
          `<div class="tr-badge ${kind}" data-trans-clip="${c.id}" data-edge="out" data-centered="0" ` +
          `style="left:${R.out.a * S.zoom}px;width:${Math.max(4, d * S.zoom)}px" title="${AVP.esc(label)}: ${d.toFixed(2)} s">` +
          `<span class="tr-h l" data-th="l"></span><span class="tr-h r fixed" data-th="r"></span></div>`;
      }
    });
    return html;
  }

  function render() {
    if (!dom.content) return;
    AVP.touchData();
    const laneW = laneWidth();
    let html =
      `<div class="tl-row ruler" style="height:${RULER_H}px">` +
      `<div class="tl-head corner"></div>` +
      `<div class="tl-lane ruler-lane" style="width:${laneW}px;height:${RULER_H}px">` +
      `<canvas class="ruler-canvas" width="${laneW}" height="${RULER_H}"></canvas>` +
      markerHtml() +
      `</div></div>`;

    for (const id of S.trackOrder) {
      const tr = S.tracks[id];
      if (!tr) continue;
      const h = TRACK_H[tr.kind];
      const isTarget = S.target[tr.kind] === id;
      const off = tr.kind === 'video' ? !!tr.hidden : !!tr.muted;
      const list = S.clips.filter((c) => c.track === id);
      html +=
        `<div class="tl-row ${tr.kind}${tr.locked ? ' is-locked' : ''}" data-row="${id}" style="height:${h}px">` +
        `<div class="tl-head ${tr.kind}${isTarget ? ' target' : ''}" data-head="${id}" title="Click to target ${id}. Right-click for track options.">` +
        `<span class="tl-buttons">` +
        `<button class="tl-toggle lock${tr.locked ? ' on' : ''}" data-lock="${id}" title="Lock / unlock track">${ICON_LOCK}</button>` +
        (tr.kind === 'video'
          ? `<button class="tl-toggle${off ? ' off' : ''}" data-toggle="${id}" title="Show / hide track">${ICON_EYE}</button>`
          : `<button class="tl-toggle mute${tr.muted ? ' on' : ''}" data-toggle="${id}" title="Mute track">M</button>` +
            `<button class="tl-toggle solo${tr.solo ? ' on' : ''}" data-solo="${id}" title="Solo track">S</button>`) +
        `</span>` +
        `<span class="tl-name">${id}</span></div>` +
        `<div class="tl-lane" data-track="${id}" style="width:${laneW}px;height:${h}px">` +
        list.map((c) => clipHtml(c, list)).join('') +
        transitionsHtml(list, id) +
        `</div></div>`;
    }
    html += '<div class="marker-lines">' + S.markers.map((m) => `<div class="marker-line" style="left:${HEAD_W + m.t * S.zoom}px"></div>`).join('') + '</div>';
    html += '<div class="tl-marquee hidden"></div>';
    html += '<div class="tl-playhead"></div>';
    html += '<div class="razor-cut hidden"><span></span></div>';
    dom.content.innerHTML = html;
    dom.razor = dom.content.querySelector('.razor-cut');
    dom.content.style.width = HEAD_W + laneW + 'px';
    dom.marquee = dom.content.querySelector('.tl-marquee');
    dom.playhead = dom.content.querySelector('.tl-playhead');
    drawRuler(laneW);
    updatePlayhead();
    updateToolbar();
  }

  function markerHtml() {
    return S.markers
      .map((m) => `<div class="marker-flag" data-marker="${m.id}" style="left:${m.t * S.zoom}px" title="${AVP.esc(m.label || 'Marker')} (${AVP.fmtTC(m.t)})"></div>`)
      .join('');
  }

  function updatePlayhead() {
    if (!dom.content) return;
    const sc = dom.scroll;
    const x = HEAD_W + S.playhead * S.zoom;
    if (!dom.playhead) dom.playhead = dom.content.querySelector('.tl-playhead');
    if (S.playing && sc) {
      if (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft + HEAD_W) {
        sc.scrollLeft = Math.max(0, x - HEAD_W - 40);
      }
    }
    if (dom.playhead) {
      const left = x + 'px';
      if (dom.playhead.style.left !== left) dom.playhead.style.left = left;
      const shown = x - sc.scrollLeft < HEAD_W ? 'none' : '';
      if (dom.playhead.style.display !== shown) dom.playhead.style.display = shown;
    }
    const tcText = AVP.fmtTC(S.playhead);
    if (dom.tc && dom.tc.textContent !== tcText) dom.tc.textContent = tcText;
  }

  /* ---------- pointer helpers ---------- */

  function rulerLaneLeft() {
    const lane = dom.content.querySelector('.ruler-lane');
    return lane ? lane.getBoundingClientRect().left : 0;
  }

  function timeAtClientX(clientX) {
    return Math.max(0, AVP.snapFrame((clientX - rulerLaneLeft()) / S.zoom));
  }

  // Playhead magnet: when the pointer comes within a few pixels of a marker, the playhead locks onto
  // the marker and the view centres on it. It stays there until the pointer moves away.
  const MARKER_LOCK_PX = 8;
  const MARKER_RELEASE_PX = 18;
  let scrubLock = null; // { marker, x } while the playhead is held on a marker

  function centreOn(t) {
    const sc = dom.scroll;
    if (!sc) return;
    const x = HEAD_W + t * S.zoom;
    sc.scrollLeft = Math.max(0, x - (sc.clientWidth + HEAD_W) / 2);
  }

  function scrubTo(clientX) {
    if (scrubLock) {
      if (Math.abs(clientX - scrubLock.x) <= MARKER_RELEASE_PX) {
        S.playhead = scrubLock.marker.t;
        updatePlayhead();
        return;
      }
      scrubLock = null;
    }
    const raw = timeAtClientX(clientX);
    const marker = S.snap ? AVP.nearestMarker(raw, MARKER_LOCK_PX / S.zoom) : null;
    if (marker) {
      scrubLock = { marker, x: clientX };
      S.playhead = marker.t;
      centreOn(marker.t);
    } else {
      S.playhead = raw;
    }
    updatePlayhead();
  }

  // Next or previous marker from the playhead: moves there and centres the timeline on it.
  function gotoMarker(dir) {
    const list = S.markers.slice().sort((a, b) => a.t - b.t);
    const eps = 1e-3;
    const m = dir > 0 ? list.find((x) => x.t > S.playhead + eps) : list.slice().reverse().find((x) => x.t < S.playhead - eps);
    if (!m) return AVP.toast(dir > 0 ? 'No later marker' : 'No earlier marker', 'warn');
    AVP.monitor.goTo(m.t);
    centreOn(m.t);
    render();
  }

  function trackAtY(y) {
    const rows = dom.content.querySelectorAll('.tl-row[data-row]');
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y >= b.top && y < b.bottom) return r.dataset.row;
    }
    return null;
  }

  function snapPoints(movingIds) {
    const pts = [S.playhead, 0];
    S.clips.forEach((c) => {
      if (movingIds.includes(c.id)) return;
      pts.push(c.start, c.start + c.duration);
    });
    S.markers.forEach((m) => pts.push(m.t));
    return pts;
  }

  function snapDelta(edges) {
    if (!S.snap || !drag) return 0;
    const thr = SNAP_PX / S.zoom;
    let best = 0;
    let bestAbs = Infinity;
    for (const edge of edges) {
      for (const p of drag.pts) {
        const d = p - edge;
        const a = Math.abs(d);
        if (a < thr && a < bestAbs) {
          bestAbs = a;
          best = d;
        }
      }
    }
    return best;
  }

  function razorAt(c, t) {
    if (!(t > c.start + EPS && t < c.start + c.duration - EPS)) return;
    if (S.tracks[c.track].locked) return AVP.toast('This track is locked', 'warn');
    AVP.pushUndo();
    AVP.edit.splitClip(c, t); // also cuts linked partners
    S.selection = [];
    AVP.refresh();
  }

  /* ---------- clip dragging ---------- */

  function startClipDrag(kind, c, e) {
    if (S.tracks[c.track].locked) return;
    const partnerIds = new Set(AVP.partners(c).map((p) => p.id));
    // Moving takes the linked partners along. Trimming changes only the clip you grab, plus any other
    // clips you selected yourself (partners that linked selection added are left alone).
    const ids = [c.id];
    if (kind === 'move') partnerIds.forEach((id) => ids.push(id));
    else {
      S.selection.forEach((id) => {
        const o = AVP.findClip(id);
        if (o && id !== c.id && !partnerIds.has(id) && !S.tracks[o.track].locked) ids.push(id);
      });
    }
    const orig = {};
    ids.forEach((id) => (orig[id] = Object.assign({}, AVP.findClip(id))));
    drag = {
      kind,
      leadId: c.id,
      ids,
      orig,
      startX: e.clientX,
      startY: e.clientY,
      pushed: AVP.pushUndo(),
      moved: false,
      pts: snapPoints(ids),
    };
  }

  function updateClipDrag(e) {
    const lead = drag.orig[drag.leadId];
    const dx = (e.clientX - drag.startX) / S.zoom;
    if (Math.abs(e.clientX - drag.startX) > 2) drag.moved = true;
    let d = 0;
    let newTrack = null;

    if (drag.kind === 'move') {
      let ns = Math.max(0, lead.start + dx);
      ns += snapDelta([ns, ns + lead.duration]);
      ns = Math.max(0, AVP.snapFrame(ns));
      d = ns - lead.start;
      const tid = trackAtY(e.clientY);
      if (tid && tid !== lead.track && S.tracks[tid] && !S.tracks[tid].locked && S.tracks[tid].kind === S.tracks[lead.track].kind) {
        newTrack = tid;
        drag.moved = true;
      }
    } else if (drag.kind === 'trim-in') {
      const lo = Math.max(-lead.inPoint / AVP.speedAt(lead, 0), -lead.start);
      const hi = lead.duration - 0.1;
      let x = clamp(dx, lo, hi);
      x += snapDelta([lead.start + x]);
      x = AVP.snapFrame(lead.start + x) - lead.start;
      d = clamp(x, lo, hi);
    } else {
      // trim-out: cannot run past the end of the source (unless it is a still or title)
      const m = AVP.findMedia(lead.mediaId);
      const maxDur = !m || m.type === 'image' ? Infinity : Math.max(0.1, AVP.timeForSrc(lead, m.duration - lead.inPoint));
      const lo = 0.1 - lead.duration;
      const hi = maxDur - lead.duration;
      const end = lead.start + lead.duration;
      let x = clamp(dx, lo, hi);
      x += snapDelta([end + x]);
      x = AVP.snapFrame(end + x) - end;
      d = clamp(x, lo, hi);
    }

    for (const id of drag.ids) {
      const o = drag.orig[id];
      const c = AVP.findClip(id);
      if (!c) continue;
      if (drag.kind === 'move') {
        c.start = o.start + d;
        if (id === drag.leadId && newTrack) c.track = newTrack;
      } else {
        AVP.trimApply(c, o, drag.kind, d);
      }
    }
    render();
  }

  /* ---------- pointer events ---------- */

  /* ---------- transition handles ---------- */

  // The transition object that a badge edits: the incoming clip's transIn, or the clip's transOut.
  function transSpecOf(c, edge) {
    return edge === 'out' ? c.transOut : c.transIn;
  }

  // Starts dragging a transition handle. The change is applied to the partner audio fade too.
  function startTransDrag(badge, side, e) {
    const c = AVP.findClip(badge.dataset.transClip);
    if (!c) return;
    const edge = badge.dataset.edge;
    const spec = transSpecOf(c, edge);
    if (!spec) return;
    const centered = badge.dataset.centered === '1';
    const list = S.clips.filter((o) => o.track === c.track);
    // The longest a transition can be: it cannot run past either clip it joins.
    let maxD = c.duration;
    if (centered) {
      const prev = list.find((o) => o.id !== c.id && Math.abs(AVP.clipEnd(o) - c.start) < AVP.EPS);
      maxD = Math.min(c.duration, prev ? prev.duration : c.duration);
    }
    drag = {
      kind: 'trans',
      edge,
      side,
      centered,
      clipId: c.id,
      origD: spec.duration,
      maxD,
      startX: e.clientX,
      moved: false,
      pushed: AVP.pushUndo(),
      partnerIds: AVP.partners(c).map((p) => p.id),
    };
  }

  function updateTransDrag(e) {
    const dx = (e.clientX - drag.startX) / S.zoom;
    if (Math.abs(e.clientX - drag.startX) > 2) drag.moved = true;
    // Centred: each side grows by half, so the handle moves twice as fast as the window edge.
    // Edge transitions: the handle moves the duration one for one.
    const grow = drag.side === 'r' ? dx : -dx;
    const delta = drag.centered ? grow * 2 : grow;
    const fps = S.fps;
    let d = drag.origD + delta;
    d = Math.round(AVP.clamp(d, 1 / fps, drag.maxD) * fps) / fps;
    const c = AVP.findClip(drag.clipId);
    if (!c) return;
    [c].concat(drag.partnerIds.map((id) => AVP.findClip(id))).forEach((clip) => {
      if (!clip) return;
      const spec = transSpecOf(clip, drag.edge);
      if (spec) spec.duration = d;
    });
    render();
    AVP.monitor.draw();
  }

  function onDown(e) {
    if (e.button === 1) {
      // Middle button drags the timeline in any direction, whatever tool is active.
      drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, s0: dom.scroll.scrollLeft, t0: dom.scroll.scrollTop };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (e.target.closest('.tl-head')) return;

    const handle = e.target.closest('.tr-h');
    if (handle && S.tool === 'select' && !handle.classList.contains('fixed')) {
      const badge = handle.closest('.tr-badge');
      if (badge) {
        startTransDrag(badge, handle.dataset.th, e);
        e.preventDefault();
        return;
      }
    }

    if (S.tool === 'hand') {
      drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, s0: dom.scroll.scrollLeft, t0: dom.scroll.scrollTop };
      e.preventDefault();
      return;
    }

    if (S.tool === 'zoom') {
      // Click to zoom in around the pointer; Alt+click zooms out.
      zoomAt(e.altKey ? 1 / 1.5 : 1.5, timeAtClientX(e.clientX), e.clientX);
      return;
    }

    if (S.tool === 'type') {
      const lane = e.target.closest('.tl-lane[data-track]');
      if (!lane) return;
      const tid = lane.dataset.track;
      if (S.tracks[tid].kind !== 'video') return AVP.toast('Titles go on a video track', 'warn');
      const t = Math.max(0, AVP.snapFrame((e.clientX - lane.getBoundingClientRect().left) / S.zoom));
      AVP.edit.placeTitle({ track: tid, start: t, preset: 0, mode: 'overwrite' });
      setTool('select');
      return;
    }

    if (e.target.closest('.tl-row.ruler')) {
      AVP.monitor.stop();
      drag = { kind: 'scrub' };
      scrubLock = null;
      scrubTo(e.clientX);
      e.preventDefault();
      return;
    }

    if (e.target.closest('.marker-flag')) {
      const m = S.markers.find((x) => x.id === e.target.closest('.marker-flag').dataset.marker);
      if (m) {
        AVP.monitor.goTo(m.t);
        render();
      }
      return;
    }

    const el = e.target.closest('.clip');
    if (el) {
      const c = AVP.findClip(el.dataset.id);
      if (!c) return;
      if (S.tool === 'razor') {
        const laneLeft = el.parentElement.getBoundingClientRect().left;
        razorAt(c, AVP.snapFrame((e.clientX - laneLeft) / S.zoom));
        return;
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        AVP.toggleSelect(c.id);
        render();
        AVP.refreshPanels();
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const kind = x < EDGE_PX ? 'trim-in' : rect.width - x < EDGE_PX ? 'trim-out' : 'move';
      const wasSelected = S.selection.includes(c.id);
      if (!wasSelected) AVP.select([c.id], false);
      startClipDrag(kind, c, e);
      if (drag) drag.soloOnClick = wasSelected && S.selection.length > 1;
      e.preventDefault();
      return;
    }

    if (e.target.closest('.tl-lane')) {
      if (S.tool === 'select' && !e.shiftKey) {
        // Rubber-band selection; a plain click (no movement) scrubs instead.
        const cb = dom.content.getBoundingClientRect();
        drag = { kind: 'marquee', x0: e.clientX - cb.left, y0: e.clientY - cb.top, cx: cb.left, cy: cb.top, moved: false, pushed: false };
        e.preventDefault();
        return;
      }
      if (!e.shiftKey) AVP.select([], false);
      AVP.monitor.stop();
      drag = { kind: 'scrub' };
      scrubLock = null;
      scrubTo(e.clientX);
      render();
      AVP.refreshPanels();
      e.preventDefault();
    }
  }

  function updateMarquee(e) {
    const cb = dom.content.getBoundingClientRect();
    const x = e.clientX - cb.left;
    const y = e.clientY - cb.top;
    const r = { x: Math.min(x, drag.x0), y: Math.min(y, drag.y0), w: Math.abs(x - drag.x0), h: Math.abs(y - drag.y0) };
    if (r.w > 3 || r.h > 3) drag.moved = true;
    dom.marquee.classList.toggle('hidden', !drag.moved);
    dom.marquee.style.left = r.x + 'px';
    dom.marquee.style.top = r.y + 'px';
    dom.marquee.style.width = r.w + 'px';
    dom.marquee.style.height = r.h + 'px';
  }

  function finishMarquee(e, moved) {
    const mr = dom.marquee.getBoundingClientRect();
    dom.marquee.classList.add('hidden');
    if (!moved) {
      AVP.select([], false);
      AVP.monitor.stop();
      S.playhead = timeAtClientX(e.clientX);
      return;
    }
    const ids = [];
    dom.content.querySelectorAll('.clip').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > mr.left && r.left < mr.right && r.bottom > mr.top && r.top < mr.bottom) ids.push(el.dataset.id);
    });
    AVP.select(ids, false);
  }

  function onMove(e) {
    if (!drag) return;
    if (drag.kind === 'pan') {
      dom.scroll.scrollLeft = drag.s0 - (e.clientX - drag.x0);
      dom.scroll.scrollTop = drag.t0 - (e.clientY - drag.y0);
    }
    else if (drag.kind === 'scrub') scrubTo(e.clientX);
    else if (drag.kind === 'marquee') updateMarquee(e);
    else if (drag.kind === 'trans') updateTransDrag(e);
    else updateClipDrag(e);
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'marquee') {
      finishMarquee(e, d.moved);
      render();
      AVP.refreshPanels();
      return;
    }
    if (d.pushed && !d.moved) AVP.popUndo();
    // A plain click on a clip from a multi-selection selects just that clip.
    if (d.soloOnClick && !d.moved) AVP.select([d.leadId], false);
    if ((d.kind === 'move' || d.kind === 'trim-in' || d.kind === 'trim-out') && d.moved) {
      // Dropped clips overwrite whatever they now cover on their tracks.
      const keep = new Set(d.ids);
      d.ids.forEach((id) => {
        const c = AVP.findClip(id);
        if (c) AVP.edit.carveRange(c.track, c.start, c.start + c.duration, keep);
      });
    }
    if (d.kind !== 'pan') AVP.refresh();
  }

  // Razor tool: a red line shows exactly where the clip will be cut, snapped to the frame.
  function showRazorLine(e) {
    if (!dom.razor || drag) return;
    if (e.target.closest('.tl-head') || e.target.closest('.tools')) return hideRazorLine();
    const t = timeAtClientX(e.clientX);
    dom.razor.style.left = HEAD_W + t * S.zoom + 'px';
    dom.razor.firstChild.textContent = AVP.fmtTC(t);
    dom.razor.classList.remove('hidden');
  }

  function hideRazorLine() {
    if (dom.razor) dom.razor.classList.add('hidden');
  }

  function onHover(e) {
    if (S.tool === 'razor') return showRazorLine(e);
    if (drag || S.tool !== 'select') return;
    const el = e.target.closest('.clip');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    el.style.cursor = x < EDGE_PX || r.width - x < EDGE_PX ? 'ew-resize' : 'default';
  }

  function onClick(e) {
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const id = tg.dataset.toggle;
      const tr = S.tracks[id];
      AVP.pushUndo();
      if (tr.kind === 'video') tr.hidden = !tr.hidden;
      else tr.muted = !tr.muted;
      AVP.refresh();
      return;
    }
    const so = e.target.closest('[data-solo]');
    if (so) {
      const tr = S.tracks[so.dataset.solo];
      AVP.pushUndo();
      tr.solo = !tr.solo;
      AVP.refresh();
      return;
    }
    const lk = e.target.closest('[data-lock]');
    if (lk) {
      const tr = S.tracks[lk.dataset.lock];
      AVP.pushUndo();
      tr.locked = !tr.locked;
      AVP.refresh();
      return;
    }
    const head = e.target.closest('.tl-head[data-head]');
    if (head) {
      const id = head.dataset.head;
      S.target[S.tracks[id].kind] = id;
      render();
    }
  }

  /* ---------- drag and drop ---------- */

  function hasType(e, mime) {
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(mime));
  }

  function onDragOver(e) {
    if (hasType(e, DRAG_MIME) || hasType(e, LIB_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function onDrop(e) {
    if (hasType(e, LIB_MIME)) return dropLibraryItem(e);
    const id = e.dataTransfer && e.dataTransfer.getData(DRAG_MIME);
    if (!id) return;
    e.preventDefault();
    const lane = e.target.closest('.tl-lane[data-track]');
    const m = AVP.findMedia(id);
    if (!lane || !m) return;
    const trackId = lane.dataset.track;
    const kind = S.tracks[trackId].kind;
    if (S.tracks[trackId].caption) return AVP.toast('Captions are added in the Captions panel', 'warn');
    const t = Math.max(0, AVP.snapFrame((e.clientX - lane.getBoundingClientRect().left) / S.zoom));
    const mode = e.shiftKey ? 'insert' : 'overwrite';
    if (m.type === 'audio' && kind === 'audio') {
      AVP.edit.placeMedia({ mediaId: id, start: t, videoTrack: null, audioTrack: trackId, mode });
    } else if (m.type !== 'audio' && kind === 'video') {
      AVP.edit.placeMedia({ mediaId: id, start: t, videoTrack: trackId, audioTrack: S.target.audio, mode });
    } else {
      AVP.toast('Video and images go on a video track, audio on an audio track', 'warn');
    }
  }

  // Effects, transitions and titles dragged from the Effects tab.
  function dropLibraryItem(e) {
    e.preventDefault();
    let item = null;
    try {
      item = JSON.parse(e.dataTransfer.getData(LIB_MIME));
    } catch (err) {
      return;
    }
    if (!item) return;
    hideTransitionPreview();
    const clipEl = e.target.closest('.clip');
    const lane = e.target.closest('.tl-lane[data-track]');

    if (item.kind === 'effect') {
      if (!clipEl) return AVP.toast('Drop effects onto a clip', 'warn');
      AVP.edit.addFx([clipEl.dataset.id], item.type);
    } else if (item.kind === 'look') {
      if (!clipEl) return AVP.toast('Drop a look onto a clip', 'warn');
      AVP.edit.addLook([clipEl.dataset.id], item.index);
    } else if (item.kind === 'transition') {
      if (!clipEl) return AVP.toast('Drop a transition on a clip: near a cut it goes at the cut, otherwise at the start or end', 'warn');
      const c = AVP.findClip(clipEl.dataset.id);
      const def = AVP.TRANSITIONS[item.type];
      if (!c || !def) return;
      const r = clipEl.getBoundingClientRect();
      // The same plan the preview showed, so the drop lands exactly where the preview was.
      const plan = AVP.transitionDropPlan(clipsOnTrack(c.track), c, e.clientX - r.left, r.width, CUT_PX, def.dur);
      AVP.edit.applyTransition(plan.clipId, item.type, plan.edge);
    } else if (item.kind === 'title') {
      if (!lane) return;
      const trackId = lane.dataset.track;
      if (S.tracks[trackId].kind !== 'video') return AVP.toast('Titles go on a video track', 'warn');
      const t = Math.max(0, AVP.snapFrame((e.clientX - lane.getBoundingClientRect().left) / S.zoom));
      AVP.edit.placeTitle({ track: trackId, start: t, preset: item.preset, mode: e.shiftKey ? 'insert' : 'overwrite' });
    }
  }

  function markDropTarget(e) {
    const el = e.target.closest('.clip');
    if (hoverClipEl && hoverClipEl !== el) hoverClipEl.classList.remove('drop-target');
    hoverClipEl = el;
    // Transitions show their own preview instead of outlining the clip.
    const isTransition = AVP.libDrag && AVP.libDrag.kind === 'transition';
    if (el && hasType(e, LIB_MIME) && !isTransition) el.classList.add('drop-target');
  }

  /* ---------- transition drop preview ---------- */

  // Pointer distance (px) from a cut that still counts as dropping on that cut.
  const CUT_PX = 12;
  let trPreview = null;

  function clipsOnTrack(track) {
    return S.clips.filter((o) => o.track === track).sort((a, b) => a.start - b.start);
  }

  function hideTransitionPreview() {
    if (trPreview) trPreview.remove();
    trPreview = null;
  }

  // While a transition from the Effects library is dragged over a clip, shows the span it will cover:
  // centred on a cut when the pointer is at a cut, otherwise at the clip's start or end. Red when the
  // transition does not fit the track (a video transition on an audio clip, or the reverse).
  function showTransitionPreview(e) {
    const item = AVP.libDrag;
    const el = e.target.closest('.clip');
    const lane = e.target.closest('.tl-lane[data-track]');
    const def = item && item.kind === 'transition' ? AVP.TRANSITIONS[item.type] : null;
    if (!def || !el || !lane) return hideTransitionPreview();
    const c = AVP.findClip(el.dataset.id);
    if (!c) return hideTransitionPreview();
    const r = el.getBoundingClientRect();
    const plan = AVP.transitionDropPlan(clipsOnTrack(c.track), c, e.clientX - r.left, r.width, CUT_PX, def.dur);
    const fits = def.audio === (S.tracks[c.track].kind === 'audio');
    if (!trPreview) trPreview = document.createElement('div');
    const a = Math.max(0, plan.span[0]);
    const b = Math.max(a, plan.span[1]);
    trPreview.className = 'tr-drop-preview' + (fits ? '' : ' bad') + (plan.centered ? ' cut' : '');
    trPreview.textContent = !fits
      ? (def.audio ? 'Audio fades go on audio clips' : 'Video transitions go on video clips')
      : plan.centered ? def.name + ' at the cut' : def.name;
    trPreview.style.left = a * S.zoom + 'px';
    trPreview.style.width = Math.max(6, (b - a) * S.zoom) + 'px';
    if (trPreview.parentElement !== lane) lane.appendChild(trPreview);
  }

  /* ---------- zoom / fit ---------- */

  function setZoom(z) {
    S.zoom = clamp(Math.round(z), 5, 240);
    const zoom = $('#tlZoom');
    if (zoom) zoom.value = S.zoom;
    render();
  }

  // Zooms so the time under the pointer stays under the pointer.
  function zoomAt(factor, t, clientX) {
    const offset = clientX - dom.scroll.getBoundingClientRect().left;
    setZoom(S.zoom * factor);
    dom.scroll.scrollLeft = Math.max(0, HEAD_W + t * S.zoom - offset);
  }

  function zoomBy(factor) {
    setZoom(S.zoom * factor);
  }

  function fit() {
    const end = Math.max(AVP.seqEnd(), 5);
    const avail = dom.scroll.clientWidth - HEAD_W - 60;
    setZoom(avail / end);
    dom.scroll.scrollLeft = 0;
  }

  /* ---------- context menus ---------- */

  function trackMenu(id) {
    const tr = S.tracks[id];
    const kind = tr.kind;
    const count = S.trackOrder.filter((t) => S.tracks[t].kind === kind).length;
    const items = [
      { label: `Add ${kind === 'video' ? 'Video' : 'Audio'} Track Above`, action: () => AVP.edit.addTrack(kind, id, 'above') },
      { label: `Add ${kind === 'video' ? 'Video' : 'Audio'} Track Below`, action: () => AVP.edit.addTrack(kind, id, 'below') },
      { sep: true },
      { label: 'Set as Target Track', action: () => { S.target[kind] = id; AVP.refresh(); } },
      { label: 'Select All Clips on Track', action: () => { AVP.select(S.clips.filter((c) => c.track === id).map((c) => c.id), false); AVP.refresh(); } },
      { label: tr.locked ? 'Unlock Track' : 'Lock Track', action: () => { AVP.pushUndo(); tr.locked = !tr.locked; AVP.refresh(); } },
    ];
    if (kind === 'video') items.push({ label: tr.hidden ? 'Show Track' : 'Hide Track', action: () => { AVP.pushUndo(); tr.hidden = !tr.hidden; AVP.refresh(); } });
    else items.push({ label: tr.muted ? 'Unmute Track' : 'Mute Track', action: () => { AVP.pushUndo(); tr.muted = !tr.muted; AVP.refresh(); } });
    items.push({ sep: true });
    const empty = !S.clips.some((c) => c.track === id);
    items.push({
      label: 'Delete Track',
      disabled: !empty || count <= 1,
      action: () => AVP.edit.removeTrack(id),
    });
    return items;
  }

  function transitionMenu(c, edge) {
    const kind = S.tracks[c.track].kind;
    return AVP.transitionsFor(kind).map((k) => ({
      label: AVP.TRANSITIONS[k].name,
      action: () => AVP.edit.applyTransition(c.id, k, edge),
    }));
  }

  // Marker actions for the clip menu and the Clip menu. getIds is read when an item is chosen.
  function markerItems(getIds, audio) {
    const transitions = audio
      ? [{ label: 'Constant Gain (Audio Fade)', action: () => AVP.edit.transitionAtMarkers(getIds(), 'audio-fade') }]
      : AVP.transitionsFor('video').map((k) => ({ label: AVP.TRANSITIONS[k].name, action: () => AVP.edit.transitionAtMarkers(getIds(), k) }));
    return [
      { label: 'Split at Each Marker', action: () => AVP.edit.splitAtMarkers(getIds()) },
      { label: 'Transition at Each Marker', children: transitions },
      { label: 'Keep Only Between First and Last Marker', action: () => AVP.edit.keepBetweenMarkers(getIds()) },
      { label: 'Remove Markers in These Clips', action: () => AVP.edit.removeMarkersOn(getIds()) },
    ];
  }

  function clipMenu(c) {
    const m = AVP.findMedia(c.mediaId);
    const kind = S.tracks[c.track].kind;
    const isVideo = kind === 'video';
    const hasPartner = AVP.partners(c).length > 0;
    const ids = S.selection.slice();
    // Marker actions apply to the selection when this clip is part of it, otherwise to this clip alone.
    const targets = ids.includes(c.id) ? ids : [c.id];
    const many = ids.length > 1;
    const hasStart = !!c.transIn;
    const hasEnd = !!(S.clips.find((o) => o.track === c.track && Math.abs(o.start - AVP.clipEnd(c)) < EPS) || {}).transIn || !!c.transOut;
    const items = [
      { label: 'Cut at Playhead', key: 'Ctrl+K', action: () => AVP.edit.splitAtPlayhead() },
      { label: 'Cut at Markers', children: markerItems(() => targets, kind === 'audio') },
      { label: 'Copy', key: 'Ctrl+C', action: () => AVP.edit.copySelection() },
      { label: 'Paste at Playhead', key: 'Ctrl+V', action: () => AVP.edit.paste(S.playhead, 'overwrite') },
      { label: 'Duplicate', key: 'Ctrl+D', action: () => AVP.edit.duplicate() },
      { sep: true },
      { label: 'Delete', key: 'Del', action: () => AVP.edit.deleteSelection(false) },
      { label: 'Ripple Delete', key: 'Shift+Del', action: () => AVP.edit.deleteSelection(true) },
      { sep: true },
      { label: 'Speed / Duration…', key: 'Ctrl+R', action: () => AVP.main.speedDialog(ids) },
      { label: c.enabled ? 'Disable Clip' : 'Enable Clip', action: () => AVP.edit.toggleEnabled(ids) },
      { label: 'Link Selected', disabled: !many, action: () => AVP.edit.link(ids) },
      { label: 'Unlink', disabled: !hasPartner && !c.linkId, action: () => AVP.edit.unlink(ids) },
      { sep: true },
      {
        label: 'Effects',
        children: Object.keys(AVP.EFFECTS).map((k) => ({
          label: `${AVP.EFFECTS[k].cat}: ${AVP.EFFECTS[k].name}`,
          action: () => AVP.edit.addFx(ids, k),
        })),
      },
    ];
    if (isVideo || c.kind === 'title') {
      items.push({ label: 'Transition at Start', children: transitionMenu(c, 'start') });
      items.push({ label: 'Transition at End', children: transitionMenu(c, 'end') });
      if (hasStart) items.push({ label: 'Remove Start Transition', action: () => AVP.edit.removeTransition(c.id, 'start') });
      if (hasEnd) items.push({ label: 'Remove End Transition', action: () => AVP.edit.removeTransition(c.id, 'end') });
    } else {
      items.push({ label: 'Audio Fade In', action: () => AVP.edit.applyTransition(c.id, 'audio-fade', 'start') });
      items.push({ label: 'Audio Fade Out', action: () => AVP.edit.applyTransition(c.id, 'audio-fade', 'end') });
    }
    items.push({ sep: true });
    if (c.kind === 'title') {
      items.push({ label: 'Edit Title in Effect Controls', action: () => AVP.panels.setPanel('controls') });
    }
    if (m) items.push({ label: 'Open Source in Source Monitor', action: () => AVP.bin.loadSource(m.id) });
    items.push({ label: 'Show Effect Controls', action: () => { AVP.select([c.id], false); AVP.panels.setPanel('controls'); AVP.refresh(); } });
    return items;
  }

  function rulerMenu(t) {
    return [
      { label: 'Go to Here', action: () => AVP.monitor.goTo(t) },
      { label: 'Add Marker Here', key: 'M', action: () => AVP.edit.addMarker(t) },
      { sep: true },
      { label: 'Set Work Area In', key: '[', action: () => AVP.main.setWork('in', t) },
      { label: 'Set Work Area Out', key: ']', action: () => AVP.main.setWork('out', t) },
      { label: 'Clear Work Area', action: () => AVP.main.setWork('clear') },
      { sep: true },
      { label: 'Zoom to Fit', key: '\\', action: fit },
    ];
  }

  function laneMenu(track, t) {
    return [
      { label: 'Paste Here', key: 'Ctrl+V', action: () => AVP.edit.paste(t, 'overwrite'), disabled: !S.clipboard },
      { label: 'Insert Title Here', action: () => AVP.edit.placeTitle({ track, start: t, preset: 0, mode: 'overwrite' }), disabled: S.tracks[track].kind !== 'video' || S.tracks[track].locked },
      { label: 'Add Marker Here', key: 'M', action: () => AVP.edit.addMarker(t) },
      { sep: true },
      {
        label: 'Select All',
        key: 'Ctrl+A',
        action: () => {
          AVP.select(
            S.clips.map((c) => c.id),
            false
          );
          AVP.refresh();
        },
      },
      { label: 'Zoom to Fit', key: '\\', action: fit },
      { label: 'Add Video Track', action: () => AVP.edit.addTrack('video') },
      { label: 'Add Audio Track', action: () => AVP.edit.addTrack('audio') },
    ];
  }

  function markerMenu(m) {
    return [
      { label: 'Go to Marker', action: () => AVP.monitor.goTo(m.t) },
      {
        label: 'Rename Marker…',
        action: () =>
          AVP.dialog.form({
            title: 'Marker name',
            fields: [{ k: 'label', label: 'Name', type: 'text', value: m.label || '' }],
            ok: 'Save',
            onOk: (v) => {
              AVP.pushUndo();
              m.label = v.label;
              AVP.refresh();
            },
          }),
      },
      { label: 'Delete Marker', action: () => AVP.edit.removeMarker(m.id) },
    ];
  }

  function onContextMenu(e) {
    e.preventDefault();
    const head = e.target.closest('.tl-head[data-head]');
    if (head) return AVP.menu.show(e.clientX, e.clientY, trackMenu(head.dataset.head));
    const mk = e.target.closest('.marker-flag');
    if (mk) {
      const m = S.markers.find((x) => x.id === mk.dataset.marker);
      if (m) return AVP.menu.show(e.clientX, e.clientY, markerMenu(m));
    }
    const clipEl = e.target.closest('.clip');
    if (clipEl) {
      const c = AVP.findClip(clipEl.dataset.id);
      if (c) {
        if (!S.selection.includes(c.id)) AVP.select([c.id], false);
        render();
        AVP.refreshPanels();
        return AVP.menu.show(e.clientX, e.clientY, clipMenu(c));
      }
    }
    if (e.target.closest('.tl-row.ruler')) return AVP.menu.show(e.clientX, e.clientY, rulerMenu(timeAtClientX(e.clientX)));
    const lane = e.target.closest('.tl-lane[data-track]');
    if (lane) {
      const t = Math.max(0, AVP.snapFrame((e.clientX - lane.getBoundingClientRect().left) / S.zoom));
      return AVP.menu.show(e.clientX, e.clientY, laneMenu(lane.dataset.track, t));
    }
    AVP.menu.show(e.clientX, e.clientY, [{ label: 'Add Video Track', action: () => AVP.edit.addTrack('video') }, { label: 'Add Audio Track', action: () => AVP.edit.addTrack('audio') }]);
  }

  function init() {
    dom.scroll = $('#tlScroll');
    dom.content = $('#tlContent');
    dom.tc = $('#tlTC');

    dom.scroll.addEventListener('pointerdown', onDown);
    dom.scroll.addEventListener('pointermove', onHover);
    dom.scroll.addEventListener('pointerleave', hideRazorLine);
    dom.scroll.addEventListener('click', onClick);
    dom.scroll.addEventListener('contextmenu', onContextMenu);
    dom.scroll.addEventListener('dragover', (e) => {
      onDragOver(e);
      markDropTarget(e);
      showTransitionPreview(e);
    });
    dom.scroll.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !dom.scroll.contains(e.relatedTarget)) hideTransitionPreview();
      if (hoverClipEl) hoverClipEl.classList.remove('drop-target');
      hoverClipEl = null;
    });
    dom.scroll.addEventListener('drop', (e) => {
      if (hoverClipEl) hoverClipEl.classList.remove('drop-target');
      hoverClipEl = null;
      onDrop(e);
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => setTool(b.dataset.tool));
    });
    $('#tlSnap').addEventListener('click', () => AVP.main.toggleSnap());
    $('#tlLinked').addEventListener('click', () => {
      S.linkedSelection = S.linkedSelection === false;
      AVP.toast(S.linkedSelection ? 'Linked selection on' : 'Linked selection off: clips select one at a time');
      updateToolbar();
    });
    $('#tlFit').addEventListener('click', fit);
    $('#tlMarker').addEventListener('click', () => AVP.edit.addMarker(S.playhead));
    $('#tlZoom').addEventListener('input', (e) => {
      S.zoom = +e.target.value;
      render();
    });

    setTool(S.tool);
    render();
  }

  AVP.timeline = {
    init,
    render,
    updatePlayhead,
    setTool,
    zoomBy,
    fit,
    updateToolbar,
    rulerMenu,
    gotoMarker,
    markerItems,
  };
})();
