# JASSUB.js - Makefile

# make - Build Dependencies and the JASSUB.js
BASE_DIR:=$(dir $(realpath $(firstword $(MAKEFILE_LIST))))

# The MODERN build enables SIMD flags which affect all compiled artifacts.
# Keep caches separate so legacy and modern builds can coexist.
ifeq (${MODERN},1)
	BUILD_VARIANT := modern
else
	BUILD_VARIANT := legacy
endif

BUILD_LIB_DIR := $(BASE_DIR)build/lib/$(BUILD_VARIANT)
DIST_DIR := $(BASE_DIR)dist/libraries/$(BUILD_VARIANT)

export CFLAGS = -O3 -flto -fno-rtti -fno-exceptions -s USE_PTHREADS=1
export CXXFLAGS = $(CFLAGS)
export PKG_CONFIG_PATH = $(DIST_DIR)/lib/pkgconfig
export EM_PKG_CONFIG_PATH = $(PKG_CONFIG_PATH)

SIMD_ARGS = \
	-msimd128 \
	-msse \
	-msse2 \
	-msse3 \
	-mssse3 \
	-msse4 \
	-msse4.1 \
	-msse4.2 \
	-mavx \
	-mavx2 \
	-matomics \
	-mnontrapping-fptoint 

ifeq (${MODERN},1)
	WORKER_NAME = jassub-worker-modern
	WORKER_ARGS = \
		-s WASM=1 \
		$(SIMD_ARGS)

	override CFLAGS += $(SIMD_ARGS)
	override CXXFLAGS += $(SIMD_ARGS)

else
	WORKER_NAME = jassub-worker
	WORKER_ARGS = \
		-s WASM=1

endif

all: jassub
jassub: dist

.PHONY: all jassub dist

include functions.mk

# FriBidi
$(BUILD_LIB_DIR)/fribidi/configure: lib/fribidi $(wildcard $(BASE_DIR)build/patches/fribidi/*.patch)
	$(call PREPARE_SRC_PATCHED,fribidi)
	cd $(BUILD_LIB_DIR)/fribidi && $(RECONF_AUTO)

$(DIST_DIR)/lib/libfribidi.a: $(BUILD_LIB_DIR)/fribidi/configure
	cd $(BUILD_LIB_DIR)/fribidi && \
	$(call CONFIGURE_AUTO) --disable-debug && \
	$(JASSUB_MAKE) -C lib/ fribidi-unicode-version.h && \
	$(JASSUB_MAKE) -C lib/ install && \
	$(JASSUB_MAKE) install-pkgconfigDATA

# Brotli
$(BUILD_LIB_DIR)/brotli/configured: lib/brotli $(wildcard $(BASE_DIR)build/patches/brotli/*.patch)
	$(call PREPARE_SRC_PATCHED,brotli)
	touch $(BUILD_LIB_DIR)/brotli/configured

$(DIST_DIR)/lib/libbrotlidec.a: $(DIST_DIR)/lib/libbrotlicommon.a
$(DIST_DIR)/lib/libbrotlicommon.a: $(BUILD_LIB_DIR)/brotli/configured
	cd $(BUILD_LIB_DIR)/brotli && \
	$(call CONFIGURE_CMAKE) && \
	$(JASSUB_MAKE) install
	# Normalise static lib names
	cd $(DIST_DIR)/lib/ && \
	for lib in *-static.a ; do mv "$$lib" "$${lib%-static.a}.a" ; done


# Freetype without Harfbuzz
$(BUILD_LIB_DIR)/freetype/configure: lib/freetype $(wildcard $(BASE_DIR)build/patches/freetype/*.patch)
	$(call PREPARE_SRC_PATCHED,freetype)
	cd $(BUILD_LIB_DIR)/freetype && $(RECONF_AUTO)

$(BUILD_LIB_DIR)/freetype/build_hb/dist_hb/lib/libfreetype.a: $(DIST_DIR)/lib/libbrotlidec.a $(BUILD_LIB_DIR)/freetype/configure
	cd $(BUILD_LIB_DIR)/freetype && \
		mkdir -p build_hb && \
		cd build_hb && \
		$(call CONFIGURE_AUTO,..) \
			--prefix="$$(pwd)/dist_hb" \
			--with-brotli=yes \
			--without-harfbuzz \
		&& \
		$(JASSUB_MAKE) install

# Harfbuzz
$(BUILD_LIB_DIR)/harfbuzz/configure: lib/harfbuzz $(wildcard $(BASE_DIR)build/patches/harfbuzz/*.patch)
	$(call PREPARE_SRC_PATCHED,harfbuzz)
	cd $(BUILD_LIB_DIR)/harfbuzz && $(RECONF_AUTO)

$(DIST_DIR)/lib/libharfbuzz.a: $(BUILD_LIB_DIR)/freetype/build_hb/dist_hb/lib/libfreetype.a $(BUILD_LIB_DIR)/harfbuzz/configure
	cd $(BUILD_LIB_DIR)/harfbuzz && \
	EM_PKG_CONFIG_PATH=$(PKG_CONFIG_PATH):$(BUILD_LIB_DIR)/freetype/build_hb/dist_hb/lib/pkgconfig \
	CFLAGS="-DHB_NO_MT $(CFLAGS)" \
	CXXFLAGS="-DHB_NO_MT $(CFLAGS)" \
	$(call CONFIGURE_AUTO) \
		--with-freetype \
	&& \
	cd src && \
	$(JASSUB_MAKE) install-libLTLIBRARIES install-pkgincludeHEADERS install-pkgconfigDATA

# Freetype with Harfbuzz
$(DIST_DIR)/lib/libfreetype.a: $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libbrotlidec.a
	cd $(BUILD_LIB_DIR)/freetype && \
	EM_PKG_CONFIG_PATH=$(PKG_CONFIG_PATH):$(BUILD_LIB_DIR)/freetype/build_hb/dist_hb/lib/pkgconfig \
	$(call CONFIGURE_AUTO) \
		--with-brotli=yes \
		--with-harfbuzz \
	&& \
	$(JASSUB_MAKE) install

# libass
$(BUILD_LIB_DIR)/libass/configured: lib/libass
	cd lib/libass && $(RECONF_AUTO)
	$(call PREPARE_SRC_VPATH,libass)
	touch $(BUILD_LIB_DIR)/libass/configured

$(DIST_DIR)/lib/libass.a: $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libfribidi.a $(DIST_DIR)/lib/libfreetype.a $(DIST_DIR)/lib/libbrotlidec.a $(BUILD_LIB_DIR)/libass/configured
	cd $(BUILD_LIB_DIR)/libass && \
	$(call CONFIGURE_AUTO,$(BASE_DIR)lib/libass) \
		--enable-large-tiles \
		--disable-fontconfig \
		--disable-require-system-font-provider \
		--enable-pthreads \
	&& \
	$(JASSUB_MAKE) install

LIBASS_DEPS = \
	$(DIST_DIR)/lib/libfribidi.a \
	$(DIST_DIR)/lib/libbrotlicommon.a \
	$(DIST_DIR)/lib/libbrotlidec.a \
	$(DIST_DIR)/lib/libfreetype.a \
	$(DIST_DIR)/lib/libharfbuzz.a \
	$(DIST_DIR)/lib/libass.a


dist: $(LIBASS_DEPS) src/wasm/$(WORKER_NAME).js

# Dist Files https://github.com/emscripten-core/emscripten/blob/3.1.38/src/settings.js

# args for increasing performance
# https://github.com/emscripten-core/emscripten/issues/13899
PERFORMANCE_ARGS = \
		-s BINARYEN_EXTRA_PASSES=--one-caller-inline-max-function-size=19306 \
		-s INVOKE_RUN=0 \
		-s DISABLE_EXCEPTION_CATCHING=1 \
		-s TEXTDECODER=2 \
		-s INITIAL_MEMORY=60MB \
		-s MALLOC=mimalloc \
		-s WASM_BIGINT=1 \
		-s MINIMAL_RUNTIME_STREAMING_WASM_INSTANTIATION=1 \
		-flto \
		-fno-exceptions \
		-O3

# args for reducing size
SIZE_ARGS = \
		-s POLYFILL=0 \
		-s FILESYSTEM=0 \
		-s AUTO_JS_LIBRARIES=0 \
		-s AUTO_NATIVE_LIBRARIES=0 \
		-s HTML5_SUPPORT_DEFERRING_USER_SENSITIVE_REQUESTS=0 \
		-s INCOMING_MODULE_JS_API="[]" \
		-s USE_SDL=0 \
		-s MINIMAL_RUNTIME=1 

# args that are required for this to even work at all
COMPAT_ARGS = \
		-s EXPORTED_FUNCTIONS="['_malloc']" \
		-s EXPORT_KEEPALIVE=1 \
		-s EXPORTED_RUNTIME_METHODS="['getTempRet0', 'setTempRet0']" \
		-s IMPORTED_MEMORY=1 \
		-mbulk-memory

src/wasm/$(WORKER_NAME).js: src/JASSUB.cpp src/worker/pre-worker.js
	mkdir -p src/wasm
	emcc src/JASSUB.cpp $(LIBASS_DEPS) \
		$(WORKER_ARGS) \
		$(PERFORMANCE_ARGS) \
		$(SIZE_ARGS) \
		$(COMPAT_ARGS) \
		--pre-js src/worker/pre-worker.js \
		--emit-tsd='types.d.ts' \
		-s ENVIRONMENT=worker \
		-s EXIT_RUNTIME=0 \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s GROWABLE_ARRAYBUFFERS=0 \
		-s MODULARIZE=1 \
		-s EXPORT_ES6=1 \
		-lembind \
		-pthread \
		-s PTHREAD_POOL_SIZE='(self.crossOriginIsolated ? Math.min(Math.max(0, navigator.hardwareConcurrency - 2), 8) : 0)' \
		-o $@

# dist/license/all:
#	@#FIXME: allow -j in toplevel Makefile and reintegrate licence extraction into this file
#	make -j "$$(nproc)" -f Makefile_licence all

# dist/js/COPYRIGHT: dist/license/all
#	cp "$<" "$@"

# Clean Tasks

clean: clean-dist clean-libs clean-jassub

clean-dist:
	rm -frv dist/libraries/*
	rm -frv src/wasm/*
	rm -frv dist/license/*
clean-libs:
	rm -frv dist/libraries build/lib
clean-jassub:
	cd src && git clean -fdX

git-checkout:
	git submodule sync --recursive && \
	git submodule update --init --recursive

SUBMODULES := brotli freetype fribidi harfbuzz libass
git-smreset: $(addprefix git-, $(SUBMODULES))

$(foreach subm, $(SUBMODULES), $(eval $(call TR_GIT_SM_RESET,$(subm))))

server: # Node http server npm i -g http-server
	http-server

.PHONY: clean clean-dist clean-libs clean-jassub git-checkout git-smreset server
