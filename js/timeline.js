/*
 * AhPah Video Pro - Timeline panel: rows, clips, ruler, playhead and mouse editing.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const EPS = AVP.EPS;

  const HEAD_W = 150;
  const RULER_H = 24;
  const TRACK_H = { video: 54, audio: 40 };
  const SNAP_PX = 8;
  const EDGE_PX = 7;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const dom = {};
  let drag = null;

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
  }

  /* ---------- rendering ---------- */

  function fmtShort(t, step) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    let label = `${m}:${String(s).padStart(2, '0')}`;
    if (step < 1) label += ':' + String(Math.round((t - Math.floor(t)) * S.fps)).padStart(2, '0');
    return label;
  }

  function drawRuler(laneW) {
    const cv = dom.content.querySelector('.ruler-canvas');
    if (!cv) return;
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    g.fillStyle = '#2b2b2b';
    g.fillRect(0, 0, W, H);
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
      g.lineTo(x, H);
      g.stroke();
      g.fillText(fmtShort(t, step), x + 3, 11);
    }
  }

  function clipsHtml(track) {
    return S.clips
      .filter((c) => c.track === track)
      .map((c) => {
        const m = AVP.findMedia(c.mediaId);
        const kind = m ? m.type : 'video';
        const cls = [
          'clip',
          kind === 'audio' ? 'audio' : kind === 'image' ? 'image' : 'video',
          S.selection.includes(c.id) ? 'selected' : '',
          m && m.offline ? 'offline' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const name = m ? m.name : 'Missing media';
        const left = c.start * S.zoom;
        const width = Math.max(3, c.duration * S.zoom);
        return (
          `<div class="${cls}" data-id="${c.id}" style="left:${left}px;width:${width}px" title="${AVP.esc(name)}">` +
          `<span class="clip-label">${AVP.esc(name)}</span></div>`
        );
      })
      .join('');
  }

  function render() {
    if (!dom.content) return;
    const sc = dom.scroll;
    const laneW = Math.max(sc.clientWidth - HEAD_W, Math.ceil((AVP.seqEnd() + 60) * S.zoom));
    let html =
      `<div class="tl-row ruler" style="height:${RULER_H}px">` +
      `<div class="tl-head corner"></div>` +
      `<div class="tl-lane ruler-lane" style="width:${laneW}px;height:${RULER_H}px">` +
      `<canvas class="ruler-canvas" width="${laneW}" height="${RULER_H}"></canvas></div></div>`;

    for (const id of AVP.trackOrder) {
      const tr = S.tracks[id];
      const h = TRACK_H[tr.kind];
      const isTarget = S.target[tr.kind] === id;
      const off = tr.kind === 'video' ? !!tr.hidden : !!tr.muted;
      html +=
        `<div class="tl-row ${tr.kind}" data-row="${id}" style="height:${h}px">` +
        `<div class="tl-head ${tr.kind}${isTarget ? ' target' : ''}" data-head="${id}" title="Click to target ${id}">` +
        `<span class="tl-name">${id}</span>` +
        `<button class="tl-toggle${off ? ' off' : ''}" data-toggle="${id}" title="${
          tr.kind === 'video' ? 'Show / hide track' : 'Mute / unmute track'
        }"></button></div>` +
        `<div class="tl-lane" data-track="${id}" style="width:${laneW}px;height:${h}px">${clipsHtml(id)}</div>` +
        `</div>`;
    }
    html += '<div class="tl-playhead"></div>';
    dom.content.innerHTML = html;
    dom.content.style.width = HEAD_W + laneW + 'px';
    dom.content.querySelectorAll('.tl-toggle').forEach((btn) => {
      const id = btn.dataset.toggle;
      btn.innerHTML = S.tracks[id].kind === 'video' ? AVP.icons.get('eye') : AVP.icons.get('speaker');
    });
    dom.playhead = dom.content.querySelector('.tl-playhead');
    drawRuler(laneW);
    updatePlayhead();
    updateToolbar();
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
      dom.playhead.style.left = x + 'px';
      // Hide the line when it is under the sticky track headers.
      dom.playhead.style.display = x - sc.scrollLeft < HEAD_W ? 'none' : '';
    }
    if (dom.tc) dom.tc.textContent = AVP.fmtTC(S.playhead);
  }

  /* ---------- pointer interaction ---------- */

  function rulerLaneLeft() {
    const lane = dom.content.querySelector('.ruler-lane');
    return lane ? lane.getBoundingClientRect().left : 0;
  }

  function scrubTo(clientX) {
    S.playhead = Math.max(0, AVP.snapFrame((clientX - rulerLaneLeft()) / S.zoom));
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
    AVP.pushUndo();
    AVP.edit.splitClip(c, t); // also cuts linked partners
    S.selection = [];
    AVP.refresh();
  }

  function startClipDrag(kind, c, e) {
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
      if (tid && tid !== lead.track && S.tracks[tid].kind === S.tracks[lead.track].kind) {
        newTrack = tid;
        drag.moved = true;
      }
    } else if (drag.kind === 'trim-in') {
      const lo = Math.max(-lead.inPoint, -lead.start);
      const hi = lead.duration - 0.1;
      let x = clamp(dx, lo, hi);
      x += snapDelta([lead.start + x]);
      x = AVP.snapFrame(lead.start + x) - lead.start;
      d = clamp(x, lo, hi);
    } else {
      // trim-out
      const m = AVP.findMedia(lead.mediaId);
      const maxDur = !m || m.type === 'image' ? Infinity : Math.max(0.1, m.duration - lead.inPoint);
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
      } else if (drag.kind === 'trim-in') {
        c.start = o.start + d;
        c.inPoint = o.inPoint + d;
        c.duration = o.duration - d;
      } else {
        c.duration = o.duration + d;
      }
    }
    render();
    AVP.refreshPanels();
  }

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
      if (!e.shiftKey) AVP.select([], false);
      AVP.monitor.stop();
      drag = { kind: 'scrub' };
      scrubTo(e.clientX);
      render();
      AVP.refreshPanels();
      e.preventDefault();
    }
  }

  function onMove(e) {
    if (!drag) return;
    if (drag.kind === 'pan') {
      dom.scroll.scrollLeft = drag.s0 - (e.clientX - drag.x0);
    } else if (drag.kind === 'scrub') {
      scrubTo(e.clientX);
    } else {
      updateClipDrag(e);
    }
  }

  function onUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.pushed && !d.moved) AVP.popUndo();
    if (d.kind === 'move' || d.kind === 'trim-in' || d.kind === 'trim-out') {
      if (d.moved) {
        // Dropped clips overwrite whatever they now cover on their tracks.
        const keep = new Set(d.ids);
        d.ids.forEach((id) => {
          const c = AVP.findClip(id);
          if (c) AVP.edit.carveRange(c.track, c.start, c.start + c.duration, keep);
        });
      }
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
    const head = e.target.closest('.tl-head[data-head]');
    if (head) {
      const id = head.dataset.head;
      S.target[S.tracks[id].kind] = id;
      render();
    }
  }

  // Drag from the Project panel onto a track.
  function onDragOver(e) {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('application/x-avp-media')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function onDrop(e) {
    const id = e.dataTransfer && e.dataTransfer.getData('application/x-avp-media');
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
      AVP.toast('Video and images go on a video track, audio on an audio track');
    }
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

  function init() {
    dom.scroll = $('#tlScroll');
    dom.content = $('#tlContent');
    dom.tc = $('#tlTC');

    dom.scroll.addEventListener('pointerdown', onDown);
    dom.scroll.addEventListener('pointermove', onHover);
    dom.scroll.addEventListener('click', onClick);
    dom.scroll.addEventListener('dragover', onDragOver);
    dom.scroll.addEventListener('drop', onDrop);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => setTool(b.dataset.tool));
    });
    $('#tlSnap').addEventListener('click', () => AVP.toggleSnap());
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
  };
})();
