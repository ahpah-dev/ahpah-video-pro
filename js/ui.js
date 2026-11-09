/*
 * AhPah Video Pro - small UI helpers for the theme.
 * The custom sliders in css/theme.css fill the track up to the thumb. CSS cannot read an input's
 * value, so this sets a --fill custom property on every range input, as the value changes and
 * whenever panels are redrawn.
 */
(function () {
  'use strict';

  const AVP = window.AVP || (window.AVP = {});
  let queued = false;

  function paint(el) {
    const min = el.min === '' ? 0 : +el.min;
    const max = el.max === '' ? 100 : +el.max;
    const v = +el.value;
    const pct = max > min ? AVP.clamp((v - min) / (max - min), 0, 1) * 100 : 0;
    el.style.setProperty('--fill', pct.toFixed(2) + '%');
  }

  function paintAll() {
    queued = false;
    document.querySelectorAll('input[type=range]').forEach(paint);
  }

  // Coalesces repeated requests into one pass per frame.
  function paintRanges() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(paintAll);
    }
  }

  document.addEventListener(
    'input',
    (e) => {
      if (e.target && e.target.matches && e.target.matches('input[type=range]')) paint(e.target);
    },
    true
  );
  document.addEventListener('change', paintRanges, true);

  // Panels are redrawn with innerHTML, which replaces the sliders; repaint their fills after.
  const observer = new MutationObserver(paintRanges);
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    paintRanges();
  });

  AVP.ui = { paintRanges, paint };
})();
