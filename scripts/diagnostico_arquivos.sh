#!/bin/bash
# Diagnóstico de acordo, pagamento e ocorrência: como o motor leu cada arquivo e por que algo
# não foi reconhecido. Só nomes de coluna, códigos de resultado e contagens (nada pessoal).
# Uso: scripts/diagnostico_arquivos.sh
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PY="${MOTORCOB_PYTHON:-python3}"
command -v python3.12 >/dev/null 2>&1 && [ -z "${MOTORCOB_PYTHON:-}" ] && PY=python3.12
cd "$REPO" && exec "$PY" -m nuvem.diagnostico_arquivos
