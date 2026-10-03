// Vitest forwards browser console output to the terminal without a color API.
// Use ANSI codes to color and align the result lines.
const wrap = (code: string, text: string) => `\u001B[${code}m${text}\u001B[0m`

export const green = (text: string) => wrap('32', text)
export const yellow = (text: string) => wrap('33', text)
export const orange = (text: string) => wrap('38;5;208', text)
export const red = (text: string) => wrap('31', text)
export const cyan = (text: string) => wrap('36', text)
export const bold = (text: string) => wrap('1', text)
export const dim = (text: string) => wrap('2', text)

export interface Metrics {
  within: number
  meanAbs: number
  max: number
}

// Color the match percentage. The thresholds use the displayed value.
// Green at 100.0%. Yellow from 99.5%. Orange from 99.0%. Red below 99.0%.
function withinColor (percent: number, text: string) {
  if (percent >= 100) return green(text)
  if (percent >= 99.5) return yellow(text)
  if (percent >= 99) return orange(text)
  return red(text)
}

export function logTolerance (label: string, metrics: Metrics, ok: boolean, note = '') {
  const percent = Math.round(metrics.within * 1000) / 10
  const within = `${percent.toFixed(1)}%`.padStart(6)
  const meanAbs = metrics.meanAbs.toFixed(2).padStart(6)
  const max = String(metrics.max).padStart(4)
  const tag = ok ? green('PASS') : red('FAIL')
  const line = `${tag} ${bold(label.padEnd(28))} ${dim('within=')}${withinColor(percent, within)}${dim(`  meanAbs=${meanAbs}  max=${max}`)}`
  console.log(line + (note ? `  ${dim(`(${note})`)}` : ''))
}

export function logInfo (label: string, detail: string) {
  console.log(`${cyan('INFO')} ${bold(label.padEnd(28))} ${dim(detail)}`)
}
