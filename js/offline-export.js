/*
 * AhPah Video Pro - offline MP4 export.
 * The sequence is rendered frame by frame rather than in real time. For each frame, every video that is
 * showing is moved to its exact moment and waited for, the picture is drawn once, and it is encoded with
 * WebCodecs (H.264). The sound is rendered offline, chunk by chunk, with the same gain, fade, track, pan and
 * Essential Sound settings the live mix uses, and encoded as AAC. Both go into an MP4 with mp4-muxer
 * (js/vendor). Nothing depends on playing in real time, so a slow computer takes longer but the picture
 * does not freeze at the start or stutter. Needs WebCodecs (Chrome, Edge, and recent Safari).
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const SR = 48000; // sample rate of the exported sound
  const CHUNK = 10; // seconds of sound rendered and encoded at a time
  const CURVE_HZ = 100; // how often gain and pan are sampled for the sound
  const AUDIO_PIECE = 4800; // sound frames given to the encoder at a time
  const VIDEO_QUEUE = 6; // frames allowed to wait in the video encoder
  // Each chunk of sound is rendered this much earlier, and the lead-in is dropped. The filters need that time to
  // settle; without it every chunk starts with a dip in level at its join.
  const LEAD_IN = 0.5;

  let job = null; // the export in progress, or null

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function supported() {
    return (
      typeof VideoEncoder !== 'undefined' &&
      typeof AudioEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      typeof AudioData !== 'undefined' &&
      typeof OfflineAudioContext !== 'undefined' &&
      typeof Mp4Muxer !== 'undefined'
    );
  }

  function active() {
    return !!job;
  }

  // The first H.264 profile this browser accepts at the frame size and rate.
  async function pickVideoCodec(w, h, bitrate, fps) {
    const list = fps > 30 ? ['avc1.64002a', 'avc1.640028', 'avc1.42001f'] : ['avc1.640028', 'avc1.42001f'];
    for (const codec of list) {
      try {
        const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps });
        if (r.supported) return codec;
      } catch (e) {
        /* try the next profile */
      }
    }
    return null;
  }

  function setProgress(frac, text) {
    const fill = document.getElementById('exportFill');
    const label = document.getElementById('exportText');
    if (fill) fill.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
    if (label) label.textContent = text;
  }

  // Moves a video element to a time and resolves once that frame can be drawn (or after a timeout).
  function seekTo(el, time) {
    return new Promise((resolve) => {
      if (!el.seeking && el.readyState >= 2 && Math.abs(el.currentTime - time) < 0.0005) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeEventListener('seeked', finish);
        resolve();
      };
      const timer = setTimeout(finish, 4000);
      el.addEventListener('seeked', finish);
      el.currentTime = time;
    });
  }

  // Clips whose picture is showing at time t, including the outgoing side of a transition.
  function clipsShowingAt(t) {
    const out = [];
    const idx = AVP.trackIndex();
    S.trackOrder.forEach((id) => {
      const tr = idx[id];
      if (!tr) return;
      tr.items.forEach(({ c, R }) => {
        if (AVP.isVisibleAt(R, t)) out.push(c);
      });
    });
    return out;
  }

  // Draws the picture at time t: every video is first moved to its frame, then the frame is drawn.
  async function drawFrame(t) {
    const waits = [];
    for (const c of clipsShowingAt(t)) {
      const m = AVP.findMedia(c.mediaId);
      if (!m || m.type !== 'video' || AVP.trackKind(c.track) !== 'video') continue;
      const n = AVP.monitor.getSource(c);
      if (!n || !n.el) continue;
      const target = Math.max(0, c.inPoint + (t - c.start) * (c.speed || 1));
      waits.push(seekTo(n.el, target));
    }
    await Promise.all(waits);
    S.playhead = t;
    AVP.render.frame(job.ctx, t, AVP.monitor.getSource);
  }

  async function encodeFrame(i) {
    const t = job.start + i / job.fps;
    await drawFrame(t);
    const vf = new VideoFrame(job.canvas, {
      timestamp: Math.round((i * 1e6) / job.fps),
      duration: Math.round(1e6 / job.fps),
    });
    job.venc.encode(vf, { keyFrame: i % (job.fps * 2) === 0 });
    vf.close();
    while (job.venc.encodeQueueSize > VIDEO_QUEUE && !job.cancelled) {
      await new Promise((r) => setTimeout(r, 2));
    }
  }

  // The decoded sound of a media file, once per export. null when the file has no sound we can read.
  function decodedSound(media) {
    if (job.sounds.has(media.id)) return job.sounds.get(media.id);
    const p = (async () => {
      try {
        const data = await (await fetch(media.url)).arrayBuffer();
        return await new OfflineAudioContext(2, 1, SR).decodeAudioData(data);
      } catch (e) {
        return null;
      }
    })();
    job.sounds.set(media.id, p);
    return p;
  }

  // Samples fn over [a, b] at CURVE_HZ, for AudioParam.setValueCurveAtTime.
  function sampleCurve(fn, a, b) {
    const n = Math.max(2, Math.ceil((b - a) * CURVE_HZ) + 1);
    const curve = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const v = fn(a + (k / (n - 1)) * (b - a));
      curve[k] = Number.isFinite(v) ? v : 0;
    }
    return curve;
  }

  // Renders the sound of the sequence between a and b (seconds on the sequence).
  async function renderSound(a, b) {
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((b - a) * SR)), SR);
    const master = ctx.createGain();
    master.connect(ctx.destination);

    // Reverb: the same synthetic room the live mix uses.
    const ir = AVP.loudness.roomImpulse(SR, 1.6, 3.5);
    const irBuf = ctx.createBuffer(2, ir.left.length, SR);
    irBuf.getChannelData(0).set(ir.left);
    irBuf.getChannelData(1).set(ir.right);
    const room = ctx.createConvolver();
    room.buffer = irBuf;
    room.connect(master);
    const roomIn = ctx.createGain();
    roomIn.connect(room);

    // One bus per audio track: its volume and pan, as automated in the mixer.
    const buses = new Map();
    const busFor = (id) => {
      if (buses.has(id)) return buses.get(id);
      const input = ctx.createGain();
      const pan = ctx.createStereoPanner();
      input.connect(pan);
      pan.connect(master);
      input.gain.setValueCurveAtTime(sampleCurve((t) => Math.pow(10, AVP.monitor.trackParam(id, 'volume', t) / 20), a, b), 0, b - a);
      pan.pan.setValueCurveAtTime(sampleCurve((t) => clamp(AVP.monitor.trackParam(id, 'pan', t) / 100, -1, 1), a, b), 0, b - a);
      const bus = { input };
      buses.set(id, bus);
      return bus;
    };

    const clips = S.clips.filter(
      (c) => c.kind === 'media' && AVP.trackKind(c.track) === 'audio' && c.start < b && AVP.clipEnd(c) > a
    );
    for (const c of clips) {
      const media = AVP.findMedia(c.mediaId);
      if (!media) continue;
      const buf = await decodedSound(media);
      if (!buf) continue;
      const sp = c.speed || 1;
      const s0 = Math.max(c.start, a);
      const s1 = Math.min(AVP.clipEnd(c), b);
      if (s1 - s0 <= 0) continue;

      const snd = AVP.soundOf(c);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = sp;
      // Essential Sound: low cut, presence and compression, as in the live mix.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = snd.enabled ? Math.max(20, snd.lowCut) : 20;
      const eq = ctx.createBiquadFilter();
      eq.type = 'peaking';
      eq.frequency.value = 3000;
      eq.Q.value = 1;
      eq.gain.value = snd.enabled ? snd.presence : 0;
      const comp = ctx.createDynamicsCompressor();
      if (snd.enabled && snd.compress) {
        comp.threshold.value = -24;
        comp.ratio.value = 3;
        comp.knee.value = 12;
        comp.attack.value = 0.005;
        comp.release.value = 0.25;
      } else {
        comp.threshold.value = 0;
        comp.ratio.value = 1;
      }
      // Clip gain: keyframed volume, fades, auto-match, noise gate and ducking, sampled over the chunk.
      const g = ctx.createGain();
      g.gain.setValueCurveAtTime(sampleCurve((t) => AVP.monitor.clipGainAt(c, t), a, b), 0, b - a);
      src.connect(hp);
      hp.connect(eq);
      eq.connect(comp);
      comp.connect(g);
      g.connect(busFor(c.track).input);
      const send = ctx.createGain();
      send.gain.value = snd.enabled ? clamp((snd.reverb || 0) / 100, 0, 1) * 0.8 : 0;
      g.connect(send);
      send.connect(roomIn);
      // Start at the clip's place in this chunk (or at the chunk start if the clip began earlier).
      src.start(s0 - a, c.inPoint + (s0 - c.start) * sp, (s1 - s0) * sp);
    }
    return ctx.startRendering();
  }

  // Hands a rendered chunk of sound to the AAC encoder, without its lead-in (skipSec seconds at the start).
  function encodeSound(buf, a, skipSec) {
    const skip = Math.round(skipSec * SR);
    const L0 = buf.getChannelData(0);
    const R0 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L0;
    const L = L0.subarray(skip);
    const R = R0.subarray(skip);
    for (let off = 0; off < L.length; off += AUDIO_PIECE) {
      const n = Math.min(AUDIO_PIECE, L.length - off);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate: SR,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round(((a - job.start) + off / SR) * 1e6),
        data,
      });
      job.aenc.encode(ad);
      ad.close();
    }
  }

  function closeEncoders() {
    if (!job) return;
    [job.venc, job.aenc].forEach((e) => {
      try {
        if (e && e.state !== 'closed') e.close();
      } catch (err) {
        /* already closed */
      }
    });
  }

  function restore() {
    if (job && job.savedSize) {
      job.canvas.width = job.savedSize.w;
      job.canvas.height = job.savedSize.h;
    }
    const ov = document.getElementById('exportOverlay');
    if (ov) ov.classList.add('hidden');
    S.exporting = false;
    job = null;
    AVP.refresh();
  }

  function cancel() {
    if (!job) return;
    job.cancelled = true;
    setProgress(0, 'Cancelling…');
  }

  /*
   * opts: { start, stop (seconds on the sequence), width, height, bitrate (Mbps), fps }
   * Resolves when the file has been saved, or the export was cancelled or failed.
   */
  async function run(opts) {
    if (job) return;
    const canvasInfo = AVP.monitor.exportCanvas();
    const w = Math.max(2, Math.floor(opts.width / 2) * 2);
    const h = Math.max(2, Math.floor(opts.height / 2) * 2);
    const fps = Math.max(1, Math.round(opts.fps || S.fps));
    const bitrate = Math.round((opts.bitrate || 8) * 1000000);
    const codec = await pickVideoCodec(w, h, bitrate, fps);
    if (!codec) return AVP.toast('This browser cannot encode H.264 video. Choose WebM instead.', 'error');
    const audioOk = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 160000 })
      .then((r) => r.supported)
      .catch(() => false);
    if (!audioOk) return AVP.toast('This browser cannot encode AAC sound. Choose WebM instead.', 'error');

    const savedSize = { w: canvasInfo.canvas.width, h: canvasInfo.canvas.height };
    canvasInfo.canvas.width = w;
    canvasInfo.canvas.height = h;
    AVP.monitor.stop();
    S.exporting = true;
    const target = new Mp4Muxer.ArrayBufferTarget();
    const mux = new Mp4Muxer.Muxer({
      target,
      video: { codec: 'avc', width: w, height: h },
      audio: { codec: 'aac', numberOfChannels: 2, sampleRate: SR },
      fastStart: 'in-memory',
    });
    job = {
      start: opts.start,
      stop: opts.stop,
      fps,
      canvas: canvasInfo.canvas,
      ctx: canvasInfo.ctx,
      savedSize,
      mux,
      target,
      sounds: new Map(),
      cancelled: false,
      error: null,
      venc: null,
      aenc: null,
    };
    const fail = (e) => {
      if (job) job.error = e;
    };
    job.venc = new VideoEncoder({ output: (chunk, meta) => mux.addVideoChunk(chunk, meta), error: fail });
    job.aenc = new AudioEncoder({ output: (chunk, meta) => mux.addAudioChunk(chunk, meta), error: fail });
    job.venc.configure({ codec, width: w, height: h, bitrate, framerate: fps });
    job.aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 160000 });

    const total = Math.max(1, Math.round((job.stop - job.start) * fps));
    const ov = document.getElementById('exportOverlay');
    if (ov) ov.classList.remove('hidden');
    setProgress(0, 'Exporting frame by frame… 0%  (Esc to cancel)');
    AVP.toast('Exporting frame by frame. It takes as long as it needs, and the picture will not stutter.');

    try {
      for (const el of document.querySelectorAll('audio, video')) el.pause();
      for (let a = job.start; a < job.stop - 1e-9; a += CHUNK) {
        if (job.cancelled || job.error) break;
        const b = Math.min(job.stop, a + CHUNK);
        const lead = Math.min(LEAD_IN, a);
        const sound = await renderSound(a - lead, b);
        encodeSound(sound, a, lead);
        const f0 = Math.round((a - job.start) * fps);
        const f1 = Math.round((b - job.start) * fps);
        for (let i = f0; i < f1 && !job.cancelled && !job.error; i++) {
          await encodeFrame(i);
          if (i % 5 === 0) setProgress(i / total, `Exporting… ${Math.round((i / total) * 100)}%  (Esc to cancel)`);
        }
      }
      if (job.cancelled) {
        closeEncoders();
        AVP.toast('Export cancelled. Nothing was saved.', 'warn');
        return restore();
      }
      if (job.error) throw job.error;
      await job.venc.flush();
      await job.aenc.flush();
      mux.finalize();
      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      closeEncoders();
      AVP.download(blob, `${AVP.safeName(S.projectName)}.mp4`);
      AVP.toast(`Export saved as MP4, ${(blob.size / (1024 * 1024)).toFixed(1)} MB`, 'ok');
    } catch (err) {
      closeEncoders();
      AVP.toast('The MP4 export failed: ' + ((err && err.message) || err) + '. Try WebM.', 'error');
    }
    restore();
  }

  AVP.offlineExport = { supported, active, run, cancel };
})();
