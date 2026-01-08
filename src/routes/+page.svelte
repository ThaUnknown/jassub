<script lang='ts'>
  import { subtitleList, renderers } from '$lib/constants'

</script>

<div>
  <h1>Available Subtitles</h1>
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
            <td>
              <a href='/{subtitle}/{renderer}/'>{subtitle}</a>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  div {
    max-width: 80vw;
    margin: 40px auto;
    padding: 0 10px;
  }
  table {
    border-collapse: collapse;
    border: 1px solid #ccc;
  }
  th,
  td {
    border: 1px solid #ccc;
    padding: 8px 12px;
    text-align: left;
  }
</style>
