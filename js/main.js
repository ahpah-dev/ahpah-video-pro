/*
 * AhPah Video Pro - app bootstrap: action registry, menu bar, keyboard shortcuts,
 * sequence / export / speed dialogs, and wiring between the modules.
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
  };

  AVP.icons = {
    get: (name) => ICONS[name] || '',
    apply: (btn) => {
      if (btn && btn.dataset.icon) btn.innerHTML = ICONS[btn.dataset.icon] || '';
    },
  };

  /* ---------- refresh ---------- */

  function refreshPanels() {
    AVP.panels.renderControls();
    AVP.panels.renderSide();
    if (S.leftTab === 'captions') AVP.panels.renderCaptions();
    AVP.monitor.sync();
  }

  function refresh() {
    AVP.touchData();
    refreshPanels();
    AVP.timeline.render();
    AVP.monitor.draw();
    updateTitle();
    if (AVP.project) AVP.project.touch();
  }

  AVP.refreshPanels = refreshPanels;
  AVP.refresh = refresh;

  function updateTitle() {
    $('#projName').textContent = S.projectName + `  ·  ${S.seqWidth}×${S.seqHeight} · ${S.fps} fps`;
    document.title = `${S.projectName} - AhPah Video Pro`;
  }

  /* ---------- sequence, work area, snapping ---------- */

  function toggleSnap() {
    S.snap = !S.snap;
    AVP.timeline.updateToolbar();
    AVP.toast(`Snapping ${S.snap ? 'on' : 'off'}`);
  }

  // edge: 'in' | 'out' | 'clear'
  function setWork(edge, t) {
    AVP.pushUndo();
    const time = t != null ? AVP.snapFrame(t) : AVP.snapFrame(S.playhead);
    if (edge === 'clear') {
      S.workIn = null;
      S.workOut = null;
    } else if (edge === 'in') {
      S.workIn = time;
      if (S.workOut != null && S.workOut <= time) S.workOut = null;
    } else {
      S.workOut = time;
      if (S.workIn != null && S.workIn >= time) S.workIn = null;
    }
    AVP.refresh();
  }

  function sequenceDialog() {
    const presets = [
      { v: '1920x1080x30', label: 'HD 1080p · 30 fps' },
      { v: '1920x1080x25', label: 'HD 1080p · 25 fps' },
      { v: '1920x1080x24', label: 'Cinema 1080p · 24 fps' },
      { v: '1920x1080x60', label: 'HD 1080p · 60 fps' },
      { v: '1280x720x30', label: 'HD 720p · 30 fps' },
      { v: '3840x2160x30', label: 'UHD 4K · 30 fps' },
      { v: '1080x1920x30', label: 'Vertical 9:16 · 30 fps' },
      { v: '1080x1080x30', label: 'Square 1:1 · 30 fps' },
    ];
    const cur = `${S.seqWidth}x${S.seqHeight}x${S.fps}`;
    const preset = presets.some((p) => p.v === cur) ? cur : 'custom';
    AVP.dialog.form({
      title: 'Sequence settings',
      intro: 'Changing the frame size or rate affects the whole sequence. Clips keep their timing.',
      fields: [
        { k: 'preset', label: 'Preset', type: 'select', value: preset, options: presets.concat([{ v: 'custom', label: 'Custom' }]) },
        { k: 'width', label: 'Width (px)', type: 'number', value: S.seqWidth, min: 16, max: 7680, step: 1 },
        { k: 'height', label: 'Height (px)', type: 'number', value: S.seqHeight, min: 16, max: 4320, step: 1 },
        { k: 'fps', label: 'Frame rate', type: 'select', value: String(S.fps), options: [24, 25, 30, 50, 60].map((f) => ({ v: String(f), label: f + ' fps' })) },
      ],
      ok: 'Apply',
      onChange: (vals, set) => {
        const p = presets.find((x) => x.v === vals.preset);
        if (p) {
          const [w, h, f] = p.v.split('x');
          set('width', w);
          set('height', h);
          set('fps', f);
        }
      },
      onOk: (v) => {
        const w = Math.round(v.width) || S.seqWidth;
        const h = Math.round(v.height) || S.seqHeight;
        AVP.pushUndo();
        S.fps = parseInt(v.fps, 10) || S.fps;
        AVP.monitor.resize(w, h);
        AVP.refresh();
        AVP.toast(`Sequence set to ${w}×${h} at ${S.fps} fps`, 'ok');
      },
    });
  }

  function speedDialog(ids) {
    const list = (ids || S.selection).map(AVP.findClip).filter(Boolean);
    if (!list.length) return AVP.toast('Select a clip first', 'warn');
    AVP.dialog.form({
      title: 'Speed / Duration',
      intro: 'Changes how fast the clip plays. 200% plays twice as fast and halves the duration.',
      fields: [{ k: 'speed', label: 'Speed (%)', type: 'number', value: Math.round((list[0].speed || 1) * 100), min: 10, max: 1600, step: 5 }],
      ok: 'Apply',
      onOk: (v) => AVP.edit.setSpeed(list.map((c) => c.id), (v.speed || 100) / 100),
    });
  }

  function exportDialog() {
    const mp4 = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/mp4');
    const hasWork = S.workIn != null || S.workOut != null;
    AVP.dialog.form({
      title: 'Export video',
      intro: 'Export runs in real time: a 10-minute sequence takes about 10 minutes. Keep this tab visible.',
      fields: [
        {
          k: 'format',
          label: 'Format',
          type: 'select',
          value: 'webm',
          options: [{ v: 'webm', label: 'WebM (VP9 / VP8 with Opus)' }].concat(
            mp4 ? [{ v: 'mp4', label: 'MP4 (H.264 with AAC)' }] : [{ v: 'mp4', label: 'MP4 (not supported in this browser)' }]
          ),
        },
        {
          k: 'size',
          label: 'Frame size',
          type: 'select',
          value: `${S.seqWidth}x${S.seqHeight}`,
          options: [
            { v: `${S.seqWidth}x${S.seqHeight}`, label: `Sequence (${S.seqWidth}×${S.seqHeight})` },
            { v: '1920x1080', label: '1920×1080' },
            { v: '1280x720', label: '1280×720' },
            { v: '854x480', label: '854×480' },
          ],
        },
        {
          k: 'bitrate',
          label: 'Quality',
          type: 'select',
          value: '8',
          options: [
            { v: '4', label: 'Smaller file (4 Mbps)' },
            { v: '8', label: 'Balanced (8 Mbps)' },
            { v: '16', label: 'High (16 Mbps)' },
          ],
        },
        {
          k: 'range',
          label: 'Range',
          type: 'select',
          value: hasWork ? 'work' : 'sequence',
          options: [
            { v: 'sequence', label: 'Entire sequence' },
            { v: 'work', label: 'Work area (set with [ and ])' },
          ],
        },
      ],
      ok: 'Export',
      onOk: (v) => {
        const [w, h] = v.size.split('x').map(Number);
        AVP.monitor.startExport({ format: v.format, width: w, height: h, bitrate: +v.bitrate, range: v.range });
      },
    });
  }

  function newProject() {
    if ((S.clips.length || S.media.length) && !confirm('Start a new project? Unsaved changes will be lost.')) return;
    S.media.forEach((m) => m.url && URL.revokeObjectURL(m.url));
    const fresh = AVP.newTrackSet();
    AVP.monitor.stop();
    AVP.project.apply({
      format: 'ahpvp',
      name: 'Untitled Project',
      fps: 30,
      width: 1920,
      height: 1080,
      tracks: fresh.tracks,
      trackOrder: fresh.order,
      clips: [],
      markers: [],
      media: [],
    });
    S.media = [];
    S.binSelected = null;
    S.srcMediaId = null;
    S.srcIn = null;
    S.srcOut = null;
    S.target = { video: 'V1', audio: 'A1' };
    const sv = $('#srcVideo');
    sv.pause();
    sv.removeAttribute('src');
    sv.load();
    $('#srcImage').removeAttribute('src');
    $('#srcName').textContent = '(no clip)';
    $('#srcPlaceholder').classList.remove('hidden');
    AVP.resetHistory();
    refresh();
    AVP.bin.updateSourceUI();
  }

  function newTitle() {
    AVP.edit.placeTitle({ track: S.target.video, start: S.playhead, preset: 0, mode: 'overwrite' });
  }

  function defaultTransition() {
    const list = AVP.selectedClips();
    if (!list.length) return AVP.toast('Select a clip first', 'warn');
    list.forEach((c) => {
      const kind = S.tracks[c.track].kind;
      AVP.edit.applyTransition(c.id, kind === 'audio' ? 'audio-fade' : 'dissolve', 'start');
    });
  }

  function selectAll() {
    AVP.select(
      S.clips.map((c) => c.id),
      false
    );
    refresh();
  }

  function deselectAll() {
    AVP.select([], false);
    refresh();
  }

  function setPreview(scale) {
    AVP.monitor.setPreviewScale(scale);
    refreshPanels();
  }

  function previewItems() {
    return [
      { label: 'Full (best quality)', checked: S.previewScale === 1, action: () => setPreview(1) },
      { label: 'Half (recommended)', checked: S.previewScale === 0.5, action: () => setPreview(0.5) },
      { label: 'Quarter (fastest)', checked: S.previewScale === 0.25, action: () => setPreview(0.25) },
    ];
  }

  function toggleSafe() {
    S.showSafe = !S.showSafe;
    AVP.monitor.draw();
    AVP.toast(`Safe margins ${S.showSafe ? 'shown' : 'hidden'}`);
  }

  function shortcutsHtml() {
    const rows = [
      ['Space', 'Play / pause'],
      ['J / K / L', 'Reverse / stop / forward'],
      ['← / →', 'Previous / next frame (Shift: 1 second)'],
      ['↑ / ↓', 'Previous / next edit point or marker'],
      ['Home / End', 'Go to start / end'],
      ['I / O', 'Mark In / Out in the Source monitor'],
      [', (comma)', 'Insert Source range at playhead'],
      ['. (period)', 'Overwrite Source range at playhead'],
      ['V / C / H', 'Selection / Razor / Hand tool'],
      ['S', 'Toggle snapping'],
      ['M', 'Add marker at playhead'],
      ['[ / ]', 'Set work area In / Out at playhead'],
      ['Ctrl+K', 'Cut selected clips (or every track) at playhead'],
      ['Ctrl+C / V / D', 'Copy / paste at playhead / duplicate'],
      ['Ctrl+Shift+D', 'Apply default transition to selected clips'],
      ['Ctrl+R', 'Speed / duration of selected clips'],
      ['Ctrl+T', 'New title at playhead'],
      ['Delete / Shift+Delete', 'Delete / ripple delete'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Ctrl+A / Ctrl+Shift+A', 'Select all / deselect all'],
      ['= / - / \\', 'Zoom timeline in / out / to fit'],
      ['Ctrl+I / O / S / N', 'Import / open / save project / new project'],
      ['Ctrl+M', 'Export video'],
      ['Ctrl+Shift+E', 'Export frame at playhead as PNG'],
      ['Esc', 'Stop an export, close a menu or dialog'],
    ];
    return (
      '<table class="kb">' +
      rows.map((r) => `<tr><td><kbd>${AVP.esc(r[0])}</kbd></td><td>${AVP.esc(r[1])}</td></tr>`).join('') +
      '</table><p class="muted">Right-click the timeline, clips, tracks, markers, the Project panel and the monitors for more commands. Drag effects and transitions from the Effects tab.</p>'
    );
  }

  AVP.main = {
    toggleSnap,
    setWork,
    sequenceDialog,
    speedDialog,
    exportDialog,
    newProject,
    refresh,
  };

  /* ---------- menus ---------- */

  const ACTIONS = {
    newProject: () => newProject(),
    import: () => $('#fileInput').click(),
    open: () => $('#openInput').click(),
    save: () => AVP.project.save(),
    export: () => exportDialog(),
    exportFrame: () => AVP.monitor.exportFrame(),
    undo: () => AVP.undo(),
    redo: () => AVP.redo(),
    cut: () => AVP.edit.splitAtPlayhead(),
    copy: () => AVP.edit.copySelection(),
    paste: () => AVP.edit.paste(S.playhead, 'overwrite'),
    duplicate: () => AVP.edit.duplicate(),
    deleteSelection: () => AVP.edit.deleteSelection(false),
    rippleDelete: () => AVP.edit.deleteSelection(true),
    selectAll: () => selectAll(),
    deselectAll: () => deselectAll(),
    speed: () => speedDialog(),
    newTitle: () => newTitle(),
    defaultTransition: () => defaultTransition(),
    insert: () => AVP.bin.placeFromSource(true),
    overwrite: () => AVP.bin.placeFromSource(false),
    markIn: () => AVP.bin.markIn(),
    markOut: () => AVP.bin.markOut(),
    link: () => AVP.edit.link(S.selection.slice()),
    unlink: () => AVP.edit.unlink(S.selection.slice()),
    enable: () => AVP.edit.toggleEnabled(S.selection.slice()),
    addMarker: () => AVP.edit.addMarker(S.playhead),
    workIn: () => setWork('in'),
    workOut: () => setWork('out'),
    workClear: () => setWork('clear'),
    sequence: () => sequenceDialog(),
    playPause: () => AVP.monitor.playPause(),
    goStart: () => AVP.monitor.goTo(0),
    goEnd: () => AVP.monitor.goTo(AVP.seqEnd()),
    toggleSnap: () => toggleSnap(),
    zoomIn: () => AVP.timeline.zoomBy(1.25),
    zoomOut: () => AVP.timeline.zoomBy(0.8),
    fit: () => AVP.timeline.fit(),
    safe: () => toggleSafe(),
    addVideoTrack: () => AVP.edit.addTrack('video'),
    addAudioTrack: () => AVP.edit.addTrack('audio'),
    panelControls: () => AVP.panels.setPanel('controls'),
    panelEffects: () => AVP.panels.setPanel('effects'),
    panelProject: () => AVP.panels.setPanel('project'),
    panelMarkers: () => AVP.panels.setPanel('markers'),
    panelMetadata: () => AVP.panels.setPanel('metadata'),
    panelGraphics: () => AVP.panels.setPanel('graphics'),
    panelCaptions: () => AVP.panels.setPanel('captions'),
    newCaption: () => AVP.captions.newAtPlayhead(),
    importCaptions: () => AVP.captions.importPicker(),
    exportCaptions: () => AVP.captions.exportSRT(),
    newRectangle: () => AVP.edit.placeShape({ track: S.target.video, start: S.playhead, type: 'rect', mode: 'overwrite' }),
    newEllipse: () => AVP.edit.placeShape({ track: S.target.video, start: S.playhead, type: 'ellipse', mode: 'overwrite' }),
    panelLumetri: () => AVP.panels.setPanel('lumetri'),
    panelSound: () => AVP.panels.setPanel('sound'),
    panelMixer: () => AVP.panels.setPanel('mixer'),
    addLumetri: () => AVP.edit.addFx(S.selection.slice(), 'lumetri'),
    resetDocks: () => AVP.docks.reset(),
    resetMonitors: () => AVP.monitorDock.reset(),
    prevEdit: () => AVP.monitor.jumpEdit(-1),
    nextEdit: () => AVP.monitor.jumpEdit(1),
    prevMarker: () => AVP.timeline.gotoMarker(-1),
    nextMarker: () => AVP.timeline.gotoMarker(1),
    clearMarkers: () => {
      if (!S.markers.length) return AVP.toast('There are no markers');
      AVP.pushUndo();
      S.markers = [];
      AVP.refresh();
    },
    wsEditing: () => setWorkspace('editing'),
    wsAssembly: () => setWorkspace('assembly'),
    wsEffects: () => setWorkspace('effects'),
    wsColor: () => setWorkspace('color'),
    wsAudio: () => setWorkspace('audio'),
    shortcuts: () => AVP.dialog.info('Keyboard shortcuts', shortcutsHtml()),
    about: () =>
      AVP.dialog.info(
        'About AhPah Video Pro',
        `<div class="about"><img src="assets/logo.svg" alt=""><div><h3>AhPah Video Pro ${AVP.VERSION}</h3>` +
          '<p>A free, open-source, public-domain video editor with a Premiere-style layout, effects, transitions and titles.</p>' +
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
        { label: 'Export Video…', key: 'Ctrl+M', action: 'export' },
        { label: 'Export Frame as PNG…', key: 'Ctrl+Shift+E', action: 'exportFrame' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', key: 'Ctrl+Z', action: 'undo' },
        { label: 'Redo', key: 'Ctrl+Shift+Z', action: 'redo' },
        { sep: true },
        { label: 'Cut at Playhead', key: 'Ctrl+K', action: 'cut' },
        { label: 'Copy', key: 'Ctrl+C', action: 'copy' },
        { label: 'Paste at Playhead', key: 'Ctrl+V', action: 'paste' },
        { label: 'Duplicate', key: 'Ctrl+D', action: 'duplicate' },
        { sep: true },
        { label: 'Delete', key: 'Del', action: 'deleteSelection' },
        { label: 'Ripple Delete', key: 'Shift+Del', action: 'rippleDelete' },
        { sep: true },
        { label: 'Select All', key: 'Ctrl+A', action: 'selectAll' },
        { label: 'Deselect All', key: 'Ctrl+Shift+A', action: 'deselectAll' },
      ],
    },
    {
      label: 'Clip',
      items: [
        { label: 'Speed / Duration…', key: 'Ctrl+R', action: 'speed' },
        { label: 'Enable / Disable', action: 'enable' },
        { label: 'Add Lumetri Color', action: 'addLumetri' },
        { label: 'Link Selected', action: 'link' },
        { label: 'Unlink', action: 'unlink' },
        { sep: true },
        { label: 'Apply Default Transition', key: 'Ctrl+Shift+D', action: 'defaultTransition' },
        { label: 'New Title at Playhead', key: 'Ctrl+T', action: 'newTitle' },
        { sep: true },
        { label: 'Insert Source at Playhead', key: ',', action: 'insert' },
        { label: 'Overwrite Source at Playhead', key: '.', action: 'overwrite' },
        { label: 'Mark Source In', key: 'I', action: 'markIn' },
        { label: 'Mark Source Out', key: 'O', action: 'markOut' },
      ],
    },
    {
      label: 'Markers',
      items: [
        { label: 'Add Marker', key: 'M', action: 'addMarker' },
        { label: 'Previous Marker', action: 'prevMarker' },
        { label: 'Next Marker', action: 'nextMarker' },
        { label: 'Previous Edit', key: '↑', action: 'prevEdit' },
        { label: 'Next Edit', key: '↓', action: 'nextEdit' },
        { sep: true },
        { label: 'Clear All Markers', action: 'clearMarkers' },
      ],
    },
    {
      label: 'Graphics',
      items: [
        { label: 'New Title…', key: 'Ctrl+T', action: 'newTitle' },
        { label: 'Apply Default Transition', key: 'Ctrl+Shift+D', action: 'defaultTransition' },
        { sep: true },
        { label: 'New Rectangle', action: 'newRectangle' },
        { label: 'New Ellipse', action: 'newEllipse' },
        { label: 'Essential Graphics panel', action: 'panelGraphics' },
        { sep: true },
        { label: 'New Caption at Playhead', action: 'newCaption' },
        { label: 'Import Captions (SRT)…', action: 'importCaptions' },
        { label: 'Export Captions (SRT)…', action: 'exportCaptions' },
        { label: 'Captions panel', action: 'panelCaptions' },
      ],
    },
    {
      label: 'Sequence',
      items: [
        { label: 'Sequence Settings…', action: 'sequence' },
        { sep: true },
        { label: 'Play / Pause', key: 'Space', action: 'playPause' },
        { label: 'Go to Start', key: 'Home', action: 'goStart' },
        { label: 'Go to End', key: 'End', action: 'goEnd' },
        { sep: true },
        { label: 'Add Marker', key: 'M', action: 'addMarker' },
        { label: 'Set Work Area In', key: '[', action: 'workIn' },
        { label: 'Set Work Area Out', key: ']', action: 'workOut' },
        { label: 'Clear Work Area', action: 'workClear' },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', key: '=', action: 'zoomIn' },
        { label: 'Zoom Out', key: '-', action: 'zoomOut' },
        { label: 'Fit Timeline to Window', key: '\\', action: 'fit' },
        { label: 'Toggle Snapping', key: 'S', action: 'toggleSnap' },
        { label: 'Show Safe Margins', action: 'safe' },
        { label: 'Playback Resolution', submenu: 'preview' },
        { sep: true },
        { label: 'Add Video Track', action: 'addVideoTrack' },
        { label: 'Add Audio Track', action: 'addAudioTrack' },
      ],
    },
    {
      label: 'Window',
      items: [
        { label: 'Project', action: 'panelProject' },
        { label: 'Effects', action: 'panelEffects' },
        { label: 'Markers', action: 'panelMarkers' },
        { label: 'Effect Controls', action: 'panelControls' },
        { label: 'Lumetri Color', action: 'panelLumetri' },
        { label: 'Essential Sound', action: 'panelSound' },
        { label: 'Audio Clip Mixer', action: 'panelMixer' },
        { label: 'Metadata', action: 'panelMetadata' },
        { sep: true },
        { label: 'Reset Panel Layout', action: 'resetDocks' },
        { label: 'Reset Monitor Positions', action: 'resetMonitors' },
        { label: 'Editing workspace', action: 'wsEditing' },
        { label: 'Assembly workspace', action: 'wsAssembly' },
        { label: 'Effects workspace', action: 'wsEffects' },
        { label: 'Color workspace', action: 'wsColor' },
        { label: 'Audio workspace', action: 'wsAudio' },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts', key: '?', action: 'shortcuts' },
        { label: 'About AhPah Video Pro', action: 'about' },
      ],
    },
  ];

  function menuItems(list) {
    return list.map((it) => {
      if (it.sep) return { sep: true };
      if (it.submenu === 'preview') return { label: 'Playback Resolution', children: previewItems() };
      return { label: it.label, key: it.key, action: () => ACTIONS[it.action]() };
    });
  }

  function buildMenuBar() {
    const bar = $('#menubar');
    bar.innerHTML = MENUS.map((m, i) => `<button class="menu-title" data-menu="${i}">${m.label}</button>`).join('');
    let openIdx = -1;
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('.menu-title');
      if (!b) return;
      if (openIdx === +b.dataset.menu && AVP.menu.isOpen()) {
        AVP.menu.close();
        openIdx = -1;
      } else {
        openIdx = +b.dataset.menu;
        AVP.menu.dropdown(b, menuItems(MENUS[openIdx].items));
      }
    });
    bar.addEventListener('mouseover', (e) => {
      if (!AVP.menu.isOpen()) return;
      const b = e.target.closest('.menu-title');
      if (b && +b.dataset.menu !== openIdx) {
        openIdx = +b.dataset.menu;
        AVP.menu.dropdown(b, menuItems(MENUS[openIdx].items));
      }
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
      AVP.menu.close();
      if (AVP.dialog.isOpen()) AVP.dialog.close();
      if (AVP.monitor.isExporting()) AVP.monitor.finishExport();
      else if (!AVP.dialog.isOpen() && S.selection.length) deselectAll();
      return;
    }

    if (mod) {
      const lk = k.toLowerCase();
      let name = null;
      if (e.shiftKey && lk === 'z') name = 'redo';
      else if (e.shiftKey && lk === 'a') name = 'deselectAll';
      else if (e.shiftKey && lk === 'd') name = 'defaultTransition';
      else if (e.shiftKey && lk === 'e') name = 'exportFrame';
      else
        name = {
          z: 'undo',
          y: 'redo',
          k: 'cut',
          a: 'selectAll',
          c: 'copy',
          v: 'paste',
          d: 'duplicate',
          r: 'speed',
          t: 'newTitle',
          s: 'save',
          o: 'open',
          i: 'import',
          m: 'export',
          n: 'newProject',
        }[lk];
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
      case 'z':
      case 'Z':
        AVP.timeline.setTool('zoom');
        return;
      case 't':
      case 'T':
        AVP.timeline.setTool('type');
        return;
      case 's':
      case 'S':
        toggleSnap();
        return;
      case 'm':
      case 'M':
        ACTIONS.addMarker();
        return;
      case '[':
        setWork('in');
        return;
      case ']':
        setWork('out');
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

  /* ---------- context menus for the monitors and the app background ---------- */

  function programMenu() {
    return [
      { label: 'Play / Pause', key: 'Space', action: () => AVP.monitor.playPause() },
      { label: 'Go to Start', key: 'Home', action: () => AVP.monitor.goTo(0) },
      { label: 'Go to End', key: 'End', action: () => AVP.monitor.goTo(AVP.seqEnd()) },
      { sep: true },
      { label: 'Add Marker at Playhead', key: 'M', action: () => AVP.edit.addMarker(S.playhead) },
      { label: 'Set Work Area In / Out', children: [
        { label: 'Work In here', key: '[', action: () => setWork('in') },
        { label: 'Work Out here', key: ']', action: () => setWork('out') },
        { label: 'Clear Work Area', action: () => setWork('clear') },
      ] },
      { sep: true },
      { label: 'Export Frame as PNG…', key: 'Ctrl+Shift+E', action: () => AVP.monitor.exportFrame() },
      { label: 'Export Video…', key: 'Ctrl+M', action: () => exportDialog() },
      { label: 'Sequence Settings…', action: () => sequenceDialog() },
      { label: S.showSafe ? 'Hide Safe Margins' : 'Show Safe Margins', action: () => toggleSafe() },
      { label: 'Playback Resolution', children: previewItems() },
    ];
  }

  function fallbackMenu() {
    return [
      { label: 'Import Media…', key: 'Ctrl+I', action: () => $('#fileInput').click() },
      { label: 'Paste at Playhead', key: 'Ctrl+V', action: () => AVP.edit.paste(S.playhead, 'overwrite') },
      { label: 'Select All', key: 'Ctrl+A', action: selectAll },
      { sep: true },
      { label: 'Sequence Settings…', action: sequenceDialog },
      { label: 'Export Video…', key: 'Ctrl+M', action: exportDialog },
      { label: 'Keyboard Shortcuts', key: '?', action: ACTIONS.shortcuts },
    ];
  }

  function wireContextMenus() {
    $('#programPanel').addEventListener('contextmenu', (e) => {
      if (e.target.closest('.transport')) return;
      e.preventDefault();
      AVP.menu.show(e.clientX, e.clientY, programMenu());
    });
    $('#fxBody').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      AVP.menu.show(e.clientX, e.clientY, [
        { label: 'Open Effects library', action: () => AVP.panels.setPanel('effects') },
        { label: 'Show Effect Controls', action: () => AVP.panels.setPanel('controls') },
      ]);
    });
    document.addEventListener('contextmenu', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // keep native copy / paste in fields
      e.preventDefault();
      if (!AVP.menu.isOpen()) AVP.menu.show(e.clientX, e.clientY, fallbackMenu());
    });
  }

  /* ---------- startup ---------- */

  // Premiere-style workspaces. Each one arranges the same panels differently.
  const WORKSPACES = {
    learning: { name: 'Learning', available: false },
    assembly: { name: 'Assembly', layout: 'ws-assembly', panel: 'project' },
    editing: { name: 'Editing', layout: '', panel: 'project', right: 'controls' },
    color: { name: 'Color', layout: 'ws-color', panel: 'project', right: 'controls' },
    effects: { name: 'Effects', layout: 'ws-effects', panel: 'effects', right: 'controls' },
    audio: { name: 'Audio', layout: 'ws-audio', panel: 'project', right: 'controls' },
    graphics: { name: 'Graphics', layout: '', panel: 'graphics', right: 'controls' },
    captions: { name: 'Captions', layout: '', panel: 'captions', right: 'controls' },
    libraries: { name: 'Libraries', available: false },
  };

  function setWorkspace(id) {
    const ws = WORKSPACES[id];
    if (!ws) return;
    if (ws.available === false) return AVP.toast(`${ws.name} is not in this version yet`, 'warn');
    S.workspace = id;
    const layout = $('#layout');
    layout.classList.remove('ws-editing', 'ws-assembly', 'ws-effects', 'ws-color', 'ws-audio');
    if (id === 'editing') layout.classList.add('ws-editing');
    if (ws.layout) layout.classList.add(ws.layout);
    AVP.layout.activate(id);
    document.querySelectorAll('.wtab').forEach((b) => b.classList.toggle('active', b.dataset.ws === id));
    if (ws.panel) AVP.panels.setPanel(ws.panel);
    if (ws.right) AVP.panels.setPanel(ws.right);
    AVP.timeline.render();
  }

  function init() {
    AVP.gpu.init();
    document.querySelectorAll('[data-icon]').forEach(AVP.icons.apply);
    AVP.menu.init();
    AVP.dialog.init();
    buildMenuBar();

    AVP.bin.init();
    AVP.timeline.init();
    AVP.monitor.init();
    AVP.panels.init();
    AVP.layout.init();
    AVP.docks.init();
    AVP.monitorDock.init();
    AVP.meters.init();
    document.querySelectorAll('.wtab').forEach((b) => b.addEventListener('click', () => setWorkspace(b.dataset.ws)));

    $('#btnExport').addEventListener('click', () => exportDialog());
    $('#pToStart').addEventListener('click', () => AVP.monitor.goTo(0));
    $('#pRev').addEventListener('click', () => AVP.monitor.play(-1));
    $('#pStepBack').addEventListener('click', () => AVP.monitor.stepFrames(-1));
    $('#pPlay').addEventListener('click', () => AVP.monitor.playPause());
    $('#pStepFwd').addEventListener('click', () => AVP.monitor.stepFrames(1));
    $('#pFwd').addEventListener('click', () => AVP.monitor.play(1));
    $('#pToEnd').addEventListener('click', () => AVP.monitor.goTo(AVP.seqEnd()));
    $('#btnSeq').addEventListener('click', () => sequenceDialog());
    const pr = $('#previewSel');
    if (pr) {
      pr.value = String(S.previewScale);
      pr.addEventListener('change', () => setPreview(parseFloat(pr.value)));
    }

    $('#openInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) AVP.project.openFile(f);
      e.target.value = '';
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('mouseup', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b) b.blur();
    });
    wireContextMenus();

    window.addEventListener('beforeunload', (e) => {
      if (S.clips.length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    updateTitle();
    refresh();
    AVP.project.offerRecovery();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
