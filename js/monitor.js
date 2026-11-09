/*
 * AhPah Video Pro - Program monitor: playback engine, compositing and WebM export.
 *
 * Each timeline clip gets its own HTMLMediaElement (created lazily). Every frame we
 * look at the playhead, make sure the clips under it are playing or seeked to the
 * right position, and draw the video tracks onto a 1920x1080 canvas. Audio from each
 * element goes through a Web Audio gain node so volume and mute can be applied, and
 * the same graph feeds a MediaStream destination that the exporter records.
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
  const nodes = new Map(); // clipId -> { el?, img?, gain?, src?, mediaId }
  const imageCache = new Map(); // mediaId -> HTMLImageElement
  let lastTs = 0;
  let recorder = null;
  let recChunks = [];
  let exportEnd = 0;

  /* ---------- audio graph ---------- */

  function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  }

  function getNode(c) {
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
      let gain = null;
      let src = null;
      if (audioCtx) {
        try {
          src = audioCtx.createMediaElementSource(el);
          gain = audioCtx.createGain();
          src.connect(gain);
          gain.connect(audioCtx.destination);
          if (streamDest) gain.connect(streamDest);
        } catch (err) {
          gain = null;
          src = null;
        }
      }
      n = { el, img: null, gain, src, mediaId: m.id };
    }
    nodes.set(c.id, n);
    return n;
  }

  function hasLinkedAudio(c) {
    return AVP.partners(c).some((p) => S.tracks[p.track] && S.tracks[p.track].kind === 'audio');
  }

  // Video clips with a linked audio clip are silenced here so the sound is not doubled.
  function gainFor(c) {
    const tr = S.tracks[c.track];
    if (!tr || tr.muted) return 0;
    const m = AVP.findMedia(c.mediaId);
    if (m && m.type === 'video' && tr.kind === 'video' && hasLinkedAudio(c)) return 0;
    return c.volume;
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
      if (n.src) n.src.disconnect();
      nodes.delete(id);
    }
  }

  /* ---------- playback ---------- */

  function isActive(c, t) {
    return t >= c.start - EPS && t < c.start + c.duration - EPS;
  }

  // Keep media elements in step with the playhead.
  function sync() {
    cleanupNodes();
    const t = S.playhead;
    const active = new Set();
    const forward = S.playing && S.playDir > 0;

    for (const c of S.clips) {
      if (!isActive(c, t)) continue;
      active.add(c.id);
      const n = getNode(c);
      if (!n) continue;
      if (n.gain) n.gain.gain.value = gainFor(c);
      if (!n.el) continue;

      const el = n.el;
      const target = c.inPoint + (t - c.start);
      if (forward) {
        if (el.paused) {
          if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - target) > 0.3) {
          el.currentTime = target;
        }
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
      }
    }

    for (const [id, n] of nodes) {
      if (!active.has(id) && n.el && !n.el.paused) n.el.pause();
    }
  }

  function draw() {
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const t = S.playhead;

    for (const tid of ['V1', 'V2', 'V3']) {
      const tr = S.tracks[tid];
      if (!tr || tr.hidden) continue;
      for (const c of S.clips) {
        if (c.track !== tid || !isActive(c, t)) continue;
        const n = getNode(c);
        if (!n) continue;
        let src = null;
        let sw = 0;
        let sh = 0;
        if (n.img) {
          if (n.img.complete && n.img.naturalWidth) {
            src = n.img;
            sw = n.img.naturalWidth;
            sh = n.img.naturalHeight;
          }
        } else if (n.el && n.el.readyState >= 2 && n.el.videoWidth) {
          src = n.el;
          sw = n.el.videoWidth;
          sh = n.el.videoHeight;
        }
        if (!src) continue;
        const k = Math.min(W / sw, H / sh) * c.scale;
        const dw = sw * k;
        const dh = sh * k;
        ctx.globalAlpha = Math.max(0, Math.min(1, c.opacity));
        ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
        ctx.globalAlpha = 1;
      }
    }
  }

  function updateTimecodes() {
    const tc = $('#progTC');
    if (tc) tc.textContent = AVP.fmtTC(S.playhead);
    const dur = $('#seqDur');
    if (dur) dur.textContent = `Duration ${AVP.fmtTC(AVP.seqEnd())}`;
    const pp = $('#pPlay');
    if (pp) {
      pp.dataset.icon = S.playing && S.playDir > 0 ? 'pause' : 'play';
      AVP.icons.apply(pp);
    }
  }

  function loop(ts) {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.25) : 0;
    lastTs = ts;

    if (S.playing) {
      S.playhead += S.playDir * dt;
      const end = AVP.seqEnd();
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
    draw();
    AVP.timeline.updatePlayhead();
    updateTimecodes();
    if (S.exporting) updateExportUI();
    requestAnimationFrame(loop);
  }

  function stop() {
    S.playing = false;
    S.playDir = 0;
  }

  function play(dir) {
    if (AVP.seqEnd() <= 0) {
      AVP.toast('The timeline is empty');
      return;
    }
    if (dir > 0 && S.playhead >= AVP.seqEnd() - EPS) S.playhead = 0;
    if (dir < 0 && S.playhead <= 0) S.playhead = AVP.seqEnd();
    AVP.bin.updateSourceUI();
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

  // Jump to the previous / next clip boundary.
  function jumpEdit(dir) {
    const pts = [0];
    S.clips.forEach((c) => pts.push(c.start, c.start + c.duration));
    const t = S.playhead;
    const cands = dir > 0 ? pts.filter((p) => p > t + EPS) : pts.filter((p) => p < t - EPS);
    if (!cands.length) return;
    goTo(dir > 0 ? Math.min(...cands) : Math.max(...cands));
  }

  /* ---------- export ---------- */

  function updateExportUI() {
    const pct = exportEnd > 0 ? Math.min(100, (S.playhead / exportEnd) * 100) : 0;
    const fill = $('#exportFill');
    const text = $('#exportText');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    if (text) text.textContent = `Exporting WebM… ${Math.round(pct)}%  (Esc to stop)`;
  }

  function startExport() {
    if (S.exporting) return;
    const end = AVP.seqEnd();
    if (end <= 0) return AVP.toast('Nothing to export. Add clips to the timeline first.');
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
      return AVP.toast('This browser cannot record video. Try Chrome, Edge or Firefox.');
    }
    resumeAudio();

    const tracks = canvas.captureStream(S.fps).getVideoTracks().slice();
    if (streamDest) tracks.push(...streamDest.stream.getAudioTracks());

    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m)
    );
    try {
      recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime || undefined,
        videoBitsPerSecond: 8000000,
      });
    } catch (err) {
      return AVP.toast('Could not start recording: ' + err.message);
    }

    recChunks = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) recChunks.push(ev.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recChunks, { type: 'video/webm' });
      AVP.download(blob, `${AVP.safeName(S.projectName)}.webm`);
      AVP.toast('Export saved as WebM');
      const ov = $('#exportOverlay');
      if (ov) ov.classList.add('hidden');
    };

    exportEnd = end;
    S.exporting = true;
    stop();
    S.playhead = 0;
    recorder.start(1000);
    const ov = $('#exportOverlay');
    if (ov) ov.classList.remove('hidden');
    AVP.toast('Exporting in real time. Keep this tab visible.');
    play(1);
  }

  function finishExport() {
    if (!S.exporting) return;
    S.exporting = false;
    stop();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  /* ---------- init ---------- */

  function init() {
    canvas = $('#prog');
    canvas.width = S.seqWidth;
    canvas.height = S.seqHeight;
    ctx = canvas.getContext('2d');
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      streamDest = audioCtx.createMediaStreamDestination();
    } catch (err) {
      audioCtx = null;
      streamDest = null;
    }
    requestAnimationFrame(loop);
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
    isExporting: () => S.exporting,
  };
})();
