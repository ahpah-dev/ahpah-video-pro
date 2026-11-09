# Changelog

## 1.2.0

### Premiere Pro-style interface
- Application bar with the Premiere menu order (File, Edit, Clip, Sequence, Markers, Graphics,
  View, Window, Help) and a workspace bar: Learning, Assembly, Editing, Color, Effects, Audio,
  Graphics, Captions, Libraries.
- Working workspaces: Editing (default), Assembly (wide Project panel), Effects (wide Effects
  library), Color (large Program monitor) and Audio (taller timeline). The others show a message.
- Left panel group with Project (search, import, remove), Effects and Markers tabs.
- Right panel group with Effect Controls and Metadata tabs.
- Timeline with a sequence tab, a vertical tool palette (Selection, Razor, Hand, Zoom, Type),
  track headers with lock, eye, and M / S buttons, and a master audio meter driven by the mix.
- Audio solo on audio tracks.
- Premiere-style dark colours, panel tabs, timecode, and monitor transport.

## 1.1.0
## 1.1.0

### Performance
- Playback lag came from drawing every frame at 1920×1080 through a full-frame layer per clip,
  and from re-sorting and re-rendering the timeline on every tick. Both are fixed.
- Playback previews at half size by default (choose full or quarter in the Program panel
  or the View menu). Export still uses the full frame size.
- Clips without post effects are drawn straight onto the canvas instead of through a full
  layer copy.
- The clip index and transition windows are cached and rebuilt only when the project changes.
- Waveform images are stored once per media file instead of in every clip's style, so
  timeline redraws stay small.
- Drawing is event-driven: an idle editor does no frame work, and playback is paced to about
  60 frames per second.

### Media
- Imported clips keep their full original length. Recorded WebM files that report no
  duration are measured by seeking to the end; the decoded audio length is used as a fallback.
- Waveforms are drawn on audio and video clips.

### Editing
- Effects: colour, blur, glow, mosaic, vignette, film grain, crop and flip.
- Transitions: dissolve, dip to black and white, wipes, slide, zoom, and audio fades.
  Transitions can be dropped onto clip edges or applied from the clip menu.
- Titles: text clips with styling, six presets and a text editor in Effect Controls.
- Keyframes for position, scale, rotation, opacity, volume and effect settings.
- Clip speed (Ctrl+R), markers (M), work area (`[` and `]`), rubber-band selection,
  copy / paste / duplicate, link / unlink, enable / disable, track add / delete / lock.
- Right-click context menus across the app.
- Sequence settings, export options (WebM or MP4, frame size, quality, work-area range) and
  PNG frame export.
- Project autosave with recovery on start-up.

### Design
- Refreshed dark theme: clearer panel headers, tool icons in a segmented control, rounded
  clips and transition badges, styled menus and dialogs.

### Fixes
- The transport works from any position. An empty timeline gives a clear message and plays the
  Source clip if one is loaded. Playback keeps moving when the window is hidden.
- Splits, trims and carves keep linked audio and keyframes in step.

## 1.0.0
- First public prototype: timeline editing, Source / Program monitors, WebM export.
