# Changelog

## 1.7.0

### Design
- The look is now flat and close to Premiere Pro: solid panels, a blue accent, and no glossy
  highlights. The interface font is unchanged.
- Sliders are stronger: a deeper groove, a clear fill to the value, a bordered thumb, and a
  vertical fader style for the mixer.
- Lumetri Color is laid out as Premiere-style sections (Basic Correction, White Balance, Color
  Wheels, Curves, Creative, HSL Secondary, Input LUT). Each section can be collapsed from its
  header, and the state is kept while you work.
- Double-click any Lumetri or effect slider to return it to its default.
- Colour wheels have a centre crosshair.

## 1.6.0

### Design
- New design layer (css/theme.css) over the editor styles, with a stronger visual system.
- Sliders: a recessed groove with a bright fill up to a glossy thumb, a halo on hover and a press
  state. The fill follows the value through js/ui.js.
- Checkboxes, selects with a custom arrow, and search fields with a magnifier.
- Buttons with a lit top edge, pressed and active states, and a glowing play button.
- LCD-style timecode, recessed meters, mixer strips with vertical faders, and framed monitors.
- Clips with a lit top edge and a glow when selected; tabs, menus, dialogs and toasts restyled.

## 1.5.0

### Lumetri Color
- Colour wheels for shadows, midtones and highlights (drag to tint, double-click to reset).
- Curves editor: RGB and per-channel curves with draggable points.
- HSL secondary: a hue range that can be shifted, saturated and lifted.
- Sharpening.
- Input LUTs: load Adobe .cube 3D LUTs, with a strength control. LUTs are saved in the project.
- The shader now runs all grading in one pass, including the new controls.

### Essential Sound
- Loudness is measured in LUFS (ITU-R BS.1770 K-weighting with gating) and the auto-match target
  is in LUFS.
- Noise reduction: a gate that closes between speech, using the clip's measured noise floor.
- Reverb send to a synthetic room.
- Ducking: music and sound effects lower while a dialogue clip plays.

### Audio Clip Mixer
- Pan for each track.
- Reverb send per track.
- Automation of volume, pan and send: a stopwatch on each control, and moving a control writes a
  keyframe at the playhead.

### Graphics
- Essential Graphics panel: text, rectangle and ellipse graphics, with a browser of presets.
- Rectangles and ellipses: fill, stroke, size and corner radius. Available from the Graphics menu.
- The Graphics workspace is now available.

## 1.4.0

### Transitions
- Drag the edge of a transition box on the timeline to change its length. A centred transition grows
  both ways from its cut; a transition at the start or end of a clip grows from its free edge.
- The linked audio fade follows the same length, and each change is one undo step.

## 1.3.0

### Lumetri Color
- New Lumetri Color effect and panel: exposure, contrast, highlights, shadows, whites and blacks,
  temperature and tint, saturation, vibrance and faded film. Keyframes work on every control.
- Grading runs on the GPU in a WebGL shader, frame by frame, so playback and export use the same
  result. Browsers without WebGL fall back to CSS filters for exposure, contrast and saturation.
- Add it from the Lumetri Color tab, the Clip menu, or the Effects library.

### Essential Sound
- New Essential Sound panel for audio clips (and the audio of video clips).
- Audio types (Dialogue, Music, Sound Effects, Ambience) set starting values.
- Auto-match loudness moves a clip toward a target level, based on its measured RMS.
- Clean up: low cut, presence EQ and compression, applied in the audio chain before the track.

### Audio Clip Mixer
- Mixer tab with a fader, meter, mute and solo for each audio track, plus a master meter.
- Track faders are in dB and apply to every clip on the track, including the export mix.
- Meters read the real audio graph, so they respond to what is playing.

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
