FROM docker.io/emscripten/emsdk:3.1.38

RUN apt-get update && \
    apt-get install curl -y --no-install-recommends && \
    curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash - &&\
    apt-get install -y --no-install-recommends \
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
CMD ["bash", "-c", "make; sudo npm i; sudo node vite.build.js"]
