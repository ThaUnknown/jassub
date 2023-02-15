<h1 align="center">
  JASSUB
</h1>
<p align="center">
  JavaScript SSA/ASS Subtitle Renderer.
</p>
JASSUB is a JS wrapper for <a href="https://github.com/libass/libass">libass</a>, which renders <a href="https://en.wikipedia.org/wiki/SubStation_Alpha">SSA/ASS subtitles</a> directly in your browser. It uses Emscripten to compile libass' C++ code to WASM.

<p align="center">
  <a href="https://thaunknown.github.io/jassub/">Online Demos</a>
</p>

## Features
- Supports most SSA/ASS features (everything libass supports)
- Supports all OpenType, TrueType and WOFF fonts, as well as embedded fonts
- Supports anamorphic videos [(on browsers which support it)](https://caniuse.com/mdn-api_htmlvideoelement_requestvideoframecallback)
- Capable of using local fonts [(on browsers which support it)](https://caniuse.com/mdn-api_window_querylocalfonts)
- Works fast (all the heavy lifting is done by WebAssembly)
- Is fully threaded (on browsers which support it, it's capable of working fully on a separate thread)
- Is asynchronous (renders when available, not in order of execution)
- Benefits from hardware acceleration (uses hardware accelerated canvas API's)
- Doesn't manipulate the DOM to render subtitles
- Easy to use - just connect it to video element

## Isn't this just the same thing as JavascriptSubtitlesOctopus?
No. See <a href="https://thaunknown.github.io/jassub/explainer.html">this</a> comparison.

## Usage
By default all you need to do is copy the files from the `dist/` folder of the repository into the same folder as where your JS runs, then do:
```js
import JASSUB from './jassub.es.js'

const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass'
})
```
`Note:` while the `dist/` folder includes a UMD dist it still uses modern syntax. If you want backwards compatibility with older browsers I recommend you run it tru babel.

If you use a bundler like Vite, you can instead do:
```shell
npm i jassub
```

```js
import JASSUB from 'jassub'
import workerUrl from 'jassub/dist/jassub-worker.js?url'
import 'jassub/dist/jassub-worker.wasm?url'

const renderer = new JASSUB({
  video: document.querySelector('video'),
  subContent: subtitleString,
  workerUrl // you can also use: `new URL('jassub/dist/jassub-worker.js', import.meta.url)` instead of importing it as an url
})
```
## Using only with canvas
You're also able to use it without any video. However, that requires you to set the time the subtitles should render at yourself:
```js
import JASSUB from './jassub.es.js'

const renderer = new JASSUB({
  canvas: document.querySelector('canvas'),
  subUrl: './tracks/sub.ass'
})

renderer.setCurrentTime(15)
```
## Changing subtitles
You're not limited to only display the subtitle file you referenced in your options. You're able to dynamically change subtitles on the fly. There's three methods that you can use for this specifically:

- `setTrackByUrl(url):` works the same as the `subUrl` option. It will set the subtitle to display by its URL.
- `setTrack(content):` works the same as the `subContent` option. It will set the subtitle to dispaly by its content.
- `freeTrack():` this simply removes the subtitles. You can use the two methods above to set a new subtitle file to be displayed.
```js
renderer.setTrackByUrl('/newsub.ass')
```
## Cleaning up the object
After you're finished with rendering the subtitles. You need to call the `destroy()` method to correctly destroy the object.
```js
const renderer = new JASSUB(options)
// After you've finished using it...
renderer.destroy()
```
## Options
The default options are best, and automatically fallback to the next fastest options in line, when the API's they use are unsupported. You can however forcefully change this behavior by specifying options. These options are included in the JSDoc of the object, so if your editor supports JSDoc IntelliSense you will see these exact descriptions when calling methods and specifying options.

- `{Object} options` Settings object.
- `{HTMLVideoElement} options.video` Video to use as target for rendering and event listeners. Optional if canvas is specified instead.
- `{HTMLCanvasElement} options.canvas` { Optional } Canvas to use for manual handling. Not required if video is specified.
- `{'js'|'wasm'} options.blendMode` { Optional = 'js' } Which image blending mode to use. WASM will perform better on lower end devices, JS will perform better if the device and browser supports hardware acceleration.
- `{Boolean} options.asyncRender` { Optional = true } Whether or not to use async rendering, which offloads the CPU by creating image bitmaps on the GPU.
- `{Boolean} options.offscreenRender` { Optional = true } Whether or not to render things fully on the worker, greatly reduces CPU usage.
- `{Boolean} options.onDemandRender` { Optional = true } Whether or not to render subtitles as the video player renders frames, rather than predicting which frame the player is on using events.
- `{Number} options.targetFps` { Optional = true } Target FPS to render subtitles at. Ignored when onDemandRender is enabled.
- `{Number} options.timeOffset` { Optional = 0 } Subtitle time offset in seconds.
- `{Boolean} options.debug` { Optional = false } Whether or not to print debug information.
- `{Number} options.prescaleFactor` { Optional = 1.0 } Scale down (< 1.0) the subtitles canvas to improve performance at the expense of quality, or scale it up (> 1.0).
- `{Number} options.prescaleHeightLimit` { Optional = 1080 } The height in pixels beyond which the subtitles canvas won't be prescaled.
- `{Number} options.maxRenderHeight` { Optional = 0 } The maximum rendering height in pixels of the subtitles canvas. Beyond this subtitles will be upscaled by the browser.
- `{Boolean} options.dropAllAnimations` { Optional = false } Attempt to discard all animated tags. Enabling this may severly mangle complex subtitles and should only be considered as an last ditch effort of uncertain success for hardware otherwise incapable of displaing anything. Will not reliably work with manually edited or allocated events.
- `{String} options.workerUrl` { Optional = 'jassub-worker.js' } The URL of the worker.
- `{String} options.legacyWorkerUrl` { Optional = 'jassub-worker-legacy.js' } The URL of the legacy worker. Only loaded if the browser doesn't support WASM.
- `{String} [options.subUrl=options.subContent]` The URL of the subtitle file to play.
- `{String} [options.subContent=options.subUrl]` The content of the subtitle file to play.
- `{String[]|Uint8Array[]} options.fonts` { Optional } An array of links or Uint8Arrays to the fonts used in the subtitle. If Uint8Array is used the array is copied, not referenced. This forces all the fonts in this array to be loaded by the renderer, regardless of if they are used.
- `{Object} options.availableFonts` { Optional = {'liberation sans': './default.woff2'}} Object with all available fonts - Key is font family in lower case, value is link or Uint8Array: { arial: '/font1.ttf' }. These fonts are selectively loaded if detected as used in the current subtitle track.
- `{String} options.fallbackFont` { Optional = 'liberation sans' } The font family key of the fallback font in availableFonts to use if the other font for the style is missing special glyphs or unicode.
- `{Boolean} options.useLocalFonts` { Optional = false } If the Local Font Access API is enabled [chrome://flags/#font-access], the library will query for permissions to use local fonts and use them if any are missing. The permission can be queried beforehand using navigator.permissions.request({ name: 'local-fonts' }).
- `{Number} options.libassMemoryLimit` { Optional } libass bitmap cache memory limit in MiB (approximate).
- `{Number} options.libassGlyphLimit` { Optional } libass glyph cache memory limit in MiB (approximate).

## Methods and properties
This library has a lot of methods and properties, however many aren't made for manual use or have no effect when changing, those are usually prefixed with `_`. Most of these never need to be called by the user.

### List of properties:
  - `debug` - -||-
  - `prescaleFactor` - -||-
  - `prescaleHeightLimit` - -||-
  - `maxRenderHeight` - -||-
  - `busy` - Boolean which specifies if the renderer is currently busy. 
  - `timeOffset` - -||-
### List of methods:
- `resize(width = 0, height = 0, top = 0, left = 0)` - Resize the canvas to given parameters. Auto-generated if values are ommited.
  - {Number} [width=0]
  - {Number} [height=0]
  - {Number} [top=0]
  - {Number} [left=0]
- `setVideo(video)` - Change the video to use as target for event listeners.
  - {HTMLVideoElement} video
- `setTrackByUrl(url)` - Overwrites the current subtitle content.
  - {String} url URL to load subtitles from.
- `setTrack(content)` - Overwrites the current subtitle content.
  - {String} content Content of the ASS file.
- `freeTrack()` - Free currently used subtitle track.
- `setIsPaused(isPaused)` - Sets the playback state of the media.
  - {Boolean} isPaused Pause/Play subtitle playback.
- `setRate(rate)` - Sets the playback rate of the media [speed multiplier].
  - {Number} rate Playback rate.
- `setCurrentTime(isPaused, currentTime, rate)` - Sets the current time, playback state and rate of the subtitles.
  - {Boolean} [isPaused] Pause/Play subtitle playback.
  - {Number} [currentTime] Time in seconds.
  - {Number} [rate] Playback rate.
- `destroy(err)` - Destroy the object, worker, listeners and all data.
  - {String} [err] Error to throw when destroying.
- `sendMessage(target, data = {}, transferable)` - Send data and execute function in the worker.
  - {String} target Target function.
  - {Object} [data] Data for function.
  - {Transferable[]} [transferable] Array of transferables.
- `createEvent(event)` - Create a new ASS event directly.
  - {ASS_Event} event
- `setEvent(event, index)` - Overwrite the data of the event with the specified index.
  - {ASS_Event} event
  - {Number} index
- `removeEvent(index)` - Remove the event with the specified index.
  - {Number} index
- `getEvents(callback)` - Get all ASS events.
  - {function(Error|null, ASS_Event)} callback Function to callback when worker returns the events.
- `createStyle(style)` - Create a new ASS style directly.
  - {ASS_Style} event
- `setStyle (event, index)` - Overwrite the data of the style with the specified index.
  - {ASS_Style} event
  - {Number} index
- `removeStyle (index)` - Remove the style with the specified index.
  - {Number} index
- `getStyles (callback)` - Get all ASS styles.
  - {function(Error|null, ASS_Style)} callback Function to callback when worker returns the styles.
- `addfont (font)` - Adds a font to the renderer.
  - {String|Uint8Array} font Font to add.

### ASS_Event object properties
- `{Number} Start` - Start Time of the Event, in 0:00:00:00 format ie. Hrs:Mins:Secs:hundredths. This is the time elapsed during script playback at which the text will appear onscreen. Note that there is a single digit for the hours!
- `{Number} Duration` - End Time of the Event, in 0:00:00:00 format ie. Hrs:Mins:Secs:hundredths. This is the time elapsed during script playback at which the text will disappear offscreen. Note that there is a single digit for the hours!
- `{String} Style` - Style name. If it is "Default", then your own *Default style will be subtituted.
- `{String} Name` - Character name. This is the name of the character who speaks the dialogue. It is for information only, to make the script is easier to follow when editing/timing.
- `{Number} MarginL` - 4-figure Left Margin override. The values are in pixels. All zeroes means the default margins defined by the style are used.
- `{Number} MarginR` - 4-figure Right Margin override. The values are in pixels. All zeroes means the default margins defined by the style are used.
- `{Number} MarginV` - 4-figure Bottom Margin override. The values are in pixels. All zeroes means the default margins defined by the style are used.
- `{String} Effect` - Transition Effect. This is either empty, or contains information for one of the three transition effects implemented in SSA v4.x
- `{String} Text` - Subtitle Text. This is the actual text which will be displayed as a subtitle onscreen. Everything after the 9th comma is treated as the subtitle text, so it can include commas.
- `{Number} ReadOrder` - Number in order of which to read this event.
- `{Number} Layer` - Z-index overlap in which to render this event.
- `{Number} _index` - (Internal) index of the event.

### ASS_Style object properties 
  - `{String} Name` The name of the Style. Case sensitive. Cannot include commas.
  - `{String} FontName` The fontname as used by Windows. Case-sensitive.
  - `{Number} FontSize` Font size.
  - `{Number} PrimaryColour` A long integer BGR (blue-green-red)  value. ie. the byte order in the hexadecimal equivelent of this number is BBGGRR
  - `{Number} SecondaryColour` A long integer BGR (blue-green-red)  value. ie. the byte order in the hexadecimal equivelent of this number is BBGGRR
  - `{Number} OutlineColour` A long integer BGR (blue-green-red)  value. ie. the byte order in the hexadecimal equivelent of this number is BBGGRR
  - `{Number} BackColour` This is the colour of the subtitle outline or shadow, if these are used. A long integer BGR (blue-green-red)  value. ie. the byte order in the hexadecimal equivelent of this number is BBGGRR.
  - `{Number} Bold` This defines whether text is bold (true) or not (false). -1 is True, 0 is False. This is independant of the Italic attribute - you can have have text which is both bold and italic.
  - `{Number} Italic`  Italic. This defines whether text is italic (true) or not (false). -1 is True, 0 is False. This is independant of the bold attribute - you can have have text which is both bold and italic.
  - `{Number} Underline` -1 or 0
  - `{Number} StrikeOut` -1 or 0
  - `{Number} ScaleX` Modifies the width of the font. [percent]
  - `{Number} ScaleY` Modifies the height of the font. [percent]
  - `{Number} Spacing` Extra space between characters. [pixels]
  - `{Number} Angle` The origin of the rotation is defined by the alignment. Can be a floating point number. [degrees]
  - `{Number} BorderStyle` 1=Outline + drop shadow, 3=Opaque box
  - `{Number} Outline` If BorderStyle is 1,  then this specifies the width of the outline around the text, in pixels. Values may be 0, 1, 2, 3 or 4.
  - `{Number} Shadow` If BorderStyle is 1,  then this specifies the depth of the drop shadow behind the text, in pixels. Values may be 0, 1, 2, 3 or 4. Drop shadow is always used in addition to an outline - SSA will force an outline of 1 pixel if no outline width is given.
  - `{Number} Alignment` This sets how text is "justified" within the Left/Right onscreen margins, and also the vertical placing. Values may be 1=Left, 2=Centered, 3=Right. Add 4 to the value for a "Toptitle". Add 8 to the value for a "Midtitle". eg. 5 = left-justified toptitle
  - `{Number} MarginL` This defines the Left Margin in pixels. It is the distance from the left-hand edge of the screen.The three onscreen margins (MarginL, MarginR, MarginV) define areas in which the subtitle text will be displayed.
  - `{Number} MarginR` This defines the Right Margin in pixels. It is the distance from the right-hand edge of the screen. The three onscreen margins (MarginL, MarginR, MarginV) define areas in which the subtitle text will be displayed.
  - `{Number} MarginV` This defines the vertical Left Margin in pixels. For a subtitle, it is the distance from the bottom of the screen. For a toptitle, it is the distance from the top of the screen. For a midtitle, the value is ignored - the text will be vertically centred.
  - `{Number} Encoding` This specifies the font character set or encoding and on multi-lingual Windows installations it provides access to characters used in multiple than one languages. It is usually 0 (zero) for English (Western, ANSI) Windows.
  - `{Number} treat_fontname_as_pattern`
  - `{Number} Blur`
  - `{Number} Justify`

# How to build?
## Dependencies
- git
- emscripten (Configure the enviroment)
- make
- python3
- cmake
- pkgconfig
- patch
- libtool
- autotools (autoconf, automake, autopoint)
- gettext
- ragel - Required by Harfbuzz
- itstool - Required by Fontconfig
- gperf - Required by Fontconfig
- licensecheck

## Get the Source
Run git clone --recursive https://github.com/ThaUnknown/jassub.git

## Build inside a Container
### Docker
1. Install Docker
2. ./run-docker-build.sh
3. Artifacts are in /dist/js
### Buildah
1. Install Buildah and a suitable backend for buildah run like crun or runc
2. ./run-buildah-build.sh
3. Artifacts are in /dist/js
## Build without Containers
1. Install the dependency packages listed above
2. make
    - If on macOS with libtool from brew, LIBTOOLIZE=glibtoolize make
3. Artifacts are in /dist/js
