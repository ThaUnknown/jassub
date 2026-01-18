<script lang='ts'>
  import { subtitleList, renderers } from '$lib/constants'
  import { results, annotations } from '$lib/results'

  const usedAnnotations = [...new Set(
    Object.values(results)
      .flatMap(r => r.notes ?? [])
  )].sort()
</script>

<main>
  <div>Part of the <a href='https://github.com/ThaUnknown/jassub' target='_blank'>JASSUB library</a></div>
  <div>Want to test your own subtitles, fonts or video? <a href='/custom/'>Try the custom page</a></div>
  <h1>Available Subtitles</h1>
  <div>
    Measured average frametimes (in milliseconds) for different renderers and subtitles, with an average of 5sec, saving the highest measured frametime per subtitle+renderer combination at 1080p. Click on a value to run the benchmark yourself.
  </div>
  <table>
    <thead>
      <tr>
        <th>Renderer \ Subtitle</th>
        {#each Object.keys(subtitleList) as subtitle (subtitle)}
          <th>{subtitle}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each renderers as renderer (renderer)}
        <tr>
          <td><strong>{renderer}</strong></td>
          {#each Object.keys(subtitleList) as subtitle (subtitle)}
            {@const result = results[`${renderer}-${subtitle}`]}
            {#if result}
              <td>
                <a href='/{subtitle}/{renderer}/'>
                  {result.frametime === 'FAIL' ? 'FAIL' : `${result.frametime}ms`}
                </a>
                {#if result.notes?.length}
                  <sup class='notes'>{result.notes.join('')}</sup>
                {/if}
              </td>
            {/if}
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>

  {#if usedAnnotations.length > 0}
    <footer>
      <h3>Notes</h3>
      <dl>
        {#each usedAnnotations as note (note)}
          <span>
            <dt>{note}</dt>
            <dd>{annotations[note]}</dd>
          </span>
        {/each}
      </dl>
      <div>JSSO underreports actual timings as it doesn't report the times of unchanged events and rounds times to nearest digit. This causes problems when trying to profile subtitles with gaps.</div>
      <div>ASS.js doesn't provide any way to measure render timings, so it is done on a "best effort", by measuring only if a frame is delayed more than the video frame duration and assuming 1000/videoFPS for everything else [usually 33-42ms], and might not be entirely accurate. For example this means that "42ms is real-time and fine". Also could not get custom fonts working.</div>

    </footer>
  {/if}
</main>
