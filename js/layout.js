/*
 * AhPah Video Pro - panel layout.
 * The top row (left panel, Source, Program, right panel) and the timeline are sized by
 * splitters placed in the gaps between the panels. Sizes are stored as fractions of the
 * window, so the layout scales when the window is resized. Each workspace keeps its own sizes.
 * The tab strips of the left and right panel groups scroll by mouse wheel or by dragging.
 */
(function () {
  'use strict';

  const AVP = window.AVP;

  const GAP = 4; // gap between panels (css/premiere.css .layout)
  const PAD = 4; // padding around the layout
  const HIT = 8; // width of the grab area on a splitter
  const MIN_COL = 170;
  const MIN_TOP = 170;
  const MIN_TL = 170;
  const STORE_KEY = 'ahpah-video-pro.layout.v1';

  // Starting sizes. Side columns are fixed in px; the middle columns share the rest in the given ratio.
  // `top` is the share of the height given to the panels above the timeline.
  const PRESETS = {
    editing: { left: 320, right: 320, mid: [1, 1.2], top: 0.56 },
    assembly: { left: 420, right: 240, mid: [1, 1], top: 0.5 },
    effects: { left: 340, right: 380, mid: [1, 1], top: 0.56 },
    color: { left: 220, right: 220, mid: [1, 2], top: 0.56 },
    audio: { left: 260, right: 220, mid: [1, 1], top: 0.45 },
  };

  let layoutEl = null;
  let splits = { v: [], h: null };
  let saved = {};
  let wsId = 'editing';
  let current = null; // { cols: [4 fractions of the width], top: fraction of the height }
  let drag = null;

  function loadSaved() {
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
      saved = {};
    }
  }

  function saveSaved() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch (e) {
      /* storage can be full or disabled; the layout still works */
    }
  }

  // Space left for the columns and the two rows, after padding and gaps.
  function box() {
    return {
      w: layoutEl.clientWidth - 2 * PAD - 3 * GAP,
      h: layoutEl.clientHeight - 2 * PAD - GAP,
    };
  }

  function presetFor(id) {
    const b = box();
    const p = PRESETS[id] || PRESETS.editing;
    let left = p.left;
    let right = p.right;
    let mid = b.w - left - right;
    if (mid < 2 * MIN_COL) {
      // A narrow window: shrink the side columns in the same proportion.
      const k = b.w / (left + right + 2 * MIN_COL);
      left *= k;
      right *= k;
      mid = b.w - left - right;
    }
    const sum = p.mid[0] + p.mid[1];
    const px = [left, (mid * p.mid[0]) / sum, (mid * p.mid[1]) / sum, right];
    return { cols: px.map((v) => v / b.w), top: p.top };
  }

  // Makes the sizes for a workspace current, from the saved sizes or the preset.
  function activate(id) {
    if (!layoutEl) return;
    wsId = PRESETS[id] ? id : 'editing';
    current = saved[wsId] || presetFor(wsId);
    apply();
  }

  // Writes the current sizes to the grid and places the splitters on the gaps.
  function apply() {
    if (!layoutEl || !current) return;
    const b = box();
    if (b.w <= 0 || b.h <= 0) return;
    const px = current.cols.map((f) => f * b.w);
    const panels = current.top * b.h; // height of the row of panels
    const tl = b.h - panels; // height of the timeline row
    const row1 = timelineFirst ? tl : panels;
    layoutEl.style.gridTemplateColumns = px.map((v) => v.toFixed(1) + 'px').join(' ');
    layoutEl.style.gridTemplateRows = row1.toFixed(1) + 'px minmax(0, 1fr)';

    let x = PAD;
    for (let i = 0; i < 3; i++) {
      x += px[i];
      const centre = x + GAP / 2;
      const s = splits.v[i];
      s.style.left = centre - HIT / 2 + 'px';
      s.style.top = (timelineFirst ? PAD + tl + GAP : PAD) + 'px';
      s.style.height = panels + 'px';
      x += GAP;
    }
    const y = PAD + row1 + GAP / 2;
    splits.h.style.top = y - HIT / 2 + 'px';
    splits.h.style.left = PAD + 'px';
    splits.h.style.width = b.w + 3 * GAP + 'px';
  }

  // True when the timeline is the top row. Set by js/monitor-dock.js; the sizes stay the same.
  let timelineFirst = false;
  function setTimelineFirst(first) {
    timelineFirst = !!first;
    apply();
  }

  function startDrag(kind, idx, e) {
    e.preventDefault();
    const b = box();
    drag = {
      kind,
      idx,
      el: e.currentTarget,
      x0: e.clientX,
      y0: e.clientY,
      cols: current.cols.map((f) => f * b.w),
      top: current.top * b.h,
      b,
    };
    drag.el.classList.add('dragging');
    document.body.classList.add(kind === 'v' ? 'split-x' : 'split-y');
    drag.el.setPointerCapture(e.pointerId);
  }

  function moveDrag(e) {
    if (!drag) return;
    const { b } = drag;
    if (drag.kind === 'v') {
      const i = drag.idx;
      const a0 = drag.cols[i];
      const c0 = drag.cols[i + 1];
      const dx = Math.max(MIN_COL - a0, Math.min(c0 - MIN_COL, e.clientX - drag.x0));
      const cols = drag.cols.slice();
      cols[i] = a0 + dx;
      cols[i + 1] = c0 - dx;
      current = { cols: cols.map((v) => v / b.w), top: current.top };
    } else {
      // drag.top is the panel row's height when the drag started. With the timeline on top, dragging down shrinks the panels.
      const t0 = drag.top;
      const sign = timelineFirst ? -1 : 1;
      const dy = Math.max(MIN_TOP - t0, Math.min(b.h - MIN_TL - t0, sign * (e.clientY - drag.y0)));
      current = { cols: current.cols, top: (t0 + dy) / b.h };
    }
    apply();
  }

  function endDrag() {
    if (!drag) return;
    drag.el.classList.remove('dragging');
    document.body.classList.remove('split-x', 'split-y');
    drag = null;
    saved[wsId] = current;
    saveSaved();
  }

  function makeSplitter(kind, idx) {
    const s = document.createElement('div');
    s.className = 'split ' + kind;
    s.title = kind === 'v' ? 'Drag to resize the panels' : 'Drag to resize the timeline';
    s.addEventListener('pointerdown', (e) => startDrag(kind, idx, e));
    s.addEventListener('pointermove', moveDrag);
    s.addEventListener('pointerup', endDrag);
    s.addEventListener('pointercancel', endDrag);
    s.addEventListener('dblclick', () => {
      // Double-click a splitter to put the sizes of this workspace back to the preset.
      delete saved[wsId];
      saveSaved();
      activate(wsId);
    });
    layoutEl.appendChild(s);
    return s;
  }

  // Tab strips scroll by wheel and by dragging, so every tab stays reachable in a narrow panel.
  function initTabStrip(strip) {
    strip.addEventListener(
      'wheel',
      (e) => {
        if (strip.scrollWidth <= strip.clientWidth) return;
        e.preventDefault();
        strip.scrollLeft += e.deltaY || e.deltaX;
      },
      { passive: false }
    );
    strip.addEventListener('pointerdown', (e) => {
      // A left-drag on a tab moves the tab (js/docks.js). Drag empty strip space or use the middle button to scroll.
      if (e.target.closest('.panel-grip')) return;
      if (e.button === 0 && e.target.closest('.ptab')) return;
      if ((e.button !== 0 && e.button !== 1) || strip.scrollWidth <= strip.clientWidth) return;
      delete strip.dataset.dragged;
      const x0 = e.clientX;
      const s0 = strip.scrollLeft;
      let moved = false;
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - x0) > 4) moved = true;
        if (moved) strip.scrollLeft = s0 - (ev.clientX - x0);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) strip.dataset.dragged = '1';
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    // A drag that scrolled the strip should not also click the tab under the pointer.
    strip.addEventListener(
      'click',
      (e) => {
        if (strip.dataset.dragged) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );
  }

  function init() {
    layoutEl = document.getElementById('layout');
    if (!layoutEl) return;
    loadSaved();
    splits.v = [0, 1, 2].map((i) => makeSplitter('v', i));
    splits.h = makeSplitter('h', 0);
    document.querySelectorAll('.ptabs').forEach(initTabStrip);
    if ('ResizeObserver' in window) new ResizeObserver(() => apply()).observe(layoutEl);
    else window.addEventListener('resize', apply);
    activate('editing');
  }

  AVP.layout = { init, activate, apply, presetFor, PRESETS, setTimelineFirst };
})();
