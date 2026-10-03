export interface CorpusEvent {
  start: number
  end: number
  style: string
  layer: number
  text: string
}

export interface ParsedAss {
  styles: Record<string, { font: string }>
  events: CorpusEvent[]
}

export interface CorpusCue {
  time: number
  style: string
  text: string
}

// Parse H:MM:SS.CC. The separator can be a dot.
export function parseAssTime (value: string): number {
  const match = value.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/)
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100
}

function splitColumns (formatLine: string, dataLine: string): string[] {
  const columns = formatLine.replace(/^Format:\s*/i, '').split(',').map(c => c.trim().toLowerCase())
  const values = dataLine.split(',')
  // The Text column can contain commas. Keep the tail intact.
  if (values.length > columns.length) {
    values[columns.length - 1] = values.slice(columns.length - 1).join(',')
    values.length = columns.length
  }
  return columns.map((_, i) => values[i]?.trim() ?? '')
}

export function parseAss (content: string): ParsedAss {
  const styles: ParsedAss['styles'] = {}
  const events: CorpusEvent[] = []
  let section = ''
  let styleFormat = ''
  let eventFormat = ''

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]!.toLowerCase()
      continue
    }
    if (!line || line.startsWith(';')) continue

    if (/^format\s*:/i.test(line)) {
      if (section.startsWith('v4') && section.includes('styles')) styleFormat = line
      else if (section === 'events') eventFormat = line
      continue
    }

    if (section.startsWith('v4') && section.includes('styles') && /^style\s*:/i.test(line) && styleFormat) {
      const columns = splitColumns(styleFormat, line.replace(/^style\s*:/i, ''))
      const format = styleFormat.replace(/^Format:\s*/i, '').split(',').map(c => c.trim().toLowerCase())
      const name = columns[format.indexOf('name')]
      const font = columns[format.indexOf('fontname')]
      if (name) styles[name] = { font: font ?? '' }
      continue
    }

    if (section === 'events' && /^dialogue\s*:/i.test(line) && eventFormat) {
      const columns = splitColumns(eventFormat, line.replace(/^dialogue\s*:/i, ''))
      const format = eventFormat.replace(/^Format:\s*/i, '').split(',').map(c => c.trim().toLowerCase())
      events.push({
        start: parseAssTime(columns[format.indexOf('start')] ?? ''),
        end: parseAssTime(columns[format.indexOf('end')] ?? ''),
        style: columns[format.indexOf('style')] ?? 'Default',
        layer: Number(columns[format.indexOf('layer')] ?? 0) || 0,
        text: columns[format.indexOf('text')] ?? ''
      })
    }
  }

  return { styles, events }
}

export function stripTags (text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nnh]/g, ' ')
    .trim()
}

function isVisible (text: string): boolean {
  return stripTags(text).length > 0
}

// Pick up to perStyle visible cues for each style. Cap the total at max.
export function sampleCues (parsed: ParsedAss, options: { perStyle?: number, max?: number } = {}): CorpusCue[] {
  const perStyle = options.perStyle ?? 1
  const max = options.max ?? 6
  const byStyle = new Map<string, CorpusEvent[]>()

  for (const event of parsed.events) {
    if (event.end <= event.start) continue
    if (!isVisible(event.text)) continue
    const list = byStyle.get(event.style) ?? []
    list.push(event)
    byStyle.set(event.style, list)
  }

  const cues: CorpusCue[] = []
  const styles = [...byStyle.keys()].sort()
  const perStylePicked = new Map<string, CorpusCue[]>()

  for (const style of styles) {
    const list = byStyle.get(style)!
    const count = Math.min(perStyle, list.length)
    const picked: CorpusCue[] = []
    for (let i = 0; i < count; i++) {
      const index = count === 1 ? Math.floor(list.length / 2) : Math.round((i * (list.length - 1)) / (count - 1))
      const event = list[index]!
      picked.push({
        time: event.start + (event.end - event.start) / 2,
        style,
        text: stripTags(event.text)
      })
    }
    perStylePicked.set(style, picked)
  }

  // Interleave the styles to spread the cap across styles.
  for (let round = 0; cues.length < max; round++) {
    let added = false
    for (const style of styles) {
      const picked = perStylePicked.get(style)!
      if (round < picked.length) {
        cues.push(picked[round]!)
        added = true
        if (cues.length >= max) break
      }
    }
    if (!added) break
  }

  return cues
}

export function countNonZero (data: Uint8ClampedArray): number {
  let count = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]) count++
  return count
}
