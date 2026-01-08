export interface Subtitle {
  delay: number
  fonts: string[]
  subUrl: string
  videoUrl: string
}

export interface PerfInfo {
  fps: number
  processingDuration: number
  droppedFrames: number
  presentedFrames: number
  mistimedFrames: number
}

export type PerfCallback = (info: PerfInfo) => void

export const subtitleList: Record<string, Subtitle> = {
  variable: {
    delay: 0,
    fonts: [],
    subUrl: '/subtitles/box.ass',
    videoUrl: '/videos/vfr.mp4'
  },
  high: {
    delay: 0,
    fonts: [],
    subUrl: '/subtitles/box.ass',
    videoUrl: '/videos/cfr.mp4'
  },
  simple: {
    delay: 0,
    fonts: [],
    subUrl: '/subtitles/test.ass',
    videoUrl: 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  },
  fate: {
    delay: -0.041,
    fonts: [
      '/fonts/Averia Sans Libre Light.ttf',
      '/fonts/Averia Serif Simple Light.ttf',
      '/fonts/Gramond.ttf'
    ],
    subUrl: '/subtitles/FGOBD.ass',
    videoUrl: 'https://v.animethemes.moe/FateGrandOrderBabylonia-OP1v2-NCBD1080.webm'
  },
  beastars: {
    delay: 246.38,
    fonts: [
      '/fonts/architext.regular.ttf',
      '/fonts/FRABK.TTF',
      '/fonts/allison-script.regular.otf',
      '/fonts/Lato-Regular.ttf',
      '/fonts/chawp.otf',
      '/fonts/arial.ttf',
      '/fonts/SlatePro-Medium.otf'
    ],
    subUrl: '/subtitles/beastars.ass',
    videoUrl: '/videos/Beastars.mp4'
  },
  kusriya: {
    delay: 0,
    fonts: [],
    subUrl: '/subtitles/Kusriya S2 OP1v3.ass',
    videoUrl: 'https://v.animethemes.moe/KusuriyaNoHitorigotoS2-OP1-NCBD1080.webm'
  }
} as const

export const renderers = ['jassub', 'jsso', 'assjs', 'sabre'] as const
