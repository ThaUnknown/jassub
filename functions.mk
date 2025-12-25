# For inclusion in toplevel Makefile
#	 Defines some useful macros and variables for building etc
#	 If arguments are expected (macro) it needs to be invoked with $(call ...),
#	 if no arguments are supported the definition is aregular avariable and can be used as such.
#	 Special macros of the name TR_... create targets (and always take arguments)
#	 and thus also need to be $(eval ...)'ed

## Build stuff

# @arg1: name of submodule
define PREPARE_SRC_PATCHED
	rm -rf $(BUILD_LIB_DIR)/$(1)
	mkdir -p $(BUILD_LIB_DIR)
	cp -r lib/$(1) $(BUILD_LIB_DIR)/$(1)
	find $(BUILD_LIB_DIR)/$(1) -type f \( -name 'RELEASEVERSION' -o -name '*.sh' -o -name 'configure' -o -name '*.am' -o -name '*.m4' -o -name '*.ac' -o -name '*.in' -o -name '*.mk' -o -name '*.txt' -o -name '*.raw' \) -exec dos2unix -q {} +
	find $(BUILD_LIB_DIR)/$(1) -type f \( -name '*.sh' -o -name 'configure' \) -exec chmod +x {} +
	$(foreach file, $(wildcard $(BASE_DIR)build/patches/$(1)/*.patch), \
		patch -d "$(BUILD_LIB_DIR)/$(1)" -Np1 -i $(file) && \
	) :
endef

# @arg1: name of submdolue
define PREPARE_SRC_VPATH
	rm -rf $(BUILD_LIB_DIR)/$(1)
	mkdir -p $(BUILD_LIB_DIR)/$(1)
	touch $(BUILD_LIB_DIR)/$(1)/configured
endef

# All projects we build have autogen.sh, otherwise we could also fallback to `autoreconf -ivf .`
RECONF_AUTO := NOCONFIGURE=1 sh ./autogen.sh

CONF_ARGS = --enable-optimize

ifeq (${MODERN},1)
  override CONF_ARGS += --enable-simd 
endif

# @arg1: path to source directory; defaults to current working directory
define CONFIGURE_AUTO
	CFLAGS="$(CFLAGS)" CXXFLAGS="$(CXXFLAGS)" \
	CC=emcc CXX=em++ \
	emconfigure $(or $(1),.)/configure \
		--prefix="$(DIST_DIR)" \
		--host=wasm32-unknown-emscripten \
		--enable-static \
		--disable-shared \
		--disable-debug \
    $(CONF_ARGS)
endef

# @arg1: path to source directory; defaults to current working directory
define CONFIGURE_CMAKE
	emcmake cmake -S "$(or $(1),.)" -DCMAKE_INSTALL_PREFIX="$(DIST_DIR)"
endef

# FIXME: Propagate jobserver info with $(MAKE) and set up our makefile for fully parallel builds
JSO_MAKE := emmake make -j "$(shell nproc)"

## Clean and git related

# @arg1: submodule name
define TR_GIT_SM_RESET
git-$(1):
	cd lib/$(1) && \
	git reset --hard && \
	git clean -dfx
	git submodule update --force lib/$(1)

.PHONY: git-$(1)
endef
