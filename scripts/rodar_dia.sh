#!/bin/bash
# Rotina diária do MotorCob no Mac (ou Linux).
# Uso: scripts/rodar_dia.sh [AAAA-MM-DD]      (sem data = hoje)
#      scripts/rodar_dia.sh --vigiar           (só roda se alguma empresa subiu carga nova no site,
#                                               mudou a orquestração ou ainda não fez a rotina do dia)
#      scripts/rodar_dia.sh --plantao          (fica no ar: olha o site a cada 5 s e chama o --vigiar
#                                               na hora em que chega arquivo; é o que o launchd mantém)
# Pasta de dados: $MOTORCOB_DADOS (padrão: ~/MotorCob-dados), fora do repositório
# porque tem dado pessoal. Estrutura em docs/PRODUCAO.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DADOS="${MOTORCOB_DADOS:-$HOME/MotorCob-dados}"
PY="${MOTORCOB_PYTHON:-python3}"
VIGIAR=0
PLANTAO=0
if [ "${1:-}" = "--vigiar" ]; then VIGIAR=1; shift; fi
if [ "${1:-}" = "--plantao" ]; then PLANTAO=1; shift; fi
DATA="${1:-$(date +%F)}"
# ligado ao site: arquivo do Mac (scripts/configurar_nuvem.sh) ou variáveis de ambiente (servidor na nuvem)
NUVEM=0
{ [ -f "$DADOS/config/supabase.env" ] || [ -n "${MOTORCOB_SUPABASE_KEY:-}" ]; } && NUVEM=1

if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
  echo "ERRO: precisa de Python 3.11 ou mais novo (brew install python@3.12)." >&2
  exit 1
fi
if [ "$PLANTAO" = 1 ]; then
  [ "$NUVEM" = 1 ] || { echo "ERRO: --plantao precisa da nuvem configurada (scripts/configurar_nuvem.sh ou MOTORCOB_SUPABASE_URL/KEY)" >&2; exit 1; }
  cd "$REPO"
  export MOTORCOB_DADOS="$DADOS" MOTORCOB_PYTHON="$PY"
  exec "$PY" -m nuvem.sincronizar plantao --dados "$DADOS"
fi
if [ "$VIGIAR" = 1 ]; then
  [ "$NUVEM" = 1 ] || { echo "ERRO: --vigiar precisa da nuvem configurada (scripts/configurar_nuvem.sh ou MOTORCOB_SUPABASE_URL/KEY)" >&2; exit 1; }
  cd "$REPO"
  # sem nada a fazer: sai calado (o plantão chama a cada minuto e na hora do arquivo novo)
  mkdir -p "$DADOS/logs"
  MOTORCOB_DADOS="$DADOS" "$PY" -m nuvem.sincronizar vigiar --checar --dados "$DADOS" \
    2>"$DADOS/logs/vigia_ultimo_erro.log" || exit 0   # erro de conexão fica no log (scripts/diagnostico.sh mostra)
  mkdir -p "$DADOS/logs"
  LOG="$DADOS/logs/vigia_$DATA.log"
  echo "== $(date '+%F %T') carga nova no site" >> "$LOG"
  # no Mac o motor se atualiza pelo git; no servidor, pela imagem nova (sem .git)
  [ -d "$REPO/.git" ] && { git -C "$REPO" pull --ff-only -q 2>>"$LOG" || echo "aviso: não consegui atualizar o motor (git pull)" >> "$LOG"; }
  if MOTORCOB_DADOS="$DADOS" "$PY" -m nuvem.sincronizar vigiar --dados "$DADOS" --data "$DATA" >> "$LOG" 2>&1; then
    echo "Lista do dia publicada no site ($(date '+%T'))." | tee -a "$LOG"
    exit 0
  fi
  echo "ERRO ao gerar a lista — veja $LOG (o site mostra a execução com erro)" | tee -a "$LOG" >&2
  exit 1
fi

for obrigatorio in base/clientes.csv base/contatos.csv; do
  if [ "$NUVEM" = 0 ] && [ ! -f "$DADOS/$obrigatorio" ]; then
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
if [ "$NUVEM" = 1 ]; then
  # modo nuvem: atualiza o motor (empresas novas chegam por empresas/<slug>.json), baixa o
  # que o site recebeu de cada empresa, roda e publica no site
  [ -d "$REPO/.git" ] && { git -C "$REPO" pull --ff-only -q 2>>"$LOG" || echo "aviso: não consegui atualizar o motor (git pull); sigo com a versão atual" | tee -a "$LOG"; }
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
