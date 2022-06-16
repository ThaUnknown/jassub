# If needed, override the following variables via `make VARNAME=VAL ...`
# Note: we only compile and not(!) link here, thus -c
CXX = em++ -c
CXXFLAGS = -O3
LIBASS_CXXFLAGS = $(shell pkg-config --static --cflags "libass >= 0.14.0")
LOCAL_CXXFLAGS  = -Wall -Wno-deprecated $(LIBASS_CXXFLAGS)

all: jassub-worker.bc

JASSUBInterface.cpp: JASSUB.idl ../build/webidl_binder.py
	@# Our version of WebIDL contains JSO-specific patches
	python3 ../build/webidl_binder.py JASSUB.idl JASSUBInterface

jassub-worker.bc: JASSUB.cpp JASSUBInterface.cpp
	@# All later dependencies are already included into the first by CPP
	$(CXX) $(LOCAL_CXXFLAGS) $(CXXFLAGS) -o $@ $<

clean:
	rm -f jassub-worker.bc
	rm -f JASSUBInterface.cpp WebIDLGrammar.pkl parser.out

.PHONY: all clean
