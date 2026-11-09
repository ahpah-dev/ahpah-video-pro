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
  const RULER_H = 26;
  const TRACK_H = { video: 54, audio: 44 };
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
    dom.scroll.classList.toggle('tool-razor', tool === 'razor');
    dom.scroll.classList.toggle('tool-hand', tool === 'hand');
    updateToolbar();
  }

  function updateToolbar() {
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
    const snap = $('#tlSnap');
    if (snap) snap.classList.toggle('active', S.snap);
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
    g.fillStyle = '#2b2b2b';
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
    g.fillStyle = '#9a9a9a';
    g.strokeStyle = '#6a6a6a';
    g.lineWidth = 1;
    for (let k = 0; k * step * S.zoom <= laneW; k++) {
      const t = k * step;
      const x = Math.round(t * S.zoom) + 0.5;
      g.beginPath();
      g.moveTo(x, H - 7);
      g.lineTo(x, H - 4);
      g.stroke();
      g.fillText(fmtShort(t, step), x + 3, 11);
    }
  }

  function clipHtml(c, list) {
    const m = AVP.findMedia(c.mediaId);
    const kind = c.kind === 'title' ? 'title' : m ? m.type : 'video';
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
    let wave = '';
    if (m && m.wave && kind !== 'image' && kind !== 'title') {
      const sp = c.speed || 1;
      const full = (m.duration / sp) * S.zoom;
      wave = ' wv-' + m.id;
      style += `background-size:${full}px 100%;background-position:${-(c.inPoint / sp) * S.zoom}px 0;`;
    }
    let label = kind === 'title' ? c.text.text.split('\n')[0] || 'Title' : m ? m.name : 'Missing media';
    if (c.speed && c.speed !== 1) label += `  ${Math.round(c.speed * 100)}%`;
    if (c.fx && c.fx.length) label += `  fx${c.fx.length}`;
    const name = m ? m.name : c.kind === 'title' ? 'Title' : 'Missing media';
    return (
      `<div class="${cls}${wave}" data-id="${c.id}" style="${style}" title="${AVP.esc(name)}">` +
      `<span class="clip-label">${AVP.esc(label)}</span></div>`
    );
  }

  // Transition badges sit on the cut they belong to.
  function transitionsHtml(list, track) {
    let html = '';
    const kind = S.tracks[track].kind;
    list.forEach((c) => {
      if (!c.transIn) return;
      const R = AVP.roleWindows(c, list);
      if (!R.in) return;
      const left = R.in.a * S.zoom;
      const width = Math.max(4, (R.in.b - R.in.a) * S.zoom);
      const def = AVP.TRANSITIONS[R.in.type];
      const label = def ? def.name : R.in.type;
      html +=
        `<div class="tr-badge ${kind}" data-trans-clip="${c.id}" style="left:${left}px;width:${width}px" ` +
        `title="${AVP.esc(label)} (${R.in.centered ? 'centred' : 'from start'})"></div>`;
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
        `<span class="tl-name">${id}</span>` +
        `<span class="tl-buttons">` +
        `<button class="tl-toggle${off ? ' off' : ''}" data-toggle="${id}" title="${tr.kind === 'video' ? 'Show / hide track' : 'Mute / unmute track'}"></button>` +
        `<button class="tl-toggle lock${tr.locked ? ' on' : ''}" data-lock="${id}" title="Lock / unlock track"></button>` +
        `</span></div>` +
        `<div class="tl-lane" data-track="${id}" style="width:${laneW}px;height:${h}px">` +
        list.map((c) => clipHtml(c, list)).join('') +
        transitionsHtml(list, id) +
        `</div></div>`;
    }
    html += '<div class="marker-lines">' + S.markers.map((m) => `<div class="marker-line" style="left:${HEAD_W + m.t * S.zoom}px"></div>`).join('') + '</div>';
    html += '<div class="tl-marquee hidden"></div>';
    html += '<div class="tl-playhead"></div>';
    dom.content.innerHTML = html;
    dom.content.style.width = HEAD_W + laneW + 'px';
    dom.content.querySelectorAll('.tl-toggle').forEach((btn) => {
      const id = btn.dataset.toggle || btn.dataset.lock;
      if (btn.dataset.lock) btn.innerHTML = ICON_LOCK;
      else btn.innerHTML = S.tracks[id].kind === 'video' ? ICON_EYE : ICON_SPK;
    });
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

  function scrubTo(clientX) {
    S.playhead = timeAtClientX(clientX);
    updatePlayhead();
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
    const ids = [c.id].concat(AVP.partners(c).map((p) => p.id));
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
      const lo = Math.max(-lead.inPoint / (lead.speed || 1), -lead.start);
      const hi = lead.duration - 0.1;
      let x = clamp(dx, lo, hi);
      x += snapDelta([lead.start + x]);
      x = AVP.snapFrame(lead.start + x) - lead.start;
      d = clamp(x, lo, hi);
    } else {
      // trim-out: cannot run past the end of the source (unless it is a still or title)
      const m = AVP.findMedia(lead.mediaId);
      const sp = lead.speed || 1;
      const maxDur = !m || m.type === 'image' ? Infinity : Math.max(0.1, (m.duration - lead.inPoint) / sp);
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

  function onDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.tl-head')) return;

    if (S.tool === 'hand') {
      drag = { kind: 'pan', x0: e.clientX, s0: dom.scroll.scrollLeft };
      e.preventDefault();
      return;
    }

    if (e.target.closest('.tl-row.ruler')) {
      AVP.monitor.stop();
      drag = { kind: 'scrub' };
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
      if (!S.selection.includes(c.id)) AVP.select([c.id], false);
      startClipDrag(kind, c, e);
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

  function finishMarquee(e) {
    const mr = dom.marquee.getBoundingClientRect();
    dom.marquee.classList.add('hidden');
    if (!drag.moved) {
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
    if (drag.kind === 'pan') dom.scroll.scrollLeft = drag.s0 - (e.clientX - drag.x0);
    else if (drag.kind === 'scrub') scrubTo(e.clientX);
    else if (drag.kind === 'marquee') updateMarquee(e);
    else updateClipDrag(e);
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'marquee') {
      finishMarquee(e);
      render();
      AVP.refreshPanels();
      return;
    }
    if (d.pushed && !d.moved) AVP.popUndo();
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

  function onHover(e) {
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
    const clipEl = e.target.closest('.clip');
    const lane = e.target.closest('.tl-lane[data-track]');

    if (item.kind === 'effect') {
      if (!clipEl) return AVP.toast('Drop effects onto a clip', 'warn');
      AVP.edit.addFx([clipEl.dataset.id], item.type);
    } else if (item.kind === 'transition') {
      if (!clipEl) return AVP.toast('Drop transitions onto the start or end of a clip', 'warn');
      const r = clipEl.getBoundingClientRect();
      const edge = e.clientX - r.left < r.width / 2 ? 'start' : 'end';
      AVP.edit.applyTransition(clipEl.dataset.id, item.type, edge);
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
    if (el && hasType(e, LIB_MIME)) el.classList.add('drop-target');
  }

  /* ---------- zoom / fit ---------- */

  function setZoom(z) {
    S.zoom = clamp(Math.round(z), 5, 240);
    const zoom = $('#tlZoom');
    if (zoom) zoom.value = S.zoom;
    render();
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

  function clipMenu(c) {
    const m = AVP.findMedia(c.mediaId);
    const kind = S.tracks[c.track].kind;
    const isVideo = kind === 'video';
    const hasPartner = AVP.partners(c).length > 0;
    const ids = S.selection.slice();
    const many = ids.length > 1;
    const hasStart = !!c.transIn;
    const hasEnd = !!(S.clips.find((o) => o.track === c.track && Math.abs(o.start - AVP.clipEnd(c)) < EPS) || {}).transIn || !!c.transOut;
    const items = [
      { label: 'Cut at Playhead', key: 'Ctrl+K', action: () => AVP.edit.splitAtPlayhead() },
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
    dom.scroll.addEventListener('click', onClick);
    dom.scroll.addEventListener('contextmenu', onContextMenu);
    dom.scroll.addEventListener('dragover', (e) => {
      onDragOver(e);
      markDropTarget(e);
    });
    dom.scroll.addEventListener('dragleave', () => {
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
    $('#tlFit').addEventListener('click', fit);
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
  };
})();
