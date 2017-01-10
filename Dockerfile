FROM docker.io/emscripten/emsdk:4.0.22

RUN apt-get update && \
    apt-get install curl -y --no-install-recommends && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - &&\
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
        nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /code
ENV PATH="/code/node_modules/.bin:${PATH}"
CMD ["bash", "-c", "sudo npm i; make; env MODERN=1 make"]

