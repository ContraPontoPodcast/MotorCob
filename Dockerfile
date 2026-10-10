# MotorCob na nuvem: o mesmo plantão do Mac (scripts/rodar_dia.sh --plantao) num contêiner.
# Dados (estado, bases, saídas) ficam no volume /dados; a chave do Supabase chega por variável de ambiente
# (MOTORCOB_SUPABASE_URL / MOTORCOB_SUPABASE_KEY), nunca dentro da imagem.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    TZ=America/Sao_Paulo LANG=C.UTF-8 \
    MOTORCOB_DADOS=/dados MOTORCOB_PYTHON=python3

RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir openpyxl==3.1.5 \
 && useradd --create-home --uid 10001 motorcob \
 && mkdir -p /dados && chown motorcob:motorcob /dados

WORKDIR /app
COPY . /app
RUN chmod 755 scripts/*.sh && chmod -R a+rX,go-w /app

USER motorcob
VOLUME ["/dados"]
ENTRYPOINT ["scripts/rodar_dia.sh"]
CMD ["--plantao"]
