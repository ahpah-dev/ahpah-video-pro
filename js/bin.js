/*
 * AhPah Video Pro - Project panel (media bin), import, waveforms and the Source monitor.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const $ = (sel) => document.querySelector(sel);

  const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'];
  const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'];
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
  const TYPE_LABEL = { video: 'Video', audio: 'Audio', image: 'Image' };
  const DEFAULT_IMAGE_SECONDS = 5;
  const MAX_DECODE_BYTES = 400 * 1024 * 1024; // larger files skip waveform decoding

  let srcVideo;
  let srcImage;
  let srcScrub;
  let srcTC;
  let srcInOut;
  let srcName;
  let srcPlaceholder;
  let srcPlay;

  function detectType(file) {
    const t = file.type || '';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    if (t.startsWith('image/')) return 'image';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (VIDEO_EXT.includes(ext)) return 'video';
    if (AUDIO_EXT.includes(ext)) return 'audio';
    if (IMAGE_EXT.includes(ext)) return 'image';
    return null;
  }

  function makeThumb(src, w, h) {
    if (!w || !h) return null;
    try {
      const cv = document.createElement('canvas');
      cv.width = 160;
      cv.height = 90;
      const g = cv.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, 160, 90);
      const k = Math.min(160 / w, 90 / h);
      const dw = w * k;
      const dh = h * k;
      g.drawImage(src, (160 - dw) / 2, (90 - dh) / 2, dw, dh);
      return cv.toDataURL('image/jpeg', 0.75);
    } catch (e) {
      return null;
    }
  }

  // Draws a waveform image (one column per bucket) for the timeline clips.
  function makeWave(buffer) {
    const data = buffer.getChannelData(0);
    const cols = Math.max(64, Math.min(4096, Math.round(buffer.duration * 40)));
    const per = Math.max(1, Math.floor(data.length / cols));
    const cv = document.createElement('canvas');
    cv.width = cols;
    cv.height = 64;
    const g = cv.getContext('2d');
    // Light, semi-transparent bars so the clip colour stays readable underneath.
    g.fillStyle = 'rgba(255,255,255,0.42)';
    for (let x = 0; x < cols; x++) {
      let peak = 0;
      const start = x * per;
      for (let i = 0; i < per; i++) {
        const v = Math.abs(data[start + i] || 0);
        if (v > peak) peak = v;
      }
      const h = Math.max(1, peak * 26);
      g.fillRect(x, (64 - h) / 2, 1, h);
    }
    return cv.toDataURL('image/png');
  }

  // One CSS rule per media item holds its waveform image; clips just reference the class.
  function setWaveRule(media) {
    let style = document.getElementById('wave-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'wave-styles';
      document.head.appendChild(style);
    }
    style.appendChild(document.createTextNode(`.clip.wv-${media.id}{background-image:url("${media.wave}")}`));
  }

  // Average level of the audio in dB (RMS), used by Essential Sound loudness match.
  function measureRmsDb(buffer) {
    const d = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(d.length / 400000));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += step) {
      sum += d[i] * d[i];
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    return rms > 0 ? 20 * Math.log10(rms) : null;
  }

  // Decodes the audio track once so the timeline can draw it. The decoded length also
  // corrects media whose container did not report a duration.
  function decodeWave(media, file) {
    if (media.type === 'image') return Promise.resolve();
    const ac = AVP.monitor.audioContext();
    if (!ac || !file || file.size > MAX_DECODE_BYTES) return Promise.resolve();
    return file
      .arrayBuffer()
      .then((buf) => ac.decodeAudioData(buf))
      .then((audio) => {
        media.wave = makeWave(audio);
        const channels = [];
        for (let k = 0; k < audio.numberOfChannels; k++) channels.push(audio.getChannelData(k));
        media.lufs = AVP.loudness.integratedLufs(channels, audio.sampleRate);
        media.env = AVP.loudness.levelEnvelope(channels, audio.sampleRate);
        setWaveRule(media);
        media.hasAudio = true;
        if (media.durationGuess && audio.duration > 0) {
          const old = media.duration;
          media.duration = audio.duration;
          media.durationGuess = false;
          // Clips that were placed with the guessed length take the real length.
          S.clips.forEach((c) => {
            if (c.mediaId === media.id && c.inPoint === 0 && Math.abs(c.duration - old) < 1e-3) c.duration = media.duration;
          });
          AVP.touchData();
        }
        renderBin();
        AVP.refresh();
      })
      .catch(() => {
        media.hasAudio = media.type === 'video' ? false : media.hasAudio;
      });
  }

  // Reads duration / size and grabs a thumbnail frame for one media item.
  // The clip keeps the file's full length. Recorded WebM files often report no duration;
  // those are measured by seeking to the end, and the decoded audio is the fallback.
  function probe(media) {
    return new Promise((resolve) => {
      const finish = () => resolve(media);

      if (media.type === 'image') {
        const img = new Image();
        img.onload = () => {
          media.width = img.naturalWidth;
          media.height = img.naturalHeight;
          media.duration = DEFAULT_IMAGE_SECONDS;
          media.thumb = makeThumb(img, media.width, media.height);
          finish();
        };
        img.onerror = () => {
          media.error = true;
          finish();
        };
        img.src = media.url;
        return;
      }

      const el = document.createElement(media.type === 'audio' ? 'audio' : 'video');
      el.preload = 'metadata';
      el.muted = true;
      let thumbTimer = null;
      el.onerror = () => {
        media.error = true;
        finish();
      };

      const haveDuration = () => isFinite(el.duration) && el.duration > 0;

      const withThumbnail = () => {
        if (media.type !== 'video') return finish();
        media.width = el.videoWidth;
        media.height = el.videoHeight;
        thumbTimer = setTimeout(finish, 4000);
        el.onseeked = () => {
          clearTimeout(thumbTimer);
          media.thumb = makeThumb(el, media.width, media.height);
          finish();
        };
        el.currentTime = Math.min(1, media.duration / 2);
      };

      el.onloadedmetadata = () => {
        if (haveDuration()) {
          media.duration = el.duration;
          return withThumbnail();
        }
        // No duration in the container: seek past the end so the browser measures it.
        let settled = false;
        const settle = (guess) => {
          if (settled) return;
          settled = true;
          if (guess) {
            media.duration = 10;
            media.durationGuess = true;
          } else {
            media.duration = el.duration;
            media.durationGuess = false;
          }
          el.currentTime = 0;
          withThumbnail();
        };
        el.addEventListener('durationchange', function onDur() {
          if (haveDuration()) {
            el.removeEventListener('durationchange', onDur);
            settle(false);
          }
        });
        setTimeout(() => settle(true), 6000);
        el.currentTime = 1e101;
      };
      el.src = media.url;
    });
  }

  function importFiles(files) {
    const list = Array.from(files || []);
    const jobs = [];
    let count = 0;
    for (const f of list) {
      const type = detectType(f);
      if (!type) {
        AVP.toast(`Skipped unsupported file: ${f.name}`, 'warn');
        continue;
      }
      // Re-link an offline item from a re-opened project instead of duplicating it.
      const offline = S.media.find((m) => m.offline && m.name === f.name && m.type === type);
      if (offline) {
        offline.url = URL.createObjectURL(f);
        offline.offline = false;
        AVP.mediaStore.put(offline.id, f, type);
        count++;
        jobs.push(probe(offline).then(() => decodeWave(offline, f)));
        continue;
      }
      const media = {
        id: AVP.uid(),
        name: f.name,
        type,
        url: URL.createObjectURL(f),
        duration: 0,
        width: 0,
        height: 0,
        thumb: null,
        wave: null,
        hasAudio: type !== 'image',
        durationGuess: false,
        size: f.size,
        error: false,
        offline: false,
      };
      S.media.push(media);
      AVP.mediaStore.put(media.id, f, type);
      count++;
      jobs.push(probe(media).then(() => decodeWave(media, f)));
    }
    renderBin();
    if (count) {
      AVP.toast(`Imported ${count} file${count > 1 ? 's' : ''}`, 'ok');
      Promise.all(jobs).then(renderBin);
    }
    return count;
  }

  // Gives an offline media item its file: from storage on recovery or reopening, or a file picked by the user.
  function relink(media, f) {
    media.url = URL.createObjectURL(f);
    media.offline = false;
    media.size = f.size;
    renderBin();
    return probe(media)
      .then(() => decodeWave(media, f))
      .then(() => {
        renderBin();
        AVP.refresh();
      });
  }

  function renderBin() {
    const list = $('#binList');
    if (!list) return;
    if (!S.media.length) {
      list.innerHTML =
        '<div class="bin-empty"><div class="big">Drop media here</div>' +
        '<div>or press <b>Ctrl+I</b> to import video, audio or images</div></div>';
    } else {
      const q = (S.binQuery || '').trim().toLowerCase();
      const shown = q ? S.media.filter((m) => m.name.toLowerCase().indexOf(q) >= 0) : S.media;
      list.innerHTML = shown
        .map((m) => {
          const icon = m.type === 'audio' ? '&#9835;' : m.type === 'image' ? '&#9635;' : '&#9654;';
          const thumb = m.thumb ? `<img src="${m.thumb}" alt="">` : `<span class="bin-icon">${icon}</span>`;
          const len = m.error ? 'Unsupported format' : m.offline ? 'Offline: re-import this file' : AVP.fmtTC(m.duration);
          const size = m.width ? ` · ${m.width}×${m.height}` : '';
          const cls = ['bin-item', S.binSelected === m.id ? 'selected' : '', m.error || m.offline ? 'bad' : '']
            .filter(Boolean)
            .join(' ');
          return (
            `<div class="${cls}" draggable="true" data-media="${m.id}" title="${AVP.esc(m.name)}">` +
            `<div class="bin-thumb">${thumb}</div>` +
            `<div class="bin-meta"><div class="bin-name">${AVP.esc(m.name)}</div>` +
            `<div class="bin-sub">${TYPE_LABEL[m.type]} · ${len}${size}</div></div></div>`
          );
        })
        .join('');
    }
    const count = $('#binCount');
    if (count) {
      const n = S.media.length;
      count.textContent = `${n} item${n === 1 ? '' : 's'}`;
    }
    const rm = $('#btnRemoveMedia');
    if (rm) rm.disabled = !AVP.findMedia(S.binSelected);
    const proj = $('#binProjName');
    if (proj) proj.textContent = S.projectName;
  }

  /* ---------- Source monitor ---------- */

  function loadSource(id) {
    const m = AVP.findMedia(id);
    if (!m) return;
    S.srcMediaId = id;
    S.srcIn = null;
    S.srcOut = null;
    S.binSelected = id;
    srcName.textContent = m.name;
    srcPlaceholder.classList.add('hidden');
    if (m.type === 'image') {
      srcVideo.pause();
      srcVideo.removeAttribute('src');
      srcVideo.style.display = 'none';
      srcImage.src = m.url;
      srcImage.style.display = 'block';
      srcScrub.disabled = true;
    } else {
      srcImage.style.display = 'none';
      srcImage.removeAttribute('src');
      srcVideo.style.display = m.type === 'video' ? 'block' : 'none';
      srcVideo.src = m.url;
      srcScrub.disabled = false;
      srcVideo.currentTime = 0;
      if (m.type === 'audio') srcPlaceholder.classList.remove('hidden');
    }
    renderBin();
    updateSourceUI();
  }

  function sourceTime() {
    const m = AVP.findMedia(S.srcMediaId);
    return m && m.type !== 'image' ? srcVideo.currentTime || 0 : 0;
  }

  function updateSourceUI() {
    if (!srcTC) return;
    const m = AVP.findMedia(S.srcMediaId);
    const t = sourceTime();
    srcTC.textContent = AVP.fmtTC(t);
    if (m && m.type !== 'image' && isFinite(srcVideo.duration)) {
      srcScrub.max = srcVideo.duration;
      srcScrub.value = t;
    }
    srcInOut.textContent =
      `In ${S.srcIn != null ? AVP.fmtTC(S.srcIn) : '--:--:--:--'}  ` +
      `Out ${S.srcOut != null ? AVP.fmtTC(S.srcOut) : '--:--:--:--'}`;
    srcPlay.dataset.icon = srcVideo.paused ? 'play' : 'pause';
    AVP.icons.apply(srcPlay);
  }

  function stepSource(n) {
    const m = AVP.findMedia(S.srcMediaId);
    if (!m || m.type === 'image') return;
    srcVideo.pause();
    srcVideo.currentTime = Math.max(0, AVP.snapFrame(srcVideo.currentTime) + n / S.fps);
  }

  function togglePlay() {
    const m = AVP.findMedia(S.srcMediaId);
    if (!m || m.type === 'image') return AVP.toast('Double-click a clip in the Project panel to load it');
    AVP.monitor.stop();
    if (srcVideo.paused) srcVideo.play().catch(() => AVP.toast('The browser would not play this file', 'error'));
    else srcVideo.pause();
  }

  function markIn() {
    if (!AVP.findMedia(S.srcMediaId)) return AVP.toast('Load a clip in the Source monitor first');
    S.srcIn = AVP.snapFrame(sourceTime());
    if (S.srcOut != null && S.srcOut <= S.srcIn) S.srcOut = null;
    updateSourceUI();
  }

  function markOut() {
    const m = AVP.findMedia(S.srcMediaId);
    if (!m) return AVP.toast('Load a clip in the Source monitor first');
    S.srcOut = AVP.snapFrame(m.type === 'image' ? DEFAULT_IMAGE_SECONDS : sourceTime());
    if (S.srcIn != null && S.srcOut <= S.srcIn) S.srcIn = null;
    updateSourceUI();
  }

  function clearMarks() {
    S.srcIn = null;
    S.srcOut = null;
    updateSourceUI();
  }

  // Insert (ripple) or overwrite the marked source range at the playhead.
  function placeFromSource(insert, at) {
    const m = AVP.findMedia(S.srcMediaId);
    if (!m) return AVP.toast('Load a clip in the Source monitor first (double-click it in the Project panel)', 'warn');
    const full = m.type === 'image' ? DEFAULT_IMAGE_SECONDS : m.duration;
    const inP = S.srcIn != null ? S.srcIn : 0;
    const outP = S.srcOut != null ? S.srcOut : full;
    const len = outP - inP;
    if (len < 1 / S.fps) return AVP.toast('Mark In and Out so the range is at least one frame', 'warn');
    const start = AVP.snapFrame(at != null ? at : S.playhead);
    AVP.monitor.stop();
    AVP.edit.placeMedia({
      mediaId: m.id,
      start,
      inPoint: inP,
      duration: len,
      videoTrack: m.type === 'audio' ? null : S.target.video,
      audioTrack: m.type === 'image' ? null : S.target.audio,
      mode: insert ? 'insert' : 'overwrite',
    });
    S.playhead = start + len;
    AVP.toast(`${insert ? 'Inserted' : 'Overwrote'} ${m.name}`, 'ok');
  }

  /* ---------- context menus ---------- */

  function mediaMenu(id) {
    const m = AVP.findMedia(id);
    if (!m) return [];
    return [
      { label: 'Open in Source Monitor', action: () => loadSource(id) },
      { label: 'Insert at Playhead', key: ',', action: () => (loadSource(id), placeFromSource(true)) },
      { label: 'Overwrite at Playhead', key: '.', action: () => (loadSource(id), placeFromSource(false)) },
      { sep: true },
      { label: 'Rename…', action: () => AVP.dialog.form({
          title: 'Rename media',
          fields: [{ k: 'name', label: 'Name', type: 'text', value: m.name }],
          ok: 'Rename',
          onOk: (v) => {
            m.name = v.name.trim() || m.name;
            renderBin();
            AVP.refresh();
          },
        }) },
      { label: 'Media Info…', action: () => AVP.dialog.info('Media info', mediaInfoHtml(m)) },
      { sep: true },
      {
        label: 'Remove from Project',
        action: () => {
          const used = S.clips.filter((c) => c.mediaId === id).length;
          const msg = used ? ` It is used by ${used} clip${used > 1 ? 's' : ''} on the timeline; those clips will be removed too.` : '';
          if (confirm(`Remove "${m.name}" from the project?${msg}`)) AVP.edit.removeMedia(id);
        },
      },
    ];
  }

  function mediaInfoHtml(m) {
    const rows = [
      ['Type', TYPE_LABEL[m.type]],
      ['Duration', AVP.fmtTC(m.duration)],
      ['Size', m.width ? `${m.width} × ${m.height}` : '—'],
      ['File size', m.size ? (m.size / 1048576).toFixed(1) + ' MB' : '—'],
      ['Audio', m.type === 'image' ? 'none' : m.hasAudio ? 'yes' : 'no'],
      ['Status', m.offline ? 'Offline' : m.error ? 'Error' : 'Online'],
    ];
    return (
      '<table class="kb">' +
      rows.map((r) => `<tr><td>${r[0]}</td><td>${AVP.esc(r[1])}</td></tr>`).join('') +
      '</table>'
    );
  }

  function hasFiles(e) {
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  }

  function init() {
    srcVideo = $('#srcVideo');
    srcImage = $('#srcImage');
    srcScrub = $('#srcScrub');
    srcTC = $('#srcTC');
    srcInOut = $('#srcInOut');
    srcName = $('#srcName');
    srcPlaceholder = $('#srcPlaceholder');
    srcPlay = $('#srcPlay');

    $('#binSearch').addEventListener('input', (e) => {
      S.binQuery = e.target.value;
      renderBin();
    });
    $('#btnRemoveMedia').addEventListener('click', () => {
      const m = AVP.findMedia(S.binSelected);
      if (!m) return AVP.toast('Select a media item first', 'warn');
      const used = S.clips.filter((c) => c.mediaId === m.id).length;
      const msg = used ? ` It is used by ${used} clip${used > 1 ? 's' : ''} on the timeline; those clips will be removed too.` : '';
      if (confirm(`Remove "${m.name}" from the project?${msg}`)) AVP.edit.removeMedia(m.id);
    });
    const list = $('#binList');
    list.addEventListener('click', (e) => {
      const it = e.target.closest('.bin-item');
      if (!it) return;
      S.binSelected = it.dataset.media;
      renderBin();
      if (AVP.panels) AVP.panels.renderSide();
    });
    list.addEventListener('dblclick', (e) => {
      const it = e.target.closest('.bin-item');
      if (it) loadSource(it.dataset.media);
    });
    list.addEventListener('dragstart', (e) => {
      const it = e.target.closest('.bin-item');
      if (!it) return;
      e.dataTransfer.setData('application/x-avp-media', it.dataset.media);
      e.dataTransfer.effectAllowed = 'copy';
    });
    list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const it = e.target.closest('.bin-item');
      if (it) {
        S.binSelected = it.dataset.media;
        renderBin();
        AVP.menu.show(e.clientX, e.clientY, mediaMenu(it.dataset.media));
      } else {
        AVP.menu.show(e.clientX, e.clientY, [
          { label: 'Import Media…', key: 'Ctrl+I', action: () => $('#fileInput').click() },
        ]);
      }
    });

    const panel = $('#leftPanel');
    panel.addEventListener('dragover', (e) => {
      if (hasFiles(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    panel.addEventListener('drop', (e) => {
      if (hasFiles(e)) {
        e.preventDefault();
        importFiles(e.dataTransfer.files);
      }
    });

    $('#btnImport').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => {
      importFiles(e.target.files);
      e.target.value = '';
    });

    srcVideo.addEventListener('timeupdate', updateSourceUI);
    srcVideo.addEventListener('loadedmetadata', updateSourceUI);
    srcVideo.addEventListener('play', updateSourceUI);
    srcVideo.addEventListener('pause', updateSourceUI);
    srcVideo.addEventListener('ended', updateSourceUI);
    srcVideo.addEventListener('error', () => {
      if (S.srcMediaId) AVP.toast('The browser cannot decode this file in the Source monitor', 'error');
    });
    srcScrub.addEventListener('input', () => {
      if (isFinite(srcVideo.duration)) srcVideo.currentTime = +srcScrub.value;
    });

    $('#srcBack').addEventListener('click', () => stepSource(-1));
    $('#srcFwd').addEventListener('click', () => stepSource(1));
    srcPlay.addEventListener('click', togglePlay);
    $('#srcMarkIn').addEventListener('click', markIn);
    $('#srcMarkOut').addEventListener('click', markOut);
    $('#srcClear').addEventListener('click', clearMarks);
    $('#srcInsert').addEventListener('click', () => placeFromSource(true));
    $('#srcOverwrite').addEventListener('click', () => placeFromSource(false));

    $('#srcPanel').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const has = !!AVP.findMedia(S.srcMediaId);
      AVP.menu.show(e.clientX, e.clientY, [
        { label: has ? 'Play / Pause' : 'Play / Pause (load a clip first)', action: togglePlay, disabled: !has },
        { label: 'Step Back one frame', key: '←', action: () => stepSource(-1), disabled: !has },
        { label: 'Step Forward one frame', key: '→', action: () => stepSource(1), disabled: !has },
        { sep: true },
        { label: 'Mark In', key: 'I', action: markIn, disabled: !has },
        { label: 'Mark Out', key: 'O', action: markOut, disabled: !has },
        { label: 'Clear Marks', action: clearMarks, disabled: !has },
        { sep: true },
        { label: 'Insert at Playhead', key: ',', action: () => placeFromSource(true), disabled: !has },
        { label: 'Overwrite at Playhead', key: '.', action: () => placeFromSource(false), disabled: !has },
        { sep: true },
        { label: 'Export Frame at Playhead as PNG…', action: () => AVP.monitor.exportFrame() },
      ]);
    });

    renderBin();
    updateSourceUI();
  }

  AVP.bin = {
    init,
    renderBin,
    importFiles,
    loadSource,
    markIn,
    markOut,
    clearMarks,
    placeFromSource,
    stepSource,
    togglePlay,
    updateSourceUI,
    mediaMenu,
    relink,
  };
})();
