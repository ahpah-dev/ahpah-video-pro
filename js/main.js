/*
 * AhPah Video Pro - app bootstrap: menus, keyboard shortcuts, Effect Controls,
 * project save/open and modal dialogs.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const $ = (sel) => document.querySelector(sel);

  /* ---------- icons (inline SVG, no external assets) ---------- */

  const ICONS = {
    play: '<svg viewBox="0 0 16 16"><path d="M4.5 2.5v11l9-5.5z" fill="currentColor"/></svg>',
    pause:
      '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3" height="11" rx="0.6" fill="currentColor"/>' +
      '<rect x="9.5" y="2.5" width="3" height="11" rx="0.6" fill="currentColor"/></svg>',
    stepBack:
      '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="1.8" height="10" fill="currentColor"/>' +
      '<path d="M13.5 3v10L6.5 8z" fill="currentColor"/></svg>',
    stepFwd:
      '<svg viewBox="0 0 16 16"><rect x="11.7" y="3" width="1.8" height="10" fill="currentColor"/>' +
      '<path d="M2.5 3v10L9.5 8z" fill="currentColor"/></svg>',
    toStart:
      '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="1.8" height="10" fill="currentColor"/>' +
      '<path d="M13.5 3v10L5.5 8z" fill="currentColor"/></svg>',
    toEnd:
      '<svg viewBox="0 0 16 16"><rect x="11.7" y="3" width="1.8" height="10" fill="currentColor"/>' +
      '<path d="M2.5 3v10L10.5 8z" fill="currentColor"/></svg>',
    rev:
      '<svg viewBox="0 0 16 16"><path d="M8 3v10L1.5 8z" fill="currentColor"/>' +
      '<path d="M14.5 3v10L8 8z" fill="currentColor"/></svg>',
    ff:
      '<svg viewBox="0 0 16 16"><path d="M1.5 3v10L8 8z" fill="currentColor"/>' +
      '<path d="M8 3v10L14.5 8z" fill="currentColor"/></svg>',
    eye:
      '<svg viewBox="0 0 16 16"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" ' +
      'fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>',
    speaker:
      '<svg viewBox="0 0 16 16"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor"/>' +
      '<path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.6 3.6a6.2 6.2 0 0 1 0 8.8" fill="none" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  };

  AVP.icons = {
    get: (name) => ICONS[name] || '',
    apply: (btn) => {
      if (btn && btn.dataset.icon) btn.innerHTML = ICONS[btn.dataset.icon] || '';
    },
  };

  /* ---------- refresh helpers ---------- */

  function refreshPanels() {
    renderProps();
    AVP.monitor.sync();
  }

  function refresh() {
    refreshPanels();
    AVP.timeline.render();
    AVP.monitor.draw();
  }

  AVP.refreshPanels = refreshPanels;
  AVP.refresh = refresh;

  function updateTitle() {
    $('#projName').textContent = S.projectName;
    document.title = `${S.projectName} - AhPah Video Pro`;
    AVP.bin.renderBin();
  }

  /* ---------- Effect Controls panel ---------- */

  function currentClip() {
    return S.selection.map((id) => AVP.findClip(id)).find(Boolean) || null;
  }

  function sliderRow(prop, label, value, min, max, unit) {
    return (
      `<label class="fx-row"><span>${label}</span>` +
      `<input type="range" data-prop="${prop}" min="${min}" max="${max}" step="1" value="${value}">` +
      `<output>${value}${unit}</output></label>`
    );
  }

  function renderProps() {
    const body = $('#fxBody');
    if (!body) return;
    const c = currentClip();
    if (!c) {
      body.innerHTML = '<div class="hint">Select a clip on the timeline to adjust its effects.</div>';
      return;
    }
    const m = AVP.findMedia(c.mediaId);
    const isAudio = S.tracks[c.track].kind === 'audio';
    const linked = !isAudio && AVP.partners(c).length > 0;
    body.innerHTML =
      `<div class="fx-head"><div class="fx-name">${AVP.esc(m ? m.name : 'Missing media')}</div>` +
      `<div class="fx-sub">${c.track} · ${AVP.fmtTC(c.start)} to ${AVP.fmtTC(c.start + c.duration)}</div></div>` +
      (isAudio
        ? ''
        : `<div class="fx-group"><div class="fx-title">Motion</div>` +
          sliderRow('opacity', 'Opacity', Math.round(c.opacity * 100), 0, 100, '%') +
          sliderRow('scale', 'Scale', Math.round(c.scale * 100), 10, 300, '%') +
          `</div>`) +
      `<div class="fx-group"><div class="fx-title">Audio</div>` +
      (linked
        ? '<div class="fx-note">Sound comes from the linked audio clip on A1.</div>'
        : sliderRow('volume', 'Volume', Math.round(c.volume * 100), 0, 200, '%')) +
      `</div>` +
      `<div class="fx-group"><div class="fx-title">Timing</div>` +
      `<div class="fx-kv"><span>Source in</span><b>${AVP.fmtTC(c.inPoint)}</b></div>` +
      `<div class="fx-kv"><span>Duration</span><b>${AVP.fmtTC(c.duration)}</b></div></div>` +
      `<div class="fx-group"><button class="btn" id="fxReset">Reset effects</button></div>`;

    body.querySelectorAll('input[type=range]').forEach((inp) => {
      inp.addEventListener('pointerdown', () => AVP.pushUndo());
      inp.addEventListener('input', () => {
        const cur = currentClip();
        if (!cur) return;
        const v = +inp.value;
        const prop = inp.dataset.prop;
        if (prop === 'opacity') cur.opacity = v / 100;
        else if (prop === 'scale') cur.scale = v / 100;
        else cur.volume = v / 100;
        inp.nextElementSibling.textContent = v + '%';
        AVP.timeline.render();
        AVP.monitor.sync();
      });
    });
    const reset = $('#fxReset');
    if (reset) {
      reset.addEventListener('click', () => {
        const cur = currentClip();
        if (!cur) return;
        AVP.pushUndo();
        cur.opacity = 1;
        cur.scale = 1;
        cur.volume = 1;
        refresh();
      });
    }
  }

  /* ---------- project save / open ---------- */

  function newProject() {
    if ((S.clips.length || S.media.length) && !confirm('Start a new project? Unsaved changes will be lost.')) return;
    S.media.forEach((m) => m.url && URL.revokeObjectURL(m.url));
    S.projectName = 'Untitled Project';
    S.media = [];
    S.clips = [];
    S.tracks = AVP.defaultTracks();
    S.selection = [];
    S.playhead = 0;
    S.binSelected = null;
    S.srcMediaId = null;
    S.srcIn = null;
    S.srcOut = null;
    S.target = { video: 'V1', audio: 'A1' };
    AVP.monitor.stop();
    AVP.resetHistory();
    const sv = $('#srcVideo');
    sv.pause();
    sv.removeAttribute('src');
    sv.load();
    $('#srcImage').removeAttribute('src');
    $('#srcName').textContent = '(no clip)';
    $('#srcPlaceholder').classList.remove('hidden');
    updateTitle();
    refresh();
    AVP.bin.updateSourceUI();
  }

  function saveProject() {
    const name = prompt('Project name', S.projectName);
    if (name === null) return;
    S.projectName = name.trim() || 'Untitled Project';
    const data = {
      app: AVP.APP_NAME,
      format: 'ahpvp',
      version: 1,
      name: S.projectName,
      fps: S.fps,
      width: S.seqWidth,
      height: S.seqHeight,
      tracks: S.tracks,
      clips: S.clips,
      media: S.media.map((m) => ({ id: m.id, name: m.name, type: m.type, duration: m.duration, width: m.width, height: m.height })),
    };
    AVP.download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), AVP.safeName(S.projectName) + '.ahpvp');
    updateTitle();
    AVP.toast('Project saved. Media files are not stored in the project: keep them on disk.');
  }

  async function openProject(file) {
    let data = null;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      data = null;
    }
    if (!data || data.format !== 'ahpvp' || !Array.isArray(data.clips)) {
      return AVP.toast('That file is not an AhPah Video Pro project');
    }
    const old = S.media;
    S.projectName = data.name || 'Untitled Project';
    S.fps = data.fps || 30;
    S.seqWidth = data.width || 1920;
    S.seqHeight = data.height || 1080;
    const cv = $('#prog');
    cv.width = S.seqWidth;
    cv.height = S.seqHeight;
    S.media = (data.media || []).map((dm) => {
      const existing = old.find((x) => x.url && x.name === dm.name && x.type === dm.type);
      if (existing) return Object.assign({}, existing, { id: dm.id });
      return Object.assign({}, dm, { url: null, offline: true, thumb: null, error: false });
    });
    S.tracks = Object.assign(AVP.defaultTracks(), data.tracks || {});
    S.clips = data.clips;
    S.selection = [];
    S.playhead = 0;
    AVP.monitor.stop();
    AVP.resetHistory();
    updateTitle();
    refresh();
    const missing = S.media.filter((m) => m.offline).length;
    AVP.toast(
      missing
        ? `${missing} media file${missing > 1 ? 's are' : ' is'} offline. Import them again with the same file name.`
        : 'Project opened'
    );
  }

  /* ---------- actions (shared by menus and shortcuts) ---------- */

  function toggleSnap() {
    S.snap = !S.snap;
    AVP.timeline.updateToolbar();
    AVP.toast(`Snapping ${S.snap ? 'on' : 'off'}`);
  }

  function showModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modal').classList.remove('hidden');
  }

  function closeModal() {
    $('#modal').classList.add('hidden');
  }

  function shortcutsHtml() {
    const rows = [
      ['Space', 'Play / pause'],
      ['J / K / L', 'Reverse / stop / forward'],
      ['Left / Right', 'Previous / next frame (Shift: 1 second)'],
      ['Up / Down', 'Previous / next edit point'],
      ['Home / End', 'Go to start / end'],
      ['I / O', 'Mark In / Out in the Source monitor'],
      [', (comma)', 'Insert Source range at playhead'],
      ['. (period)', 'Overwrite Source range at playhead'],
      ['V / C / H', 'Selection / Razor / Hand tool'],
      ['S', 'Toggle snapping'],
      ['Ctrl+K', 'Split selected clips (or all tracks) at playhead'],
      ['Delete', 'Delete selected clips (Shift: ripple delete)'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Ctrl+A / Ctrl+Shift+A', 'Select all / deselect all clips'],
      ['= / -  and  \\', 'Zoom timeline in / out / to fit'],
      ['Ctrl+I / Ctrl+O / Ctrl+S', 'Import / open project / save project'],
      ['Ctrl+M', 'Export video (WebM)'],
      ['Esc', 'Stop an export or close a menu'],
    ];
    return (
      '<table class="kb">' +
      rows.map((r) => `<tr><td><kbd>${AVP.esc(r[0])}</kbd></td><td>${AVP.esc(r[1])}</td></tr>`).join('') +
      '</table><p class="muted">Tip: drag clips from the Project panel onto a track. Hold Shift while dropping to insert.</p>'
    );
  }

  const ACTIONS = {
    newProject: () => newProject(),
    import: () => $('#fileInput').click(),
    open: () => $('#openInput').click(),
    save: () => saveProject(),
    export: () => AVP.monitor.startExport(),
    undo: () => AVP.undo(),
    redo: () => AVP.redo(),
    deleteSelection: () => AVP.edit.deleteSelection(false),
    rippleDelete: () => AVP.edit.deleteSelection(true),
    selectAll: () => {
      AVP.select(S.clips.map((c) => c.id), false);
      refresh();
    },
    deselectAll: () => {
      AVP.select([], false);
      refresh();
    },
    splitAtPlayhead: () => AVP.edit.splitAtPlayhead(),
    insert: () => AVP.bin.placeFromSource(true),
    overwrite: () => AVP.bin.placeFromSource(false),
    markIn: () => AVP.bin.markIn(),
    markOut: () => AVP.bin.markOut(),
    toggleSnap: () => toggleSnap(),
    playPause: () => AVP.monitor.playPause(),
    goStart: () => AVP.monitor.goTo(0),
    goEnd: () => AVP.monitor.goTo(AVP.seqEnd()),
    zoomIn: () => AVP.timeline.zoomBy(1.25),
    zoomOut: () => AVP.timeline.zoomBy(0.8),
    fit: () => AVP.timeline.fit(),
    shortcuts: () => showModal('Keyboard shortcuts', shortcutsHtml()),
    about: () =>
      showModal(
        'About AhPah Video Pro',
        `<div class="about"><img src="assets/logo.svg" alt=""><div><h3>AhPah Video Pro ${AVP.VERSION}</h3>` +
          '<p>A free, open-source, public-domain video editor with a Premiere-style layout.</p>' +
          '<p class="muted">Released under the Unlicense. Not affiliated with Adobe.</p></div></div>'
      ),
  };

  const MENUS = [
    {
      label: 'File',
      items: [
        { label: 'New Project', key: 'Ctrl+N', action: 'newProject' },
        { label: 'Import Media…', key: 'Ctrl+I', action: 'import' },
        { sep: true },
        { label: 'Open Project…', key: 'Ctrl+O', action: 'open' },
        { label: 'Save Project…', key: 'Ctrl+S', action: 'save' },
        { sep: true },
        { label: 'Export Video (WebM)…', key: 'Ctrl+M', action: 'export' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', key: 'Ctrl+Z', action: 'undo' },
        { label: 'Redo', key: 'Ctrl+Shift+Z', action: 'redo' },
        { sep: true },
        { label: 'Delete', key: 'Delete', action: 'deleteSelection' },
        { label: 'Ripple Delete', key: 'Shift+Delete', action: 'rippleDelete' },
        { sep: true },
        { label: 'Select All', key: 'Ctrl+A', action: 'selectAll' },
        { label: 'Deselect All', key: 'Ctrl+Shift+A', action: 'deselectAll' },
      ],
    },
    {
      label: 'Clip',
      items: [
        { label: 'Split at Playhead', key: 'Ctrl+K', action: 'splitAtPlayhead' },
        { label: 'Insert Source at Playhead', key: ',', action: 'insert' },
        { label: 'Overwrite Source at Playhead', key: '.', action: 'overwrite' },
        { sep: true },
        { label: 'Mark Source In', key: 'I', action: 'markIn' },
        { label: 'Mark Source Out', key: 'O', action: 'markOut' },
        { sep: true },
        { label: 'Toggle Snapping', key: 'S', action: 'toggleSnap' },
      ],
    },
    {
      label: 'Sequence',
      items: [
        { label: 'Play / Pause', key: 'Space', action: 'playPause' },
        { label: 'Go to Start', key: 'Home', action: 'goStart' },
        { label: 'Go to End', key: 'End', action: 'goEnd' },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', key: '=', action: 'zoomIn' },
        { label: 'Zoom Out', key: '-', action: 'zoomOut' },
        { label: 'Fit Timeline to Window', key: '\\', action: 'fit' },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts', key: '?', action: 'shortcuts' },
        { label: 'About AhPah Video Pro', key: '', action: 'about' },
      ],
    },
  ];

  let openMenuIdx = -1;

  function closeMenus() {
    document.querySelectorAll('.menu-dd').forEach((d) => d.remove());
    document.querySelectorAll('.menu-title.open').forEach((b) => b.classList.remove('open'));
    openMenuIdx = -1;
  }

  function openMenu(idx, btn) {
    closeMenus();
    const menu = MENUS[idx];
    const dd = document.createElement('div');
    dd.className = 'menu-dd';
    dd.innerHTML = menu.items
      .map((it) =>
        it.sep
          ? '<div class="sep"></div>'
          : `<div class="mi" data-action="${it.action}"><span>${AVP.esc(it.label)}</span><span class="kbd">${AVP.esc(it.key)}</span></div>`
      )
      .join('');
    const r = btn.getBoundingClientRect();
    dd.style.left = r.left + 'px';
    dd.style.top = r.bottom + 'px';
    document.body.appendChild(dd);
    dd.addEventListener('click', (e) => {
      const mi = e.target.closest('.mi');
      if (!mi) return;
      closeMenus();
      const fn = ACTIONS[mi.dataset.action];
      if (fn) fn();
    });
    btn.classList.add('open');
    openMenuIdx = idx;
  }

  function buildMenus() {
    const bar = $('#menubar');
    bar.innerHTML = MENUS.map((m, i) => `<button class="menu-title" data-menu="${i}">${m.label}</button>`).join('');
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('.menu-title');
      if (!b) return;
      if (openMenuIdx === +b.dataset.menu) closeMenus();
      else openMenu(+b.dataset.menu, b);
    });
    bar.addEventListener('mouseover', (e) => {
      if (openMenuIdx < 0) return;
      const b = e.target.closest('.menu-title');
      if (b && +b.dataset.menu !== openMenuIdx) openMenu(+b.dataset.menu, b);
    });
  }

  /* ---------- keyboard ---------- */

  function onKey(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (k === 'Escape') {
      closeMenus();
      if (!$('#modal').classList.contains('hidden')) closeModal();
      if (AVP.monitor.isExporting()) AVP.monitor.finishExport();
      return;
    }

    if (mod) {
      const map = {
        z: e.shiftKey ? 'redo' : 'undo',
        y: 'redo',
        k: 'splitAtPlayhead',
        a: e.shiftKey ? 'deselectAll' : 'selectAll',
        s: 'save',
        o: 'open',
        i: 'import',
        m: 'export',
        n: 'newProject',
      };
      const name = map[k.toLowerCase()];
      if (name) {
        e.preventDefault();
        ACTIONS[name]();
      }
      return;
    }
    if (e.altKey) return;

    switch (k) {
      case ' ':
        e.preventDefault();
        AVP.monitor.playPause();
        return;
      case 'j':
      case 'J':
        AVP.monitor.play(-1);
        return;
      case 'k':
      case 'K':
        AVP.monitor.stop();
        return;
      case 'l':
      case 'L':
        AVP.monitor.play(1);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        AVP.monitor.stepFrames(e.shiftKey ? -S.fps : -1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        AVP.monitor.stepFrames(e.shiftKey ? S.fps : 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        AVP.monitor.jumpEdit(-1);
        return;
      case 'ArrowDown':
        e.preventDefault();
        AVP.monitor.jumpEdit(1);
        return;
      case 'Home':
        e.preventDefault();
        ACTIONS.goStart();
        return;
      case 'End':
        e.preventDefault();
        ACTIONS.goEnd();
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        AVP.edit.deleteSelection(e.shiftKey);
        return;
      case '?':
        ACTIONS.shortcuts();
        return;
      case 'i':
      case 'I':
        AVP.bin.markIn();
        return;
      case 'o':
      case 'O':
        AVP.bin.markOut();
        return;
      case ',':
        AVP.bin.placeFromSource(true);
        return;
      case '.':
        AVP.bin.placeFromSource(false);
        return;
      case 'v':
      case 'V':
        AVP.timeline.setTool('select');
        return;
      case 'c':
      case 'C':
        AVP.timeline.setTool('razor');
        return;
      case 'h':
      case 'H':
        AVP.timeline.setTool('hand');
        return;
      case 's':
      case 'S':
        toggleSnap();
        return;
      case '=':
      case '+':
        ACTIONS.zoomIn();
        return;
      case '-':
      case '_':
        ACTIONS.zoomOut();
        return;
      case '\\':
        ACTIONS.fit();
        return;
      default:
        return;
    }
  }

  /* ---------- startup ---------- */

  function init() {
    document.querySelectorAll('[data-icon]').forEach(AVP.icons.apply);
    buildMenus();

    AVP.bin.init();
    AVP.timeline.init();
    AVP.monitor.init();

    $('#btnExport').addEventListener('click', () => AVP.monitor.startExport());
    $('#pToStart').addEventListener('click', () => AVP.monitor.goTo(0));
    $('#pRev').addEventListener('click', () => AVP.monitor.play(-1));
    $('#pStepBack').addEventListener('click', () => AVP.monitor.stepFrames(-1));
    $('#pPlay').addEventListener('click', () => AVP.monitor.playPause());
    $('#pStepFwd').addEventListener('click', () => AVP.monitor.stepFrames(1));
    $('#pFwd').addEventListener('click', () => AVP.monitor.play(1));
    $('#pToEnd').addEventListener('click', () => AVP.monitor.goTo(AVP.seqEnd()));

    $('#openInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) openProject(f);
      e.target.value = '';
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.menu-dd, .menu-title')) closeMenus();
    });
    document.addEventListener('mouseup', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b) b.blur();
    });
    $('#modalClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });
    window.addEventListener('beforeunload', (e) => {
      if (S.clips.length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    updateTitle();
    refresh();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
