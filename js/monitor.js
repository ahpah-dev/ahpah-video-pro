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

  // Source for the compositor: video element or still image for a media clip.
  function getSource(c) {
    if (c.kind !== 'media') return null;
    return ensureNode(c);
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
    const src = c.inPoint + Math.max(0, t - c.start) * (c.speed || 1);
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
  let cleanedVersion = -1;
  function sync() {
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
      const sp = c.speed || 1;
      if (el.playbackRate !== sp) el.playbackRate = AVP.clamp(sp, 0.0625, 16);
      const target = Math.max(0, c.inPoint + (t - c.start) * sp);
      if (forward && track) {
        if (el.paused) {
          if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - target) > 0.3 * sp) {
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
    if (text) text.textContent = `Exporting… ${Math.round(pct)}%  (Esc to stop)`;
  }

  /*
   * opts: { format: 'webm'|'mp4', width, height, bitrate (Mbps), range: 'sequence'|'work' }
   * Export runs in real time: the sequence plays once and is recorded.
   */
  function startExport(opts) {
    if (S.exporting) return;
    const end = AVP.seqEnd();
    if (end <= 0) return AVP.toast('Nothing to export. Add clips to the timeline first.', 'warn');
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
      return AVP.toast('This browser cannot record video. Try Chrome, Edge or Firefox.', 'error');
    }
    opts = Object.assign({ format: 'webm', width: S.seqWidth, height: S.seqHeight, bitrate: 8, range: 'sequence' }, opts || {});
    const mime = pickMime(opts.format);
    if (!mime) return AVP.toast('This browser cannot record ' + opts.format.toUpperCase() + '. Choose WebM.', 'error');

    let start = 0;
    let stopAt = end;
    if (opts.range === 'work') {
      start = S.workIn != null ? Math.max(0, S.workIn) : 0;
      stopAt = S.workOut != null ? Math.min(end, S.workOut) : end;
      if (stopAt - start < 0.1) return AVP.toast('The work area is empty', 'warn');
    }

    resumeAudio();
    savedSize = { w: canvas.width, h: canvas.height };
    canvas.width = opts.width;
    canvas.height = opts.height;

    const tracks = canvas.captureStream(S.fps).getVideoTracks().slice();
    if (streamDest) tracks.push(...streamDest.stream.getAudioTracks());
    try {
      recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime,
        videoBitsPerSecond: Math.round(opts.bitrate * 1000000),
      });
    } catch (err) {
      restoreCanvasSize();
      return AVP.toast('Could not start recording: ' + err.message, 'error');
    }

    recChunks = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) recChunks.push(ev.data);
    };
    const ext = opts.format === 'mp4' ? 'mp4' : 'webm';
    recorder.onstop = () => {
      const blob = new Blob(recChunks, { type: opts.format === 'mp4' ? 'video/mp4' : 'video/webm' });
      AVP.download(blob, `${AVP.safeName(S.projectName)}.${ext}`);
      AVP.toast(`Export saved as ${ext.toUpperCase()}`, 'ok');
      restoreCanvasSize();
      const ov = $('#exportOverlay');
      if (ov) ov.classList.add('hidden');
    };

    exportStart = start;
    exportEnd = stopAt;
    S.exporting = true;
    stop();
    S.playhead = start;
    recorder.start(1000);
    const ov = $('#exportOverlay');
    if (ov) ov.classList.remove('hidden');
    AVP.toast('Exporting in real time. Keep this tab visible while it runs.');
    play(1);
  }

  function restoreCanvasSize() {
    if (savedSize) {
      canvas.width = savedSize.w;
      canvas.height = savedSize.h;
      savedSize = null;
    }
  }

  function finishExport() {
    if (!S.exporting) return;
    S.exporting = false;
    stop();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
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
    masterAnalyser: () => masterAnalyser,
    trackAnalyser: (id) => {
      const b = trackBus(id);
      return b ? b.analyser : null;
    },
  };
})();
