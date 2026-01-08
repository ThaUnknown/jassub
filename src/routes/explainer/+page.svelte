<div>
  <p>
    View the <a href='https://github.com/ThaUnknown/jassub#readme' target='_blank'>Readme</a> for usage details.
  </p>
  <h1 class='content-title'>Isn't this just the same thing as JavascriptSubtitlesOctopus?</h1>
  <p>No, here's why:</p>
  <ul>
    <li>It's frame perfect</li>
    <ul>
      <li>This version can render TS perfectly without miscalculating display times at all</li>
      <li>This version can detect the video framerate, and render subtitles at that framerate, instead of hardcoding 24fps</li>
      <li>This version can handle variable framerate videos perfectly</li>
      <li>Supports anamorphic videos</li>
      <li>Performs color space mangling</li>
    </ul>
    <li>This is smaller</li>
    <ul>
      <li>This version removes a LOT of dead code, unused dependencies and misused functionality, duplicate code and fixes for old browser engines</li>
      <li>This version doesn't force default assets by default, instead they can easily be loaded at runtime, but only if needed</li>
    </ul>
    <li>This is faster, a LOT faster</li>
    <ul>
      <li>Can run fully in the worker, thanks to offscreen canvases, making sure the rest of the website/webapp doesn't lag</li>
      <li>Removes almost all C++ and JS procesing code, instead it calls libass directly, returns the raw data, and appends it directly to Vulkan shaders, with 0 processing, 0 iterations and 0 copies</li>
    </ul>
    <li>This fixes a LOT of bugs</li>
    <ul>
      <li>Your browser will no longer crash when resizing video with animations</li>
      <li>Your browser won't leak 10's of MB's of RAM when resizing video with animations</li>
      <li>Your browser will free up memory quicker</li>
      <li>The subtitles will no longer randomly disappear</li>
      <li>The subtitles will no longer dissapear when moving or resizing the video</li>
    </ul>
    <li>This loads a LOT faster thanks to a lot of font improvements</li>
    <ul>
      <li>Fonts don't block the load of the library</li>
      <li>Fonts are loaded in the background and updated asynchronously</li>
      <li>Fonts can be loaded as direct Uint8 data, so the user can preload fonts by themselves</li>
      <li>Can load local fonts from the user's device</li>
    </ul>
  </ul>
</div>

<style>
  div {
    max-width: 80vw;
    margin: 40px auto;
    padding: 0 10px;
  }
</style>
