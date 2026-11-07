#!/usr/bin/env bash
# Builds the single-thread WebAssembly MVP jassub build into legacy/ of the mounted demo repository.
# Runs in the image of ./Dockerfile. Rebuild with:
#
#   docker build -t jassub-legacy legacy-build
#   docker run --rm -v "${PWD}:/demo" jassub-legacy
set -euo pipefail

# jassub 2.5.36, the version this demo depends on.
JASSUB_REPO=https://github.com/ThaUnknown/jassub.git
JASSUB_COMMIT=ed0edc7

WORK=/work/jassub
OUT=/demo/legacy
VARIANT=legacy-mvp
# The Makefile names its targets with absolute paths.
LIB="$WORK/dist/libraries/$VARIANT/lib"

echo "=== jassub $JASSUB_COMMIT ==="
rm -rf "$WORK"
git clone --quiet "$JASSUB_REPO" "$WORK"
git -C "$WORK" checkout --quiet "$JASSUB_COMMIT"
git -C "$WORK" submodule update --init --recursive --quiet
cd "$WORK"

echo "=== patch the build ==="
# --enable-pthreads comes from CONFIGURE_AUTO in functions.mk and from the libass line of the Makefile.
sed -i 's/--enable-pthreads/--disable-pthreads/g' functions.mk Makefile
# Set these in the Makefile, not on the make command line: command-line variables reach the sub-makes
# and would override the CFLAGS that libass's configure filled with the fribidi and freetype includes.
sed -i 's|^export CFLAGS = .*|export CFLAGS = -O3 -flto -fno-rtti -fno-exceptions -fno-math-errno -ffast-math|' Makefile
cp /kit/pre-worker.js src/worker/pre-worker.js
cp /kit/library-legacy.js src/worker/library-legacy.js

echo "=== libraries ==="
make BUILD_VARIANT="$VARIANT" \
  "$LIB/libfribidi.a" "$LIB/libbrotlicommon.a" "$LIB/libbrotlidec.a" \
  "$LIB/libfreetype.a" "$LIB/libharfbuzz.a" "$LIB/libass.a"

echo "=== link ==="
mkdir -p src/wasm
em++ src/JASSUB.cpp \
  "$LIB/libfribidi.a" "$LIB/libbrotlicommon.a" "$LIB/libbrotlidec.a" \
  "$LIB/libfreetype.a" "$LIB/libharfbuzz.a" "$LIB/libass.a" \
  -s MALLOC=emmalloc \
  -s BINARYEN_EXTRA_PASSES=--one-caller-inline-max-function-size=19306 \
  -s INVOKE_RUN=0 \
  -s DISABLE_EXCEPTION_CATCHING=1 \
  -s TEXTDECODER=1 \
  -s INITIAL_MEMORY=64MB \
  -s DYNAMIC_EXECUTION=0 \
  -s EMBIND_AOT=1 \
  -s MINIMAL_RUNTIME_STREAMING_WASM_INSTANTIATION=1 \
  -flto -fno-exceptions -fno-math-errno -ffast-math -O3 \
  -s STACK_SIZE=256KB \
  -s POLYFILL=0 \
  -s FILESYSTEM=0 \
  -s AUTO_JS_LIBRARIES=0 \
  -s AUTO_NATIVE_LIBRARIES=0 \
  -s HTML5_SUPPORT_DEFERRING_USER_SENSITIVE_REQUESTS=0 \
  -s INCOMING_MODULE_JS_API="[]" \
  -s USE_SDL=0 \
  -s EXPORTED_RUNTIME_METHODS="[]" \
  -s MINIMAL_RUNTIME=1 \
  -s MAXIMUM_MEMORY=2GB \
  -s WASM=2 \
  -s WASM_BIGINT=0 \
  -s EXPORTED_FUNCTIONS="['_malloc']" \
  -s EXPORT_KEEPALIVE=1 \
  -s DISABLE_EXCEPTION_THROWING=1 \
  -s DEFAULT_LIBRARY_FUNCS_TO_INCLUDE='["$stringToNewUTF8"]' \
  -s MIN_CHROME_VERSION=74 \
  -s MIN_FIREFOX_VERSION=68 \
  -s MIN_SAFARI_VERSION=120200 \
  -s LEGACY_VM_SUPPORT=1 \
  --pre-js src/worker/pre-worker.js \
  --js-library src/worker/library-legacy.js \
  -s ENVIRONMENT=worker \
  -s EXIT_RUNTIME=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=0 \
  -s EXPORT_NAME=JASSUBLegacy \
  -lembind \
  -o src/wasm/jassub-worker-legacy.js

echo "=== install ==="
mkdir -p "$OUT"
cp src/wasm/jassub-worker-legacy.js src/wasm/jassub-worker-legacy.wasm src/wasm/jassub-worker-legacy.wasm.js "$OUT/"
ls -l "$OUT"
echo "=== done ==="
