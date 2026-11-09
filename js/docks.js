/*
 * AhPah Video Pro - dockable tabs.
 * Drag a tab along its strip to reorder it, or drop it on the other panel group to move it there.
 * The tab buttons and their panes are moved as they are, so every panel keeps working. The
 * arrangement is saved in the browser, so it comes back the same after a reload.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const KEY = 'ahpah-video-pro.docks.v1';
  const THRESHOLD = 6; // pixels a press must move before it becomes a drag

  // Each group is a panel with a tab strip. `panes` maps each tab name to its pane element.
  const GROUPS = {
    left: {
      panel: 'leftPanel',
      attr: 'ptab',
      tabs: ['project', 'effects', 'markers', 'graphics', 'captions'],
      panes: { project: 'paneProject', effects: 'paneEffects', markers: 'paneMarkers', graphics: 'paneGraphics', captions: 'paneCaptions' },
    },
    right: {
      panel: 'fxPanel',
      attr: 'rtab',
      tabs: ['controls', 'lumetri', 'sound', 'mixer', 'metadata'],
      panes: { controls: 'fxBody', lumetri: 'lumetriBody', sound: 'soundBody', mixer: 'mixerBody', metadata: 'infoBody' },
    },
  };
  const ALL_TABS = [].concat(GROUPS.left.tabs, GROUPS.right.tabs);
  const GROUP_OF = {};
  Object.keys(GROUPS).forEach((g) => GROUPS[g].tabs.forEach((t) => (GROUP_OF[t] = g)));

  // Group name -> ordered list of tab names. Starts as the default arrangement.
  let arrangement = null;
  let drag = null;
  let justDragged = false;

  const $ = (id) => document.getElementById(id);

  function defaultArrangement() {
    return { left: GROUPS.left.tabs.slice(), right: GROUPS.right.tabs.slice() };
  }

  // A saved arrangement may predate newer tabs. Keep its order, drop unknown tabs, and add any missing
  // tab at the end of its default group.
  function normalize(a) {
    if (!a || !Array.isArray(a.left) || !Array.isArray(a.right)) return defaultArrangement();
    const out = { left: [], right: [] };
    const seen = new Set();
    ['left', 'right'].forEach((g) =>
      a[g].forEach((t) => {
        if (GROUP_OF[t] === g && !seen.has(t)) {
          seen.add(t);
          out[g].push(t);
        }
      })
    );
    ALL_TABS.forEach((t) => {
      if (!seen.has(t)) {
        seen.add(t);
        out[GROUP_OF[t]].push(t);
      }
    });
    return out;
  }

  function load() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY));
      arrangement = normalize(a);
    } catch (e) {
      arrangement = defaultArrangement();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(arrangement));
    } catch (e) {
      /* storage unavailable: the layout still works for this session */
    }
  }

  function tabButton(name) {
    const g = GROUP_OF[name];
    return document.querySelector(`[data-${GROUPS[g].attr}="${name}"]`);
  }

  function nameOf(btn) {
    return btn.dataset.ptab || btn.dataset.rtab || null;
  }

  // Puts every tab button and pane into the group it belongs to, in order.
  function apply() {
    Object.keys(GROUPS).forEach((g) => {
      const G = GROUPS[g];
      const panel = $(G.panel);
      const strip = panel && panel.querySelector(':scope > .ptabs');
      if (!panel || !strip) return;
      arrangement[g].forEach((name) => {
        const btn = tabButton(name);
        if (btn) strip.appendChild(btn);
      });
      arrangement[g].forEach((name) => {
        const pane = $(G.panes[name]);
        if (pane) panel.appendChild(pane);
      });
    });
    ensureActive();
  }

  // A group whose active tab was moved away shows its first tab instead.
  function ensureActive() {
    Object.keys(GROUPS).forEach((g) => {
      if (!arrangement[g].length) return;
      const hasActive = arrangement[g].some((name) => {
        const btn = tabButton(name);
        return btn && btn.classList.contains('active');
      });
      if (!hasActive && AVP.panels) AVP.panels.setPanel(arrangement[g][0]);
    });
  }

  // Moves a tab to a group at a position (0 = first). The tab is removed from its old place first.
  function moveTab(name, toGroup, index) {
    Object.keys(GROUPS).forEach((g) => (arrangement[g] = arrangement[g].filter((t) => t !== name)));
    const list = arrangement[toGroup];
    const at = Math.max(0, Math.min(list.length, index));
    list.splice(at, 0, name);
    save();
    apply();
  }

  function reset() {
    arrangement = defaultArrangement();
    save();
    apply();
    if (AVP.toast) AVP.toast('Panel layout reset');
  }

  /* ---------- dragging ---------- */

  function startDrag() {
    drag.active = true;
    drag.btn.classList.add('dragging');
    document.body.classList.add('dock-drag');
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'dock-ghost';
    drag.ghost.textContent = drag.btn.textContent.trim();
    document.body.appendChild(drag.ghost);
    drag.mark = document.createElement('div');
    drag.mark.className = 'dock-mark hidden';
    document.body.appendChild(drag.mark);
  }

  // Works out where the tab would land: on a strip (between tabs) or on a panel body (end of its tabs).
  function targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    for (const g of Object.keys(GROUPS)) {
      const panel = $(GROUPS[g].panel);
      if (!panel || !panel.contains(el)) continue;
      const strip = panel.querySelector(':scope > .ptabs');
      const tabs = Array.from(strip.children).filter((b) => b.classList.contains('ptab') && b !== drag.btn);
      const sr = strip.getBoundingClientRect();
      if (y >= sr.top - 6 && y <= sr.bottom + 6) {
        let index = tabs.length;
        for (let i = 0; i < tabs.length; i++) {
          const r = tabs[i].getBoundingClientRect();
          if (x < r.left + r.width / 2) {
            index = i;
            break;
          }
        }
        return { group: g, index, panel, strip, tabs, onStrip: true };
      }
      return { group: g, index: tabs.length, panel, strip, tabs, onStrip: false };
    }
    return null;
  }

  function showTarget(t) {
    document.querySelectorAll('.panel.dock-target').forEach((p) => p.classList.remove('dock-target'));
    if (!t) return drag.mark.classList.add('hidden');
    if (!t.onStrip) {
      t.panel.classList.add('dock-target');
      drag.mark.classList.add('hidden');
      return;
    }
    const sr = t.strip.getBoundingClientRect();
    let x;
    if (t.tabs.length === 0) x = sr.left + 4;
    else if (t.index < t.tabs.length) x = t.tabs[t.index].getBoundingClientRect().left;
    else x = t.tabs[t.tabs.length - 1].getBoundingClientRect().right;
    drag.mark.style.left = x - 1 + 'px';
    drag.mark.style.top = sr.top + 3 + 'px';
    drag.mark.style.height = sr.height - 6 + 'px';
    drag.mark.classList.remove('hidden');
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const btn = e.target.closest && e.target.closest('.ptab');
    if (!btn || !btn.parentElement || !btn.parentElement.classList.contains('ptabs')) return;
    const name = nameOf(btn);
    if (!name) return;
    drag = { name, btn, startX: e.clientX, startY: e.clientY, active: false, target: null };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cancel);
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
    window.removeEventListener('pointercancel', cancel);
    if (!drag) return;
    if (drag.active) {
      drag.btn.classList.remove('dragging');
      drag.ghost.remove();
      drag.mark.remove();
      document.body.classList.remove('dock-drag');
      document.querySelectorAll('.panel.dock-target').forEach((p) => p.classList.remove('dock-target'));
    }
    drag = null;
  }

  function cancel() {
    finish();
  }

  function onUp() {
    if (!drag) return;
    const d = drag;
    const wasActive = d.active;
    const t = d.target;
    finish();
    if (!wasActive) return; // a plain click: the tab's own click handler switches to it
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    if (t) moveTab(d.name, t.group, t.index);
  }

  // A drop must not also count as a click on the tab.
  function blockClick(e) {
    if (justDragged) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  function init() {
    load();
    apply();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('click', blockClick, true);
  }

  AVP.docks = { init, reset, moveTab, get arrangement() { return arrangement; } };
})();
