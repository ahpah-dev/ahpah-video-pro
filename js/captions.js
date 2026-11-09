/*
 * AhPah Video Pro - captions.
 * A caption is a title clip on the CC track, which sits above the video. This file holds the caption
 * rules, SRT reading and writing, and the import and export actions. The Captions panel is in panels.js.
 * Speech is not transcribed here: captions are typed, or imported from an SRT file.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const S = AVP.state;
  const TRACK = 'CC';
  const POSITION_Y = { bottom: 38, middle: 0, top: -38 }; // percent of the frame height from the centre

  // Style for new captions. The Captions panel edits this; "Apply style to all" updates existing captions.
  AVP.captionStyle = { font: 'Arial', size: 50, color: '#ffffff', bgOpacity: 75, position: 'bottom' };

  function pad(n, w) {
    return String(n).padStart(w, '0');
  }

  // Seconds -> "HH:MM:SS,mmm" (SRT time).
  function srtTime(sec) {
    const ms = Math.round(Math.max(0, sec) * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
  }

  // The text style for a caption, from the style settings.
  function textFor(text, style) {
    return Object.assign({}, AVP.TEXT_DEFAULTS, {
      text,
      font: style.font,
      size: style.size,
      color: style.color,
      bgColor: '#000000',
      bgOpacity: style.bgOpacity,
      align: 'center',
      maxWidth: 80,
      lineHeight: 1.2,
    });
  }

  function captionTrack() {
    if (!S.tracks[TRACK]) {
      S.tracks[TRACK] = { id: TRACK, kind: 'video', caption: true, hidden: false, locked: false, volume: 0, pan: 0, send: 0, keys: {} };
      S.trackOrder.unshift(TRACK);
      AVP.touchData();
    }
    return TRACK;
  }

  // Puts a caption at a time, replacing any caption it overlaps. Does not record undo (callers do).
  function placeCaption(start, duration, text) {
    const track = captionTrack();
    const a = Math.max(0, AVP.snapFrame(start));
    const d = Math.max(1 / S.fps, duration);
    AVP.edit.clearRange(track, a, a + d);
    const c = AVP.normalizeClip({
      kind: 'title',
      mediaId: null,
      track,
      start: a,
      inPoint: 0,
      duration: d,
      props: Object.assign(AVP.defaultProps(), { y: POSITION_Y[AVP.captionStyle.position] }),
      text: textFor(text, AVP.captionStyle),
    });
    S.clips.push(c);
    return c;
  }

  // Reads SRT text into { start, end, text } items (seconds). Accepts BOM, CRLF and "." before milliseconds.
  AVP.parseSRT = function (src) {
    const text = String(src).replace(/^\uFEFF/, '').replace(/\r/g, '');
    const timing = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
    const toSec = (h, m, s, ms) => +h * 3600 + +m * 60 + +s + +(ms + '00').slice(0, 3) / 1000;
    const out = [];
    text.split(/\n\s*\n/).forEach((block) => {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => timing.test(l));
      if (i < 0) return;
      const m = lines[i].match(timing);
      const start = toSec(m[1], m[2], m[3], m[4]);
      const end = toSec(m[5], m[6], m[7], m[8]);
      const body = lines.slice(i + 1).join('\n').trim();
      if (end > start) out.push({ start, end, text: body });
    });
    return out;
  };

  // Caption items -> SRT text, numbered from 1.
  AVP.formatSRT = function (items) {
    return items.map((it, i) => `${i + 1}\n${srtTime(it.start)} --> ${srtTime(it.end)}\n${it.text}\n`).join('\n');
  };

  AVP.captions = {
    track: TRACK,

    ensureTrack: captionTrack,

    // Captions in time order.
    list() {
      return S.clips.filter((c) => c.track === TRACK && c.kind === 'title').sort((a, b) => a.start - b.start);
    },

    // New caption at the playhead, selected so it can be typed in.
    newAtPlayhead() {
      AVP.pushUndo();
      const c = placeCaption(S.playhead, 3, 'New caption');
      AVP.select([c.id], false);
      AVP.panels.setPanel('captions');
      AVP.refresh();
    },

    // Moves or resizes a caption. Captions it now covers are cut back or removed.
    setTimes(id, start, end) {
      const c = AVP.findClip(id);
      if (!c) return;
      const a = Math.max(0, AVP.snapFrame(start));
      const b = Math.max(a + 1 / S.fps, AVP.snapFrame(end));
      c.start = a;
      c.duration = b - a;
      AVP.edit.carveRange(TRACK, a, b, new Set([id]));
    },

    // Copies the style settings to every caption.
    restyleAll() {
      AVP.pushUndo();
      const style = AVP.captionStyle;
      this.list().forEach((c) => {
        c.text = textFor(c.text.text, style);
        c.props = Object.assign({}, c.props, { y: POSITION_Y[style.position] });
      });
      AVP.refresh();
      AVP.toast('Style applied to all captions', 'ok');
    },

    importSRT(src) {
      const items = AVP.parseSRT(src);
      if (!items.length) return AVP.toast('No captions found. Check that this is an SRT file.', 'warn');
      AVP.pushUndo();
      items.forEach((it) => placeCaption(it.start, it.end - it.start, it.text));
      AVP.select([], false);
      AVP.panels.setPanel('captions');
      AVP.refresh();
      AVP.toast(`Imported ${items.length} caption${items.length === 1 ? '' : 's'}`, 'ok');
    },

    // Asks for an SRT file and imports it.
    importPicker() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.srt,text/plain';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        file.text().then((src) => AVP.captions.importSRT(src), () => AVP.toast('Could not read that file', 'error'));
      });
      input.click();
    },

    exportSRT() {
      const list = this.list();
      if (!list.length) return AVP.toast('There are no captions to export', 'warn');
      const items = list.map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text.text }));
      const blob = new Blob([AVP.formatSRT(items)], { type: 'application/x-subrip' });
      const name = (S.projectName || 'captions').replace(/[^\w\- ]+/g, '').trim() || 'captions';
      AVP.download(blob, name + '.srt');
      AVP.toast(`Exported ${list.length} caption${list.length === 1 ? '' : 's'}`, 'ok');
    },
  };

  AVP.captions.placeCaption = placeCaption;
})();
