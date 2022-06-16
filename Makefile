# JASSub.js - Makefile

# make - Build Dependencies and the JASSub.js
BASE_DIR:=$(dir $(realpath $(firstword $(MAKEFILE_LIST))))
DIST_DIR:=$(BASE_DIR)dist/libraries

GLOBAL_CFLAGS:=-O3
GLOBAL_LDFLAGS:=-s ENVIRONMENT=worker -s NO_EXIT_RUNTIME=1
export LDFLAGS = $(GLOBAL_LDFLAGS)

all: jassub

jassub: dist

# Fribidi
build/lib/fribidi/configure: lib/fribidi $(wildcard $(BASE_DIR)build/patches/fribidi/*.patch)
	rm -rf build/lib/fribidi
	mkdir -p build/lib
	cp -r lib/fribidi build/lib/fribidi
	$(foreach file, $(wildcard $(BASE_DIR)build/patches/fribidi/*.patch), patch -d "$(BASE_DIR)build/lib/fribidi" -Np1 -i $(file) && ) true
	cd build/lib/fribidi && NOCONFIGURE=1 ./autogen.sh

$(DIST_DIR)/lib/libfribidi.a: build/lib/fribidi/configure
	cd build/lib/fribidi && \
	emconfigure ./configure \
		CFLAGS=" \
		-s USE_PTHREADS=0 \
		$(GLOBAL_CFLAGS) \
		-DFRIBIDI_ENTRY=extern \
		" \
		--prefix="$(DIST_DIR)" \
		--host=x86-none-linux \
		--build=x86_64 \
		--enable-static \
		--disable-shared \
		--disable-dependency-tracking \
		--disable-debug \
	&& \
	emmake make -C lib/ install && \
	emmake make install-pkgconfigDATA

build/lib/expat/configured: lib/expat
	mkdir -p build/lib/expat
	touch build/lib/expat/configured

$(DIST_DIR)/lib/libexpat.a: build/lib/expat/configured
	cd build/lib/expat && \
	emcmake cmake \
		-DCMAKE_C_FLAGS=" \
		-s USE_PTHREADS=0 \
		$(GLOBAL_CFLAGS) \
		" \
		-DCMAKE_INSTALL_PREFIX=$(DIST_DIR) \
		-DEXPAT_BUILD_DOCS=off \
		-DEXPAT_SHARED_LIBS=off \
		-DEXPAT_BUILD_EXAMPLES=off \
		-DEXPAT_BUILD_FUZZERS=off \
		-DEXPAT_BUILD_TESTS=off \
		-DEXPAT_BUILD_TOOLS=off \
		$(BASE_DIR)lib/expat/expat \
	&& \
	emmake make -j8 && \
	emmake make install

build/lib/brotli/js/decode.js: build/lib/brotli/configured
build/lib/brotli/js/polyfill.js: build/lib/brotli/configured
build/lib/brotli/configured: lib/brotli $(wildcard $(BASE_DIR)build/patches/brotli/*.patch)
	rm -rf build/lib/brotli
	cp -r lib/brotli build/lib/brotli
	$(foreach file, $(wildcard $(BASE_DIR)build/patches/brotli/*.patch), patch -d "$(BASE_DIR)build/lib/brotli" -Np1 -i $(file) && ) true
	touch build/lib/brotli/configured

build/lib/brotli/libbrotlidec.pc: build/lib/brotli/configured
	cd build/lib/brotli && \
	emcmake cmake \
		-DCMAKE_C_FLAGS=" \
		$(GLOBAL_CFLAGS) \
		" \
		-DCMAKE_INSTALL_PREFIX=$(DIST_DIR) \
		. \
	&& \
	emmake make -j8 && \
	cp -r ./c/include $(DIST_DIR)

$(DIST_DIR)/lib/libbrotlicommon.a: build/lib/brotli/libbrotlidec.pc
	cd build/lib/brotli && \
	mkdir -p $(DIST_DIR)/lib/pkgconfig && \
	cp libbrotlicommon.pc $(DIST_DIR)/lib/pkgconfig && \
	cp libbrotlicommon-static.a $(DIST_DIR)/lib/libbrotlicommon.a

$(DIST_DIR)/lib/libbrotlidec.a: build/lib/brotli/libbrotlidec.pc $(DIST_DIR)/lib/libbrotlicommon.a
	cd build/lib/brotli && \
	mkdir -p $(DIST_DIR)/lib/pkgconfig && \
	cp libbrotlidec.pc $(DIST_DIR)/lib/pkgconfig && \
	cp libbrotlidec-static.a $(DIST_DIR)/lib/libbrotlidec.a

# Freetype without Harfbuzz
build/lib/freetype/build_hb/dist_hb/lib/libfreetype.a: $(DIST_DIR)/lib/libbrotlidec.a $(wildcard $(BASE_DIR)build/patches/freetype/*.patch)
	rm -rf build/lib/freetype
	cp -r lib/freetype build/lib/freetype
	$(foreach file, $(wildcard $(BASE_DIR)build/patches/freetype/*.patch), patch -d "$(BASE_DIR)build/lib/freetype" -Np1 -i $(file) && ) true
	cd build/lib/freetype && \
		NOCONFIGURE=1 ./autogen.sh && \
		mkdir -p build_hb && \
		cd build_hb && \
		EM_PKG_CONFIG_PATH=$(DIST_DIR)/lib/pkgconfig \
		emconfigure ../configure \
			CFLAGS=" \
			-s USE_PTHREADS=0 \
			$(GLOBAL_CFLAGS) \
			" \
			--prefix="$$(pwd)/dist_hb" \
			--host=x86-none-linux \
			--build=x86_64 \
			--enable-static \
			--disable-shared \
			\
			--with-brotli=yes \
			--without-zlib \
			--without-bzip2 \
			--without-png \
			--without-harfbuzz \
		&& \
		emmake make -j8 && \
		emmake make install

# Harfbuzz
build/lib/harfbuzz/configure: lib/harfbuzz $(wildcard $(BASE_DIR)build/patches/harfbuzz/*.patch)
	rm -rf build/lib/harfbuzz
	cp -r lib/harfbuzz build/lib/harfbuzz
	$(foreach file, $(wildcard $(BASE_DIR)build/patches/harfbuzz/*.patch), patch -d "$(BASE_DIR)build/lib/harfbuzz" -Np1 -i $(file) && ) true
	cd build/lib/harfbuzz && NOCONFIGURE=1 ./autogen.sh

$(DIST_DIR)/lib/libharfbuzz.a: build/lib/freetype/build_hb/dist_hb/lib/libfreetype.a build/lib/harfbuzz/configure
	cd build/lib/harfbuzz && \
	EM_PKG_CONFIG_PATH=$(DIST_DIR)/lib/pkgconfig:$(BASE_DIR)build/lib/freetype/build_hb/dist_hb/lib/pkgconfig \
	emconfigure ./configure \
		CFLAGS=" \
		-s USE_PTHREADS=0 \
		$(GLOBAL_CFLAGS) \
		-DHB_NO_MT \
		" \
		CXXFLAGS=" \
		-s USE_PTHREADS=0 \
		$(GLOBAL_CFLAGS) \
		-DHB_NO_MT \
		" \
		--prefix="$(DIST_DIR)" \
		--host=x86-none-linux \
		--build=x86_64 \
		--enable-static \
		--disable-shared \
		--disable-dependency-tracking \
		\
		--without-cairo \
		--without-fontconfig \
		--without-icu \
		--with-freetype \
		--without-glib \
	&& \
	cd src && \
	emmake make -j8 install-libLTLIBRARIES install-pkgincludeHEADERS install-pkgconfigDATA

# Freetype with Harfbuzz
$(DIST_DIR)/lib/libfreetype.a: $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libbrotlidec.a
	cd build/lib/freetype && \
	EM_PKG_CONFIG_PATH=$(DIST_DIR)/lib/pkgconfig:$(BASE_DIR)build/lib/freetype/build_hb/dist_hb/lib/pkgconfig \
	emconfigure ./configure \
		CFLAGS=" \
		-s USE_PTHREADS=0 \
		$(GLOBAL_CFLAGS) \
		" \
		--prefix="$(DIST_DIR)" \
		--host=x86-none-linux \
		--build=x86_64 \
		--enable-static \
		--disable-shared \
		\
		--with-brotli=yes \
		--without-zlib \
		--without-bzip2 \
		--without-png \
		--with-harfbuzz \
	&& \
	emmake make -j8 && \
	emmake make install

# Fontconfig
build/lib/fontconfig/configure: lib/fontconfig $(wildcard $(BASE_DIR)build/patches/fontconfig/*.patch)
	rm -rf build/lib/fontconfig
	cp -r lib/fontconfig build/lib/fontconfig
	$(foreach file, $(wildcard $(BASE_DIR)build/patches/fontconfig/*.patch), patch -d "$(BASE_DIR)build/lib/fontconfig" -Np1 -i $(file) && ) true
	cd build/lib/fontconfig && NOCONFIGURE=1 ./autogen.sh

$(DIST_DIR)/lib/libfontconfig.a: $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libexpat.a $(DIST_DIR)/lib/libfribidi.a $(DIST_DIR)/lib/libfreetype.a build/lib/fontconfig/configure
	cd build/lib/fontconfig && \
	EM_PKG_CONFIG_PATH=$(DIST_DIR)/lib/pkgconfig \
	emconfigure ./configure \
		CFLAGS=" \
		-s USE_PTHREADS=0 \
		-DEMSCRIPTEN \
		$(GLOBAL_CFLAGS) \
		" \
		--prefix="$(DIST_DIR)" \
		--host=x86-none-linux \
		--build=x86_64 \
		--disable-shared \
		--enable-static \
		--disable-docs \
		--with-default-fonts=/fonts \
	&& \
	emmake make -C src/ install && \
	emmake make -C fontconfig/ install && \
	emmake make install-pkgconfigDATA

# libass --

build/lib/libass/configured: lib/libass
	rm -rf build/lib/libass
	cd lib/libass && NOCONFIGURE=1 ./autogen.sh
	mkdir -p build/lib/libass
	touch build/lib/libass/configured

$(DIST_DIR)/lib/libass.a: $(DIST_DIR)/lib/libfontconfig.a $(DIST_DIR)/lib/libharfbuzz.a $(DIST_DIR)/lib/libexpat.a $(DIST_DIR)/lib/libfribidi.a $(DIST_DIR)/lib/libfreetype.a $(DIST_DIR)/lib/libbrotlidec.a build/lib/libass/configured
	cd build/lib/libass && \
	EM_PKG_CONFIG_PATH=$(DIST_DIR)/lib/pkgconfig \
	emconfigure ../../../lib/libass/configure \
		CFLAGS=" \
		-s USE_PTHREADS=0 \
		$(GLOBAL_CFLAGS) \
		" \
		--prefix="$(DIST_DIR)" \
		--host=x86-none-linux \
		--build=x86_64 \
		--disable-shared \
		--enable-static \
		--disable-asm \
		\
		--enable-harfbuzz \
		--enable-fontconfig \
	&& \
	emmake make -j8 && \
	emmake make install

# JASSub.js
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
	PKG_CONFIG_PATH=$(DIST_DIR)/lib/pkgconfig \
	$(MAKE) -C src all

# Dist Files https://github.com/emscripten-core/emscripten/blob/2.0.34/src/settings.js
EMCC_COMMON_ARGS = \
	$(GLOBAL_LDFLAGS) \
	-s EXPORTED_RUNTIME_METHODS="['FS_createLazyFile', 'FS_createPath']" \
	--preload-file assets/fonts.conf \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s NO_FILESYSTEM=0 \
	-s AUTO_JS_LIBRARIES=0 \
	-s AUTO_NATIVE_LIBRARIES=0 \
	-s HTML5_SUPPORT_DEFERRING_USER_SENSITIVE_REQUESTS=0 \
	-s USE_SDL=0 \
	-s INCOMING_MODULE_JS_API="['onRuntimeInitialized','preRun','print','printErr']" \
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

dist/js/jassub-worker.js: src/jassub-worker.bc src/worker.js src/JASSubInterface.js build/lib/brotli/js/decode.js
	mkdir -p dist/js
	emcc src/jassub-worker.bc $(OCTP_DEPS) \
		--pre-js build/lib/brotli/js/decode.js \
		--post-js src/JASSubInterface.js \
		--post-js src/worker.js \
		-s WASM=1 \
		$(EMCC_COMMON_ARGS)

dist/js/jassub.js: src/jassub.js
	mkdir -p dist/js

LIB_LICENSES := brotli expat freetype fribidi fontconfig harfbuzz libass
LIB_LICENSES_FINDOPT_brotli   := -path ./research -prune -false -o ! -path ./js/decode.min.js
LIB_LICENSES_FINDOPT_expat    := -path ./expat/fuzz -prune -false -o
LIB_LICENSES_FINDOPT_freetype := -path ./src/tools -prune -false -o
LIB_LICENSES_FINDOPT_fribidi  := -path ./bin -prune -false -o
LIB_LICENSES_FINDOPT_harfbuzz := -path ./test -prune -false -o

$(addprefix dist/license/, $(LIB_LICENSES)): dist/license/%: .git/modules/lib/%/HEAD build/license_extract.sh build/license_defaults
	@mkdir -p dist/license
	(cd "lib/$*" && FINDOPTS="$(LIB_LICENSES_FINDOPT_$*)" \
	 ../../build/license_extract.sh ../../build/license_defaults "$*"  .) > $@

dist/license/jassub: .git/HEAD build/license_extract.sh
	@mkdir -p dist/license
	build/license_extract.sh build/license_defaults jassub src > dist/license/jassub

dist/license/all: dist/license/jassub $(addprefix dist/license/, $(LIB_LICENSES)) build/license_fullnotice build/license_lint.awk
	@echo "# The following lists all copyright notices and licenses for the" >  dist/license/all
	@echo "# work contained in JASSub per project."      >> dist/license/all
	@echo "" >> dist/license/all

	@echo "Concatenate extracted license info..."
	@$(foreach LIB_PROJ, jassub $(LIB_LICENSES), \
		echo "# Project: $(LIB_PROJ)"  >> dist/license/all && \
		cat  dist/license/$(LIB_PROJ)  >> dist/license/all && \
	) :

	mv dist/license/all dist/license/all.tmp
	build/license_lint.awk dist/license/all.tmp build/license_fullnotice
	cat dist/license/all.tmp build/license_fullnotice > dist/license/all

dist/js/COPYRIGHT: dist/license/all
	cp "$<" "$@"

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

server: # Node http server npm i -g http-server
	http-server

git-update: git-freetype git-fribidi git-fontconfig git-expat git-harfbuzz git-libass git-brotli

git-brotli:
	cd lib/brotli && \
	git reset --hard && \
	git clean -dfx && \
	git pull origin master

git-freetype:
	cd lib/freetype && \
	git reset --hard && \
	git clean -dfx && \
	git pull origin master

git-fribidi:
	cd lib/fribidi && \
	git reset --hard && \
	git clean -dfx && \
	git pull origin master

git-fontconfig:
	cd lib/fontconfig && \
	git reset --hard && \
	git clean -dfx && \
	git pull origin master

git-expat:
	cd lib/expat && \
	git reset --hard && \
	git clean -dfx && \
	git pull origin master

git-harfbuzz:
	cd lib/harfbuzz && \
	git reset --hard && \
	git clean -dfx && \
	git pull origin master

git-libass:
	cd lib/libass && \
	git reset --hard && \
	git clean -dfx && \
	git pull origin master
