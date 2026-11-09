/*
 * AhPah Video Pro - popup menus: right-click context menus, drop-down menus from the
 * menu bar, and one level of nested submenus. Items:
 *   { label, key?, action?, disabled?, checked?, sep?, children? }
 */
(function () {
  'use strict';

  const AVP = window.AVP;

  let openMenus = [];

  function removeTree(el) {
    if (el._sub) {
      removeTree(el._sub);
      el._sub.remove();
      el._sub = null;
    }
  }

  function close() {
    openMenus.forEach((m) => m.remove());
    openMenus = [];
    document.querySelectorAll('.menu-title.open').forEach((b) => b.classList.remove('open'));
  }

  function place(el, x, y) {
    el.style.left = '0px';
    el.style.top = '0px';
    document.body.appendChild(el);
    const r = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 4);
    const top = Math.min(y, window.innerHeight - r.height - 4);
    el.style.left = Math.max(4, left) + 'px';
    el.style.top = Math.max(4, top) + 'px';
  }

  function build(items, parent) {
    const el = document.createElement('div');
    el.className = 'menu-dd';
    openMenus.push(el);
    items.forEach((it) => {
      if (it.sep) {
        el.insertAdjacentHTML('beforeend', '<div class="sep"></div>');
        return;
      }
      const row = document.createElement('div');
      row.className = 'mi' + (it.disabled ? ' disabled' : '') + (it.children ? ' has-sub' : '');
      row.innerHTML =
        `<span class="chk">${it.checked ? '✓' : ''}</span>` +
        `<span class="lbl">${AVP.esc(it.label)}</span>` +
        `<span class="kbd">${AVP.esc(it.key || '')}</span>` +
        (it.children ? '<span class="arrow">▸</span>' : '');
      if (it.children) {
        row.addEventListener('mouseenter', () => openSub(el, row, it.children));
      } else {
        row.addEventListener('mouseenter', () => removeTree(el));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (it.disabled) return;
          close();
          if (it.action) it.action();
        });
      }
      el.appendChild(row);
    });
    return el;
  }

  function openSub(parentEl, row, items) {
    removeTree(parentEl);
    const sub = build(items, parentEl);
    sub.classList.add('sub');
    const r = row.getBoundingClientRect();
    document.body.appendChild(sub);
    const sr = sub.getBoundingClientRect();
    let left = r.right - 2;
    if (left + sr.width > window.innerWidth) left = r.left - sr.width + 2;
    sub.style.left = Math.max(4, left) + 'px';
    sub.style.top = Math.min(r.top, window.innerHeight - sr.height - 4) + 'px';
    parentEl._sub = sub;
  }

  AVP.menu = {
    // Context menu at a screen position.
    show(x, y, items) {
      close();
      if (!items || !items.length) return;
      const el = build(items, null);
      place(el, x, y);
    },

    // Drop-down menu below an element (used by the menu bar).
    dropdown(anchor, items) {
      close();
      const el = build(items, null);
      const r = anchor.getBoundingClientRect();
      place(el, r.left, r.bottom);
      anchor.classList.add('open');
    },

    close,

    isOpen: () => openMenus.length > 0,

    init() {
      document.addEventListener('mousedown', (e) => {
        if (!e.target.closest || !e.target.closest('.menu-dd, .menu-title')) close();
      });
      window.addEventListener('blur', close);
      window.addEventListener('resize', close);
    },
  };
})();
