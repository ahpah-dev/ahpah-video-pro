/*
 * AhPah Video Pro - Project panel (media bin), import, and Source monitor.
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

  let srcVideo, srcImage, srcScrub, srcTC, srcInOut, srcName, srcPlaceholder, srcPlay;

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

  // Reads duration / size and grabs a thumbnail frame for one media item.
  function probe(media) {
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          resolve(media);
        }
      };
      const timer = setTimeout(done, 8000);

      if (media.type === 'image') {
        const img = new Image();
        img.onload = () => {
          clearTimeout(timer);
          media.width = img.naturalWidth;
          media.height = img.naturalHeight;
          media.duration = DEFAULT_IMAGE_SECONDS;
          media.thumb = makeThumb(img, media.width, media.height);
          done();
        };
        img.onerror = () => {
          clearTimeout(timer);
          media.error = true;
          done();
        };
        img.src = media.url;
        return;
      }

      const el = document.createElement(media.type === 'audio' ? 'audio' : 'video');
      el.preload = 'metadata';
      el.muted = true;
      el.onerror = () => {
        clearTimeout(timer);
        media.error = true;
        done();
      };
      const afterMetadata = () => {
        media.duration = isFinite(el.duration) && el.duration > 0 ? el.duration : 10;
        if (media.type !== 'video') {
          clearTimeout(timer);
          return done();
        }
        media.width = el.videoWidth;
        media.height = el.videoHeight;
        el.onseeked = () => {
          clearTimeout(timer);
          media.thumb = makeThumb(el, media.width, media.height);
          done();
        };
        el.currentTime = Math.min(1, media.duration / 2);
      };
      el.onloadedmetadata = () => {
        if (isFinite(el.duration)) return afterMetadata();
        // Some recorded WebM files report Infinity: seek to the end to learn the real length.
        el.ontimeupdate = () => {
          el.ontimeupdate = null;
          el.currentTime = 0;
          afterMetadata();
        };
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
        AVP.toast(`Skipped unsupported file: ${f.name}`);
        continue;
      }
      // Re-link an offline item from a re-opened project instead of duplicating it.
      const offline = S.media.find((m) => m.offline && m.name === f.name && m.type === type);
      if (offline) {
        offline.url = URL.createObjectURL(f);
        offline.offline = false;
        count++;
        jobs.push(probe(offline).then(renderBin));
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
        error: false,
        offline: false,
      };
      S.media.push(media);
      count++;
      jobs.push(probe(media).then(renderBin));
    }
    renderBin();
    if (count) {
      AVP.toast(`Imported ${count} file${count > 1 ? 's' : ''}`);
      Promise.all(jobs).then(renderBin);
    }
    return count;
  }

  function renderBin() {
    const list = $('#binList');
    if (!list) return;
    if (!S.media.length) {
      list.innerHTML =
        '<div class="bin-empty"><div class="big">Drop media here</div>' +
        '<div>or press <b>Ctrl+I</b> to import video, audio or images</div></div>';
    } else {
      list.innerHTML = S.media
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
    if (count) count.textContent = `${S.media.length} item${S.media.length === 1 ? '' : 's'}`;
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
    }
    if (m.type === 'audio') srcPlaceholder.classList.remove('hidden');
    renderBin();
    updateSourceUI();
  }

  function updateSourceUI() {
    const m = AVP.findMedia(S.srcMediaId);
    const t = m && m.type !== 'image' ? srcVideo.currentTime || 0 : 0;
    srcTC.textContent = AVP.fmtTC(t);
    if (m && m.type !== 'image' && isFinite(srcVideo.duration)) {
      srcScrub.max = srcVideo.duration;
      srcScrub.value = t;
    }
    srcInOut.textContent =
      `In ${S.srcIn != null ? AVP.fmtTC(S.srcIn) : '--:--:--:--'}   ` +
      `Out ${S.srcOut != null ? AVP.fmtTC(S.srcOut) : '--:--:--:--'}`;
    srcPlay.dataset.icon = srcVideo.paused ? 'play' : 'pause';
    AVP.icons.apply(srcPlay);
  }

  function sourceTime() {
    const m = AVP.findMedia(S.srcMediaId);
    return m && m.type !== 'image' ? srcVideo.currentTime || 0 : 0;
  }

  function stepSource(n) {
    const m = AVP.findMedia(S.srcMediaId);
    if (!m || m.type === 'image') return;
    srcVideo.pause();
    srcVideo.currentTime = Math.max(0, AVP.snapFrame(srcVideo.currentTime) + n / S.fps);
  }

  function togglePlay() {
    const m = AVP.findMedia(S.srcMediaId);
    if (!m || m.type === 'image') return;
    AVP.monitor.stop();
    if (srcVideo.paused) srcVideo.play().catch(() => {});
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
  function placeFromSource(insert) {
    const m = AVP.findMedia(S.srcMediaId);
    if (!m) return AVP.toast('Load a clip in the Source monitor first (double-click it in the Project panel)');
    const full = m.type === 'image' ? DEFAULT_IMAGE_SECONDS : m.duration;
    const inP = S.srcIn != null ? S.srcIn : 0;
    const outP = S.srcOut != null ? S.srcOut : full;
    const len = outP - inP;
    if (len < 1 / S.fps) return AVP.toast('Mark In and Out so the range is at least one frame');
    const start = AVP.snapFrame(S.playhead);
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
    AVP.toast(`${insert ? 'Inserted' : 'Overwrote'} ${m.name}`);
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

    const list = $('#binList');
    list.addEventListener('click', (e) => {
      const it = e.target.closest('.bin-item');
      if (!it) return;
      S.binSelected = it.dataset.media;
      renderBin();
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

    const panel = $('#binPanel');
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
  };
})();
