import { ARCHITEXT, LATO } from './fonts.ts'

const HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Lato,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,20,1
Style: Box,Lato,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,4,0,8,20,20,20,1
Style: NoOutline,Lato,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

function ass (events: string, scriptInfo = '') {
  const header = scriptInfo
    ? HEADER.replace('ScriptType: v4.00+', `ScriptType: v4.00+\n${scriptInfo}`)
    : HEADER
  return header + events.trim() + '\n'
}

interface EvOptions {
  start?: string
  end?: string
  style?: string
  layer?: number
}

const ev = (text: string, opts: EvOptions = {}) =>
  `Dialogue: ${opts.layer ?? 0},${opts.start ?? '0:00:00.00'},${opts.end ?? '0:00:05.00'},${opts.style ?? 'Default'},,0,0,0,,${text}`

export interface Case {
  name: string
  ass: string
  time: number
  fonts?: string[]
  // Video color space. A subtitle matrix that differs from it triggers the
  // color conversion.
  videoColorSpace?: 'BT709' | 'BT601'
  // Check only the modern build. Use for fallback cases where libass versions
  // differ.
  modernOnly?: boolean
  // Tolerance overrides. A case that sets any of these must also give a
  // reason.
  tol?: number
  minWithin?: number
  maxMeanAbs?: number
  tolReason?: string
}

export const CASES: Case[] = [
  // Alignment
  { name: 'basic-text', ass: ass(ev('Hello JASSUB')), time: 2.5 },
  { name: 'align-an1', ass: ass(ev('{\\an1}bottom left')), time: 2.5 },
  { name: 'align-an2', ass: ass(ev('{\\an2}bottom center')), time: 2.5 },
  { name: 'align-an3', ass: ass(ev('{\\an3}bottom right')), time: 2.5 },
  { name: 'align-an4', ass: ass(ev('{\\an4}middle left')), time: 2.5 },
  { name: 'align-an5', ass: ass(ev('{\\an5}middle center')), time: 2.5 },
  { name: 'align-an6', ass: ass(ev('{\\an6}middle right')), time: 2.5 },
  { name: 'align-an7', ass: ass(ev('{\\an7}top left')), time: 2.5 },
  { name: 'align-an8', ass: ass(ev('{\\an8}top center')), time: 2.5 },
  { name: 'align-an9', ass: ass(ev('{\\an9}top right')), time: 2.5 },

  // Color and alpha
  { name: 'color-primary', ass: ass(ev('{\\1c&H0000FF&}red {\\1c&H00FF00&}green {\\1c&HFF0000&}blue {\\1c&HFFFFFF&}white')), time: 2.5 },
  { name: 'color-outline', ass: ass(ev('{\\3c&H00FFFF&\\bord4}cyan outline')), time: 2.5 },
  { name: 'color-back', ass: ass(ev('{\\4c&HFF00FF&\\shad6}magenta shadow')), time: 2.5 },
  { name: 'alpha-primary', ass: ass(ev('{\\1a&H80&}half alpha') + '\n' + ev('{\\1a&H00&}opaque', { start: '0:00:00.25' })), time: 2.5 },
  { name: 'alpha-outline', ass: ass(ev('{\\3a&H80&\\bord6}half outline')), time: 2.5 },
  { name: 'alpha-back', ass: ass(ev('{\\4a&H80&\\shad6}half shadow')), time: 2.5 },
  { name: 'alpha-invisible', ass: ass(ev('{\\alpha&HFF&}invisible')), time: 2.5 },

  // Borders and shadows
  { name: 'border-0', ass: ass(ev('{\\bord0\\shad0}no border', { style: 'NoOutline' })), time: 2.5 },
  { name: 'border-1', ass: ass(ev('{\\bord1}border 1')), time: 2.5 },
  { name: 'border-4', ass: ass(ev('{\\bord4}border 4')), time: 2.5 },
  { name: 'shadow-0', ass: ass(ev('{\\shad0}no shadow')), time: 2.5 },
  { name: 'shadow-4', ass: ass(ev('{\\shad4}shadow 4')), time: 2.5 },
  { name: 'shadow-subpixel', ass: ass(ev('{\\shad3.5}subpixel shadow')), time: 2.5 },
  { name: 'box-bordstyle3', ass: ass(ev('{\\bord6\\1c&H000000&}opaque box', { style: 'Box' })), time: 2.5 },

  // Blur
  { name: 'blur-4', ass: ass(ev('{\\blur4\\bord2}blur 4')), time: 2.5 },
  { name: 'blur-16', ass: ass(ev('{\\blur16\\bord2}blur 16')), time: 2.5, tol: 2, tolReason: 'blur edges differ by 2 levels between libass versions' },
  { name: 'blur-be1', ass: ass(ev('{\\be1\\shad0}be1')), time: 2.5 },

  // Font style
  { name: 'bold', ass: ass(ev('{\\b1}bold text')), time: 2.5 },
  { name: 'italic', ass: ass(ev('{\\i1}italic text')), time: 2.5 },
  { name: 'underline', ass: ass(ev('{\\u1}underlined')), time: 2.5 },
  { name: 'strikeout', ass: ass(ev('{\\s1}strikeout')), time: 2.5 },
  { name: 'scale-x', ass: ass(ev('{\\fscx150}wide text')), time: 2.5 },
  { name: 'scale-y', ass: ass(ev('{\\fscy150}tall text')), time: 2.5 },
  { name: 'spacing', ass: ass(ev('{\\fsp10}spaced out')), time: 2.5 },
  { name: 'angle', ass: ass(ev('{\\frz30}angled')), time: 2.5 },
  { name: 'huge-font', ass: ass(ev('{\\fs120}Huge')), time: 2.5 },
  { name: 'tiny-font', ass: ass(ev('{\\fs10}tiny')), time: 2.5 },
  { name: 'style-reset', ass: ass(ev('{\\b1\\i1}bold italic {\\r}reset')), time: 2.5 },

  // Wrapping
  {
    name: 'wrap-default',
    ass: ass(ev('The quick brown fox jumps over the lazy dog again and again and again and again')),
    time: 2.5
  },
  { name: 'wrap-q2', ass: ass(ev('{\\q2}The quick brown fox jumps over the lazy dog and keeps running far past the edge', { style: 'Default' })), time: 2.5 },
  { name: 'wrap-q1', ass: ass(ev('{\\q1}The quick brown fox jumps over the lazy dog and keeps running far past the edge')), time: 2.5 },
  { name: 'wrap-q3', ass: ass(ev('{\\q3}The quick brown fox jumps over the lazy dog and keeps running far past the edge')), time: 2.5 },
  { name: 'linebreak', ass: ass(ev('first line\\Nsecond line\\nsoft break')), time: 2.5 },
  { name: 'hard-space', ass: ass(ev('text\\h\\h\\h\\hpushed')), time: 2.5 },

  // Position and animation
  { name: 'position', ass: ass(ev('{\\pos(200,120)}positioned')), time: 2.5 },
  { name: 'move', ass: ass(ev('{\\move(100,100,540,260,0,4000)}moving')), time: 2.0 },
  { name: 'origin-rotate', ass: ass(ev('{\\org(100,100)\\pos(320,180)\\frz45}origin')), time: 2.5 },
  { name: 'rotate-3d-x', ass: ass(ev('{\\frx45}rotate x')), time: 2.5 },
  { name: 'rotate-3d-y', ass: ass(ev('{\\fry45}rotate y')), time: 2.5 },
  { name: 'transform-rotate', ass: ass(ev('{\\an5\\t(0,4000,\\frz360)}spinning')), time: 1.0 },
  { name: 'transform-scale', ass: ass(ev('{\\an5\\t(0,2000,\\fscx250\\fscy250)}growing')), time: 1.0 },
  { name: 'transform-border', ass: ass(ev('{\\an5\\bord0\\t(0,2000,\\bord12)}growing border')), time: 1.0 },
  { name: 'transform-shadow', ass: ass(ev('{\\an5\\shad0\\t(0,2000,\\shad12)}growing shadow')), time: 1.0 },
  { name: 'fade-fad', ass: ass(ev('{\\fad(1000,1000)}fading')), time: 0.5 },
  { name: 'fade-t-alpha', ass: ass(ev('{\\an5\\t(0,1000,\\alpha&HFF&)}fading out')), time: 0.5 },

  // Clipping
  { name: 'clip-rect', ass: ass(ev('{\\an5\\pos(320,180)\\clip(200,120,440,240)}clipped text is only partly visible')), time: 2.5 },
  { name: 'iclip-rect', ass: ass(ev('{\\an5\\pos(320,180)\\iclip(200,120,440,240)}inverse clipped text')), time: 2.5 },
  { name: 'clip-vector', ass: ass(ev('{\\an5\\pos(320,180)\\clip(m 150 200 b 320 60 490 200 320 200)}vector clip')), time: 2.5 },

  // Drawings
  { name: 'drawing-fill', ass: ass(ev('{\\an5\\pos(320,180)\\p1\\bord0\\1c&H00FFFF&}m 0 0 l 120 0 120 120 0 120')), time: 2.5 },
  { name: 'drawing-bordered', ass: ass(ev('{\\an5\\pos(320,180)\\p1\\bord4\\1c&H00FF00&\\3c&H000000&}m 0 0 l 120 0 120 120 0 120')), time: 2.5 },
  { name: 'drawing-then-text', ass: ass(ev('{\\an5\\pos(320,180)}before {\\p1}m 0 0 l 200 0 200 60 0 60{\\p0} after')), time: 2.5 },

  // Karaoke
  { name: 'karaoke-k', ass: ass(ev('{\\an5\\1c&H808080&}ka{\\k30}ra{\\k30}o{\\k30}ke')), time: 2.45 },
  { name: 'karaoke-kf', ass: ass(ev('{\\an5\\1c&H808080&}ka{\\kf40}ra{\\kf40}o{\\kf40}ke')), time: 2.45 },
  { name: 'karaoke-K', ass: ass(ev('{\\an5\\1c&H808080&}ka{\\K40}ra{\\K40}o{\\K40}ke')), time: 2.45 },

  // Overlapping events
  {
    name: 'overlap-opaque',
    ass: ass(ev('{\\an5\\pos(300,180)\\1c&H0000FF&}RED', { layer: 0 }) + '\n' + ev('{\\an5\\pos(340,180)\\1c&H00FF00&}GREEN', { layer: 1 })),
    time: 2.5
  },
  {
    name: 'overlap-alpha',
    ass: ass(ev('{\\an5\\pos(300,180)\\1a&H80&\\1c&H0000FF&}ALPHA', { layer: 0 }) + '\n' + ev('{\\an5\\pos(340,180)\\1a&H80&\\1c&H00FF00&}ALPHA', { layer: 1 })),
    time: 2.5
  },
  { name: 'layers-many', ass: ass(
    ev('bottom layer', { layer: 0 }) + '\n' +
    ev('middle layer', { layer: 1, start: '0:00:00.10' }) + '\n' +
    ev('top layer', { layer: 2, start: '0:00:00.20' })
  ), time: 2.5 },

  // Fonts and fallback
  {
    name: 'font-switch',
    ass: ass(ev('{\\fnArchitext}Architext font {\\r} back to Lato')),
    time: 2.5,
    fonts: [LATO, ARCHITEXT]
  },
  {
    name: 'font-missing-fallback',
    ass: ass(ev('{\\fnNoSuchFont123}missing font falls back to Lato')),
    time: 2.5,
    fonts: [LATO]
  },
  {
    name: 'font-style-missing',
    ass: ass(ev('style font is missing', { style: 'Box' })),
    time: 2.5,
    fonts: [ARCHITEXT]
  },

  // Unicode
  { name: 'unicode-cjk', ass: ass(ev('日本語のテスト')), time: 2.5 },
  { name: 'unicode-cyrillic', ass: ass(ev('Привет мир')), time: 2.5 },
  { name: 'unicode-greek', ass: ass(ev('Γειά σου κόσμε')), time: 2.5 },
  { name: 'unicode-combining', ass: ass(ev('e\u0301 a\u0300 n\u0303')), time: 2.5 },
  { name: 'unicode-rtl-arabic', ass: ass(ev('مرحبا بالعالم')), time: 2.5, modernOnly: true },
  { name: 'unicode-rtl-hebrew', ass: ass(ev('שלום עולם')), time: 2.5, modernOnly: true },
  { name: 'unicode-symbols', ass: ass(ev('© ® ™ → ← ↑ ↓ ± × ÷')), time: 2.5 },
  { name: 'unicode-emoji', ass: ass(ev('emoji 😀🎉🚀 fallback')), time: 2.5, modernOnly: true },

  // Edge cases
  { name: 'empty-event', ass: ass(ev('')), time: 2.5 },
  { name: 'zero-length-event', ass: ass(ev('zero length', { start: '0:00:02.50', end: '0:00:02.50' })), time: 2.5 },
  { name: 'unknown-style', ass: ass(ev('unknown style', { style: 'DoesNotExist' })), time: 2.5 },
  { name: 'comment-only', ass: ass('Comment: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,this is a comment'), time: 2.5 },
  { name: 'escaped-braces', ass: ass(ev('literal braces \\{ and \\} here')), time: 2.5 },
  { name: 'override-comment', ass: ass(ev('visible {\\b1}bold{\\r} and {inline comment} ignored')), time: 2.5 },

  // Color space
  { name: 'colorspace-601-video-709', ass: ass(ev('{\\1c&H0000FF&}red {\\1c&H00FF00&}green {\\1c&HFF0000&}blue'), 'YCbCr Matrix: TV.601'), time: 2.5, videoColorSpace: 'BT709', tol: 64, maxMeanAbs: 0.2, tolReason: 'the 1.8.8 SVG filter converts in linearRGB; the modern build converts in sRGB' },
  { name: 'colorspace-709-video-601', ass: ass(ev('{\\1c&H0000FF&}red {\\1c&H00FF00&}green {\\1c&HFF0000&}blue'), 'YCbCr Matrix: TV.709'), time: 2.5, videoColorSpace: 'BT601', tol: 64, maxMeanAbs: 0.2, tolReason: 'the 1.8.8 SVG filter converts in linearRGB; the modern build converts in sRGB' }
]
