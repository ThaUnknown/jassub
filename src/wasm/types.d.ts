// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    function getTempRet0(val: any): any;
    function setTempRet0(val: any): any;
}
interface WasmModule {
  __ZdlPvm(_0: number, _1: number): void;
  _malloc(_0: number): number;
  _calloc(_0: number, _1: number): number;
  _emscripten_builtin_free(_0: number): void;
  ___libc_free(_0: number): void;
  _emscripten_builtin_malloc(_0: number): number;
  ___libc_malloc(_0: number): number;
  __ZdaPv(_0: number): void;
  __ZdaPvm(_0: number, _1: number): void;
  __ZdlPv(_0: number): void;
  __Znaj(_0: number): number;
  __ZnajSt11align_val_t(_0: number, _1: number): number;
  __Znwj(_0: number): number;
  __ZnwjSt11align_val_t(_0: number, _1: number): number;
  ___libc_calloc(_0: number, _1: number): number;
  ___libc_realloc(_0: number, _1: number): number;
  _emscripten_builtin_calloc(_0: number, _1: number): number;
  _emscripten_builtin_realloc(_0: number, _1: number): number;
  _malloc_size(_0: number): number;
  _malloc_usable_size(_0: number): number;
  _reallocf(_0: number, _1: number): number;
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export interface ASS_Image extends ClassHandle {
  readonly next: ASS_Image;
  w: number;
  h: number;
  dst_x: number;
  dst_y: number;
  stride: number;
  color: number;
  readonly bitmap: number;
}

export interface ASS_Style extends ClassHandle {
  Bold: number;
  Italic: number;
  Underline: number;
  StrikeOut: number;
  BorderStyle: number;
  Alignment: number;
  MarginL: number;
  MarginR: number;
  MarginV: number;
  Encoding: number;
  treat_fontname_as_pattern: number;
  Justify: number;
  PrimaryColour: number;
  SecondaryColour: number;
  OutlineColour: number;
  BackColour: number;
  FontSize: number;
  ScaleX: number;
  ScaleY: number;
  Spacing: number;
  Angle: number;
  Outline: number;
  Shadow: number;
  Blur: number;
  get Name(): string;
  set Name(value: EmbindString);
  get FontName(): string;
  set FontName(value: EmbindString);
}

export interface ASS_Event extends ClassHandle {
  ReadOrder: number;
  Layer: number;
  Style: number;
  MarginL: number;
  MarginR: number;
  MarginV: number;
  Start: number;
  Duration: number;
  get Name(): string;
  set Name(value: EmbindString);
  get Effect(): string;
  set Effect(value: EmbindString);
  get Text(): string;
  set Text(value: EmbindString);
}

export interface JASSUB extends ClassHandle {
  trackColorSpace: number;
  changed: number;
  count: number;
  removeTrack(): void;
  quitLibrary(): void;
  reloadFonts(): void;
  removeAllEvents(): void;
  styleOverride(_0: ASS_Style): void;
  disableStyleOverride(): void;
  setLogLevel(_0: number): void;
  resizeCanvas(_0: number, _1: number, _2: number, _3: number): void;
  setMargin(_0: number, _1: number, _2: number, _3: number): void;
  getEventCount(): number;
  allocEvent(): number;
  allocStyle(): number;
  removeEvent(_0: number): void;
  getStyleCount(): number;
  removeStyle(_0: number): void;
  setMemoryLimits(_0: number, _1: number): void;
  getEvent(_0: number): ASS_Event | null;
  getStyle(_0: number): ASS_Style | null;
  setThreads(_0: number): number;
  rawRender(_0: number, _1: number): ASS_Image | null;
  createTrackMem(_0: EmbindString): void;
  addFont(_0: EmbindString, _1: number, _2: number): void;
  setDefaultFont(_0: EmbindString): void;
}

interface EmbindModule {
  ASS_Image: {};
  ASS_Style: {};
  ASS_Event: {};
  JASSUB: {
    new(_0: number, _1: number, _2: EmbindString): JASSUB;
  };
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
