// Side-effect module, import it first in the legacy worker.
// core-js must not go through Babel: its Symbol sham relies on raw typeof checks, while the Babel
// helpers of the rest of the chunk rely on the typeof transform to recognise sham symbols. The two
// cannot share one transpiled chunk, so the prebuilt ES5 bundle loads as a separate script.
import coreJsUrl from 'core-js-bundle/minified.js?url'

declare const self: DedicatedWorkerGlobalScope

self.importScripts(coreJsUrl)
