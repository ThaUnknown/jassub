# JASSUB.js - Makefile

# make - Build Dependencies and the JASSUB.js
BASE_DIR:=$(dir $(realpath $(firstword $(MAKEFILE_LIST))))
DIST_DIR:=$(BASE_DIR)dist/libraries

export LDFLAGS = -O3 -s ENVIRONMENT=worker -s NO_EXIT_RUNTIME=1
export CFLAGS = -O3 -s USE_PTHREADS=0
export CXXFLAGS = $(CFLAGS)
export PKG_CONFIG_PATH = $(DIST_DIR)/lib/pkgconfig
export EM_PKG_CONFIG_PATH = $(PKG_CONFIG_PATH)

all: jassub
jassub: dist

.PHONY: all jassub dist

include functions.mk

# FriBidi
build/lib/fribidi/configure: lib/fribidi $(wildcard $(BASE_DIR)build/patches/fribidi/*.patch)
	$(call PREPARE_SRC_PATCHED,fribidi)
	cd build/lib/fribidi && $(RECONF_AUTO)

$(DIST_DIR)/lib/libfribidi.a: build/lib/fribidi/configure
	cd build/lib/fribidi && \
	$(call CONFIGURE_AUTO) && \
	$(JSO_MAKE) -C lib/ fribidi-unicode-version.h && \
	$(JSO_MAKE) -C lib/ install && \
	$(JSO_MAKE) install-pkgconfigDATA

# Expat
build/lib/expat/configured: lib/expat
	$(call PREPARE_SRC_VPATH,expat)
	touch build/lib/expat/configured

$(DIST_DIR)/lib/libexpat.a: build/lib/expat/configured
	cd build/lib/expat && \
	$(call CONFIGURE_CMAKE,$(BASE_DIR)lib/expat/expat) \
		-DEXPAT_BUILD_DOCS=off \
		-DEXPAT_SHARED_LIBS=off \
		-DEXPAT_BUILD_EXAMPLES=off \
		-DEXPAT_BUILD_FUZZERS=off \
		-DEXPAT_BUILD_TESTS=off \
		-DEXPAT_BUILD_TOOLS=off \
	&& \
	$(JSO_MAKE) install

# Brotli
build/lib/brotli/configured: lib/brotli $(wildcard $(BASE_DIR)build/patches/brotli/*.patch)
	$(call PREPARE_SRC_PATCHED,brotli)
	touch build/lib/brotli/configured

$(DIST_DIR)/lib/libbrotlidec.a: $(DIST_DIR)/lib/libbrotlicommon.a
$(DIST_DIR)/lib/libbrotlicommon.a: build/lib/brotli/configured
	cd build/lib/brotli && \
    $(call CONFIGURE_CMAKE) && \
	$(JSO_MAKE) install
	# Normalise static lib names
	cd $(DIST_DIR)/lib/ && \
	for lib in *-static.a ; do mv "$$lib" "$${lib%-static.a}.a" ; done


# Freetype without Harfbuzz
build/lib/freetype/configure: lib/freetype $(wildcard $(BASE_DIR)build/patches/freetype/*.patch)
	$(call PREPARE_SRC_PATCHED,freetype)
	cd build/lib/freetype && $(RECONF_AUTO)

build/lib/freetype/build_hb/dist_hb/lib/libfreetype.a: $(DIST_DIR)/lib/libbrotlidec.a build/lib/freetype/configure
	cd build/lib/freetype && \
		mkdir -p build_hb && \
		cd build_hb && \
		$(call CONFIGURE_AUTO,..) \
			--prefix="$$(pwd)/dist_hb" \
			--with-brotli=yes \
			--without-harfbuzz \
		&& \
		$(JSO_MAKE) install

# Harfbuzz
build/lib/harfbuzz/configure: lib/harfbuzz $(wildcard $(BASE_DIR)build/patches/harfbuzz/*.patch)
	$(call PREPARE_SRC_PATCHED,harfbuzz)
	cd build/lib/harfbuzz && $(RECONF_AUTO)

$(DIST_DIR)/lib/libharfbuzz.a: build/lib/freetype/build_hb/dist_hb/lib/libfreetype.a build/lib/harfbuzz/configure
	cd build/lib/harfbuzz && \
	EM_PKG_CONFIG_PATH=$(PKG_CONFIG_PATH):$(BASE_DIR)build/lib/freetype/build_hb/dist_hb/lib/pkgconfig \
	CFLAGS="-DHB_NO_MT $(CFLAGS)" \
	CXXFLAGS="-DHB_NO_MT $(CFLAGS)" \
	$(call CONFIGURE_AUTO) \
		--with-freetype \
	&& \
	cd src && \
	$(JSO_MAKE) install-libLTLIBRARIES install-pkgincludeHEADERS install-pkgconfigDATA

# Freetype with Harfbuzz
$(DIST_DIR)/lib/libfreetype.a: $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libbrotlidec.a
	cd build/lib/freetype && \
	EM_PKG_CONFIG_PATH=$(PKG_CONFIG_PATH):$(BASE_DIR)build/lib/freetype/build_hb/dist_hb/lib/pkgconfig \
	$(call CONFIGURE_AUTO) \
		--with-brotli=yes \
		--with-harfbuzz \
	&& \
	$(JSO_MAKE) install

# Fontconfig
build/lib/fontconfig/configure: lib/fontconfig $(wildcard $(BASE_DIR)build/patches/fontconfig/*.patch)
	$(call PREPARE_SRC_PATCHED,fontconfig)
	cd build/lib/fontconfig && $(RECONF_AUTO)

$(DIST_DIR)/lib/libfontconfig.a: $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libexpat.a $(DIST_DIR)/lib/libfribidi.a $(DIST_DIR)/lib/libfreetype.a build/lib/fontconfig/configure
	cd build/lib/fontconfig && \
	$(call CONFIGURE_AUTO) \
		--disable-docs \
		--with-default-fonts=/fonts \
	&& \
	$(JSO_MAKE) -C src/ install && \
	$(JSO_MAKE) -C fontconfig/ install && \
	$(JSO_MAKE) install-pkgconfigDATA


# libass
build/lib/libass/configured: lib/libass
	cd lib/libass && $(RECONF_AUTO)
	$(call PREPARE_SRC_VPATH,libass)
	touch build/lib/libass/configured

$(DIST_DIR)/lib/libass.a: $(DIST_DIR)/lib/libfontconfig.a $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libexpat.a $(DIST_DIR)/lib/libfribidi.a $(DIST_DIR)/lib/libfreetype.a $(DIST_DIR)/lib/libbrotlidec.a build/lib/libass/configured
	cd build/lib/libass && \
	$(call CONFIGURE_AUTO,../../../lib/libass) \
		--disable-asm \
		--enable-fontconfig \
	&& \
	$(JSO_MAKE) install

# JASSUB.js
OCTP_DEPS = \
	$(DIST_DIR)/lib/libfribidi.a \
	$(DIST_DIR)/lib/libbrotlicommon.a \
	$(DIST_DIR)/lib/libbrotlidec.a \
	$(DIST_DIR)/lib/libfreetype.a \
	$(DIST_DIR)/lib/libexpat.a \
	$(DIST_DIR)/lib/libharfbuzz.a \
	$(DIST_DIR)/lib/libfontconfig.a \
	$(DIST_DIR)/lib/libass.a

src/jassub-worker.bc: $(OCTP_DEPS) all-src
.PHONY: all-src
all-src:
	$(MAKE) -C src all

# Dist Files https://github.com/emscripten-core/emscripten/blob/2.0.34/src/settings.js
EMCC_COMMON_ARGS = \
	$(LDFLAGS) \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s FILESYSTEM=0 \
	-s AUTO_JS_LIBRARIES=0 \
	-s AUTO_NATIVE_LIBRARIES=0 \
	-s HTML5_SUPPORT_DEFERRING_USER_SENSITIVE_REQUESTS=0 \
	-s USE_SDL=0 \
	-s INCOMING_MODULE_JS_API="['onRuntimeInitialized','print','printErr']" \
	--no-heap-copy \
	-o $@ \
  -O3
	# TODO: fix minimal runtime errors
	# -s MINIMAL_RUNTIME=1 \
	# -s MINIMAL_RUNTIME_STREAMING_WASM_COMPILATION=1 \
  #--js-opts 0 -O0 -gsource-map 
	#--js-opts 0 -O0 -g3 
	#--closure 1 \
	#-s USE_CLOSURE_COMPILER=1 \
	#-s IGNORE_CLOSURE_COMPILER_ERRORS=1 \
	#--memory-init-file 0


dist: src/jassub-worker.bc dist/js/jassub-worker.js dist/js/jassub.js

dist/js/jassub-worker.js: src/jassub-worker.bc src/worker.js src/JASSUBInterface.js src/polyfill.js
	mkdir -p dist/js
	emcc src/jassub-worker.bc $(OCTP_DEPS) \
	  --pre-js src/polyfill.js \
		--post-js src/JASSUBInterface.js \
		--post-js src/worker.js \
		-s WASM=1 \
		$(EMCC_COMMON_ARGS)

dist/js/jassub.js: src/jassub.js
	mkdir -p dist/js

# Clean Tasks

clean: clean-dist clean-libs clean-jassub

clean-dist:
	rm -frv dist/libraries/*
	rm -frv dist/js/*
	rm -frv dist/license/*
clean-libs:
	rm -frv dist/libraries build/lib
clean-jassub:
	cd src && git clean -fdX

git-checkout:
	git submodule sync --recursive && \
	git submodule update --init --recursive

SUBMODULES := brotli expat fontconfig freetype fribidi harfbuzz libass
git-smreset: $(addprefix git-, $(SUBMODULES))

$(foreach subm, $(SUBMODULES), $(eval $(call TR_GIT_SM_RESET,$(subm))))

server: # Node http server npm i -g http-server
	http-server

.PHONY: clean clean-dist clean-libs clean-jassub git-checkout git-smreset server
