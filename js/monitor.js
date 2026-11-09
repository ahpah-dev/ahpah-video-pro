/*
 * AhPah Video Pro - Program monitor: playback engine, preview drawing, PNG frame and
 * WebM / MP4 export.
 *
 * Each media clip gets its own HTMLMediaElement (created lazily). Every tick we look at
 * the playhead, keep the clips under it playing or seeked to the right source position,
 * and ask the compositor (render.js) to draw the frame. Audio from each element goes
 * through a Web Audio gain node, and the same graph feeds a MediaStream that the exporter
 * records.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const EPS = AVP.EPS;
  const $ = (sel) => document.querySelector(sel);

  let canvas = null;
  let ctx = null;
  let audioCtx = null;
  let streamDest = null;
  let masterGain = null; // every clip's gain feeds this, so the master meter sees the mix
  let masterAnalyser = null;
  const nodes = new Map(); // clipId -> { el?, img?, gain?, src?, mediaId, warned }
  const imageCache = new Map(); // mediaId -> HTMLImageElement
  let lastTs = 0;
  let recorder = null;
  let recChunks = [];
  let exportStart = 0;
  let exportEnd = 0;
  let savedSize = null;

  /* ---------- audio graph ---------- */

  function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  }

  function ensureNode(c) {
    let n = nodes.get(c.id);
    if (n) return n;
    const m = AVP.findMedia(c.mediaId);
    if (!m || !m.url || m.error) return null;

    if (m.type === 'image') {
      let img = imageCache.get(m.id);
      if (!img) {
        img = new Image();
        img.src = m.url;
        imageCache.set(m.id, img);
      }
      n = { img, el: null, gain: null, src: null, mediaId: m.id };
    } else {
      const el = document.createElement(m.type === 'audio' ? 'audio' : 'video');
      el.preload = 'auto';
      el.playsInline = true;
      el.src = m.url;
      // Video elements finish loading or seeking after we set them up: redraw when they do.
      el.addEventListener('loadeddata', () => markDirty());
      el.addEventListener('seeked', () => markDirty());
      el.addEventListener('error', () => {
        if (!n.warned) {
          n.warned = true;
          AVP.toast(`Cannot play "${m.name}". Check the file format for this browser.`, 'error');
        }
      });
      let gain = null;
      let src = null;
      let hp = null;
      let eq = null;
      let comp = null;
      if (audioCtx) {
        try {
          src = audioCtx.createMediaElementSource(el);
          hp = audioCtx.createBiquadFilter(); // Essential Sound: low cut
          hp.type = 'highpass';
          eq = audioCtx.createBiquadFilter(); // Essential Sound: presence
          eq.type = 'peaking';
          eq.frequency.value = 3000;
          eq.Q.value = 1;
          comp = audioCtx.createDynamicsCompressor(); // Essential Sound: compression
          gain = audioCtx.createGain();
          src.connect(hp);
          hp.connect(eq);
          eq.connect(comp);
          comp.connect(gain);
        } catch (err) {
          gain = null;
          src = null;
          hp = null;
          eq = null;
          comp = null;
        }
      }
      n = { el, img: null, gain, src, hp, eq, comp, bus: null, mediaId: m.id, warned: false };
    }
    nodes.set(c.id, n);
    return n;
  }

  // The moment of the media file that clip c shows at the playhead.
  function wantTime(c) {
    return c.inPoint + AVP.srcOffset(c, AVP.clamp(S.playhead - c.start, 0, c.duration));
  }

  const frameReady = (el) => el.readyState >= 2 && el.videoWidth > 0;

  /*
   * Source for the compositor: video element or still image for a media clip.
   * Splitting a clip or adding a transition gives a clip a new element that has not loaded or reached its
   * moment yet. Drawing it then shows nothing (black) or the first frame of the file. So when this clip's
   * own element is not ready, the picture comes from the best other element of the same file (the other
   * half of a split is already at the right place), then from the last snapshot of this clip, and only
   * then from the element itself.
   */
  function getSource(c) {
    if (c.kind !== 'media') return null;
    const n = ensureNode(c);
    if (!n || !n.el || (AVP.offlineExport && AVP.offlineExport.active())) return n; // an export waits for the exact frame
    const want = wantTime(c);
    const miss = (x) => (frameReady(x.el) ? Math.abs(x.el.currentTime - want) : Infinity);
    let best = n;
    let bestMiss = miss(n);
    if (bestMiss > 0.2) {
      for (const o of nodes.values()) {
        if (o === n || !o.el || o.mediaId !== n.mediaId) continue;
        const e = miss(o);
        if (e < bestMiss - 0.05) {
          best = o;
          bestMiss = e;
        }
      }
    }
    if (bestMiss === Infinity && n.snap) return { canvas: n.snap, el: null, img: null };
    return best;
  }

  // Keeps a small, recent picture of the clip, to hold on screen while its element is busy.
  function keepSnapshot(n, now) {
    if (!n.el || !frameReady(n.el) || n.el.seeking || now - (n.snapAt || 0) < 250) return;
    const w = Math.min(480, n.el.videoWidth);
    const h = Math.max(1, Math.round((w * n.el.videoHeight) / n.el.videoWidth));
    if (!n.snap) n.snap = document.createElement('canvas');
    if (n.snap.width !== w || n.snap.height !== h) {
      n.snap.width = w;
      n.snap.height = h;
    }
    try {
      n.snap.getContext('2d').drawImage(n.el, 0, 0, w, h);
      n.snapAt = now;
    } catch (err) {
      /* the element cannot be drawn right now */
    }
  }

  // Reverb room, shared by every send: a synthetic impulse response (see js/loudness.js).
  let aux = null;
  function auxInput() {
    if (!audioCtx) return null;
    if (!aux) {
      const input = audioCtx.createGain();
      const conv = audioCtx.createConvolver();
      const ir = AVP.loudness.roomImpulse(audioCtx.sampleRate, 1.6, 3.5);
      const buf = audioCtx.createBuffer(2, ir.left.length, audioCtx.sampleRate);
      buf.getChannelData(0).set(ir.left);
      buf.getChannelData(1).set(ir.right);
      conv.buffer = buf;
      input.connect(conv);
      conv.connect(masterGain || audioCtx.destination);
      if (streamDest) conv.connect(streamDest);
      aux = { input };
    }
    return aux.input;
  }

  // One bus per track: fader (volume), pan, a send to the room, and a meter. Every clip on the
  // track feeds the bus, and the bus feeds the master output, the meter and the export.
  const buses = new Map();
  function trackBus(id) {
    if (!audioCtx) return null;
    let b = buses.get(id);
    if (!b) {
      const input = audioCtx.createGain();
      const pan = audioCtx.createStereoPanner();
      const send = audioCtx.createGain();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      input.connect(pan);
      pan.connect(masterGain || audioCtx.destination);
      if (streamDest) pan.connect(streamDest);
      pan.connect(analyser);
      input.connect(send);
      send.connect(auxInput());
      b = { input, pan, send, analyser };
      buses.set(id, b);
    }
    return b;
  }

  // Keeps a clip's gain connected to its track's bus, and to its own reverb send.
  function connectBus(n, c) {
    if (!n.gain) return;
    const bus = trackBus(c.track);
    if (!bus || n.bus === bus) return;
    n.gain.disconnect();
    n.gain.connect(bus.input);
    if (!n.send) n.send = audioCtx.createGain();
    n.gain.connect(n.send);
    n.send.connect(auxInput());
    n.bus = bus;
  }

  // Essential Sound: low cut, presence, compression and reverb send for a clip's nodes.
  function applySound(n, c) {
    if (!n.hp) return;
    const snd = AVP.soundOf(c);
    n.hp.frequency.value = snd.enabled ? Math.max(20, snd.lowCut) : 20;
    n.eq.gain.value = snd.enabled ? snd.presence : 0;
    if (snd.enabled && snd.compress) {
      n.comp.threshold.value = -24;
      n.comp.ratio.value = 3;
      n.comp.knee.value = 12;
      n.comp.attack.value = 0.005;
      n.comp.release.value = 0.25;
    } else {
      n.comp.threshold.value = 0;
      n.comp.ratio.value = 1;
    }
    if (n.send) n.send.gain.value = snd.enabled ? AVP.clamp((snd.reverb || 0) / 100, 0, 1) * 0.8 : 0;
  }

  // Mixer value for a track at absolute time t: the static setting, or keyframes when automated.
  function trackParam(id, key, t) {
    const tr = S.tracks[id];
    if (!tr) return 0;
    const base = tr[key] == null ? 0 : tr[key];
    return AVP.evalKeys(tr.keys && tr.keys[key], t, base);
  }

  // Track faders, pan and sends into the buses. Runs every tick, so automation plays back.
  function syncBuses() {
    if (!audioCtx) return;
    const t = S.playhead;
    Object.keys(S.tracks).forEach((id) => {
      const b = trackBus(id);
      if (!b) return;
      b.input.gain.value = Math.pow(10, trackParam(id, 'volume', t) / 20);
      b.pan.pan.value = AVP.clamp(trackParam(id, 'pan', t) / 100, -1, 1);
      b.send.gain.value = AVP.clamp(trackParam(id, 'send', t) / 100, 0, 1);
    });
  }

  // Essential Sound loudness match: moves the clip towards its target LUFS.
  function autoGain(c) {
    const snd = AVP.soundOf(c);
    if (!snd.enabled || !snd.autoMatch) return 1;
    const m = AVP.findMedia(c.mediaId);
    if (!m || m.lufs == null) return 1;
    return Math.pow(10, AVP.clamp(snd.target - m.lufs, -12, 12) / 20);
  }

  // Essential Sound noise reduction: a gate that closes between speech. The threshold sits above
  // the clip's measured noise floor, and the gate attenuates by up to 40 dB when it closes.
  function gateFactor(c, t) {
    const snd = AVP.soundOf(c);
    if (!snd.enabled || !(snd.noiseReduce > 0)) return 1;
    const m = AVP.findMedia(c.mediaId);
    if (!m || !m.env) return 1;
    const src = c.inPoint + AVP.srcOffset(c, Math.max(0, t - c.start));
    const idx = AVP.clamp(Math.floor(src / m.env.hop), 0, m.env.env.length - 1);
    const level = m.env.env[idx];
    const k = snd.noiseReduce / 100;
    const threshold = m.env.floor + k * 25;
    return level >= threshold ? 1 : Math.pow(10, (-k * 40) / 20);
  }

  // Dialogue ducking: a clip with a duck setting is lowered while any dialogue clip is playing.
  function duckFactor(c, t) {
    const snd = AVP.soundOf(c);
    if (!snd.enabled || !(snd.duck > 0) || snd.type === 'dialogue') return 1;
    const talking = S.clips.some((o) => {
      if (!o.enabled || AVP.trackKind(o.track) !== 'audio') return false;
      const s = AVP.soundOf(o);
      return s.enabled && s.type === 'dialogue' && t >= o.start && t < o.start + o.duration;
    });
    return talking ? Math.pow(10, -snd.duck / 20) : 1;
  }

  // Video tracks make no sound. A video's sound is the audio clip made from the same file, on an audio
  // track. So a clip on a video track is always silent here: unlinking, moving or overwriting its audio
  // clip can never leave the video's own sound playing next to the audio clip.
  function silentPicture(c) {
    return !AVP.clipMakesSound(c);
  }

  // Volume for a clip right now: keyframed volume x constant-gain fades x track mute.
  function gainFor(c, R, t) {
    const tr = S.tracks[c.track];
    if (!tr || !c.enabled || tr.muted) return 0;
    // Solo: when any audio track is soloed, the other audio tracks are silent.
    if (tr.kind === 'audio' && !tr.solo && Object.keys(S.tracks).some((id) => S.tracks[id].kind === 'audio' && S.tracks[id].solo)) return 0;
    if (silentPicture(c)) return 0;
    return Math.max(0, (AVP.propAt(c, 'volume', t) / 100) * AVP.audioRamp(R, t) * autoGain(c) * gateFactor(c, t) * duckFactor(c, t));
  }

  // The gain a clip plays at at time t, exactly as the live mix uses it. Used by the offline export.
  function clipGainAt(c, t) {
    const list = S.clips.filter((o) => o.track === c.track).sort((a, b) => a.start - b.start);
    return gainFor(c, AVP.roleWindows(c, list), t);
  }

  function cleanupNodes() {
    if (!nodes.size) return;
    const alive = new Set(S.clips.map((c) => c.id));
    for (const [id, n] of nodes) {
      if (alive.has(id)) continue;
      if (n.el) {
        n.el.pause();
        n.el.removeAttribute('src');
        n.el.load();
      }
      if (n.gain) n.gain.disconnect();
      if (n.send) n.send.disconnect();
      if (n.comp) n.comp.disconnect();
      if (n.eq) n.eq.disconnect();
      if (n.hp) n.hp.disconnect();
      if (n.src) n.src.disconnect();
      nodes.delete(id);
    }
  }

  /* ---------- playback ---------- */

  // Clips visible at time t, with their transition windows (from the cached index).
  function activeAt(t) {
    const out = [];
    const idx = AVP.trackIndex();
    for (const id of S.trackOrder) {
      const tr = idx[id];
      if (!tr) continue;
      for (const { c, R } of tr.items) {
        if (AVP.isVisibleAt(R, t)) out.push({ c, R, track: tr });
      }
    }
    return out;
  }

  // Keeps media elements in step with the playhead.
  const PREWARM_SECONDS = 3; // how far ahead the next pictures are made ready
  const PREWARM_MAX = 4; // at most this many at once
  let cleanedVersion = -1;
  function sync() {
    if (AVP.offlineExport && AVP.offlineExport.active()) return; // an offline export moves the media itself
    syncBuses();
    if (cleanedVersion !== AVP.dataVersion) {
      cleanupNodes();
      cleanedVersion = AVP.dataVersion;
    }
    const t = S.playhead;
    const forward = S.playing && S.playDir > 0;
    const activeIds = new Set();

    for (const { c, R, track } of activeAt(t)) {
      activeIds.add(c.id);
      if (c.kind !== 'media') continue;
      const n = ensureNode(c);
      if (!n) continue;
      if (n.gain) {
        n.gain.gain.setTargetAtTime(gainFor(c, R, t), audioCtx.currentTime, 0.03);
        connectBus(n, c);
        applySound(n, c);
      }
      if (!n.el) continue;
      // Belt and braces: the element of a picture clip is muted, whatever the audio graph is doing.
      const silent = silentPicture(c);
      if (n.el.muted !== silent) n.el.muted = silent;

      const el = n.el;
      const sp = AVP.speedAt(c, t - c.start); // changes moment to moment on a speed ramp
      const rate = AVP.clamp(sp, 0.0625, 16);
      if (Math.abs(el.playbackRate - rate) > 0.002) el.playbackRate = rate;
      // A ramp is heard at the speed it plays at, as in the export (no pitch correction).
      if (AVP.hasRamp(c) && el.preservesPitch !== false) el.preservesPitch = false;
      const target = Math.max(0, c.inPoint + AVP.srcOffset(c, t - c.start));
      if (forward && track) {
        if (el.paused) {
          if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - target) > Math.max(0.12, 0.3 * sp)) {
          el.currentTime = target;
        }
      } else {
        // Paused (scrubbing or stepping): seek to the playhead. A newer seek replaces one still in
        // progress, so the picture follows the pointer; seeks are limited to about 12 a second.
        if (!el.paused) el.pause();
        const now = performance.now();
        if (Math.abs(el.currentTime - target) > 0.02 && (!el.seeking || now - (n.seekAt || 0) > 80)) {
          el.currentTime = target;
          n.seekAt = now;
        }
      }
    }

    for (const [id, n] of nodes) {
      if (!activeIds.has(id) && n.el && !n.el.paused) n.el.pause();
    }

    // Get the next pictures ready before they are needed: load them and park each on its first frame, so a
    // cut, a split or a transition does not start from an element that is still loading.
    const dir = S.playing && S.playDir < 0 ? -1 : 1;
    const coming = [];
    const idx = AVP.trackIndex();
    for (const id of S.trackOrder) {
      const tr = idx[id];
      if (!tr || tr.kind !== 'video') continue;
      for (const { c, R } of tr.items) {
        if (c.kind !== 'media' || activeIds.has(c.id) || !c.enabled) continue;
        const gap = dir > 0 ? R.ext0 - t : t - R.ext1;
        if (gap > 0 && gap < PREWARM_SECONDS) coming.push({ c, R, gap });
      }
    }
    coming.sort((a, b) => a.gap - b.gap);
    for (const { c, R } of coming.slice(0, PREWARM_MAX)) {
      const n = ensureNode(c);
      if (!n || !n.el) continue;
      if (!n.el.paused) n.el.pause();
      const at = dir > 0 ? R.ext0 : R.ext1;
      const target = Math.max(0, c.inPoint + AVP.srcOffset(c, AVP.clamp(at - c.start, 0, c.duration)));
      if (!n.el.seeking && Math.abs(n.el.currentTime - target) > 0.05) n.el.currentTime = target;
    }
    const now = performance.now();
    for (const id of activeIds) {
      const n = nodes.get(id);
      if (n) keepSnapshot(n, now);
    }
  }

  // Redraws are event-driven: while playing, every tick; otherwise only after a change
  // (a state edit, a media load or a seek) so an idle editor costs almost nothing.
  let dirty = 0;
  let lastDrawnT = NaN; // playhead time at the last check, so any move of the playhead is drawn
  function markDirty(ticks) {
    dirty = Math.max(dirty, ticks || 3);
  }

  // Sets the preview canvas to the chosen fraction of the sequence size. Export uses full size.
  function applyPreview() {
    if (!canvas || S.exporting) return;
    const scale = S.previewScale || 0.5;
    const w = Math.max(16, Math.round(S.seqWidth * scale));
    const h = Math.max(16, Math.round(S.seqHeight * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    markDirty(4);
  }

  function setPreviewScale(scale) {
    S.previewScale = scale;
    applyPreview();
    AVP.toast(`Playback resolution: ${Math.round(scale * 100)}%`);
  }

  function draw() {
    if (!ctx) return;
    AVP.render.frame(ctx, S.playhead, getSource);
    dirty = 0;
  }

  // Playback is paced to about 60 draws a second; changes are always drawn at once.
  let lastDrawAt = 0;
  function drawIfNeeded(now) {
    if (dirty > 0) {
      dirty--;
    } else if (!S.playing || now - lastDrawAt < 16) {
      return;
    }
    lastDrawAt = now;
    draw();
  }

  function updateTimecodes() {
    const tcText = AVP.fmtTC(S.playhead);
    const tc = $('#progTC');
    if (tc && tc.textContent !== tcText) tc.textContent = tcText;
    const durText = `Duration ${AVP.fmtTC(AVP.seqEnd())}`;
    const dur = $('#seqDur');
    if (dur && dur.textContent !== durText) dur.textContent = durText;
    const pp = $('#pPlay');
    if (pp) {
      const playingFwd = S.playing && S.playDir > 0;
      if (pp.dataset.icon !== (playingFwd ? 'pause' : 'play')) {
        pp.dataset.icon = playingFwd ? 'pause' : 'play';
        AVP.icons.apply(pp);
      }
      pp.classList.toggle('active', playingFwd);
    }
    const hint = $('#progHint');
    if (hint) hint.classList.toggle('hidden', AVP.seqEnd() > 0);
  }

  /*
   * The loop is driven by requestAnimationFrame, with a timer fallback: browsers pause
   * rAF in hidden or unfocused windows, and playback must keep moving in those cases.
   * Whichever fires first runs the tick; the other is ignored.
   */
  // Each schedule() gets a token. Only the callback that matches the latest token runs, so
  // the rAF and timer callbacks can never start a second chain of ticks.
  let scheduleToken = 0;
  function schedule() {
    const id = ++scheduleToken;
    let ran = false;
    const run = (ts) => {
      if (ran || id !== scheduleToken) return;
      ran = true;
      tick(typeof ts === 'number' ? ts : performance.now());
    };
    requestAnimationFrame(run);
    setTimeout(() => run(performance.now()), 40);
  }

  function tick(ts) {
    try {
      step(ts);
    } catch (err) {
      console.error('AhPah Video Pro: frame error', err);
    }
    schedule();
  }

  function step(ts) {
    if (S.exporting) {
      // During an export the export clock (exportTick) moves the playhead and draws each frame.
      AVP.timeline.updatePlayhead();
      updateTimecodes();
      updateExportUI();
      lastTs = ts;
      return;
    }
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.25) : 0;
    lastTs = ts;

    if (S.playing) {
      S.playhead += S.playDir * dt;
      const end = S.exporting ? exportEnd : playEnd();
      if (S.playDir > 0 && S.playhead >= end) {
        S.playhead = end;
        if (S.exporting) finishExport();
        else stop();
      } else if (S.playDir < 0 && S.playhead <= 0) {
        S.playhead = 0;
        stop();
      }
    }

    sync();
    // Any change of the playhead (scrubbing, stepping, clicking the ruler) redraws the picture at once.
    if (S.playhead !== lastDrawnT) {
      lastDrawnT = S.playhead;
      markDirty(2);
      if (AVP.panels && AVP.panels.syncPlayhead) AVP.panels.syncPlayhead();
    }
    drawIfNeeded(performance.now());
    AVP.timeline.updatePlayhead();
    updateTimecodes();
    if (S.exporting) updateExportUI();
    // next frame is scheduled by tick()
  }

  // Playback stops at the end of the work area when one is set, otherwise the sequence end.
  function playEnd() {
    if (S.workOut != null && S.workOut > 0) return Math.min(S.workOut, AVP.seqEnd());
    return AVP.seqEnd();
  }

  function stop() {
    S.playing = false;
    S.playDir = 0;
  }

  function play(dir) {
    if (AVP.seqEnd() <= 0) {
      if (S.srcMediaId && dir > 0) {
        AVP.bin.togglePlay();
        return AVP.toast('Timeline is empty: playing the Source clip. Press , to insert it on the timeline.');
      }
      return AVP.toast('Timeline is empty. Drag a clip from the Project panel onto a track first.', 'warn');
    }
    const end = playEnd();
    if (dir > 0 && S.playhead >= end - EPS) S.playhead = S.workIn != null && S.workIn < end ? S.workIn : 0;
    if (dir < 0 && S.playhead <= 0) S.playhead = end;
    resumeAudio();
    S.playing = true;
    S.playDir = dir;
  }

  function playPause() {
    if (S.playing && S.playDir > 0) stop();
    else play(1);
  }

  function stepFrames(n) {
    stop();
    S.playhead = Math.max(0, AVP.snapFrame(S.playhead) + n / S.fps);
  }

  function goTo(t) {
    stop();
    S.playhead = Math.max(0, AVP.snapFrame(t));
  }

  // Jump to the previous / next clip boundary or marker.
  function jumpEdit(dir) {
    const pts = [0];
    S.clips.forEach((c) => pts.push(c.start, c.start + c.duration));
    S.markers.forEach((m) => pts.push(m.t));
    const t = S.playhead;
    const cands = dir > 0 ? pts.filter((p) => p > t + EPS) : pts.filter((p) => p < t - EPS);
    if (!cands.length) return;
    goTo(dir > 0 ? Math.min(...cands) : Math.max(...cands));
  }

  /* ---------- export ---------- */

  function pickMime(format) {
    if (typeof MediaRecorder === 'undefined') return null;
    const list =
      format === 'mp4'
        ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']
        : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return list.find((m) => MediaRecorder.isTypeSupported(m)) || null;
  }

  function updateExportUI() {
    const span = Math.max(EPS, exportEnd - exportStart);
    const pct = Math.min(100, Math.max(0, ((S.playhead - exportStart) / span) * 100));
    const fill = $('#exportFill');
    const text = $('#exportText');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    let note = '';
    if (frameStats.ticks > 40 && frameStats.late / frameStats.ticks > 0.1) {
      note = ' · stuttering: this computer is busy. For smooth output, export at a smaller frame size';
    }
    if (text) text.textContent = `Exporting… ${Math.round(pct)}%  (Esc to stop)${note}`;
  }

  /*
   * opts: { format: 'webm'|'mp4', width, height, bitrate (Mbps), range: 'sequence'|'work' }
   *
   * Export runs in real time, driven by its own clock. A worker timer (not throttled in background tabs)
   * ticks at the frame rate; each tick sets the playhead from the clock, draws that frame once, and asks the
   * recorder for exactly that frame. Frames are only drawn when the media for that moment is ready, so the
   * picture never shows a half-seeked frame. Audio plays from the same clock through the normal graph.
   */
  let exportTrack = null; // the canvas video track the frames are pushed into
  let manualFrames = false; // true when the track accepts requestFrame (one captured frame per drawn frame)
  let exportClock0 = 0; // performance.now() when the export clock started
  let exportTicker = null;
  let notReadySince = 0; // when the media first stopped being ready (0 when it is ready)
  let recStarted = false;
  let recError = null;
  // How evenly the frames are being captured. A frame more than half a frame late counts as late.
  let frameStats = { ticks: 0, late: 0, lastAt: 0, worstMs: 0 };

  // A ticker that keeps running in background tabs. Falls back to setInterval if workers cannot run.
  function createTicker(ms, onTick) {
    let worker = null;
    let url = null;
    let timer = null;
    const useTimer = () => {
      if (!timer) timer = setInterval(onTick, ms);
    };
    try {
      url = URL.createObjectURL(
        new Blob(
          [
            'let id = null;' +
              'self.onmessage = (e) => {' +
              '  clearInterval(id);' +
              '  if (e.data === "stop") { self.close(); return; }' +
              '  id = setInterval(() => self.postMessage(0), ' + Math.round(ms) + ');' +
              '};',
          ],
          { type: 'text/javascript' }
        )
      );
      worker = new Worker(url);
      worker.onmessage = onTick;
      worker.onerror = () => {
        // The worker failed while running: carry on on the page's own timer.
        try {
          worker.terminate();
        } catch (e) {
          /* already stopped */
        }
        worker = null;
        useTimer();
      };
      worker.postMessage('start');
    } catch (e) {
      worker = null;
      useTimer();
    }
    return {
      stop() {
        if (worker) {
          try {
            worker.postMessage('stop');
            worker.terminate();
          } catch (e) {
            /* already stopped */
          }
          worker = null;
        }
        if (timer) clearInterval(timer);
        timer = null;
        if (url) URL.revokeObjectURL(url);
        url = null;
      },
    };
  }

  // True when every video that should be showing at time t has its frame ready.
  function mediaReady(t) {
    for (const { c, track } of activeAt(t)) {
      if (c.kind !== 'media' || !track) continue;
      const n = nodes.get(c.id);
      if (!n || !n.el) continue;
      if (n.el.readyState < 2 || n.el.seeking) return false;
    }
    return true;
  }

  // Waits (keeping the media moving to t) until the media is ready, or until ms have passed.
  function waitReady(t, ms) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const poll = () => {
        if (!S.exporting) return resolve();
        sync();
        if (mediaReady(t) || performance.now() - t0 > ms) return resolve();
        setTimeout(poll, 40);
      };
      poll();
    });
  }

  // True when the recording opens with a video track that has a picture size.
  function blobHasVideo(blob) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(blob);
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        v.removeAttribute('src');
        v.load();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 8000);
      v.muted = true;
      v.preload = 'metadata';
      v.onloadedmetadata = () => finish(v.videoWidth > 0);
      v.onerror = () => finish(false);
      v.src = url;
    });
  }

  // Sends the picture at time t a few times before the clock starts. A recording whose first frames arrive
  // one at a time can come out unreadable (short clips show it most), so the encoder gets a steady start.
  function primeFrames(t) {
    for (let i = 0; i < 10; i++) {
      AVP.render.frame(ctx, t, getSource);
      if (manualFrames && exportTrack) exportTrack.requestFrame();
    }
  }

  // One export frame: move the playhead to the clock, draw it once, and capture it.
  function exportTick() {
    if (!S.exporting || !recStarted) return;
    const now = performance.now();
    const frameMs = 1000 / Math.max(1, S.fps);
    if (frameStats.lastAt) {
      const gap = now - frameStats.lastAt;
      frameStats.ticks += 1;
      if (gap > frameMs * 1.5) frameStats.late += 1;
      frameStats.worstMs = Math.max(frameStats.worstMs, gap);
    }
    frameStats.lastAt = now;
    const t = Math.min(exportEnd, exportStart + (now - exportClock0) / 1000);
    S.playhead = t;
    sync();
    let draw = mediaReady(t);
    if (draw) notReadySince = 0;
    else {
      if (!notReadySince) notReadySince = now;
      // Hold the last picture while media catches up, but do not stall forever on media that cannot play.
      draw = now - notReadySince > 1500;
    }
    if (draw) AVP.render.frame(ctx, t, getSource);
    if (manualFrames && exportTrack) exportTrack.requestFrame();
    if (t >= exportEnd - 1e-6) finishExport();
  }

  function restoreCanvasSize() {
    if (savedSize) {
      canvas.width = savedSize.w;
      canvas.height = savedSize.h;
      savedSize = null;
    }
  }

  // Puts the preview canvas and the monitor back the way they were after an export.
  function restoreAfterExport() {
    restoreCanvasSize();
    const ov = $('#exportOverlay');
    if (ov) ov.classList.add('hidden');
  }

  function startExport(opts) {
    if (S.exporting) return;
    const end = AVP.seqEnd();
    if (end <= 0) return AVP.toast('Nothing to export. Add clips to the timeline first.', 'warn');
    opts = Object.assign({ format: 'webm', width: S.seqWidth, height: S.seqHeight, bitrate: 8, range: 'sequence' }, opts || {});
    if (opts.format === 'mp4' && AVP.offlineExport && AVP.offlineExport.supported()) {
      let s0 = 0;
      let s1 = end;
      if (opts.range === 'work') {
        s0 = S.workIn != null ? Math.max(0, S.workIn) : 0;
        s1 = S.workOut != null ? Math.min(end, S.workOut) : end;
        if (s1 - s0 < 0.1) return AVP.toast('The work area is empty', 'warn');
      }
      return AVP.offlineExport.run({ start: s0, stop: s1, width: opts.width, height: opts.height, bitrate: opts.bitrate, fps: S.fps });
    }
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
      return AVP.toast('This browser cannot record video. Try Chrome, Edge or Firefox.', 'error');
    }
    const mime = pickMime(opts.format);
    if (!mime) return AVP.toast('This browser cannot record ' + opts.format.toUpperCase() + '. Choose WebM.', 'error');

    let start = 0;
    let stopAt = end;
    if (opts.range === 'work') {
      start = S.workIn != null ? Math.max(0, S.workIn) : 0;
      stopAt = S.workOut != null ? Math.min(end, S.workOut) : end;
      if (stopAt - start < 0.1) return AVP.toast('The work area is empty', 'warn');
    }

    // H.264 and most encoders need even frame sizes.
    const w = Math.max(2, Math.floor(opts.width / 2) * 2);
    const h = Math.max(2, Math.floor(opts.height / 2) * 2);
    savedSize = { w: canvas.width, h: canvas.height };
    canvas.width = w;
    canvas.height = h;

    // Manual capture: a frame is recorded only when requested, so the file has one frame per drawn frame.
    let cs = canvas.captureStream(0);
    exportTrack = cs.getVideoTracks()[0] || null;
    manualFrames = !!(exportTrack && typeof exportTrack.requestFrame === 'function');
    if (!manualFrames) {
      cs = canvas.captureStream(S.fps);
      exportTrack = cs.getVideoTracks()[0] || null;
    }
    const audio = streamDest ? streamDest.stream.getAudioTracks() : [];
    if (!audio.length) AVP.toast('No sound will be recorded: audio is not available in this browser.', 'warn');
    const tracks = (exportTrack ? [exportTrack] : []).concat(audio);

    let rec;
    try {
      rec = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime,
        videoBitsPerSecond: Math.round(opts.bitrate * 1000000),
        audioBitsPerSecond: 160000,
      });
    } catch (err) {
      restoreAfterExport();
      return AVP.toast('Could not start recording: ' + err.message, 'error');
    }
    recorder = rec;
    recChunks = [];
    recStarted = false;
    recError = null;
    frameStats = { ticks: 0, late: 0, lastAt: 0, worstMs: 0 };
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) recChunks.push(ev.data);
    };
    recorder.onerror = (ev) => {
      recError = (ev.error && ev.error.message) || 'the recorder stopped unexpectedly';
      finishExport();
    };
    const attempt = (opts && opts._attempt) || 1;
    recorder.onstop = () => {
      const type = (recorder && recorder.mimeType) || mime;
      const isMp4 = type.indexOf('mp4') >= 0;
      const blob = new Blob(recChunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
      const ext = isMp4 ? 'mp4' : 'webm';
      recorder = null;
      restoreAfterExport();
      const save = (note) => {
        AVP.download(blob, `${AVP.safeName(S.projectName)}.${ext}`);
        const mb = (blob.size / (1024 * 1024)).toFixed(1);
        if (recError) AVP.toast(`Export stopped early (${recError}). Saved ${ext.toUpperCase()}, ${mb} MB.`, 'warn');
        else if (note) AVP.toast(`Saved ${ext.toUpperCase()}, ${mb} MB. ${note}`, 'warn');
        else if (frameStats.ticks && frameStats.late / frameStats.ticks > 0.05) {
          AVP.toast(`Export saved as ${ext.toUpperCase()}, ${mb} MB. ${frameStats.late} of ${frameStats.ticks} frames were late, so it may stutter. Export at a smaller frame size for smooth output.`, 'warn');
        } else AVP.toast(`Export saved as ${ext.toUpperCase()}, ${mb} MB`, 'ok');
      };
      if (!blob.size) return AVP.toast('The export produced no data. Try again, or choose another format.', 'error');
      if (recError) return save();
      // A finished file must have a readable video track. If the recorder wrote none, record again.
      blobHasVideo(blob).then((ok) => {
        if (ok) return save();
        if (attempt < 3) {
          AVP.toast(`The browser did not write the video (attempt ${attempt} of 3). Recording again.`, 'warn');
          startExport(Object.assign({}, opts, { _attempt: attempt + 1 }));
          return;
        }
        save('This browser could not read the video back. If it will not play, export as WebM.');
      });
    };

    exportStart = start;
    exportEnd = stopAt;
    S.exporting = true;
    stop();
    S.playhead = start;
    S.playing = true; // lets sync() start the media, in step with the export clock
    S.playDir = 1;
    resumeAudio();
    const ov = $('#exportOverlay');
    if (ov) ov.classList.remove('hidden');
    AVP.toast('Exporting in real time. Keep this window open while it runs.');

    // Wait for the picture at the start (the media may still be loading) before the clock begins.
    const audioWait = audioCtx && audioCtx.state === 'suspended' ? audioCtx.resume().catch(() => {}) : Promise.resolve();
    Promise.all([audioWait, waitReady(start, 4000)]).then(() => {
      if (!S.exporting) return restoreAfterExport(); // cancelled while waiting
      recStarted = true;
      recorder.start(1000);
      primeFrames(start);
      exportClock0 = performance.now();
      notReadySince = 0;
      exportTicker = createTicker(1000 / Math.max(1, S.fps), exportTick);
      exportTick();
    });
  }

  function finishExport() {
    if (AVP.offlineExport && AVP.offlineExport.active()) return AVP.offlineExport.cancel();
    if (!S.exporting) return;
    S.exporting = false;
    if (exportTicker) {
      exportTicker.stop();
      exportTicker = null;
    }
    stop();
    for (const n of nodes.values()) {
      if (n.el && !n.el.paused) n.el.pause();
    }
    if (!recStarted || !recorder) {
      // Cancelled before recording began: there is nothing to save.
      recorder = null;
      restoreAfterExport();
      return;
    }
    if (recorder.state !== 'inactive') {
      // Send the last picture, then stop. onstop saves the file.
      if (manualFrames && exportTrack) exportTrack.requestFrame();
      recorder.stop();
    }
  }

  // Renders the frame at the playhead to a PNG file.
  function exportFrame() {
    const off = document.createElement('canvas');
    off.width = S.seqWidth;
    off.height = S.seqHeight;
    const octx = off.getContext('2d');
    sync();
    AVP.render.frame(octx, S.playhead, getSource);
    off.toBlob((blob) => {
      if (!blob) return AVP.toast('Could not create the image', 'error');
      const name = `${AVP.safeName(S.projectName)} ${AVP.fmtTC(S.playhead).replace(/:/g, '-')}.png`;
      AVP.download(blob, name);
      AVP.toast('Frame saved as PNG', 'ok');
    }, 'image/png');
  }

  /* ---------- init ---------- */

  function init() {
    canvas = $('#prog');
    ctx = canvas.getContext('2d');
    applyPreview();
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      streamDest = audioCtx.createMediaStreamDestination();
      masterGain = audioCtx.createGain();
      masterAnalyser = audioCtx.createAnalyser();
      masterAnalyser.fftSize = 1024;
      masterGain.connect(audioCtx.destination);
      masterGain.connect(masterAnalyser);
    } catch (err) {
      audioCtx = null;
      streamDest = null;
    }
    schedule();
  }

  // Applies a new sequence size to the preview canvas.
  function resize(w, h) {
    S.seqWidth = w;
    S.seqHeight = h;
    applyPreview();
  }

  AVP.monitor = {
    init,
    sync,
    draw,
    stop,
    play,
    playPause,
    stepFrames,
    goTo,
    jumpEdit,
    startExport,
    finishExport,
    exportFrame,
    resize,
    setPreviewScale,
    applyPreview,
    isExporting: () => S.exporting,
    markDirty,
    getSource,
    audioContext: () => audioCtx,
    trackParam: (id, key, t) => trackParam(id, key, t),
    clipGainAt: (c, t) => clipGainAt(c, t),
    exportCanvas: () => ({ canvas, ctx }),
    masterAnalyser: () => masterAnalyser,
    trackAnalyser: (id) => {
      const b = trackBus(id);
      return b ? b.analyser : null;
    },
  };
})();
