/*
 * AhPah Video Pro - moving the panels.
 * Every panel can be moved by its handle: the Source and Program monitors by their header, the Project
 * and Effect Controls groups by the grip on their tab strip, and the timeline by the grip on its header.
 * In the top row, a panel dropped on the outer third of another panel goes in beside it; in the middle,
 * the two swap places. The timeline docks along the top or the bottom of the window. The arrangement is
 * saved in the browser. Tabs in the groups are still moved by dragging the tabs themselves.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const KEY = 'ahpah-video-pro.panelorder.v2';
  const TOP = ['leftPanel', 'srcPanel', 'programPanel', 'fxPanel'];
  const NAMES = { leftPanel: 'Project panel', srcPanel: 'Source', programPanel: 'Program', fxPanel: 'Effect Controls', timeline: 'Timeline' };
  const EDGE = 0.25; // a drop in the outer quarter of a panel places it beside that panel
  const THRESHOLD = 6;

  let order = TOP.slice();
  let timelineTop = false;
  let drag = null;

  const $ = (id) => document.getElementById(id);

  function load() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY));
      if (a && Array.isArray(a.order) && a.order.length === TOP.length && TOP.every((id) => a.order.indexOf(id) >= 0)) {
        order = a.order;
        timelineTop = !!a.timelineTop;
      }
    } catch (e) {
      order = TOP.slice();
      timelineTop = false;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ order, timelineTop }));
    } catch (e) {
      /* storage unavailable: the arrangement still holds for this session */
    }
  }

  // Puts the panels in the saved order and the timeline on the chosen edge, then refits the splitters.
  function apply() {
    const layout = $('layout');
    const timeline = $('timeline');
    if (!layout || !timeline) return;
    if (AVP.layout) AVP.layout.setTimelineFirst(timelineTop);
    order.forEach((id) => {
      const p = $(id);
      if (p) layout.appendChild(p);
    });
    if (timelineTop) layout.insertBefore(timeline, layout.firstChild);
    else layout.appendChild(timeline);
    if (AVP.layout) AVP.layout.apply();
  }

  function reset() {
    order = TOP.slice();
    timelineTop = false;
    save();
    apply();
    AVP.toast('Panel positions reset');
  }

  // Where a dragged panel would land: before / after another panel in the top row, or swapped with it.
  function targetAt(x, y) {
    if (drag.id === 'timeline') {
      const L = $('layout').getBoundingClientRect();
      return { id: 'timeline', zone: y < L.top + L.height / 2 ? 'top' : 'bottom', rect: L };
    }
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
    if (t.id === 'timeline') {
      // A bar along the top or bottom edge of the window where the timeline will go.
      mark.className = 'dock-mark dock-mark-h';
      mark.style.left = t.rect.left + 4 + 'px';
      mark.style.width = t.rect.width - 8 + 'px';
      mark.style.top = (t.zone === 'top' ? t.rect.top - 1 : t.rect.bottom - 2) + 'px';
      mark.style.height = '3px';
      return mark.classList.remove('hidden');
    }
    mark.className = 'dock-mark';
    if (t.zone === 'swap') {
      $(t.id).classList.add('mdock-target');
      return mark.classList.add('hidden');
    }
    const x = t.zone === 'before' ? t.rect.left : t.rect.right;
    mark.style.left = x - 1 + 'px';
    mark.style.top = t.rect.top + 4 + 'px';
    mark.style.height = t.rect.height - 8 + 'px';
    mark.style.width = '';
    mark.classList.remove('hidden');
  }

  function startDrag() {
    drag.active = true;
    drag.panel.classList.add('mdock-dragging');
    document.body.classList.add('mdock-drag');
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'dock-ghost';
    drag.ghost.textContent = NAMES[drag.id] || 'Panel';
    document.body.appendChild(drag.ghost);
    drag.mark = document.createElement('div');
    drag.mark.className = 'dock-mark hidden';
    document.body.appendChild(drag.mark);
  }

  // The handle for a panel: the monitor header, a group's grip, or the timeline's grip.
  function onDown(e) {
    if (e.button !== 0) return;
    const handle = e.target.closest && e.target.closest('.panel-head, .panel-grip');
    if (!handle || e.target.closest('button, select, input, textarea, a, label')) return;
    const panel = handle.closest('.panel');
    if (!panel || (TOP.indexOf(panel.id) < 0 && panel.id !== 'timeline')) return;
    drag = { id: panel.id, panel, startX: e.clientX, startY: e.clientY, active: false, target: null };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', finish);
  }

  function onMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < THRESHOLD) return;
      startDrag();
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
    if (d.id === 'timeline') {
      timelineTop = t.zone === 'top';
      save();
      apply();
      AVP.toast(`Timeline moved to the ${t.zone}`);
      return;
    }
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
