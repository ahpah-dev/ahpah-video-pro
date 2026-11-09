# AhPah Video Pro

<p align="center">
  <img src="assets/logo.svg" alt="AhPah Video Pro logo" width="120">
</p>

**AhPah Video Pro** is a free, open-source video editor that runs in your web browser. It
follows the familiar Premiere Pro style layout: a Project panel, Source and Program
monitors, Effect Controls and a multi-track timeline. It has effects, transitions, titles,
keyframes and export to WebM or MP4, with no installer and no server.

It is released into the **public domain under the [Unlicense](LICENSE)**. Use it, change
it, sell it or bundle it however you like.

> AhPah Video Pro is an independent project. It is not affiliated with, endorsed by, or
> connected to Adobe Inc. "Premiere Pro" is a trademark of Adobe; it is mentioned only to
> describe the layout.

## Features

- **Import** video, audio and still images. Imported clips keep their full original length
  (images use 5 seconds by default). Waveforms are drawn on audio and video clips.
- **Timeline**
  - Three video and three audio tracks, with add / delete track, show / hide, mute and lock.
  - Move clips (including between tracks of the same type) and trim from either edge.
  - Dropped and trimmed clips overwrite what is beneath them.
  - Razor tool, ripple delete, copy / paste, duplicate, link / unlink and enable / disable.
  - Snapping to the playhead, clip edges and markers.
  - Markers (M), a work area (`[` and `]`) and rubber-band selection.
  - Undo and redo.
- **Source monitor**: mark In and Out, then Insert (`,`) or Overwrite (`.`) at the playhead.
  Clips with sound place linked video and audio clips.
- **Effects** (Effect Controls or the Effects tab; drag onto a clip or double-click):
  brightness and contrast, saturation, hue rotate, black and white, sepia, invert, blur,
  glow, mosaic, vignette, film grain, crop and flip.
- **Motion**: position, scale, rotation and opacity, with keyframes (the stopwatch and
  diamond buttons). Keyframes also work on effect settings and volume.
- **Transitions**: cross dissolve, dip to black and white, wipes, slide, zoom, and
  constant-gain audio fades. Drag them onto a clip edge, or use the clip menu. Video
  transitions crossfade the linked audio.
- **Titles**: title clips with font, size, colour, bold / italic, outline, shadow,
  background box, alignment, line height and width. Six presets are included.
- **Speed**: change a clip's speed from 10% to 1600% (Ctrl+R).
- **Playback**: play, pause, reverse, frame stepping and jumps to edit points, at a
  choice of preview resolution (full, half or quarter). Drawing is paced to the display.
- **Export**: WebM (VP9 or VP8 with Opus) or MP4 where the browser supports it. Choose
  the frame size, quality and range (whole sequence or work area). Export a single frame
  as PNG.
- **Sequence settings**: frame size (HD, 4K, vertical, square) and frame rate.
- **Context menus** on every area: clips, tracks, the ruler, markers, the Project panel,
  both monitors and the background.
- **Projects** (`.ahpvp`): save and reopen timelines. The timeline is also autosaved in the
  browser, and you are offered recovery when you reopen the app.

## Getting started

No build step and no dependencies are needed.

1. Download or clone this repository.
2. Open `index.html` in a recent version of Chrome, Edge or Firefox.
3. Press **Ctrl+I** and import some media, then drag a clip onto a track.

You can also serve the folder with any static server, for example `python -m http.server`
in the project folder, then visit `http://localhost:8000`.

### Supported formats

Which formats play depends on your browser. MP4 (H.264 / AAC), WebM (VP8 / VP9 with
Opus or Vorbis), MP3, WAV, OGG, PNG, JPEG, GIF and WebP work in current Chrome and Edge.
MOV and MKV files open only where the browser can decode them.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Space | Play / pause |
| J / K / L | Reverse / stop / forward |
| Left / Right | Previous / next frame (Shift: 1 second) |
| Up / Down | Previous / next edit point or marker |
| Home / End | Go to start / end |
| I / O | Mark In / Out in the Source monitor |
| `,` / `.` | Insert / overwrite the Source range at the playhead |
| V / C / H | Selection / Razor / Hand tool |
| S | Toggle snapping |
| M | Add marker at playhead |
| `[` / `]` | Work area In / Out at playhead |
| Ctrl+K | Cut selected clips (or every track) at the playhead |
| Ctrl+C / Ctrl+V / Ctrl+D | Copy / paste at playhead / duplicate |
| Ctrl+Shift+D | Apply the default transition to selected clips |
| Ctrl+R | Speed / duration of selected clips |
| Ctrl+T | New title at the playhead |
| Delete / Shift+Delete | Delete / ripple delete |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+A / Ctrl+Shift+A | Select all / deselect all |
| = / - / \\ | Zoom timeline in / out / to fit |
| Ctrl+I / Ctrl+O / Ctrl+S / Ctrl+N | Import / open / save project / new project |
| Ctrl+M | Export video |
| Ctrl+Shift+E | Export frame as PNG |
| Esc | Stop an export, close a menu or dialog |
| ? | Show the shortcut list |

## Limitations

This is an early, browser-based editor. Known limits:

- Export runs in real time: a 10-minute sequence takes about 10 minutes. Keep the tab
  visible while it runs.
- No chroma key, colour wheels, keyframe curves or speed ramps yet.
- Only three video and three audio tracks are created by default (more can be added).
- The preview is drawn at the chosen resolution; export always uses the chosen export size.
- Some effects (glow, mosaic, vignette, grain) and CSS-filter effects depend on the browser's
  canvas support. Safari may skip the colour and blur effects.
- Projects reference media by file name, so keep the originals in place.

## Development

```text
index.html           Application shell (panels, toolbar, dialogs)
css/style.css        Dark editing theme
js/state.js          Shared state, undo history, data version, helpers
js/effects.js        Effect / transition / title definitions and timing maths (pure)
js/edits.js          Split, trim, carve, insert, overwrite, speed, transitions, copy / paste
js/render.js         Frame compositor (direct draw, layers for post effects, cached index)
js/monitor.js        Program monitor: playback engine, preview size, WebM / MP4 export
js/bin.js            Project panel, import, duration detection, waveforms, Source monitor
js/menu.js           Context menus and drop-down menus
js/dialog.js         Forms and info dialogs
js/panels.js         Effect Controls and the Effects library
js/timeline.js       Timeline rendering and mouse editing
js/project.js        Project files and autosave
js/main.js           Actions, menu bar, keyboard shortcuts, startup
tests/edits-test.js  Unit tests for the editing, effect and transition rules
assets/logo.svg      Application logo
```

Run the unit tests with Node 18 or later:

```bash
npm test
```

The modules are plain browser scripts that share a global `AVP` namespace, so they are easy
to read and change without tooling.

## Contributing

Issues and pull requests are welcome. Because the project is released into the public
domain, please only contribute code you have the right to dedicate under the Unlicense.

## License

This project is dedicated to the public domain under the Unlicense. See [LICENSE](LICENSE)
or <https://unlicense.org>.
