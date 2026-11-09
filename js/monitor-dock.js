/*
 * AhPah Video Pro - moving the monitors.
 * Drag the Source or Program monitor by its header and drop it on another panel in the top row:
 * on the left or right third of a panel it goes in before or after it, and in the middle it swaps
 * places. The panel fills the cell it lands in, and its picture stays centred there. The order is
 * saved in the browser. The panel groups (left and right) keep moving their tabs as before.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const KEY = 'ahpah-video-pro.panelorder.v1';
  const TOP = ['leftPanel', 'srcPanel', 'programPanel', 'fxPanel'];
  const MOVABLE = ['srcPanel', 'programPanel'];
  const NAMES = { leftPanel: 'Project panel', srcPanel: 'Source', programPanel: 'Program', fxPanel: 'Effect Controls' };
  const EDGE = 0.25; // a drop in the outer quarter of a panel places the monitor beside it
  const THRESHOLD = 6;

  let order = TOP.slice();
  let drag = null;

  const $ = (id) => document.getElementById(id);

  function load() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(a) && a.length === TOP.length && TOP.every((id) => a.indexOf(id) >= 0)) order = a;
    } catch (e) {
      order = TOP.slice();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(order));
    } catch (e) {
      /* storage unavailable: the order still holds for this session */
    }
  }

  // Puts the top-row panels in the saved order, before the timeline, and refits the splitters.
  function apply() {
    const layout = $('layout');
    const timeline = $('timeline');
    if (!layout || !timeline) return;
    order.forEach((id) => {
      const p = $(id);
      if (p) layout.insertBefore(p, timeline);
    });
    if (AVP.layout) AVP.layout.apply();
  }

  function reset() {
    order = TOP.slice();
    save();
    apply();
    AVP.toast('Monitor positions reset');
  }

  // Where a dragged monitor would land: before / after a panel, or swapped with it.
  function targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const panel = TOP.map((id) => $(id)).find((p) => p && p.contains(el));
    if (!panel || panel.id === drag.id) return null;
    const r = panel.getBoundingClientRect();
    const f = (x - r.left) / Math.max(1, r.width);
    const zone = f < EDGE ? 'before' : f > 1 - EDGE ? 'after' : 'swap';
    return { id: panel.id, zone, rect: r };
  }

  function showTarget(t) {
    const mark = drag.mark;
    document.querySelectorAll('.mdock-target').forEach((p) => p.classList.remove('mdock-target'));
    if (!t) return mark.classList.add('hidden');
    if (t.zone === 'swap') {
      $(t.id).classList.add('mdock-target');
      return mark.classList.add('hidden');
    }
    const x = t.zone === 'before' ? t.rect.left : t.rect.right;
    mark.style.left = x - 1 + 'px';
    mark.style.top = t.rect.top + 4 + 'px';
    mark.style.height = t.rect.height - 8 + 'px';
    mark.classList.remove('hidden');
  }

  function startDrag(e) {
    drag.active = true;
    drag.panel.classList.add('mdock-dragging');
    document.body.classList.add('mdock-drag');
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'dock-ghost';
    drag.ghost.textContent = NAMES[drag.id] || 'Monitor';
    document.body.appendChild(drag.ghost);
    drag.mark = document.createElement('div');
    drag.mark.className = 'dock-mark hidden';
    document.body.appendChild(drag.mark);
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const head = e.target.closest && e.target.closest('.panel-head');
    if (!head || e.target.closest('button, select, input, textarea, a, label')) return;
    const panel = head.parentElement;
    if (!panel || MOVABLE.indexOf(panel.id) < 0) return;
    drag = { id: panel.id, panel, startX: e.clientX, startY: e.clientY, active: false, target: null };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', finish);
  }

  function onMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < THRESHOLD) return;
      startDrag(e);
    }
    drag.ghost.style.left = e.clientX + 12 + 'px';
    drag.ghost.style.top = e.clientY + 10 + 'px';
    drag.target = targetAt(e.clientX, e.clientY);
    showTarget(drag.target);
  }

  function finish() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', finish);
    if (drag && drag.active) {
      drag.panel.classList.remove('mdock-dragging');
      drag.ghost.remove();
      drag.mark.remove();
      document.body.classList.remove('mdock-drag');
      document.querySelectorAll('.mdock-target').forEach((p) => p.classList.remove('mdock-target'));
    }
    drag = null;
  }

  function onUp() {
    if (!drag) return;
    const d = drag;
    const active = d.active;
    const t = d.target;
    finish();
    if (!active || !t) return;
    const next = order.slice();
    if (t.zone === 'swap') {
      const a = next.indexOf(d.id);
      const b = next.indexOf(t.id);
      next[a] = t.id;
      next[b] = d.id;
    } else {
      const rest = next.filter((id) => id !== d.id);
      const at = rest.indexOf(t.id) + (t.zone === 'after' ? 1 : 0);
      rest.splice(at, 0, d.id);
      next.splice(0, next.length, ...rest);
    }
    order = next;
    save();
    apply();
    AVP.toast(`${NAMES[d.id]} moved`);
  }

  function init() {
    load();
    apply();
    document.addEventListener('pointerdown', onDown);
  }

  AVP.monitorDock = { init, reset, apply };
})();
