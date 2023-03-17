FROM docker.io/emscripten/emsdk:3.1.34

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        git \
        ragel \
        patch \
        libtool \
        itstool \
        pkg-config \
        python3 \
        gettext \
        autopoint \
        automake \
        autoconf \
        m4 \
        gperf \
        licensecheck \
        nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /code
CMD ["bash", "-c", "make; npx pnpm i; npm run bundle"]
