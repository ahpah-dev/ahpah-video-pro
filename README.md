# AhPah Video Pro

<p align="center">
  <img src="assets/logo.svg" alt="AhPah Video Pro logo" width="120">
</p>

**AhPah Video Pro** is a free, open-source video editor that runs in your web browser.
It copies the familiar Premiere Pro style layout (Project bin, Source and Program
monitors, Effect Controls and a multi-track timeline) so editors feel at home from the
first launch.

It is released into the **public domain under the [Unlicense](LICENSE)**. Use it, change
it, sell it or bundle it however you like.

> AhPah Video Pro is an independent project. It is not affiliated with, endorsed by, or
> connected to Adobe Inc. "Premiere Pro" is a trademark of Adobe; it is mentioned only to
> describe the layout.

## Features

- **Premiere-style workspace**: menu bar, Project panel, Source monitor, Program monitor,
  Effect Controls and a timeline with track headers.
- **Import** video, audio and still images (drag files into the Project panel or use
  Ctrl+I). Duration and thumbnails are detected automatically.
- **Source monitor**: double-click a clip, mark In and Out, then Insert (`,`) or Overwrite (`.`)
  at the playhead. Clips with sound place linked video and audio clips.
- **Timeline editing**
  - Drag clips to move them, including between tracks of the same type.
  - Trim clips from either edge.
  - Razor tool (`C`) to cut clips; Ctrl+K cuts at the playhead.
  - Ripple delete (Shift+Delete) and normal delete.
  - Snapping to the playhead and clip edges (`S` to toggle).
  - Dropped and trimmed clips overwrite what is beneath them.
  - Drag from the Project panel onto a track (hold Shift to insert).
  - Undo and redo (Ctrl+Z / Ctrl+Shift+Z).
- **Playback**: play, pause, reverse, frame stepping and jumps to edit points, with a
  live timecode display and J / K / L transport keys.
- **Effect Controls**: opacity, scale and volume for the selected clip.
- **Export** the sequence as a WebM file (VP9 or VP8 with Opus audio) directly from the
  browser. No server, no installer.
- **Project files** (`.ahpvp`): save and reopen your timeline. Media files are not
  embedded; keep them on disk and import them again with the same names.

## Getting started

No build step and no dependencies are needed.

1. Download or clone this repository.
2. Open `index.html` in a recent version of Chrome, Edge or Firefox.
3. Press **Ctrl+I** and import some media.

Serving the folder with any static web server also works, for example
`python -m http.server` in the project folder, then visit `http://localhost:8000`.

### Supported formats

Which formats play depends on your browser. MP4 (H.264/AAC), WebM (VP8/VP9, Opus/Vorbis),
MP3, WAV, OGG, PNG, JPEG, GIF and WebP work in current Chrome and Edge. MOV and MKV files
open only where the browser can decode them.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Space | Play / pause |
| J / K / L | Reverse / stop / forward |
| Left / Right | Previous / next frame (Shift: 1 second) |
| Up / Down | Previous / next edit point |
| Home / End | Go to start / end |
| I / O | Mark In / Out in the Source monitor |
| `,` / `.` | Insert / overwrite the Source range at the playhead |
| V / C / H | Selection / Razor / Hand tool |
| S | Toggle snapping |
| Ctrl+K | Split selected clips (or every track) at the playhead |
| Delete / Shift+Delete | Delete / ripple delete selected clips |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+A / Ctrl+Shift+A | Select all / deselect all |
| = / - / \\ | Zoom timeline in / out / fit |
| Ctrl+I / Ctrl+O / Ctrl+S | Import / open project / save project |
| Ctrl+M | Export video (WebM) |
| Esc | Stop an export or close a menu |
| ? | Show the shortcut list |

## Limitations

This is an early, browser-based editor. Known limits:

- Export runs in real time: a 10-minute sequence takes about 10 minutes to render. Keep the
  tab visible while it runs.
- Effects are limited to opacity, scale and volume. There are no transitions, titles, colour
  correction or keyframes yet.
- Only three video tracks and three audio tracks are available.
- The timeline shows no waveforms or filmstrips.
- Projects reference media by file name, so keep the originals in place.

## Development

```text
index.html          Application shell (panels, menus, timeline)
css/style.css       Dark Premiere-style theme
js/state.js         Shared state, undo history, time helpers
js/edits.js         Split, trim, carve, insert and overwrite rules
js/bin.js           Project panel, import, Source monitor
js/timeline.js      Timeline rendering and mouse editing
js/monitor.js       Program monitor, playback engine and WebM export
js/main.js          Menus, keyboard shortcuts, Effect Controls, save / open
tests/edits-test.js Unit tests for the timeline edit rules
assets/logo.svg     Application logo
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
