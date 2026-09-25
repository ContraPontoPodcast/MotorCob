#!/bin/bash
# Liga a rotina do Mac ao Supabase do site. Pede a URL do projeto e a chave
# service_role (digitada sem aparecer na tela) e grava em
# ~/MotorCob-dados/config/supabase.env, legível só pelo seu usuário.
# A chave NUNCA vai para o git, para o site ou para mensagens.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DADOS="${MOTORCOB_DADOS:-$HOME/MotorCob-dados}"
PY="${MOTORCOB_PYTHON:-python3}"
ARQ="$DADOS/config/supabase.env"

read -r -p "URL do projeto Supabase (ex.: https://xxxx.supabase.co): " URL
read -r -s -p "Chave service_role (Project Settings > API; não aparece ao digitar): " CHAVE; echo
[ -n "$URL" ] && [ -n "$CHAVE" ] || { echo "URL e chave são obrigatórias." >&2; exit 1; }

mkdir -p "$DADOS/config"
umask 077
printf 'MOTORCOB_SUPABASE_URL=%s\nMOTORCOB_SUPABASE_KEY=%s\n' "$URL" "$CHAVE" > "$ARQ"
chmod 600 "$ARQ"

cd "$REPO"
if MOTORCOB_DADOS="$DADOS" "$PY" -c "
import sys; from pathlib import Path
from nuvem.sincronizar import carregar_config; from nuvem.supabase_api import Supabase
sb = Supabase(*carregar_config(Path('$DADOS')))
sb.selecionar('execucoes', limite=1)
print('Conexão OK com o Supabase.')"; then
  echo "Configuração salva em $ARQ. A rotina diária agora sincroniza com o site."
else
  echo "Não consegui acessar o Supabase. Confira a URL, a chave e se a migração foi aplicada." >&2
  rm -f "$ARQ"
  exit 1
fi
