# syntax=docker/dockerfile:1
# Asterisk 22 do MotorCX (PJSIP + ARI + AMD + MixMonitor), compilado da fonte oficial com o SHA-256 conferido.
# Contexto do build = raiz do repositório (copia o gerador de configuração em voz/):
#   docker build -f infra/asterisk/Dockerfile -t motorcx-asterisk .
# Na VM roda com a rede do host (SIP 5060, RTP 10000-20000; ARI só em 127.0.0.1:8088):
#   docker run --network host -v /var/motorcx/gravacoes:/var/spool/asterisk/motorcx \
#     -v /run/motorcx:/run/motorcx:ro -e MOTORCX_GCP_PROJETO=... motorcx-asterisk
# Nenhum segredo na imagem: a senha do ARI e as dos troncos chegam em tempo de execução (Secret Manager).
FROM debian:bookworm-slim AS build

ARG ASTERISK_VERSION=22.11.0
ARG ASTERISK_SHA256=3bd5ee040509a3d3cd9b1ba9520c18e6ec0a7e7981ca68c457dcd36ba3c54d94

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ca-certificates wget bzip2 patch pkg-config \
      libedit-dev libjansson-dev libxml2-dev uuid-dev libsqlite3-dev libssl-dev libsrtp2-dev libcurl4-openssl-dev \
      python3 \
 && rm -rf /var/lib/apt/lists/*

# rede com proxy TLS próprio (só no build local): docker build --secret id=ca,src=ca.crt ...; sem o segredo, nada muda
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then cp /run/secrets/ca /usr/local/share/ca-certificates/build-ca.crt \
      && update-ca-certificates >/dev/null; fi

WORKDIR /usr/src
RUN wget -q "https://downloads.asterisk.org/pub/telephony/asterisk/releases/asterisk-${ASTERISK_VERSION}.tar.gz" \
 && echo "${ASTERISK_SHA256}  asterisk-${ASTERISK_VERSION}.tar.gz" | sha256sum -c - \
 && tar xzf "asterisk-${ASTERISK_VERSION}.tar.gz" \
 && mv "asterisk-${ASTERISK_VERSION}" asterisk

WORKDIR /usr/src/asterisk
RUN ./configure --with-pjproject-bundled >/dev/null \
 && make menuselect.makeopts >/dev/null \
 && menuselect/menuselect --disable BUILD_NATIVE \
      --enable app_amd --enable app_mixmonitor --enable app_transfer --enable res_ari --enable res_stasis \
      --enable res_pjsip --enable chan_pjsip --enable res_http_websocket \
      --disable CORE-SOUNDS-EN-GSM --disable MOH-OPSOUND-WAV \
      menuselect.makeopts \
 && make -j"$(nproc)" >/dev/null \
 && make install DESTDIR=/opt/ast >/dev/null \
 && rm -rf /opt/ast/usr/include /opt/ast/var/run

FROM debian:bookworm-slim

ENV LANG=C.UTF-8 TZ=America/Sao_Paulo PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/opt/motorcx

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata tini python3 \
      libedit2 libjansson4 libxml2 libuuid1 libsqlite3-0 libssl3 libsrtp2-1 libcurl4 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10010 --home-dir /var/lib/asterisk --shell /usr/sbin/nologin asterisk

COPY --from=build /opt/ast/ /

# só o que o gerador precisa (biblioteca padrão; nada do motor)
COPY voz/__init__.py voz/banco.py voz/segredos.py voz/gcp.py voz/tarifacao.py /opt/motorcx/voz/
COPY voz/asterisk/ /opt/motorcx/voz/asterisk/
COPY infra/asterisk/conf/ /etc/asterisk/
COPY infra/asterisk/entrypoint.sh /usr/local/bin/motorcx-asterisk

RUN chmod 755 /usr/local/bin/motorcx-asterisk \
 && mkdir -p /etc/asterisk/motorcx /var/spool/asterisk/motorcx /var/run/asterisk /var/log/asterisk /var/lib/asterisk \
 && chown -R asterisk:asterisk /etc/asterisk /var/spool/asterisk /var/run/asterisk /var/log/asterisk /var/lib/asterisk \
 && chmod 750 /etc/asterisk/motorcx /var/spool/asterisk/motorcx

USER asterisk
EXPOSE 5060/udp 5060/tcp 5061/tcp 10000-20000/udp
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD asterisk -rx "core show uptime" >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/motorcx-asterisk"]
