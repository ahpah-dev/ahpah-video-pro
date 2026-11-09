/*
 * AhPah Video Pro - right-hand panel: Effect Controls (properties, keyframes, text,
 * effects, transitions, speed) and the Effects library (effects, transitions, titles).
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const $ = (sel) => document.querySelector(sel);
  const esc = AVP.esc;

  let controlsEl = null;
  let libraryEl = null;
  let infoEl = null;

  /* ---------- parameter access (plain value or keyframed) ---------- */

  function localTime(c) {
    return AVP.clamp(S.playhead - c.start, 0, c.duration);
  }

  function readParam(c, key) {
    if (key.indexOf('fx:') === 0) {
      const [, fxId, name] = key.split(':');
      const fx = c.fx.find((f) => f.id === fxId);
      return fx ? AVP.fxParamAt(c, fx, name, S.playhead) : 0;
    }
    return AVP.propAt(c, key, S.playhead);
  }

  function baseParam(c, key) {
    if (key.indexOf('fx:') === 0) {
      const [, fxId, name] = key.split(':');
      const fx = c.fx.find((f) => f.id === fxId);
      return fx ? fx.params[name] : 0;
    }
    return c.props[key];
  }

  function writeParam(c, key, value) {
    const keys = c.keys[key];
    if (keys && keys.length) {
      AVP.setKey(keys, localTime(c), value);
      return;
    }
    if (key.indexOf('fx:') === 0) {
      const [, fxId, name] = key.split(':');
      const fx = c.fx.find((f) => f.id === fxId);
      if (fx) fx.params[name] = value;
    } else c.props[key] = value;
  }

  // Keyframe stopwatch: turns keyframing on (one key at the current value) or off.
  function toggleKeyframing(c, key) {
    AVP.pushUndo();
    if (c.keys[key] && c.keys[key].length) {
      delete c.keys[key];
    } else {
      c.keys[key] = [{ t: localTime(c), v: readParam(c, key) }];
    }
    AVP.refresh();
  }

  // Adds or removes a keyframe at the playhead without turning keyframing off.
  function toggleKeyAtPlayhead(c, key) {
    AVP.pushUndo();
    if (!c.keys[key] || !c.keys[key].length) c.keys[key] = [{ t: localTime(c), v: readParam(c, key) }];
    else {
      const t = localTime(c);
      const i = c.keys[key].findIndex((k) => Math.abs(k.t - t) < 1e-3);
      if (i >= 0) c.keys[key].splice(i, 1);
      else AVP.setKey(c.keys[key], t, readParam(c, key));
      if (!c.keys[key].length) delete c.keys[key];
    }
    AVP.refresh();
  }

  function paramRow(c, key, label, def, opts) {
    opts = opts || {};
    const value = readParam(c, key);
    const keyed = !!(c.keys[key] && c.keys[key].length);
    const unit = opts.unit || '';
    const shown = Math.round(value * 10) / 10;
    const onKey = keyed ? ' on' : '';
    return (
      `<div class="fx-row" data-key="${key}">` +
      `<button class="kf-watch${onKey}" data-kf="${key}" title="Toggle keyframes for ${esc(label)}"></button>` +
      `<span class="fx-label">${esc(label)}</span>` +
      `<input type="range" data-param="${key}" min="${opts.min}" max="${opts.max}" step="${opts.step || 1}" value="${value}">` +
      `<output>${shown}${unit}</output>` +
      `<button class="kf-diamond${keyed ? ' on' : ''}" data-kfkey="${key}" title="Add or remove a keyframe at the playhead"${keyed ? '' : ' disabled'}></button>` +
      `</div>`
    );
  }

  /* ---------- Effect Controls ---------- */

  function sectionHead(title) {
    return `<div class="fx-title">${esc(title)}</div>`;
  }

  function transitionOptions(kind, current) {
    const opts = [{ v: '', label: 'None' }].concat(
      AVP.transitionsFor(kind).map((k) => ({ v: k, label: AVP.TRANSITIONS[k].name }))
    );
    return opts.map((o) => `<option value="${o.v}"${o.v === (current ? current.type : '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  }

  function renderControls() {
    if (!controlsEl) return;
    const c = AVP.selectedClips()[0];
    if (!c) {
      controlsEl.innerHTML =
        '<div class="hint">Select a clip on the timeline to edit its motion, effects, text and transitions.<br><br>' +
        'Right-click a clip for more options.</div>';
      return;
    }
    const m = AVP.findMedia(c.mediaId);
    const kind = AVP.trackKind(c.track);
    const isAudio = kind === 'audio' || (m && m.type === 'audio');
    const isTitle = c.kind === 'title';
    const linked = !isAudio && AVP.partners(c).length > 0;
    const name = isTitle ? 'Title: ' + (c.text.text.split('\n')[0] || '') : m ? m.name : 'Missing media';

    let html =
      `<div class="fx-head"><div class="fx-name">${esc(name)}</div>` +
      `<div class="fx-sub">${c.track} · ${AVP.fmtTC(c.start)} to ${AVP.fmtTC(c.start + c.duration)} · ${AVP.fmtTC(c.duration)}</div></div>`;

    if (!isAudio) {
      html +=
        `<div class="fx-group">${sectionHead('Motion')}` +
        paramRow(c, 'x', 'Position X', 0, { min: -100, max: 100, unit: '%' }) +
        paramRow(c, 'y', 'Position Y', 0, { min: -100, max: 100, unit: '%' }) +
        paramRow(c, 'scale', 'Scale', 100, { min: 0, max: 400, unit: '%' }) +
        paramRow(c, 'rotation', 'Rotation', 0, { min: -360, max: 360, unit: '°' }) +
        paramRow(c, 'opacity', 'Opacity', 100, { min: 0, max: 100, unit: '%' }) +
        `</div>`;
    }

    html +=
      `<div class="fx-group">${sectionHead('Audio')}` +
      (linked
        ? '<div class="fx-note">Sound comes from the linked audio clip.</div>'
        : paramRow(c, 'volume', 'Volume', 100, { min: 0, max: 200, unit: '%' })) +
      `</div>`;

    html +=
      `<div class="fx-group">${sectionHead('Timing')}` +
      `<div class="fx-kv"><span>Speed</span><input type="number" id="fxSpeed" value="${Math.round((c.speed || 1) * 1000) / 10}" min="10" max="1600" step="10">%</div>` +
      `<div class="fx-kv"><span>Source in</span><b>${AVP.fmtTC(c.inPoint)}</b></div>` +
      `</div>`;

    if (isTitle) html += textSection(c);

    html += `<div class="fx-group">${sectionHead('Effects')}`;
    if (!c.fx.length) html += '<div class="fx-note">No effects. Add one below or drag one from the Effects tab.</div>';
    c.fx.forEach((fx) => {
      const def = AVP.EFFECTS[fx.type];
      html +=
        `<div class="fx-card" data-fx="${fx.id}">` +
        `<div class="fx-card-head"><label class="df-check"><input type="checkbox" data-fxon="${fx.id}"${fx.enabled ? ' checked' : ''}> ${esc(def.name)}</label>` +
        `<button class="btn tiny" data-fxdel="${fx.id}" title="Remove effect">Remove</button></div>` +
        def.params.map((p) => paramRow(c, 'fx:' + fx.id + ':' + p.k, p.label, p.def, { min: p.min, max: p.max, unit: p.unit || '' })).join('') +
        `</div>`;
    });
    html +=
      `<select id="fxAdd" class="wide"><option value="">Add effect…</option>` +
      Object.keys(AVP.EFFECTS)
        .map((k) => `<option value="${k}">${esc(AVP.EFFECTS[k].cat)}: ${esc(AVP.EFFECTS[k].name)}</option>`)
        .join('') +
      `</select></div>`;

    const tIn = transitionSpec(c, 'start');
    const tOut = transitionSpec(c, 'end');
    html += `<div class="fx-group">${sectionHead('Transitions')}`;
    html +=
      `<div class="fx-kv"><span>Start</span><select data-trans="start">${transitionOptions(kind, tIn)}</select></div>` +
      `<div class="fx-kv"><span>Duration (s)</span><input type="number" data-transdur="start" value="${tIn ? tIn.duration : 1}" min="0.1" max="10" step="0.1"></div>` +
      `<div class="fx-kv"><span>End</span><select data-trans="end">${transitionOptions(kind, tOut)}</select></div>` +
      `<div class="fx-kv"><span>Duration (s)</span><input type="number" data-transdur="end" value="${tOut ? tOut.duration : 1}" min="0.1" max="10" step="0.1"></div>` +
      `<div class="fx-note">Transitions are centred on a cut when a clip touches the next one.</div></div>`;

    controlsEl.innerHTML = html;
    bindControls(c);
  }

  function textSection(c) {
    const T = c.text;
    const fonts = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Impact', 'Trebuchet MS', 'Segoe UI'];
    const fontOpts = fonts.map((f) => `<option${f === T.font ? ' selected' : ''}>${f}</option>`).join('');
    const alignOpts = ['left', 'center', 'right'].map((a) => `<option${a === T.align ? ' selected' : ''}>${a}</option>`).join('');
    return (
      `<div class="fx-group">${sectionHead('Text')}` +
      `<textarea class="wide" rows="3" data-text="text">${esc(T.text)}</textarea>` +
      `<div class="fx-kv"><span>Font</span><select data-text="font">${fontOpts}</select></div>` +
      `<div class="fx-kv"><span>Size</span><input type="number" data-text="size" value="${T.size}" min="8" max="600" step="2"></div>` +
      `<div class="fx-kv"><span>Align</span><select data-text="align">${alignOpts}</select></div>` +
      `<div class="fx-kv"><span>Style</span><span><label class="df-check"><input type="checkbox" data-text="bold"${T.bold ? ' checked' : ''}> Bold</label> ` +
      `<label class="df-check"><input type="checkbox" data-text="italic"${T.italic ? ' checked' : ''}> Italic</label></span></div>` +
      `<div class="fx-kv"><span>Colour</span><input type="color" data-text="color" value="${T.color}"></div>` +
      `<div class="fx-kv"><span>Outline</span><span><input type="color" data-text="stroke" value="${T.stroke}"> ` +
      `<input type="number" data-text="strokeWidth" value="${T.strokeWidth}" min="0" max="40" step="1" style="width:56px"></span></div>` +
      `<div class="fx-kv"><span>Shadow</span><input type="checkbox" data-text="shadow"${T.shadow ? ' checked' : ''}></div>` +
      `<div class="fx-kv"><span>Background</span><span><input type="color" data-text="bgColor" value="${T.bgColor}"> ` +
      `<input type="number" data-text="bgOpacity" value="${T.bgOpacity}" min="0" max="100" step="5" style="width:56px">%</span></div>` +
      `<div class="fx-kv"><span>Line height</span><input type="number" data-text="lineHeight" value="${T.lineHeight}" min="0.6" max="3" step="0.1"></div>` +
      `<div class="fx-kv"><span>Max width</span><input type="number" data-text="maxWidth" value="${T.maxWidth}" min="10" max="100" step="5">%</div>` +
      `</div>`
    );
  }

  function bindControls(c) {
    // Sliders and keyframed values.
    controlsEl.querySelectorAll('input[data-param]').forEach((inp) => {
      const key = inp.dataset.param;
      inp.addEventListener('pointerdown', () => AVP.pushUndo());
      inp.addEventListener('input', () => {
        const cur = AVP.findClip(c.id);
        if (!cur) return;
        writeParam(cur, key, +inp.value);
        const out = inp.parentElement.querySelector('output');
        if (out) out.textContent = Math.round(+inp.value * 10) / 10 + (out.textContent.match(/[^\d.\-]+$/) || [''])[0];
        // Do not rebuild this panel here: that would destroy the slider being dragged.
        AVP.timeline.render();
        AVP.monitor.draw();
      });
    });
    controlsEl.querySelectorAll('[data-kf]').forEach((b) => b.addEventListener('click', () => toggleKeyframing(c, b.dataset.kf)));
    controlsEl.querySelectorAll('[data-kfkey]').forEach((b) =>
      b.addEventListener('click', () => toggleKeyAtPlayhead(c, b.dataset.kfkey))
    );

    // Effects on the clip.
    const add = $('#fxAdd');
    if (add) {
      add.addEventListener('change', () => {
        if (add.value) AVP.edit.addFx([c.id], add.value);
      });
    }
    controlsEl.querySelectorAll('[data-fxdel]').forEach((b) =>
      b.addEventListener('click', () => AVP.edit.removeFx(c.id, b.dataset.fxdel))
    );
    controlsEl.querySelectorAll('[data-fxon]').forEach((cb) =>
      cb.addEventListener('change', () => {
        const fx = c.fx.find((f) => f.id === cb.dataset.fxon);
        if (!fx) return;
        AVP.pushUndo();
        fx.enabled = cb.checked;
        AVP.refresh();
      })
    );

    // Speed.
    const speed = $('#fxSpeed');
    if (speed) {
      speed.addEventListener('change', () => AVP.edit.setSpeed([c.id], (+speed.value || 100) / 100));
    }

    // Transitions.
    controlsEl.querySelectorAll('select[data-trans]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const edge = sel.dataset.trans;
        if (!sel.value) AVP.edit.removeTransition(c.id, edge);
        else AVP.edit.applyTransition(c.id, sel.value, edge);
      });
    });
    controlsEl.querySelectorAll('input[data-transdur]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const edge = inp.dataset.transdur;
        const cur = AVP.findClip(c.id);
        if (!cur) return;
        const d = AVP.clamp(+inp.value || 1, 0.1, 10);
        const specs = [cur].concat(AVP.partners(cur)).map((clip) => transitionSpec(clip, edge)).filter(Boolean);
        if (!specs.length) return;
        AVP.pushUndo();
        specs.forEach((s) => (s.duration = d));
        AVP.refresh();
      });
    });

    // Text fields (live update).
    controlsEl.querySelectorAll('[data-text]').forEach((el) => {
      const key = el.dataset.text;
      const apply = () => {
        const cur = AVP.findClip(c.id);
        if (!cur || !cur.text) return;
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number') v = parseFloat(el.value);
        else v = el.value;
        if (el.type === 'number' && isNaN(v)) return;
        cur.text[key] = v;
        AVP.timeline.render();
        AVP.monitor.draw();
      };
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', apply);
    });
  }

  function nextClip(c) {
    const end = c.start + c.duration;
    return S.clips.find((o) => o.track === c.track && o.id !== c.id && Math.abs(o.start - end) < AVP.EPS) || null;
  }

  // The transition object that sits on a clip edge (or null).
  function transitionSpec(c, edge) {
    if (edge === 'start') return c.transIn;
    const next = nextClip(c);
    if (next) return next.transIn;
    return c.transOut;
  }

  /* ---------- Effects library ---------- */

  function libItem(label, dragData, dataAttrs) {
    return `<div class="lib-item" draggable="true" data-drag='${esc(dragData)}' ${dataAttrs}>${esc(label)}</div>`;
  }

  function groupBy(map, keyFn) {
    const out = {};
    Object.keys(map).forEach((k) => {
      const g = keyFn(map[k]);
      (out[g] = out[g] || []).push(k);
    });
    return out;
  }

  function renderLibrary() {
    if (!libraryEl) return;
    const q = (S.effectsQuery || '').trim().toLowerCase();
    const match = (name) => !q || name.toLowerCase().indexOf(q) >= 0;
    let html = `<div class="lib-search"><input type="search" id="libQuery" placeholder="Search effects, transitions, titles" value="${esc(S.effectsQuery || '')}"></div>`;

    const section = (title, groups, render) => {
      const entries = Object.keys(groups)
        .map((g) => ({ g, items: groups[g].filter((x) => match(render.name(x))) }))
        .filter((e) => e.items.length);
      if (!entries.length) return '';
      return (
        `<div class="lib-section"><div class="lib-head">${esc(title)}</div>` +
        entries
          .map(
            (e) =>
              `<div class="lib-cat">${esc(e.g)}</div>` +
              e.items.map((x) => libItem(render.name(x), render.drag(x), render.attrs(x))).join('')
          )
          .join('') +
        `</div>`
      );
    };

    html += section('Video Effects', groupBy(AVP.EFFECTS, (d) => d.cat), {
      name: (k) => AVP.EFFECTS[k].name,
      drag: (k) => JSON.stringify({ kind: 'effect', type: k }),
      attrs: (k) => `data-dbl="effect" data-type="${k}"`,
    });
    const videoTrans = {};
    const audioTrans = {};
    Object.keys(AVP.TRANSITIONS).forEach((k) => (AVP.TRANSITIONS[k].audio ? audioTrans : videoTrans)[k] = AVP.TRANSITIONS[k]);
    html += section('Video Transitions', groupBy(videoTrans, (d) => d.cat), {
      name: (k) => AVP.TRANSITIONS[k].name,
      drag: (k) => JSON.stringify({ kind: 'transition', type: k }),
      attrs: (k) => `data-dbl="transition" data-type="${k}"`,
    });
    html += section('Audio Transitions', groupBy(audioTrans, (d) => d.cat), {
      name: (k) => AVP.TRANSITIONS[k].name,
      drag: (k) => JSON.stringify({ kind: 'transition', type: k }),
      attrs: (k) => `data-dbl="transition" data-type="${k}"`,
    });
    const presets = AVP.TITLE_PRESETS.map((p, i) => i);
    html += section('Titles', { 'Text presets': presets }, {
      name: (i) => AVP.TITLE_PRESETS[i].name,
      drag: (i) => JSON.stringify({ kind: 'title', preset: i }),
      attrs: (i) => `data-dbl="title" data-type="${i}"`,
    });
    html += `<div class="lib-note">Drag an effect onto a clip. Drag a transition onto the start or end of a clip. Double-click to apply to the selection.</div>`;
    libraryEl.innerHTML = html;

    const qi = $('#libQuery');
    if (qi) {
      qi.addEventListener('input', () => {
        S.effectsQuery = qi.value;
        const pos = qi.selectionStart;
        renderLibrary();
        const again = $('#libQuery');
        if (again) {
          again.focus();
          again.setSelectionRange(pos, pos);
        }
      });
    }
    libraryEl.querySelectorAll('.lib-item').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-avp-effect', el.dataset.drag);
        e.dataTransfer.effectAllowed = 'copy';
      });
      el.addEventListener('dblclick', () => {
        const type = el.dataset.type;
        const kind = el.dataset.dbl;
        if (kind === 'effect') AVP.edit.addFx(S.selection.slice(), type);
        else if (kind === 'transition') {
          const c = AVP.selectedClips()[0];
          if (!c) return AVP.toast('Select a clip first');
          AVP.edit.applyTransition(c.id, type, 'start');
        } else if (kind === 'title') {
          const track = S.target.video;
          AVP.edit.placeTitle({ track, start: S.playhead, preset: +type, mode: 'overwrite' });
        }
      });
    });
  }

  /* ---------- tabs ---------- */

  /* ---------- tab groups: left (project / effects / markers), right (controls / metadata) ---------- */

  function setLeftTab(name) {
    S.leftTab = name;
    document.querySelectorAll('[data-ptab]').forEach((b) => b.classList.toggle('active', b.dataset.ptab === name));
    const panes = { project: '#paneProject', effects: '#paneEffects', markers: '#paneMarkers' };
    Object.keys(panes).forEach((k) => {
      const el = $(panes[k]);
      if (el) el.classList.toggle('hidden', k !== name);
    });
    if (name === 'markers') renderMarkers();
  }

  function setRightTab(name) {
    S.rightTab = name;
    document.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('active', b.dataset.rtab === name));
    if (controlsEl) controlsEl.classList.toggle('hidden', name !== 'controls');
    if (infoEl) infoEl.classList.toggle('hidden', name !== 'metadata');
    if (name === 'metadata') renderInfo();
  }

  // Accepts the names used by menus and shortcuts: controls | metadata | project | effects | markers.
  function setPanel(name) {
    if (name === 'controls' || name === 'metadata') setRightTab(name);
    else setLeftTab(name);
    S.panel = name;
  }

  /* ---------- markers list ---------- */

  function renderMarkers() {
    const body = $('#markersBody');
    if (!body) return;
    const count = $('#markerCount');
    if (count) count.textContent = `${S.markers.length} marker${S.markers.length === 1 ? '' : 's'}`;
    if (!S.markers.length) {
      body.innerHTML = '<div class="hint">No markers yet. Press M or use the marker button to add one at the playhead.</div>';
      return;
    }
    body.innerHTML = S.markers
      .map(
        (m) =>
          `<div class="marker-row" data-marker="${m.id}" title="Click to go there. Double-click to rename.">` +
          `<span class="mk"></span><span class="mt">${AVP.fmtTC(m.t)}</span>` +
          `<span class="ml">${AVP.esc(m.label || 'Marker')}</span>` +
          `<button class="btn tiny" data-rm="${m.id}" title="Delete marker">×</button></div>`
      )
      .join('');
    body.querySelectorAll('.marker-row').forEach((row) => {
      const marker = () => S.markers.find((x) => x.id === row.dataset.marker);
      row.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]');
        if (rm) return AVP.edit.removeMarker(rm.dataset.rm);
        const m = marker();
        if (m) AVP.monitor.goTo(m.t);
      });
      row.addEventListener('dblclick', () => {
        const m = marker();
        if (!m) return;
        AVP.dialog.form({
          title: 'Marker name',
          fields: [{ k: 'label', label: 'Name', type: 'text', value: m.label || '' }],
          ok: 'Save',
          onOk: (v) => {
            AVP.pushUndo();
            m.label = v.label;
            AVP.refresh();
          },
        });
      });
    });
  }

  /* ---------- metadata ---------- */

  function renderInfo() {
    const body = $('#infoBody');
    if (!body) return;
    const c = AVP.selectedClips()[0];
    const m = c ? AVP.findMedia(c.mediaId) : AVP.findMedia(S.binSelected);
    if (!m) {
      body.innerHTML = '<div class="hint">Select a clip on the timeline or a media item in the Project panel to see its metadata.</div>';
      return;
    }
    const typeName = { video: 'Video', audio: 'Audio', image: 'Still image' }[m.type] || m.type;
    const rows = [
      ['File name', m.name],
      ['Type', typeName],
      ['Duration', AVP.fmtTC(m.duration)],
      ['Frame size', m.width ? `${m.width} × ${m.height}` : '—'],
      ['Audio', m.type === 'image' ? 'None' : m.hasAudio ? 'Yes' : 'No'],
      ['File size', m.size ? (m.size / 1048576).toFixed(1) + ' MB' : '—'],
      ['Status', m.offline ? 'Offline' : m.error ? 'Error' : 'Online'],
    ];
    if (c) {
      rows.push(['Track', c.track], ['Clip start', AVP.fmtTC(c.start)], ['Clip duration', AVP.fmtTC(c.duration)], ['Source in', AVP.fmtTC(c.inPoint)], ['Speed', Math.round((c.speed || 1) * 100) + '%']);
    }
    body.innerHTML =
      `<div class="fx-head"><div class="fx-name">${AVP.esc(m.name)}</div><div class="fx-sub">${c ? 'Clip metadata' : 'Media metadata'}</div></div>` +
      '<table class="kb">' +
      rows.map((r) => `<tr><td>${AVP.esc(r[0])}</td><td>${AVP.esc(r[1])}</td></tr>`).join('') +
      '</table>';
  }

  // Refreshes the side lists that depend on the project (markers, metadata).
  function renderSide() {
    if (S.leftTab === 'markers') renderMarkers();
    if (S.rightTab === 'metadata') renderInfo();
  }

  function init() {
    controlsEl = $('#fxBody');
    infoEl = $('#infoBody');
    libraryEl = $('#libBody');
    document.querySelectorAll('[data-ptab]').forEach((b) => b.addEventListener('click', () => setLeftTab(b.dataset.ptab)));
    document.querySelectorAll('[data-rtab]').forEach((b) => b.addEventListener('click', () => setRightTab(b.dataset.rtab)));
    setLeftTab(S.leftTab || 'project');
    setRightTab(S.rightTab || 'controls');
    renderLibrary();
    renderMarkers();
  }

  AVP.panels = {
    init,
    renderControls,
    renderSide,
    renderLibrary,
    renderMarkers,
    renderInfo,
    setPanel,
    readParam,
  };
})();
