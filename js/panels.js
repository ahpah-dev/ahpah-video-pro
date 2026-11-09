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
    const cur = AVP.findClip(c.id) || c;
    if (!(cur.keys[key] && cur.keys[key].length) && !playheadOnClip(cur)) {
      return AVP.toast('Move the playhead over the clip to turn on keyframes', 'warn');
    }
    AVP.pushUndo();
    if (cur.keys[key] && cur.keys[key].length) {
      delete cur.keys[key];
    } else {
      cur.keys[key] = [{ t: localTime(cur), v: readParam(cur, key) }];
    }
    AVP.refresh();
  }

  // True when the playhead is over the clip. Keyframes can only be placed on the clip.
  function playheadOnClip(c) {
    return S.playhead >= c.start - AVP.EPS && S.playhead <= c.start + c.duration + AVP.EPS;
  }

  // Position of a keyframe along the lane, as a percentage of the clip.
  function keyPct(c, t) {
    return (AVP.clamp(t / Math.max(c.duration, 1e-6), 0, 1) * 100).toFixed(3);
  }

  // Adds or removes a keyframe at the playhead without turning keyframing off.
  function toggleKeyAtPlayhead(c, key) {
    const cur = AVP.findClip(c.id) || c;
    if (!playheadOnClip(cur)) return AVP.toast('Move the playhead over the clip to set a keyframe', 'warn');
    AVP.pushUndo();
    const t = localTime(cur);
    const keys = cur.keys[key];
    const i = keys ? keys.findIndex((k) => Math.abs(k.t - t) < 1e-3) : -1;
    if (keys && keys.length && i >= 0) {
      keys.splice(i, 1);
      if (!keys.length) delete cur.keys[key]; // the last keyframe removed turns keyframing off
    } else if (keys && keys.length) {
      AVP.setKey(keys, t, readParam(cur, key));
    } else {
      cur.keys[key] = [{ t, v: readParam(cur, key) }];
    }
    AVP.refresh();
  }

  // The keyframe lane under a keyed control: one diamond per keyframe along the clip, and the playhead.
  function keyLaneHtml(c, key, keys, local, onClip) {
    const dots = keys
      .map((k) => {
        const here = onClip && Math.abs(k.t - local) < 1e-3;
        return `<span class="kf-dot${here ? ' here' : ''}" data-kfdot="${key}" data-kft="${k.t}" style="left:${keyPct(c, k.t)}%" title="Keyframe at ${AVP.fmtTC(c.start + k.t)}"></span>`;
      })
      .join('');
    const head = onClip ? `<span class="kf-head" style="left:${keyPct(c, local)}%"></span>` : '';
    return `<div class="kf-lane" data-kflane="${key}" title="Click to move the playhead. Drag a keyframe to move it.">${dots}${head}</div>`;
  }

  function paramRow(c, key, label, def, opts) {
    opts = opts || {};
    const value = readParam(c, key);
    const keys = c.keys[key] || [];
    const keyed = keys.length > 0;
    const local = localTime(c);
    const onClip = playheadOnClip(c);
    // The diamond is filled only when a keyframe sits under the playhead, hollow when this control is
    // keyed but has no key here, and dimmed when no key can be placed (not keyed, or playhead off the clip).
    const atPlayhead = keyed && onClip && keys.some((k) => Math.abs(k.t - local) < 1e-3);
    const diamondState = atPlayhead ? ' on' : keyed ? ' partial' : '';
    const diamondTitle = !keyed
      ? 'Turn on keyframes with the stopwatch first'
      : !onClip
        ? 'Move the playhead over the clip to keyframe this'
        : atPlayhead
          ? 'Remove the keyframe at the playhead'
          : 'Add a keyframe at the playhead';
    const watchTitle = keyed ? `Turn off keyframes for ${esc(label)} (removes its keys)` : `Turn on keyframes for ${esc(label)}`;
    const unit = opts.unit || '';
    const shown = Math.round(value * 10) / 10;
    const hard = opts.hard || [opts.min, opts.max];
    return (
      `<div class="fx-row" data-key="${key}">` +
      `<button class="kf-watch${keyed ? ' on' : ''}" data-kf="${key}" title="${watchTitle}"></button>` +
      `<span class="fx-label">${esc(label)}</span>` +
      `<input type="range" data-param="${key}" data-def="${def}" min="${opts.min}" max="${opts.max}" step="${opts.step || 1}" value="${value}">` +
      // The value box takes typed numbers. Typed values may go past the slider's range, within the hard limits.
      `<span class="num-wrap"><input type="text" class="num-in" inputmode="decimal" data-num="${key}" data-lo="${hard[0]}" data-hi="${hard[1]}" title="Type a value, then press Enter" value="${shown}"><span class="num-unit">${esc(unit)}</span></span>` +
      `<button class="kf-diamond${diamondState}" data-kfkey="${key}" title="${diamondTitle}"${keyed && onClip ? '' : ' disabled'}></button>` +
      (keyed ? keyLaneHtml(c, key, keys, local, onClip) : '') +
      `</div>`
    );
  }

  // Keeps the keyframe diamonds, lanes, keyed values and sliders in step with the playhead, without
  // rebuilding the panel (so a slider being dragged is not lost). Called whenever the playhead moves.
  function syncPlayhead() {
    const c = AVP.selectedClips()[0];
    if (!c) return;
    const local = localTime(c);
    const onClip = playheadOnClip(c);
    document.querySelectorAll('.fx-row[data-key]').forEach((row) => {
      const key = row.dataset.key;
      const keys = c.keys[key] || [];
      const keyed = keys.length > 0;
      const atPlayhead = keyed && onClip && keys.some((k) => Math.abs(k.t - local) < 1e-3);
      const d = row.querySelector('.kf-diamond');
      if (d) {
        d.classList.toggle('on', atPlayhead);
        d.classList.toggle('partial', keyed && !atPlayhead);
        d.disabled = !(keyed && onClip);
      }
      const watch = row.querySelector('.kf-watch');
      if (watch) watch.classList.toggle('on', keyed);
      row.querySelectorAll('.kf-dot').forEach((dot) => {
        dot.classList.toggle('here', onClip && Math.abs(+dot.dataset.kft - local) < 1e-3);
      });
      const head = row.querySelector('.kf-head');
      if (head) head.style.left = keyPct(c, local) + '%';
      const value = readParam(c, key);
      const slider = row.querySelector('input[data-param]');
      if (slider && document.activeElement !== slider) slider.value = value;
      const box = row.querySelector('input[data-num]');
      if (box && document.activeElement !== box) box.value = Math.round(value * 10) / 10;
    });
  }

  // Keyframe lanes: click to move the playhead; drag a keyframe to move it along the clip.
  function bindKeyLanes(root, c) {
    root.querySelectorAll('.kf-lane').forEach((lane) => {
      const key = lane.dataset.kflane;
      lane.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const cur = AVP.findClip(c.id);
        if (!cur || !cur.keys[key]) return;
        e.preventDefault();
        const rect = lane.getBoundingClientRect();
        const toLocal = (x) => AVP.clamp((x - rect.left) / Math.max(rect.width, 1), 0, 1) * cur.duration;
        const dot = e.target.closest('.kf-dot');
        if (!dot) {
          AVP.monitor.goTo(cur.start + toLocal(e.clientX));
          AVP.refresh();
          return;
        }
        const t0 = +dot.dataset.kft;
        const k = cur.keys[key].find((x) => Math.abs(x.t - t0) < 1e-6);
        if (!k) return;
        AVP.pushUndo();
        let moved = false;
        const move = (ev) => {
          const nt = AVP.clamp(AVP.snapFrame(cur.start + toLocal(ev.clientX)) - cur.start, 0, cur.duration);
          if (Math.abs(nt - k.t) < 1e-6) return;
          if (cur.keys[key].some((o) => o !== k && Math.abs(o.t - nt) < 1e-3)) return; // never stack two keys
          k.t = nt;
          moved = true;
          dot.style.left = keyPct(cur, nt) + '%';
          AVP.monitor.draw();
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          cur.keys[key].sort((a, b) => a.t - b.t);
          if (!moved) {
            // A click on a keyframe (no drag) moves the playhead to it and undoes the empty change.
            AVP.popUndo();
            AVP.monitor.goTo(cur.start + k.t);
          }
          AVP.refresh();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    });
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
    const isPicture = !isAudio && kind === 'video' && !!m && m.type === 'video';
    const name = isTitle ? 'Title: ' + (c.text.text.split('\n')[0] || '') : m ? m.name : 'Missing media';

    let html =
      `<div class="fx-head"><div class="fx-name">${esc(name)}</div>` +
      `<div class="fx-sub">${c.track} · ${AVP.fmtTC(c.start)} to ${AVP.fmtTC(c.start + c.duration)} · ${AVP.fmtTC(c.duration)}</div></div>`;

    if (!isAudio) {
      html +=
        `<div class="fx-group">${sectionHead('Motion')}` +
        paramRow(c, 'x', 'Position X', 0, { min: -100, max: 100, unit: '%', hard: [-1000, 1000] }) +
        paramRow(c, 'y', 'Position Y', 0, { min: -100, max: 100, unit: '%', hard: [-1000, 1000] }) +
        paramRow(c, 'scale', 'Scale', 100, { min: 0, max: 400, unit: '%', hard: [0, 10000] }) +
        paramRow(c, 'rotation', 'Rotation', 0, { min: -360, max: 360, unit: '°', hard: [-36000, 36000] }) +
        paramRow(c, 'opacity', 'Opacity', 100, { min: 0, max: 100, unit: '%' }) +
        `</div>`;
    }

    html +=
      `<div class="fx-group">${sectionHead('Audio')}` +
      (isPicture
        ? '<div class="fx-note">A video clip is picture only. Its sound is the audio clip from the same file on an audio track' + (linked ? ' (linked to this clip).' : ', which is missing or has been removed.') + '</div>'
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
    const fonts = AVP.fontList();
    if (T.font && fonts.indexOf(T.font) < 0) fonts.unshift(T.font);
    const fontOpts = fonts.map((f) => `<option${f === T.font ? ' selected' : ''}>${esc(f)}</option>`).join('');
    const animOpts = AVP.TEXT_ANIMATIONS.map((a) => `<option value="${a.v}"${a.v === (T.anim || 'none') ? ' selected' : ''}>${esc(a.label)}</option>`).join('');
    const alignOpts = ['left', 'center', 'right'].map((a) => `<option${a === T.align ? ' selected' : ''}>${a}</option>`).join('');
    return (
      `<div class="fx-group">${sectionHead('Text')}` +
      `<textarea class="wide" rows="3" data-text="text">${esc(T.text)}</textarea>` +
      `<div class="fx-kv"><span>Font</span><span class="font-pick"><select data-text="font">${fontOpts}</select>` +
      `<button class="btn tiny" data-font-import title="Add a .ttf, .otf or .woff font file to this project">Add font…</button></span></div>` +
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
      `</div>` +
      `<div class="fx-group">${sectionHead('Animation')}` +
      `<div class="fx-kv"><span>Effect</span><select data-text="anim">${animOpts}</select></div>` +
      `<div class="fx-kv"><span>Length (s)</span><input type="number" data-text="animDur" value="${T.animDur}" min="0.05" max="10" step="0.05"></div>` +
      `<div class="fx-kv"><span>Delay (s)</span><input type="number" data-text="animDelay" value="${T.animDelay}" min="0" max="30" step="0.1"></div>` +
      `<div class="fx-kv"><span>Per letter (s)</span><input type="number" data-text="animStagger" value="${T.animStagger}" min="0" max="2" step="0.01"></div>` +
      `<div class="fx-kv"><span></span><button class="btn small" data-anim-preview title="Play the clip from its start to see the animation">Preview animation</button></div>` +
      `</div>`
    );
  }

  // Keeps the typed value box next to a slider in step with the slider while it is dragged.
  function syncValueBox(slider) {
    const num = slider.closest('.fx-row') && slider.closest('.fx-row').querySelector('input[data-num]');
    if (num && document.activeElement !== num) num.value = Math.round(+slider.value * 10) / 10;
  }

  // Typed values: Enter (or leaving the box) applies the number, Escape puts the old value back.
  function bindValueBoxes(root, c) {
    root.querySelectorAll('input[data-num]').forEach((box) => {
      const key = box.dataset.num;
      const lo = parseFloat(box.dataset.lo);
      const hi = parseFloat(box.dataset.hi);
      const current = () => {
        const cur = AVP.findClip(c.id);
        return cur ? Math.round(readParam(cur, key) * 10) / 10 : null;
      };
      box.addEventListener('focus', () => box.select());
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') box.blur();
        else if (e.key === 'Escape') {
          const was = current();
          if (was !== null) box.value = was;
          box.blur();
        }
      });
      box.addEventListener('change', () => {
        const cur = AVP.findClip(c.id);
        if (!cur) return;
        const v = parseFloat(String(box.value).replace(',', '.'));
        if (!isFinite(v)) {
          AVP.toast('Type a number, for example 120', 'warn');
          box.value = current();
          return;
        }
        AVP.pushUndo();
        writeParam(cur, key, Math.min(hi, Math.max(lo, v)));
        AVP.refresh();
      });
    });
  }

  // Asks for a font file and uses it for the title. The font is saved with the project.
  function pickFontFile(clipId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ttf,.otf,.woff,.woff2';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) return AVP.toast('Font files over 15 MB are too large for a project', 'warn');
      const reader = new FileReader();
      reader.onload = () => {
        const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
        AVP.addCustomFont(name, reader.result).then((ok) => {
          if (!ok) return AVP.toast(`${file.name} could not be read as a font`, 'error');
          const cur = AVP.findClip(clipId);
          if (cur && cur.text) {
            AVP.pushUndo();
            cur.text.font = name;
          }
          AVP.toast(`Added font ${name}`);
          AVP.refresh();
        });
      };
      reader.readAsDataURL(file);
    });
    input.click();
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
        syncValueBox(inp);
        // Do not rebuild this panel here: that would destroy the slider being dragged.
        AVP.timeline.render();
        AVP.monitor.draw();
      });
    });
    bindValueBoxes(controlsEl, c);
    bindKeyLanes(controlsEl, c);
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

    const animPrev = controlsEl.querySelector('[data-anim-preview]');
    if (animPrev) {
      animPrev.addEventListener('click', () => {
        const cur = AVP.findClip(c.id);
        if (!cur) return;
        AVP.monitor.goTo(cur.start);
        AVP.monitor.play(1);
        setTimeout(() => {
          if (S.playing) AVP.monitor.stop();
        }, Math.ceil(cur.duration * 1000));
      });
    }
    const fontBtn = controlsEl.querySelector('[data-font-import]');
    if (fontBtn) fontBtn.addEventListener('click', () => pickFontFile(c.id));

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

    html += section('Looks', { 'One-click styles': AVP.LOOKS.map((l, i) => i) }, {
      name: (i) => AVP.LOOKS[i].name,
      drag: (i) => JSON.stringify({ kind: 'look', index: i }),
      attrs: (i) => `data-dbl="look" data-type="${i}"`,
    });
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
    html += `<div class="lib-note">Drag an effect onto a clip. Drag a transition onto the start or end of a clip. Click to apply to the selection.</div>`;
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
        // The timeline reads this while the item is dragged, to preview a transition.
        try {
          AVP.libDrag = JSON.parse(el.dataset.drag);
        } catch (err) {
          AVP.libDrag = null;
        }
      });
      el.addEventListener('dragend', () => {
        AVP.libDrag = null;
      });
      // One click applies the item to the selection (or adds a title at the playhead).
      el.addEventListener('click', () => {
        const type = el.dataset.type;
        const kind = el.dataset.dbl;
        if (kind === 'effect') AVP.edit.addFx(S.selection.slice(), type);
        else if (kind === 'look') AVP.edit.addLook(S.selection.slice(), +type);
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
    const panes = { project: '#paneProject', effects: '#paneEffects', markers: '#paneMarkers', graphics: '#paneGraphics', captions: '#paneCaptions' };
    Object.keys(panes).forEach((k) => {
      const el = $(panes[k]);
      if (el) el.classList.toggle('hidden', k !== name);
    });
    if (name === 'markers') renderMarkers();
    if (name === 'graphics') renderGraphics();
    if (name === 'captions') renderCaptions();
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

  /* ---------- Captions ---------- */

  // The Captions panel: a list of caption clips, each with its times and text, and the style for new captions.
  function renderCaptions() {
    const body = $('#captionsBody');
    if (!body) return;
    const list = AVP.captions.list();
    const selected = new Set(S.selection);
    const st = AVP.captionStyle;
    const fontOpts = AVP.fontList()
      .map((f) => `<option${f === st.font ? ' selected' : ''}>${esc(f)}</option>`)
      .join('');
    const posOpts = ['bottom', 'middle', 'top']
      .map((p) => `<option value="${p}"${p === st.position ? ' selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`)
      .join('');
    const rows = list
      .map(
        (c) =>
          `<div class="cap-row${selected.has(c.id) ? ' sel' : ''}" data-capid="${c.id}">` +
          `<div class="cap-times">` +
          `<input type="number" class="cap-num" step="0.1" min="0" data-capstart="${c.id}" value="${c.start.toFixed(2)}" title="Start, in seconds">` +
          `<span class="muted">to</span>` +
          `<input type="number" class="cap-num" step="0.1" min="0" data-capend="${c.id}" value="${(c.start + c.duration).toFixed(2)}" title="End, in seconds">` +
          `<button class="btn tiny" data-capdel="${c.id}" title="Delete this caption">×</button></div>` +
          `<textarea class="cap-text" rows="2" data-captext="${c.id}" spellcheck="true">${esc(c.text.text)}</textarea>` +
          `</div>`
      )
      .join('');
    body.innerHTML =
      '<div class="fx-group"><div class="fx-title">Captions</div>' +
      '<div class="graphic-buttons">' +
      '<button class="btn" data-cap="new" title="Add a caption at the playhead">New caption</button>' +
      '<button class="btn" data-cap="import" title="Import an SRT subtitle file">Import SRT…</button>' +
      `<button class="btn" data-cap="export"${list.length ? '' : ' disabled'} title="Save the captions as an SRT file">Export SRT</button>` +
      '</div>' +
      '<div class="fx-note">Captions sit on the CC track above the video. Type to edit a caption. Click a caption to go to it.</div></div>' +
      '<div class="fx-group"><div class="fx-title">Style for captions</div>' +
      `<div class="fx-kv"><span>Font</span><select data-capstyle="font">${fontOpts}</select></div>` +
      `<div class="fx-kv"><span>Size</span><input type="number" data-capstyle="size" value="${st.size}" min="8" max="300" step="2"></div>` +
      `<div class="fx-kv"><span>Box opacity</span><input type="number" data-capstyle="bgOpacity" value="${st.bgOpacity}" min="0" max="100" step="5"></div>` +
      `<div class="fx-kv"><span>Position</span><select data-capstyle="position">${posOpts}</select></div>` +
      `<div class="graphic-buttons"><button class="btn" data-cap="restyle"${list.length ? '' : ' disabled'}>Apply style to all captions</button></div></div>` +
      `<div class="fx-group"><div class="fx-title">${list.length} caption${list.length === 1 ? '' : 's'}</div>` +
      (rows || '<div class="fx-note">No captions yet. Add one at the playhead, or import an SRT file.</div>') +
      '</div>';
    bindCaptions(body);
  }

  function bindCaptions(body) {
    body.querySelectorAll('[data-cap]').forEach((b) =>
      b.addEventListener('click', () => {
        const what = b.dataset.cap;
        if (what === 'new') AVP.captions.newAtPlayhead();
        else if (what === 'import') AVP.captions.importPicker();
        else if (what === 'export') AVP.captions.exportSRT();
        else if (what === 'restyle') AVP.captions.restyleAll();
      })
    );
    body.querySelectorAll('[data-capstyle]').forEach((el) =>
      el.addEventListener('change', () => {
        const k = el.dataset.capstyle;
        AVP.captionStyle[k] = el.type === 'number' ? parseFloat(el.value) || 0 : el.value;
      })
    );
    // Text: one undo step per editing session; the timeline follows as you type.
    body.querySelectorAll('[data-captext]').forEach((ta) => {
      const id = ta.dataset.captext;
      ta.addEventListener('focus', () => AVP.pushUndo());
      ta.addEventListener('input', () => {
        const c = AVP.findClip(id);
        if (!c || !c.text) return;
        c.text.text = ta.value;
        AVP.timeline.render();
        AVP.monitor.draw();
      });
    });
    // Times: typing a start or end moves the caption and cuts back any caption it now covers.
    body.querySelectorAll('[data-capstart], [data-capend]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inp.blur(); // Enter applies the time, as in the value boxes
      });
      inp.addEventListener('change', () => {
        const id = inp.dataset.capstart || inp.dataset.capend;
        const c = AVP.findClip(id);
        if (!c) return;
        const start = inp.dataset.capstart ? parseFloat(inp.value) : c.start;
        const end = inp.dataset.capend ? parseFloat(inp.value) : c.start + c.duration;
        if (!isFinite(start) || !isFinite(end)) return;
        AVP.pushUndo();
        AVP.captions.setTimes(id, start, end);
        AVP.refresh();
      });
    });
    body.querySelectorAll('[data-capdel]').forEach((b) =>
      b.addEventListener('click', () => {
        AVP.pushUndo();
        S.clips = S.clips.filter((c) => c.id !== b.dataset.capdel);
        AVP.select([], false);
        AVP.refresh();
      })
    );
    // Clicking a caption's row (not its fields) selects it and moves the playhead to its start.
    body.querySelectorAll('.cap-row').forEach((row) =>
      row.addEventListener('click', (e) => {
        if (e.target.closest('input, textarea, button')) return;
        const c = AVP.findClip(row.dataset.capid);
        if (!c) return;
        AVP.select([c.id], false);
        AVP.monitor.goTo(c.start);
        AVP.refresh();
      })
    );
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
        syncValueBox(inp);
        AVP.monitor.draw();
      });
    });
    bindValueBoxes(root, c);
    bindKeyLanes(root, c);
    root.querySelectorAll('[data-kf]').forEach((b) => b.addEventListener('click', () => toggleKeyframing(c, b.dataset.kf)));
    root.querySelectorAll('[data-kfkey]').forEach((b) => b.addEventListener('click', () => toggleKeyAtPlayhead(c, b.dataset.kfkey)));
  }

  /* ---------- Lumetri Color ---------- */

  const LUMETRI_GROUPS = [
    { title: 'Basic Correction', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
    { title: 'White Balance', keys: ['temperature', 'tint'] },
    { slot: 'lumWheels' },
    { slot: 'lumCurves' },
    { title: 'Creative', keys: ['vibrance', 'saturation', 'fade', 'sharpen'] },
    { title: 'HSL Secondary', keys: ['hslHue', 'hslRange', 'hslSoft', 'hslShift', 'hslSat', 'hslLum'], hsl: true },
    { title: 'Input LUT', keys: ['lutAmount'], slotInside: 'lumLut' },
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
    const collapsed = S.lumCollapsed || {};
    let html =
      '<div class="lum-top"><span class="lum-name">Lumetri Color</span>' +
      '<span class="lum-clip">' + AVP.esc(name) + ' · ' + c.track + '</span>' +
      '<span class="lum-actions"><label class="lum-fxon"><input type="checkbox" id="lumOn"' + (fx.enabled ? ' checked' : '') + '> On</label> ' +
      '<button class="btn tiny" id="lumReset">Reset</button> <button class="btn tiny" id="lumRemove">Remove</button></span></div>';
    LUMETRI_GROUPS.forEach((g) => {
      if (g.slot) {
        html += '<div id="' + g.slot + '"></div>';
        return;
      }
      const key = g.title.toLowerCase().replace(/[^a-z]+/g, '-');
      html +=
        '<section class="lum-sec' + (collapsed[key] ? ' collapsed' : '') + '" data-sec="' + key + '">' +
        '<header class="lum-head" data-key="' + key + '"><span class="lum-tri"></span>' + g.title + '</header><div class="lum-body">';
      if (g.slotInside) html += '<div id="' + g.slotInside + '"></div>';
      if (g.hsl) {
        html += '<label class="df-check"><input type="checkbox" id="lumHsl"' + (fx.params.hslOn ? ' checked' : '') + '> HSL secondary on</label>';
      }
      html += g.keys
        .map((k) => {
          const d = AVP.effectParamDef('lumetri', k);
          return paramRow(c, 'fx:' + fx.id + ':' + k, d.label, d.def, { min: d.min, max: d.max, step: d.step || 1, unit: d.unit || '' });
        })
        .join('');
      html += '</div></section>';
    });
    html += '<div class="fx-note">Shadows, highlights, whites and blacks move tones in their own range. Use the stopwatch on any control to keyframe it.</div>';
    body.innerHTML = html;
    bindParams(body, c);
    const hslBox = $('#lumHsl');
    if (hslBox) {
      hslBox.addEventListener('change', (e) => {
        AVP.pushUndo();
        fx.params.hslOn = e.target.checked ? 1 : 0;
        AVP.refresh();
      });
    }
    if (AVP.lumetriUI) AVP.lumetriUI.mount(c.id, fx.id);
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

  function soundSlider(id, label, key, min, max, step, unit, value) {
    return (
      '<div class="fx-row"><span class="fx-label">' + label + '</span>' +
      '<input type="range" id="' + id + '" data-skey="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '<output>' + value + unit + '</output><span></span><span></span></div>'
    );
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
    const measured = m && m.lufs != null ? m.lufs.toFixed(1) + ' LUFS' : m && m.env ? 'silent' : 'not measured';
    const noise = m && m.env ? m.env.floor.toFixed(0) + ' dB' : 'not measured';
    body.innerHTML =
      '<div class="fx-head"><div class="fx-name">Essential Sound</div><div class="fx-sub">' + AVP.esc(m ? m.name : 'Audio') + ' · ' + c.track + '</div></div>' +
      '<div class="fx-group"><div class="fx-title">Audio Type</div>' +
      '<select class="wide" id="snType">' + options + '</select>' +
      '<div class="fx-note">A type sets starting values for the settings below. Adjust any of them to fine-tune.</div>' +
      '<label class="df-check"><input type="checkbox" id="snOn"' + (snd.enabled ? ' checked' : '') + '> Essential Sound enabled</label></div>' +
      '<div class="fx-group"><div class="fx-title">Loudness</div>' +
      '<label class="df-check"><input type="checkbox" id="snAuto"' + (snd.autoMatch ? ' checked' : '') + '> Auto-match loudness to target</label>' +
      soundSlider('snTarget', 'Target', 'target', -40, 0, 1, ' LUFS', snd.target) +
      '<div class="fx-kv"><span>Integrated loudness</span><b>' + measured + '</b></div></div>' +
      '<div class="fx-group"><div class="fx-title">Clean Up</div>' +
      soundSlider('snLow', 'Low cut', 'lowCut', 20, 300, 5, ' Hz', snd.lowCut) +
      soundSlider('snPres', 'Presence', 'presence', -6, 8, 0.5, ' dB', snd.presence) +
      '<label class="df-check"><input type="checkbox" id="snComp"' + (snd.compress ? ' checked' : '') + '> Compression (levels dialogue)</label>' +
      soundSlider('snNoise', 'Reduce noise', 'noiseReduce', 0, 100, 1, '%', snd.noiseReduce) +
      '<div class="fx-kv"><span>Noise floor</span><b>' + noise + '</b></div></div>' +
      '<div class="fx-group"><div class="fx-title">Space</div>' +
      soundSlider('snReverb', 'Reverb', 'reverb', 0, 100, 1, '%', snd.reverb) +
      (snd.type !== 'dialogue'
        ? soundSlider('snDuck', 'Duck under dialogue', 'duck', 0, 24, 1, ' dB', snd.duck)
        : '<div class="fx-note">Dialogue is the voice the other clips duck under, so it is never ducked itself.</div>') +
      '</div>';

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
    body.querySelectorAll('input[data-skey]').forEach((el) => {
      const key = el.dataset.skey;
      el.addEventListener('pointerdown', () => AVP.pushUndo());
      el.addEventListener('input', () => {
        setSoundField(id, { [key]: +el.value });
        el.parentElement.querySelector('output').textContent = el.value + (el.parentElement.querySelector('output').textContent.match(/[^\d.\-]+$/) || [''])[0];
      });
    });
  }

  /* ---------- Audio Clip Mixer ---------- */

  // Mixer values can be automated: a stopwatch turns keyframes on for a control. While keyframed,
  // moving the control writes a keyframe at the playhead, as clip keyframes do.
  function trackKeyed(id, key) {
    const tr = S.tracks[id];
    return !!(tr.keys && tr.keys[key] && tr.keys[key].length);
  }

  function toggleTrackKeys(id, key) {
    const tr = S.tracks[id];
    AVP.pushUndo();
    if (trackKeyed(id, key)) {
      delete tr.keys[key];
    } else {
      tr.keys = tr.keys || {};
      tr.keys[key] = [{ t: S.playhead, v: AVP.monitor.trackParam(id, key, S.playhead) }];
    }
    AVP.refresh();
  }

  // Writes a mixer value: a keyframe at the playhead when automated, otherwise the setting itself.
  function writeTrackValue(id, key, v) {
    const tr = S.tracks[id];
    if (trackKeyed(id, key)) {
      AVP.setKey(tr.keys[key], S.playhead, v);
    } else {
      tr[key] = v;
    }
  }

  function mixerStrip(id) {
    const tr = S.tracks[id];
    const db = AVP.monitor.trackParam(id, 'volume', S.playhead);
    const pan = AVP.monitor.trackParam(id, 'pan', S.playhead);
    const send = AVP.monitor.trackParam(id, 'send', S.playhead);
    const watch = (key) => '<button class="kf-watch' + (trackKeyed(id, key) ? ' on' : '') + '" data-tkf="' + id + '|' + key + '" title="Automate ' + key + '"></button>';
    return (
      '<div class="mix-strip">' +
      '<div class="mix-name' + (tr.solo ? ' soloing' : '') + '">' + id + '</div>' +
      '<div class="mix-meter"><canvas data-mixmeter="' + id + '"></canvas></div>' +
      '<div class="mix-auto">' + watch('volume') + '</div>' +
      '<input type="range" class="mix-fader" data-fader="' + id + '" min="-60" max="12" step="0.5" value="' + db + '" title="Track volume">' +
      '<div class="mix-db" data-dbfor="' + id + '">' + db.toFixed(1) + ' dB</div>' +
      '<div class="mix-knob"><span>Pan</span>' + watch('pan') +
      '<input type="range" data-pan="' + id + '" min="-100" max="100" step="1" value="' + pan + '" title="Pan"><output>' + Math.round(pan) + '</output></div>' +
      '<div class="mix-knob"><span>Send</span>' + watch('send') +
      '<input type="range" data-send="' + id + '" min="0" max="100" step="1" value="' + send + '" title="Reverb send"><output>' + Math.round(send) + '</output></div>' +
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
      '<div class="fx-note">Faders set each track level, pan places it left or right, and send feeds the room reverb. The stopwatch above a control automates it: moving the control then writes a keyframe at the playhead. M mutes and S solos a track.</div>';

    body.querySelectorAll('[data-tkf]').forEach((b) => {
      const [id, key] = b.dataset.tkf.split('|');
      b.addEventListener('click', () => toggleTrackKeys(id, key));
    });
    body.querySelectorAll('.mix-fader').forEach((inp) => {
      const id = inp.dataset.fader;
      inp.addEventListener('pointerdown', () => AVP.pushUndo());
      inp.addEventListener('input', () => {
        writeTrackValue(id, 'volume', +inp.value);
        const label = body.querySelector('[data-dbfor="' + id + '"]');
        if (label) label.textContent = (+inp.value).toFixed(1) + ' dB';
      });
    });
    body.querySelectorAll('[data-pan]').forEach((inp) => {
      const id = inp.dataset.pan;
      inp.addEventListener('pointerdown', () => AVP.pushUndo());
      inp.addEventListener('input', () => {
        writeTrackValue(id, 'pan', +inp.value);
        inp.parentElement.querySelector('output').textContent = Math.round(+inp.value);
      });
    });
    body.querySelectorAll('[data-send]').forEach((inp) => {
      const id = inp.dataset.send;
      inp.addEventListener('pointerdown', () => AVP.pushUndo());
      inp.addEventListener('input', () => {
        writeTrackValue(id, 'send', +inp.value);
        inp.parentElement.querySelector('output').textContent = Math.round(+inp.value);
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

  /* ---------- Graphics (Essential Graphics) ---------- */

  function renderGraphics() {
    const body = $('#graphicsBody');
    if (!body) return;
    const c = AVP.selectedClips()[0];
    const isShape = c && c.kind === 'shape';
    const isTitle = c && c.kind === 'title';
    const presets = AVP.TITLE_PRESETS.map(
      (p, i) => '<div class="lib-item" data-preset="' + i + '">' + AVP.esc(p.name) + '</div>'
    ).join('');
    let selected = '<div class="hint">Select a title or shape on the timeline to edit it here.</div>';
    if (isShape) {
      const sh = c.shape;
      selected =
        '<div class="fx-group"><div class="fx-title">' + (sh.type === 'ellipse' ? 'Ellipse' : 'Rectangle') + '</div>' +
        '<div class="fx-kv"><span>Fill</span><input type="color" data-gshape="fill" value="' + sh.fill + '"></div>' +
        '<div class="fx-kv"><span>Stroke</span><input type="color" data-gshape="stroke" value="' + sh.stroke + '"></div>' +
        soundSlider('gStroke', 'Stroke width', 'strokeWidth', 0, 40, 1, ' px', sh.strokeWidth).replace('data-skey="strokeWidth"', 'data-gshape="strokeWidth"') +
        soundSlider('gW', 'Width', 'width', 1, 100, 1, '%', sh.width).replace('data-skey="width"', 'data-gshape="width"') +
        soundSlider('gH', 'Height', 'height', 1, 100, 1, '%', sh.height).replace('data-skey="height"', 'data-gshape="height"') +
        (sh.type === 'rect' ? soundSlider('gR', 'Corner radius', 'radius', 0, 200, 1, ' px', sh.radius).replace('data-skey="radius"', 'data-gshape="radius"') : '') +
        '</div>';
    } else if (isTitle) {
      selected =
        '<div class="fx-group"><div class="fx-title">Title text</div>' +
        '<textarea class="wide" rows="3" id="gText">' + AVP.esc(c.text.text) + '</textarea>' +
        '<div class="fx-note">Font, size, colour, outline, shadow and background are in Effect Controls.</div></div>';
    }
    body.innerHTML =
      '<div class="fx-group"><div class="fx-title">New graphic</div>' +
      '<div class="graphic-buttons">' +
      '<button class="btn" id="gNewText">Text</button>' +
      '<button class="btn" id="gNewRect">Rectangle</button>' +
      '<button class="btn" id="gNewEllipse">Ellipse</button></div>' +
      '<div class="fx-note">Adds the graphic at the playhead on the target video track.</div></div>' +
      '<div class="fx-group"><div class="fx-title">Browse titles and lower thirds</div>' +
      '<div class="lib-list">' + presets + '</div>' +
      '<div class="fx-note">Click a preset to add it at the playhead.</div></div>' +
      '<div class="fx-group"><div class="fx-title">Selected graphic</div></div>' +
      selected;

    $('#gNewText').addEventListener('click', () => AVP.edit.placeTitle({ track: S.target.video, start: S.playhead, preset: 0, mode: 'overwrite' }));
    $('#gNewRect').addEventListener('click', () => AVP.edit.placeShape({ track: S.target.video, start: S.playhead, type: 'rect', mode: 'overwrite' }));
    $('#gNewEllipse').addEventListener('click', () => AVP.edit.placeShape({ track: S.target.video, start: S.playhead, type: 'ellipse', mode: 'overwrite' }));
    body.querySelectorAll('[data-preset]').forEach((el) =>
      el.addEventListener('click', () => AVP.edit.placeTitle({ track: S.target.video, start: S.playhead, preset: +el.dataset.preset, mode: 'overwrite' }))
    );
    if (isShape) {
      const id = c.id;
      body.querySelectorAll('[data-gshape]').forEach((el) => {
        const key = el.dataset.gshape;
        el.addEventListener('pointerdown', () => AVP.pushUndo());
        el.addEventListener('input', () => {
          const cur = AVP.findClip(id);
          if (!cur) return;
          cur.shape[key] = el.type === 'color' ? el.value : +el.value;
          if (el.type !== 'color') el.parentElement.querySelector('output').textContent = el.value + (el.parentElement.querySelector('output').textContent.match(/[^\d.\-]+$/) || [''])[0];
          AVP.monitor.draw();
        });
      });
    }
    if (isTitle) {
      const id = c.id;
      const text = $('#gText');
      text.addEventListener('pointerdown', () => AVP.pushUndo());
      text.addEventListener('input', () => {
        const cur = AVP.findClip(id);
        if (cur) {
          cur.text.text = text.value;
          AVP.timeline.render();
          AVP.monitor.draw();
        }
      });
    }
  }

  // Refreshes the side lists that depend on the project (markers, metadata).
  function renderSide() {
    if (S.leftTab === 'markers') renderMarkers();
    if (S.leftTab === 'graphics') renderGraphics();
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
    const lumBody = $('#lumetriBody');
    if (lumBody) {
      lumBody.addEventListener('click', (e) => {
        const head = e.target.closest('.lum-head');
        if (!head) return;
        S.lumCollapsed = S.lumCollapsed || {};
        const key = head.dataset.key;
        S.lumCollapsed[key] = !S.lumCollapsed[key];
        head.parentElement.classList.toggle('collapsed', !!S.lumCollapsed[key]);
      });
    }
    document.addEventListener('dblclick', (e) => {
      const inp = e.target.closest && e.target.closest('input[data-param]');
      if (!inp || inp.dataset.def === undefined) return;
      const c = AVP.selectedClips()[0];
      if (!c) return;
      AVP.pushUndo();
      writeParam(c, inp.dataset.param, +inp.dataset.def);
      AVP.refresh();
    });
  }

  AVP.panels = {
    init,
    syncPlayhead,
    renderControls,
    renderSide,
    renderLibrary,
    renderMarkers,
    renderCaptions,
    renderGraphics,
    renderInfo,
    renderLumetri,
    renderSound,
    renderMixer,
    setPanel,
    readParam,
  };
})();
