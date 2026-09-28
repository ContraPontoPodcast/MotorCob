#!/bin/bash
# Rotina diária do MotorCob no Mac (ou Linux).
# Uso: scripts/rodar_dia.sh [AAAA-MM-DD]      (sem data = hoje)
# Pasta de dados: $MOTORCOB_DADOS (padrão: ~/MotorCob-dados), fora do repositório
# porque tem dado pessoal. Estrutura em docs/PRODUCAO.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DADOS="${MOTORCOB_DADOS:-$HOME/MotorCob-dados}"
PY="${MOTORCOB_PYTHON:-python3}"
DATA="${1:-$(date +%F)}"

if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
  echo "ERRO: precisa de Python 3.11 ou mais novo (brew install python@3.12)." >&2
  exit 1
fi
for obrigatorio in base/clientes.csv base/contatos.csv; do
  if [ ! -f "$DADOS/config/supabase.env" ] && [ ! -f "$DADOS/$obrigatorio" ]; then
    echo "ERRO: falta $DADOS/$obrigatorio" >&2
    exit 1
  fi
done

ARGS=(--clientes "$DADOS/base/clientes.csv" --carteira "$DADOS/base/contatos.csv"
      --retornos "$DADOS/retornos" --estado "$DADOS/estado" --saida "$DADOS/saida" --data "$DATA")
[ -f "$DADOS/base/parcelas.csv" ] && ARGS+=(--parcelas "$DADOS/base/parcelas.csv")
if [ -f "$DADOS/logs/portal.csv" ] && [ -f "$DADOS/acoes/acoes.csv" ]; then
  ARGS+=(--acoes "$DADOS/acoes/acoes.csv" --portal "$DADOS/logs/portal.csv")
fi

mkdir -p "$DADOS/retornos" "$DADOS/logs"
LOG="$DADOS/logs/rodar_dia_$DATA.log"
: > "$LOG"
cd "$REPO"
if [ -f "$DADOS/config/supabase.env" ]; then
  # modo nuvem: atualiza o motor (empresas novas chegam por empresas/<slug>.json), baixa o
  # que o site recebeu de cada empresa, roda e publica no site
  git -C "$REPO" pull --ff-only -q 2>>"$LOG" || echo "aviso: não consegui atualizar o motor (git pull); sigo com a versão atual" | tee -a "$LOG"
  if MOTORCOB_DADOS="$DADOS" "$PY" -m nuvem.sincronizar dia --dados "$DADOS" --data "$DATA" 2>&1 | tee -a "$LOG"; then
    echo "Publicado no site. ID + contato por canal também em: $DADOS/empresas/<empresa>/saida/$DATA/ids/" | tee -a "$LOG"
    exit 0
  fi
  echo "ERRO na rotina de $DATA — veja $LOG (o site mostra a execução com erro)" >&2
  exit 1
fi
if "$PY" rodar_dia.py "${ARGS[@]}" 2>&1 | tee "$LOG"; then
  echo "ID + contato por canal: $DADOS/saida/$DATA/ids/" | tee -a "$LOG"
else
  echo "ERRO na rotina de $DATA — veja $LOG" >&2
  exit 1
fi
