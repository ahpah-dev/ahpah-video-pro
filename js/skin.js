/*
 * AhPah Video Pro - panel focus, as in Premiere Pro: the panel you last clicked in (or tabbed into) gets a
 * blue outline (css/premiere.css, .panel-focus). Purely visual.
 */
(function () {
  'use strict';

  function focusPanel(target) {
    const panel = target && target.closest ? target.closest('.panel') : null;
    if (!panel) return;
    document.querySelectorAll('.panel.panel-focus').forEach((p) => {
      if (p !== panel) p.classList.remove('panel-focus');
    });
    panel.classList.add('panel-focus');
  }

  document.addEventListener('pointerdown', (e) => focusPanel(e.target), true);
  document.addEventListener('focusin', (e) => focusPanel(e.target), true);
  document.addEventListener('DOMContentLoaded', () => {
    const tl = document.getElementById('timeline');
    if (tl) tl.classList.add('panel-focus');
  });
})();
