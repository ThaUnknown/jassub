import type { Plugin } from 'vite'

// abslink proxies an empty function and traps every property name at runtime. proxy-polyfill
// defines a getter per property that exists on the target at creation, so the target gets the
// known names up front. releaseProxy becomes a string: the polyfill enumerates names only, and a
// native Symbol key would stay invisible to it on engines that have Symbol but no Proxy.
// The marker checks use hasOwnProperty instead of the in operator: the Symbol sham of core-js puts
// an accessor for every symbol on Object.prototype, which makes in true for every object.
const RELEASE_SYMBOL = /export const releaseProxy = Symbol\([^)]*\);?/
const PROXY_TARGET = /new Proxy\(function \(\) \{\s*\}, \{/
const MARKER_IN = /(proxyMarker|throwMarker) in (\w+)/g

// The names the page reads on the jassub renderer proxy, then for await. Keep in sync with
// ASSRenderer in jassub/dist/worker/worker.d.ts and src/worker/report.ts.
const REMOTE_KEYS = ['then', 'demoReport', '_draw', '_drawCapture', '_resizeCanvas', '_setColorSpace', 'addFonts', 'configurePrune', 'createEvent', 'createStyle', 'debug', 'disableStyleOverride', 'freeTrack', 'getEvents', 'getStyles', 'processChunk', 'processData', 'pruneEvents', 'queryFonts', 'removeAllEvents', 'removeEvent', 'removeStyle', 'setDefaultFont', 'setEvent', 'setStyle', 'setTrack', 'setTrackByUrl', 'styleOverride']

const HELPER = `
function createProxyTarget () {
  const target = function () {};
  for (const key of ${JSON.stringify(REMOTE_KEYS)}) target[key] = undefined;
  target[releaseProxy] = undefined;
  return target;
}
`

export function patchAbslink (): Plugin {
  return {
    name: 'jassub-legacy:patch-abslink',
    enforce: 'pre',
    transform (code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/abslink/src/abslink.js')) return
      if (!RELEASE_SYMBOL.test(code) || !PROXY_TARGET.test(code) || !MARKER_IN.test(code)) throw new Error('jassub-legacy: abslink.js changed, update patch-abslink.ts')
      MARKER_IN.lastIndex = 0
      return {
        code: code
          .replace(RELEASE_SYMBOL, "export const releaseProxy = '@@abslink.releaseProxy';")
          .replace(PROXY_TARGET, 'new Proxy(createProxyTarget(), {')
          .replace(MARKER_IN, 'Object.prototype.hasOwnProperty.call($2, $1)') + HELPER,
        map: null
      }
    }
  }
}
