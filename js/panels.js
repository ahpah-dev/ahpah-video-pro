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
        def.params.map((p) => paramRow(c, 'fx:' + fx.id + ':' + p.k, p.label, p.def, { min: p.min, max: p.max, step: p.step || 1, unit: p.unit || '' })).join('') +
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

  const RIGHT_PANES = { controls: '#fxBody', lumetri: '#lumetriBody', sound: '#soundBody', mixer: '#mixerBody', metadata: '#infoBody' };
  const RIGHT_TABS = Object.keys(RIGHT_PANES);

  function setRightTab(name) {
    S.rightTab = name;
    document.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('active', b.dataset.rtab === name));
    Object.keys(RIGHT_PANES).forEach((k) => {
      const el = $(RIGHT_PANES[k]);
      if (el) el.classList.toggle('hidden', k !== name);
    });
    renderSide();
  }

  // Accepts the names used by menus and shortcuts: controls | metadata | project | effects | markers.
  function setPanel(name) {
    if (RIGHT_TABS.indexOf(name) >= 0) setRightTab(name);
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

  /* ---------- shared parameter wiring for the grading and sound panels ---------- */

  function bindParams(root, c) {
    root.querySelectorAll('input[data-param]').forEach((inp) => {
      const key = inp.dataset.param;
      inp.addEventListener('pointerdown', () => AVP.pushUndo());
      inp.addEventListener('input', () => {
        const cur = AVP.findClip(c.id);
        if (!cur) return;
        writeParam(cur, key, +inp.value);
        const out = inp.parentElement.querySelector('output');
        if (out) out.textContent = Math.round(+inp.value * 10) / 10 + (out.textContent.match(/[^\d.\-]+$/) || [''])[0];
        AVP.monitor.draw();
      });
    });
    root.querySelectorAll('[data-kf]').forEach((b) => b.addEventListener('click', () => toggleKeyframing(c, b.dataset.kf)));
    root.querySelectorAll('[data-kfkey]').forEach((b) => b.addEventListener('click', () => toggleKeyAtPlayhead(c, b.dataset.kfkey)));
  }

  /* ---------- Lumetri Color ---------- */

  const LUMETRI_GROUPS = [
    { title: 'Basic Correction', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
    { title: 'White Balance', keys: ['temperature', 'tint'] },
    { title: 'Creative', keys: ['vibrance', 'saturation', 'fade'] },
  ];

  function renderLumetri() {
    const body = $('#lumetriBody');
    if (!body) return;
    const c = AVP.selectedClips()[0];
    if (!c) {
      body.innerHTML = '<div class="hint">Select a clip on the timeline to grade it with Lumetri Color.</div>';
      return;
    }
    const fx = c.fx.find((f) => f.type === 'lumetri');
    const m = AVP.findMedia(c.mediaId);
    const name = m ? m.name : c.kind === 'title' ? 'Title' : 'Clip';
    if (!fx) {
      body.innerHTML =
        '<div class="fx-head"><div class="fx-name">Lumetri Color</div><div class="fx-sub">' + AVP.esc(name) + ' · ' + c.track + '</div></div>' +
        '<div class="fx-note">Grade this clip: exposure, white balance, tones, saturation and fade. Changes are computed on the GPU frame by frame.</div>' +
        '<button class="btn primary" id="lumAdd">Add Lumetri Color</button>';
      $('#lumAdd').addEventListener('click', () => AVP.edit.addFx([c.id], 'lumetri'));
      return;
    }
    let html =
      '<div class="fx-head"><div class="fx-name">Lumetri Color</div><div class="fx-sub">' + AVP.esc(name) + ' · ' + c.track + '</div></div>' +
      '<div class="fx-card-head"><label class="df-check"><input type="checkbox" id="lumOn"' + (fx.enabled ? ' checked' : '') + '> Enabled</label>' +
      '<span><button class="btn tiny" id="lumReset">Reset</button> <button class="btn tiny" id="lumRemove">Remove</button></span></div>';
    LUMETRI_GROUPS.forEach((g) => {
      html += '<div class="fx-group"><div class="fx-title">' + g.title + '</div>';
      html += g.keys
        .map((k) => {
          const d = AVP.effectParamDef('lumetri', k);
          return paramRow(c, 'fx:' + fx.id + ':' + k, d.label, d.def, { min: d.min, max: d.max, step: d.step || 1, unit: d.unit || '' });
        })
        .join('');
      html += '</div>';
    });
    html += '<div class="fx-note">Shadows, highlights, whites and blacks move tones in their own range. Use the stopwatch on any control to keyframe it.</div>';
    body.innerHTML = html;
    bindParams(body, c);
    $('#lumOn').addEventListener('change', (e) => {
      AVP.pushUndo();
      fx.enabled = e.target.checked;
      AVP.refresh();
    });
    $('#lumReset').addEventListener('click', () => {
      AVP.pushUndo();
      LUMETRI_GROUPS.forEach((g) => g.keys.forEach((k) => (fx.params[k] = AVP.effectParamDef('lumetri', k).def)));
      AVP.refresh();
    });
    $('#lumRemove').addEventListener('click', () => AVP.edit.removeFx(c.id, fx.id));
  }

  /* ---------- Essential Sound ---------- */

  // Essential Sound works on the audio clip: the clip itself, or the audio partner of a video clip.
  function soundClipFor(c) {
    if (!c) return null;
    if (AVP.trackKind(c.track) === 'audio') return c;
    return AVP.partners(c).find((p) => AVP.trackKind(p.track) === 'audio') || c;
  }

  function setSoundField(clipId, patch) {
    const c = AVP.findClip(clipId);
    if (!c) return;
    c.sound = Object.assign({}, AVP.soundOf(c), patch);
    AVP.monitor.sync();
  }

  function renderSound() {
    const body = $('#soundBody');
    if (!body) return;
    const c = soundClipFor(AVP.selectedClips()[0]);
    if (!c) {
      body.innerHTML = '<div class="hint">Select an audio clip, or a video clip with sound, to use Essential Sound.</div>';
      return;
    }
    const snd = AVP.soundOf(c);
    const m = AVP.findMedia(c.mediaId);
    const options = Object.keys(AVP.SOUND_PRESETS)
      .map((k) => '<option value="' + k + '"' + (k === snd.type ? ' selected' : '') + '>' + AVP.SOUND_PRESETS[k].label + '</option>')
      .join('');
    const level = m && m.rmsDb != null ? m.rmsDb.toFixed(1) + ' dB RMS' : 'not measured';
    body.innerHTML =
      '<div class="fx-head"><div class="fx-name">Essential Sound</div><div class="fx-sub">' + AVP.esc(m ? m.name : 'Audio') + ' · ' + c.track + '</div></div>' +
      '<div class="fx-group"><div class="fx-title">Audio Type</div>' +
      '<select class="wide" id="snType">' + options + '</select>' +
      '<div class="fx-note">A type sets starting values for the settings below. Adjust any of them to fine-tune.</div>' +
      '<label class="df-check"><input type="checkbox" id="snOn"' + (snd.enabled ? ' checked' : '') + '> Essential Sound enabled</label></div>' +
      '<div class="fx-group"><div class="fx-title">Loudness</div>' +
      '<label class="df-check"><input type="checkbox" id="snAuto"' + (snd.autoMatch ? ' checked' : '') + '> Auto-match loudness to target</label>' +
      '<div class="fx-row"><span class="fx-label">Target</span><input type="range" id="snTarget" min="-40" max="0" step="1" value="' + snd.target + '"><output>' + snd.target + ' dB</output><span></span><span></span></div>' +
      '<div class="fx-kv"><span>Measured level</span><b>' + level + '</b></div></div>' +
      '<div class="fx-group"><div class="fx-title">Clean Up</div>' +
      '<div class="fx-row"><span class="fx-label">Low cut</span><input type="range" id="snLow" min="20" max="300" step="5" value="' + snd.lowCut + '"><output>' + snd.lowCut + ' Hz</output><span></span><span></span></div>' +
      '<div class="fx-row"><span class="fx-label">Presence</span><input type="range" id="snPres" min="-6" max="8" step="0.5" value="' + snd.presence + '"><output>' + snd.presence + ' dB</output><span></span><span></span></div>' +
      '<label class="df-check"><input type="checkbox" id="snComp"' + (snd.compress ? ' checked' : '') + '> Compression (levels dialogue)</label></div>';

    const id = c.id;
    $('#snType').addEventListener('change', (e) => {
      AVP.pushUndo();
      AVP.applySoundPreset(AVP.findClip(id), e.target.value);
      AVP.refresh();
    });
    $('#snOn').addEventListener('change', (e) => {
      AVP.pushUndo();
      setSoundField(id, { enabled: e.target.checked });
      AVP.refresh();
    });
    $('#snAuto').addEventListener('change', (e) => {
      AVP.pushUndo();
      setSoundField(id, { autoMatch: e.target.checked });
      AVP.refresh();
    });
    $('#snComp').addEventListener('change', (e) => {
      AVP.pushUndo();
      setSoundField(id, { compress: e.target.checked });
      AVP.refresh();
    });
    const slider = (sel, key, unit) => {
      const el = $(sel);
      el.addEventListener('pointerdown', () => AVP.pushUndo());
      el.addEventListener('input', () => {
        setSoundField(id, { [key]: +el.value });
        el.parentElement.querySelector('output').textContent = el.value + unit;
      });
    };
    slider('#snTarget', 'target', ' dB');
    slider('#snLow', 'lowCut', ' Hz');
    slider('#snPres', 'presence', ' dB');
  }

  /* ---------- Audio Clip Mixer ---------- */

  function mixerStrip(id) {
    const tr = S.tracks[id];
    const db = tr.volume || 0;
    return (
      '<div class="mix-strip">' +
      '<div class="mix-name' + (tr.solo ? ' soloing' : '') + '">' + id + '</div>' +
      '<div class="mix-meter"><canvas data-mixmeter="' + id + '"></canvas></div>' +
      '<input type="range" class="mix-fader" data-fader="' + id + '" min="-60" max="12" step="0.5" value="' + db + '" title="Track volume">' +
      '<div class="mix-db" data-dbfor="' + id + '">' + db.toFixed(1) + ' dB</div>' +
      '<div class="mix-btns"><button class="tl-toggle mute' + (tr.muted ? ' on' : '') + '" data-mmute="' + id + '" title="Mute">M</button>' +
      '<button class="tl-toggle solo' + (tr.solo ? ' on' : '') + '" data-msolo="' + id + '" title="Solo">S</button></div>' +
      '</div>'
    );
  }

  function renderMixer() {
    const body = $('#mixerBody');
    if (!body) return;
    const audio = S.trackOrder.filter((id) => S.tracks[id] && S.tracks[id].kind === 'audio');
    body.innerHTML =
      '<div class="mix-row">' +
      audio.map(mixerStrip).join('') +
      '<div class="mix-strip master"><div class="mix-name">Master</div>' +
      '<div class="mix-meter"><canvas data-mixmeter="master"></canvas></div>' +
      '<div class="mix-db">0.0 dB</div></div></div>' +
      '<div class="fx-note">Track faders set each track level. M mutes a track and S solos it; while any track is soloed, the others are silent.</div>';

    body.querySelectorAll('.mix-fader').forEach((inp) => {
      const id = inp.dataset.fader;
      inp.addEventListener('pointerdown', () => AVP.pushUndo());
      inp.addEventListener('input', () => {
        S.tracks[id].volume = +inp.value;
        const label = body.querySelector('[data-dbfor="' + id + '"]');
        if (label) label.textContent = (+inp.value).toFixed(1) + ' dB';
      });
    });
    body.querySelectorAll('[data-mmute]').forEach((b) =>
      b.addEventListener('click', () => {
        const tr = S.tracks[b.dataset.mmute];
        AVP.pushUndo();
        tr.muted = !tr.muted;
        AVP.refresh();
      })
    );
    body.querySelectorAll('[data-msolo]').forEach((b) =>
      b.addEventListener('click', () => {
        const tr = S.tracks[b.dataset.msolo];
        AVP.pushUndo();
        tr.solo = !tr.solo;
        AVP.refresh();
      })
    );
  }

  // Refreshes the side lists that depend on the project (markers, metadata).
  function renderSide() {
    if (S.leftTab === 'markers') renderMarkers();
    if (S.rightTab === 'metadata') renderInfo();
    if (S.rightTab === 'lumetri') renderLumetri();
    if (S.rightTab === 'sound') renderSound();
    if (S.rightTab === 'mixer') renderMixer();
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
    renderLumetri,
    renderSound,
    renderMixer,
    setPanel,
    readParam,
  };
})();
