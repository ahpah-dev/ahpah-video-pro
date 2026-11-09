# Changelog

## 1.23.0

### Premiere Pro 2024 look
- New `css/premiere.css` skin, loaded last. Panels float with an even 4 px gutter and rounded corners; the
  panel you last clicked in gets Premiere's blue outline (`js/skin.js`).
- Flat tab strips with an underline on the front tab (light grey, blue in the active panel). The active
  workspace in the top bar is underlined instead of boxed.
- Timeline: clips use Premiere's label colours (blue-violet video, green audio, violet stills, orange
  titles) with a coloured name bar over the picture or waveform. A selected clip turns white. Track names
  are framed buttons, filled blue on the target track. The playhead is a blue line with a home-plate head.
  The ruler has minor ticks between the labels.
- Darker, calmer greys, thinner scrollbars, rounded menus and dialogs, blue program timecode.
- No behaviour changes. The splitters follow the new gutter (`GAP` and `PAD` in `js/layout.js`).

## 1.22.1

### Export: lag spikes fixed
- The frame-by-frame MP4 export seeked each video to exactly `frame / fps`. The stored timestamps are
  rounded, so that seek often landed on the frame before: about one frame in three was a repeat of the
  last one and the next was skipped, which showed as lag spikes in the exported video. Seeks are now
  nudged 3 ms past the frame's time, so the right frame is always picked.
- Checked on a real 1080p 30 fps clip, 8 seconds exported: repeated frames went from 79 of 241 to 0.
- The MP4 option no longer depends on the browser's MediaRecorder supporting MP4. It only needs
  WebCodecs, so browsers that used to get the real-time WebM export (the one that stutters) now get the
  smooth frame-by-frame MP4 too.

## 1.22.0

### MP4 export, frame by frame
- MP4 export now draws each frame at its own pace instead of in real time. For each frame, every video
  that is showing is moved to its exact moment and waited for, then the frame is encoded (H.264). The
  export no longer depends on playback, so the picture no longer freezes at the start of a clip or
  stutters on a slow computer. A slow computer just takes longer.
- The sound is rendered offline, in 10-second chunks, with the same gain, fade, track, pan, reverb and
  Essential Sound settings as the live mix, and encoded as AAC. Each chunk starts half a second early and
  drops that lead-in, so the filters settle and there is no dip at the joins.
- The file is written with mp4-muxer (MIT, in js/vendor). The output has a fast-start header, so it
  begins playing straight away.
- Esc cancels a frame-by-frame export; nothing is saved. Progress shows in the export overlay.
- The export dialog explains the two formats: MP4 is drawn frame by frame, WebM runs in real time.
- WebM and browsers without WebCodecs still use the real-time export, with the late-frame warning.

### Checked
- A real video export started with no frozen frames: the longest still run at the start is 0.1 seconds,
  down from up to 0.8 seconds before.
- A 20-second test with five flashes and clicks: the sound and picture agree to within one frame, with no
  drift, and the click at each 10-second join is kept.

## 1.21.0

### Export: stutter reporting
- The export counts frames that were captured late. While it runs, the overlay warns when more than a
  tenth of the frames are late, and suggests a smaller frame size. The final message reports how many
  frames were late.
- A normal-speed export reports nothing. A slow computer is now told why its export stutters.

### Known limit
- Exports run in real time. A slow computer cannot capture 1080p frames as fast as they are due, so the
  picture can stutter, and the sound can sit slightly behind the picture (about 20 ms normally, more on a
  busy computer). A smaller frame size reduces the load. A fully smooth export on any computer needs an
  offline renderer that draws each frame at its own pace, which is planned but not in this version.

## 1.20.0

### Export
- A background timer drives the export, so it keeps the same speed when the window is in the background.
  Before, browsers slowed the picture to about one frame a second in a hidden tab, while the sound kept
  going, so the two drifted apart.
- Each frame is drawn once and recorded exactly once. Before, the recorder took frames on its own
  schedule, so frames could be doubled or missed.
- Frames wait for video that is still seeking or loading, so the export no longer shows a half-loaded or
  black frame at the start of a clip.
- The first frames are sent to the encoder before the clock starts, so short exports begin cleanly.
- A finished MP4 is checked for a readable video track. Some browsers write an MP4 with no video; the
  export is recorded again (up to three tries), and if it still cannot be read the file is saved with a
  note to try WebM.
- MP4 is the default in the export dialog wherever the browser can record it. The unsupported MP4 choice
  is no longer listed.
- Frame sizes are rounded to even numbers, which encoders need.
- Audio is recorded at 160 kbps alongside the video bitrate.
- A recorder error stops the export cleanly and saves what was recorded, with a message. An empty
  recording is reported rather than saved.
- Cancelling with Esc saves the part already recorded.

## 1.19.0

### Text animations
- New Animation section in the Text controls of a title, with an Effect list, Length, Delay and
  Per letter (time between letters). Changes show on the Program monitor straight away.
- Effects: Typewriter (letters appear in order, with a blinking cursor that stays for a second after
  the text is done), Letter pop (overshoot), Word pop, Letter fade, Letter rise, Letter drop (bounce),
  Letter spin, Glitch in, Wave (keeps moving), and Wipe reveal (the whole text uncovered from the left).
- Preview animation plays the clip from its start.
- Titles without an animation draw exactly as before. Older titles get the default (None).

## 1.18.0

### Timeline previews
- Video and image clips show their frames on the timeline, so you can see what is in a clip without
  opening it. Before, only the name was shown.
- The filmstrip is sampled evenly across the source's length and moves with the clip's in point, so
  trimming or slipping a clip shows the matching frames. It follows the zoom level.
- Image clips repeat their picture along the clip.
- Filmstrips are built in the background after import, and rebuilt after recovery or relinking. They are
  not saved in the project file.

## 1.17.0

### Drag and drop transitions
- Drag a transition from the Effects tab onto the timeline.
- Drop it on a cut between two clips and it is centred on the cut. Drop it near a clip's start or end
  and it goes at that edge. Before, the nearer half of the clip decided, even at a cut.
- While you drag, a dashed box shows the span the transition will cover, with its name. The box is red
  when the transition does not fit the track (a video transition over an audio clip, or an audio fade
  over a video clip). Dropping in that case adds nothing and says why.
- The drop lands exactly where the preview showed.

### More transitions
- Blur Dissolve: the outgoing clip blurs as the incoming one sharpens.
- Zoom Through: the incoming clip zooms in from larger, and the outgoing one zooms past the camera.
- Whip Pan: a fast sideways move with motion blur at its peak.
- Clock Wipe: a radial sweep from the top, clockwise.
- Checkerboard Wipe: squares open in a checkerboard, even squares first.
- Random Blocks: blocks appear in a fixed scattered order.
- Venetian Blinds: horizontal slats open from the left, one after another.

## 1.16.0

### Recovery
- Recover now brings back the whole project, including the media. Before, the clips came back but every
  media file was offline, so there was no picture or sound until you imported the files again.
- Each imported file is kept in this browser's storage (IndexedDB). A recovered or reopened project gets
  its media back from there, and the thumbnails and waveforms are rebuilt.
- The recovery prompt also appears when only media is in the project, not only when there are clips.
- The caption style is saved with the project, so captions keep their look after recovery.
- The message after recovering or opening a project says how many media files were restored. Files still
  missing are named, with the advice to import them again.
- Removing a media item also removes its stored copy.

### Limits
- Storage is the browser's, so it depends on how much space the browser allows for this site. If storage
  is full, the editor says the file will need importing again after a reload.
- A project opened on another computer has no stored media there. Import its files again with the same
  names.

## 1.15.0

### Marker actions, easier to find
- Right-click a clip and hover **Cut at Markers**. It sits directly under Cut at Playhead and opens a
  side menu with the marker actions.
- **Transition at Each Marker** lists every transition (cross dissolve, dip, wipes, slides, zoom, spin,
  iris and more), and puts the one you pick at each marker. Audio clips get a fade.
- **Keep Only Between First and Last Marker** trims the clip, and its linked audio, to the part between
  its first and last markers.
- **Split at Each Marker** and **Remove Markers in These Clips** work as before.
- The Clip menu has the same actions under Cut at Markers.
- Each action is one undo step.

## 1.14.0

### Markers on a clip
- Markers on This Clip (right-click a clip): split at every marker inside it, add a dissolve at each
  marker, or remove the markers inside it.
- Clip menu: Split at Each Marker, Dissolve at Each Marker and Remove Markers in Clip act on the
  selected clips.
- Each action is one undo step. Linked audio is split with its video, and a marker exactly on a clip's
  edge does not cut it.

## 1.13.0

### Moving every panel
- The Project and Effect Controls groups move by a grip (the dotted handle) at the start of their
  tab strip. Dragging tabs still reorders and moves tabs as before.
- The timeline moves by the grip on its header. Drop it on the top or bottom edge of the window.
  The splitters follow it, so resizing still works with the timeline on top.
- The Source and Program monitors, the groups and the timeline share one arrangement in the top row.
  A panel dropped in the outer third of another goes beside it, and in the middle the two swap.
- The arrangement is saved and comes back after a reload. Window > Reset Panel Layout and Reset
  Monitor Positions restore the defaults.

## 1.12.0

### Moving the monitors
- Drag the Source or Program monitor by its header and drop it on another panel in the top row.
  On the left or right third of a panel it goes in beside that panel; in the middle it swaps places.
  A blue line or outline shows where it will land.
- The moved panel fills the cell it lands in, and its picture and placeholder stay centred in it.
- The arrangement is saved and comes back after a reload. Window > Reset Monitor Positions restores
  the default.
- Column widths stay with the column, so the panel that moves into a wide column takes that width.

### Not included yet
- The Project and Effect Controls groups still move by their tabs, not by their headers.

## 1.11.0

### Captions
- A Captions workspace and a Captions panel in the left group.
- Captions are text clips on a new CC track above the video, so adding a caption never overwrites
  the picture underneath. Older projects get the track the first time a caption is added.
- New caption at the playhead. Each caption in the panel has an editable text box, start and end
  times, and a delete button. Click a caption to go to its place on the timeline.
- Style for captions: font, size, box opacity and position (bottom, middle or top). Apply it to all
  captions at once.
- Import SRT subtitle files and export the captions as SRT. Import reads BOM, Windows line endings,
  and times with a dot or a comma before the milliseconds. Imported captions replace any caption they
  overlap.
- Graphics menu: New Caption at Playhead, Import Captions (SRT), Export Captions (SRT), Captions panel.
- The Captions tab can be dragged between panel groups like the others. A saved tab layout from an
  earlier version keeps its order and gets the Captions tab added.

### Not included
- Automatic speech-to-text. Captions are typed or imported. Automatic transcription needs a speech
  model that does not run in the browser here.

## 1.10.0

### Keyframes
- The diamond beside a keyed control is filled only when a keyframe sits under the playhead. It is
  hollow when the control is keyed but has no key here, and dimmed when no key can be placed.
  Before, it lit up for any keyed control, so clicking it could add a key where you did not expect.
- Each keyed control has a keyframe lane under its slider. Every keyframe is a diamond at its place
  on the clip, and a line shows the playhead. Click a keyframe to move the playhead to it. Drag a
  keyframe to move it along the clip; it snaps to frames and cannot land on another keyframe.
- The diamonds, the lanes, the keyed values and the sliders follow the playhead while you move it or
  play, without rebuilding the panel.
- Keyframes can only be placed while the playhead is over the clip. Before, a key at the playhead
  outside the clip was placed at the clip's edge.
- Keyframes follow edits: a cut splits them with values that meet at the cut, a tail trim and a speed
  change keep them inside the clip, and no keyframe is left past the end of its clip, where it was
  invisible and froze the value.

### Speed and linked clips
- Changing the speed of a linked clip changes its linked audio too. Before, changing only the video
  left its audio at normal speed, so the picture and sound drifted apart.

## 1.9.5

### Effects library
- One click on an effect or transition in the Effects tab applies it to the selected clip. A title
  preset is added at the playhead with one click too. It no longer needs a double-click.

## 1.9.4

### Scrubbing
- The program picture follows the playhead in real time. Dragging the playhead on the ruler, or
  stepping with the arrow keys, redraws the video at each move instead of only after the mouse is
  released.
- While paused, a new seek replaces one still in progress, so the picture keeps up with the pointer.
  Seeks are limited to about 12 a second.

## 1.9.3

### Graphics panel
- One click on a title or lower-third preset adds it at the playhead. It no longer needs a double-click.

## 1.9.2

### Audio stacking
- Only audio clips make sound. A video clip is picture only, linked or not, so its own sound can
  no longer play next to its audio clip. This happened after unlinking a video from its audio, or
  after an audio clip was overwritten, and the sound doubled.
- The Essential Sound panel on a video clip explains that its sound is the audio clip from the same
  file, and says when that clip is missing.
- Placing the same file on two audio tracks still plays both sounds, as in other editors. Move or
  mute one of them to hear only one.

## 1.9.1

### Importing a video with sound
- A video with sound now gives a picture clip on the video track and a sound clip on the audio track,
  and only the sound clip shows a waveform. Before, the video clip also showed the waveform, so it
  looked like two sounds.
- The video's own sound is muted whenever its sound clip is on the timeline, so the sound plays once.
- The two clips stay linked, so moving or cutting one moves or cuts the other. Use Unlink to
  separate them completely.

## 1.9.0

### Customising the layout
- Drag a panel tab along its strip to reorder it, or drop it on the other panel group (the left
  group or the right group) to move it there. The tab and its panel move together.
- Dropping a tab on a panel body puts it at the end of that group.
- The arrangement is saved, so it comes back after a reload. Window > Reset Panel Layout restores
  the default.
- The tab strips scroll with the middle mouse button or by dragging empty strip space. A left-drag
  on a tab moves the tab.

### Typing values
- The number beside each slider in Effect Controls and Lumetri Color is a box you can type in.
  Press Enter to apply, or Escape to put the old value back.
- Position, scale and rotation accept values past the slider's range (for example a position of
  250% or a scale of 300%). Effects keep their limits.

### Markers and the playhead
- Dragging the playhead on the ruler locks onto a marker when it comes within a few pixels, and
  the timeline centres on the marker. It stays there until the pointer moves away.
- Markers > Next Marker and Previous Marker move the playhead to the marker and centre the
  timeline on it. The up and down arrows still jump between edit points, now labelled Previous Edit
  and Next Edit in the menu.

## 1.8.1

### Trimming and linked clips
- Trimming a clip no longer trims its linked video or audio. Drag the edge of the video and the
  audio stays the same length, and the other way round. The link is kept.
- Moving a linked clip still moves its partner, and cutting still cuts both.
- Trimming several clips at once still works: clips you selected yourself are trimmed together.
- Linked selection: a new button in the timeline toolbar. On (default) a click selects a clip and
  its linked partner. Off, a click selects one clip.
- A click on a clip from a multi-selection selects just that clip. Escape clears the selection.
- Unlink works on the clips you select, even after one of them has been trimmed.

### Razor
- With the razor tool, a red line shows exactly where the clip will be cut, snapped to the frame,
  with its timecode.

### Fixes
- Rubber-band selection on the timeline no longer throws an error when you release the mouse.
- Audio clips on audio tracks are drawn in the audio colour, even when they come from a video file.

## 1.8.0

### Layout
- Drag the gaps between the panels to resize them, and drag the gap above the timeline to make the
  timeline taller or shorter. Each workspace keeps its own sizes, and they scale with the window.
- Double-click a gap to return that workspace to its starting sizes.
- The panel tabs scroll by mouse wheel or by dragging, so the Graphics tab can be reached in a narrow
  panel. The project name moved to the bottom of the Project panel.
- Larger controls above the timeline: taller panel tabs and headers, bigger buttons, timecode and
  tool palette, and taller tracks.
- The timeline pans with the middle mouse button in any direction, and the hand tool pans up and down
  as well as across.

### Effects
- New: Tint, Drop Shadow, Light Leak, Lens Flare, Scan Lines and Letterbox.

### Transitions
- New: Diagonal Wipe, Box Wipe (from centre), Iris (circle), Slide In From Top, Slide In From Bottom
  and Spin.

### Titles and fonts
- The font list shows the fonts installed on this computer (45 of the 62 candidates were installed on
  the Windows machine this release was tested on).
- Add font: import a .ttf, .otf or .woff file. It is saved in the project, so it opens on any
  computer. Files over 15 MB are refused. Very large projects can be too big for autosave, but saving
  the project file always works.

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
