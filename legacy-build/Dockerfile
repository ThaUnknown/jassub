# Emscripten 4.0.23 is the last version that still legalizes i64 imports (WASM_BIGINT=0) and still emits
# the WASM=2 wasm2js shim. Newer versions removed both and raised their floor to Chrome 85, which is the
# build this one exists to get below.
FROM docker.io/emscripten/emsdk:4.0.23

# The base image has no autotools, which the library submodules of jassub need to build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake dos2unix git ragel patch libtool itstool pkg-config \
      python3 gettext autopoint automake autoconf m4 gperf \
    && rm -rf /var/lib/apt/lists/*

COPY . /kit/

ENTRYPOINT ["bash", "/kit/build.sh"]
