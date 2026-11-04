// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
  __ZdlPvm(_0: number, _1: number): void;
  __Znwm(_0: number): number;
  _malloc(_0: number): number;
  _calloc(_0: number, _1: number): number;
  _emscripten_builtin_free(_0: number): void;
  ___libc_free(_0: number): void;
  _emscripten_builtin_malloc(_0: number): number;
  ___libc_malloc(_0: number): number;
  __ZdaPv(_0: number): void;
  __ZdaPvm(_0: number, _1: number): void;
  __ZdlPv(_0: number): void;
  __Znam(_0: number): number;
  __ZnamSt11align_val_t(_0: number, _1: number): number;
  __ZnwmSt11align_val_t(_0: number, _1: number): number;
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
export interface JASSUB extends ClassHandle {
  trackColorSpace: number;
  removeTrack(): void;
  quitLibrary(): void;
  reloadFonts(): void;
  disableStyleOverride(): void;
  removeAllEvents(): boolean;
  setLogLevel(_0: number): void;
  resizeCanvas(_0: number, _1: number, _2: number, _3: number): void;
  setMargin(_0: number, _1: number, _2: number, _3: number): void;
  removeEvent(_0: number): boolean;
  removeStyle(_0: number): boolean;
  setMemoryLimits(_0: number, _1: number): void;
  setThreads(_0: number): number;
  pruneEvents(_0: number): boolean;
  configurePrune(_0: number): boolean;
  createTrackMem(_0: EmbindString): void;
  processData(_0: EmbindString): boolean;
  processChunk(_0: EmbindString, _1: number, _2: number): boolean;
  addFont(_0: any, _1: number, _2: number): void;
  getEvents(): any;
  getStyles(): any;
  createEvent(_0: any): boolean;
  setEvent(_0: number, _1: any): boolean;
  createStyle(_0: any): boolean;
  setStyle(_0: number, _1: any): boolean;
  rawRender(_0: number, _1: number): any;
  styleOverride(_0: any): void;
  setDefaultFont(_0: any): void;
}

interface EmbindModule {
  JASSUB: {
    new(_0: number, _1: number, _2: any): JASSUB;
  };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
