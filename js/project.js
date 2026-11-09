/*
 * AhPah Video Pro - project files (.ahpvp), autosave and recovery.
 * Project files hold the timeline and settings. The media files are kept in this browser's storage
 * (js/media-store.js) when they are imported, so a recovered project gets its media back. A project
 * opened from another computer, or media that was removed from storage, needs its files imported again.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const AUTOSAVE_KEY = 'ahpah-video-pro.autosave.v2';
  const FORMAT_VERSION = 2;
  let timer = null;

  function mediaMeta(m) {
    return { id: m.id, name: m.name, type: m.type, duration: m.duration, width: m.width, height: m.height, hasAudio: m.hasAudio, size: m.size };
  }

  function serialize() {
    return {
      app: AVP.APP_NAME,
      format: 'ahpvp',
      version: FORMAT_VERSION,
      name: S.projectName,
      fps: S.fps,
      width: S.seqWidth,
      height: S.seqHeight,
      tracks: S.tracks,
      trackOrder: S.trackOrder,
      clips: S.clips,
      markers: S.markers,
      workIn: S.workIn,
      workOut: S.workOut,
      media: S.media.map(mediaMeta),
      fonts: AVP.customFonts,
      captionStyle: AVP.captionStyle,
      savedAt: new Date().toISOString(),
    };
  }

  // Gives offline media their files back from this browser's storage. Returns how many came back.
  function restoreMedia() {
    const offline = S.media.filter((m) => m.offline);
    if (!offline.length || !AVP.mediaStore) return Promise.resolve({ restored: 0, missing: offline.length });
    return Promise.all(
      offline.map((m) =>
        AVP.mediaStore.find(m.id, m.name, m.type).then((file) => {
          if (!file) return false;
          AVP.bin.relink(m, file);
          return true;
        })
      )
    ).then((flags) => {
      const restored = flags.filter(Boolean).length;
      AVP.refresh();
      return { restored, missing: offline.length - restored };
    });
  }

  // Replaces the open project with data from a parsed file. Resolves when the media is back.
  function apply(data) {
    if (!data || data.format !== 'ahpvp' || !Array.isArray(data.clips)) {
      throw new Error('Not an AhPah Video Pro project');
    }
    const old = S.media;
    AVP.restoreCustomFonts(data.fonts);
    if (data.captionStyle) Object.assign(AVP.captionStyle, data.captionStyle);
    S.projectName = data.name || 'Untitled Project';
    S.fps = data.fps || 30;
    S.seqWidth = data.width || 1920;
    S.seqHeight = data.height || 1080;
    AVP.monitor.resize(S.seqWidth, S.seqHeight);

    S.media = (data.media || []).map((dm) => {
      const existing = old.find((x) => x.url && x.name === dm.name && x.type === dm.type);
      if (existing) return Object.assign({}, existing, { id: dm.id });
      return Object.assign(
        { url: null, offline: true, thumb: null, wave: null, error: false, hasAudio: dm.type !== 'image' },
        dm
      );
    });

    const fresh = AVP.newTrackSet();
    S.tracks = data.tracks || fresh.tracks;
    S.trackOrder = data.trackOrder || Object.keys(S.tracks);
    S.clips = data.clips.map((c) => AVP.normalizeClip(c));
    // Clips on a track that no longer exists go to the first track of their kind.
    S.clips.forEach((c) => {
      if (!S.tracks[c.track]) {
        const kind = c.kind === 'title' ? 'video' : AVP.findMedia(c.mediaId) && AVP.findMedia(c.mediaId).type === 'audio' ? 'audio' : 'video';
        c.track = S.trackOrder.find((id) => S.tracks[id].kind === kind) || S.trackOrder[0];
      }
    });
    S.markers = data.markers || [];
    S.workIn = data.workIn == null ? null : data.workIn;
    S.workOut = data.workOut == null ? null : data.workOut;
    S.selection = [];
    S.playhead = 0;
    AVP.monitor.stop();
    AVP.resetHistory();
    AVP.refresh();
    AVP.bin.renderBin();
    return restoreMedia();
  }

  // Says what came back, in one toast.
  function reportOpen(result, opened) {
    const { restored, missing } = result;
    if (missing) {
      AVP.toast(
        `${opened}. ${missing} media file${missing > 1 ? 's are' : ' is'} still offline: import ${missing > 1 ? 'them' : 'it'} again with the same file name.`,
        'warn'
      );
    } else {
      AVP.toast(restored ? `${opened}. ${restored} media file${restored > 1 ? 's' : ''} restored.` : opened, 'ok');
    }
  }

  function save() {
    AVP.dialog.form({
      title: 'Save project',
      intro: 'The project file keeps the timeline and settings. Media is kept in this browser, so it can be restored here.',
      fields: [{ k: 'name', label: 'Project name', type: 'text', value: S.projectName }],
      ok: 'Save',
      onOk: (v) => {
        S.projectName = (v.name || '').trim() || 'Untitled Project';
        const json = JSON.stringify(serialize(), null, 2);
        AVP.download(new Blob([json], { type: 'application/json' }), AVP.safeName(S.projectName) + '.ahpvp');
        AVP.refresh();
        AVP.toast('Project saved', 'ok');
      },
    });
  }

  function openFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let pending;
      try {
        pending = apply(JSON.parse(reader.result));
      } catch (err) {
        AVP.toast(err.message || 'Could not open this project', 'error');
        return;
      }
      pending.then((r) => reportOpen(r, 'Project opened'));
    };
    reader.readAsText(file);
  }

  /* ---------- autosave ---------- */

  function writeAutosave() {
    timer = null;
    try {
      if (!S.clips.length && !S.media.length) localStorage.removeItem(AUTOSAVE_KEY);
      else localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize()));
    } catch (err) {
      /* storage full or disabled: autosave is best effort */
    }
  }

  function touch() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(writeAutosave, 1200);
  }

  function offerRecovery() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
    } catch (err) {
      data = null;
    }
    if (!data || !((data.clips && data.clips.length) || (data.media && data.media.length))) return;
    const when = data.savedAt ? new Date(data.savedAt).toLocaleString() : 'earlier';
    AVP.dialog.form({
      title: 'Recover unsaved project?',
      intro: `An autosaved version of "${data.name || 'Untitled Project'}" from ${when} was found. Its media is restored from this browser's storage.`,
      fields: [],
      ok: 'Recover',
      cancel: 'Start new',
      onOk: () => {
        let pending;
        try {
          pending = apply(data);
        } catch (err) {
          AVP.toast('The autosaved project could not be read', 'error');
          return;
        }
        pending.then((r) => reportOpen(r, 'Project recovered'));
      },
    });
  }

  AVP.project = { serialize, apply, save, openFile, touch, offerRecovery };
})();
