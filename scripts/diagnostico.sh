#!/bin/bash
# Diagnóstico: por que o arquivo continua "pendente" no site? Confere programa, ligação com o
# Supabase, arquivos pendentes, última rotina e a vigia, e diz o que fazer.
# Uso: scripts/diagnostico.sh
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PY="${MOTORCOB_PYTHON:-python3}"
command -v python3.12 >/dev/null 2>&1 && [ -z "${MOTORCOB_PYTHON:-}" ] && PY=python3.12
cd "$REPO" && exec "$PY" -m nuvem.diagnostico
