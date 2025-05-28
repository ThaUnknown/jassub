interface ASS_Event {
  Start: number;
  Duration: number;
  Style: string;
  Name: string;
  MarginL: number;
  MarginR: number;
  MarginV: number;
  Effect: string;
  Text: string;
  ReadOrder: number;
  Layer: number;
  _index: number;
}

interface ASS_Style {
  Name: string;
  FontName: string;
  FontSize: number;
  PrimaryColour: number; // uint32_t RGBA
  SecondaryColour: number; // uint32_t RGBA
  OutlineColour: number; // uint32_t RGBA
  BackColour: number; // uint32_t RGBA
  Bold: number;
  Italic: number;
  Underline: number;
  StrikeOut: number;
  ScaleX: number;
  ScaleY: number;
  Spacing: number;
  Angle: number;
  BorderStyle: number;
  Outline: number;
  Shadow: number;
  Alignment: number;
  MarginL: number;
  MarginR: number;
  MarginV: number;
  Encoding: number;
  treat_fontname_as_pattern: number;
  Blur: number;
  Justify: number;
}

interface JassubOptions {

  video?: HTMLVideoElement;
  canvas?: HTMLCanvasElement;

  blendMode?: 'js' | 'wasm';

  asyncRender?: boolean;
  offscreenRender?: boolean;
  onDemandRender?: boolean;
  targetFps?: number;
  timeOffset?: number;

  debug?: boolean;
  prescaleFactor?: number;
  prescaleHeightLimit?: number;
  maxRenderHeight?: number;
  dropAllAnimations?: boolean;
  dropAllBlur?: boolean

  workerUrl?: string;
  wasmUrl?: string;
  legacyWasmUrl?: string;
  modernWasmUrl?: string;

  subUrl?: string;
  subContent?: string;

  fonts?: string[] | Uint8Array[];
  availableFonts?: Record<string, string>;
  fallbackFont?: string;
  useLocalFonts?: boolean;

  libassMemoryLimit?: number;
  libassGlyphLimit?: number;
}

type ASS_EventCallback = (error: Error | null, event: ASS_Event[]) => void;
type ASS_StyleCallback = (error: Error | null, event: ASS_Style[]) => void;

export default class JASSUB {
  constructor (options: JassubOptions);

  resize (width?: number, height?: number, top?: number, left?: number): void;
  setVideo (video: HTMLVideoElement): void;
  runBenchmark (): void;

  setTrackByUrl (url: string): void;
  setTrack (content: string): void;
  freeTrack (): void;

  setIsPaused (isPaused: boolean): void;
  setRate (rate: number): void;
  setCurrentTime (isPaused?: boolean, currentTime?: number, rate?: number): void;

  createEvent (event: ASS_Event): void;
  setEvent (event: ASS_Event, index: number): void;
  removeEvent (index: number): void;
  getEvents (callback: ASS_EventCallback): void;

  createStyle (style: ASS_Style): void;
  setStyle (style: ASS_Style, index: number): void;
  removeStyle (index: number): void;
  getStyles (callback: ASS_StyleCallback): void;
  styleOverride (style: ASS_Style): void;
  disableStyleOverride();

  addFont (font: string | Uint8Array): void;

  sendMessage (target: string, data?: Record<string, unknown>, transferable?: Transferable[]): void;
  destroy (err?: string): void;

  _ctx: CanvasRenderingContext2D;
  _canvas: HTMLCanvasElement;
}
