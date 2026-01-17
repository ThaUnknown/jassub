FROM docker.io/emscripten/emsdk:4.0.22

RUN apt-get update && \
    apt-get install curl -y --no-install-recommends && \
    apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        dos2unix \
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /code
ENV PATH="/code/node_modules/.bin:${PATH}"
CMD ["bash", "-c", "make; env MODERN=1 make"]

