#!/bin/bash
# Relatório do comitê de um mês. Uso: scripts/relatorio_mes.sh 2026-09
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DADOS="${MOTORCOB_DADOS:-$HOME/MotorCob-dados}"
PY="${MOTORCOB_PYTHON:-python3}"
MES="${1:?informe o mês, ex.: 2026-09}"
INICIO="$MES-01"
FIM="$("$PY" -c "import calendar,sys; a,m=map(int,'$MES'.split('-')); print(f'$MES-{calendar.monthrange(a,m)[1]:02d}')")"
ARGS=(--clientes "$DADOS/base/clientes.csv" --carteira "$DADOS/base/contatos.csv" --retornos "$DADOS/retornos"
      --estado "$DADOS/estado" --inicio "$INICIO" --fim "$FIM" --saida "$DADOS/saida/comite/$MES")
[ -f "$DADOS/base/parcelas.csv" ] && ARGS+=(--parcelas "$DADOS/base/parcelas.csv")
cd "$REPO"
if [ -f "$DADOS/config/supabase.env" ]; then
  MOTORCOB_DADOS="$DADOS" "$PY" -m nuvem.sincronizar comite --dados "$DADOS" --mes "$MES"
else
  "$PY" relatorio.py "${ARGS[@]}"
fi
