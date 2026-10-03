#!/bin/bash
# Instalação no Mac: pasta de dados, dependência do Excel, testes e (opcional)
# agendamento. Uso: scripts/instalar_mac.sh [HH:MM | vigiar]
#   HH:MM   roda uma vez por dia nesse horário (ex.: 06:30)
#   vigiar  plantão em tempo real: olha o site a cada 5 segundos e, se chegou arquivo da
#           carteira, gera a lista na hora; também faz a rotina do dia às 06:00
#           (substitui o agendamento diário)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DADOS="${MOTORCOB_DADOS:-$HOME/MotorCob-dados}"
PY="${MOTORCOB_PYTHON:-python3}"

if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
  echo "Precisa de Python 3.11+. Instale com: brew install python@3.12  (Homebrew: https://brew.sh)" >&2
  exit 1
fi
echo "Python: $("$PY" --version)"
mkdir -p "$DADOS"/{base,retornos,logs,estado,saida,acoes,empresas}
echo "Pasta de dados: $DADOS"
"$PY" -m pip install --user --quiet openpyxl && echo "openpyxl instalado (Excel do comitê)"
(cd "$REPO" && "$PY" -m unittest -q) && echo "Testes OK"
chmod +x "$REPO"/scripts/*.sh

if [ "${1:-}" = "vigiar" ]; then
  DIARIO="$HOME/Library/LaunchAgents/br.com.contraponto.motorcob.plist"
  if [ -f "$DIARIO" ]; then
    launchctl unload "$DIARIO" 2>/dev/null || true
    rm "$DIARIO"
    echo "Agendamento diário removido: a lista passa a sair quando a carga chegar."
  fi
  PLIST="$HOME/Library/LaunchAgents/br.com.contraponto.motorcob.vigia.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>br.com.contraponto.motorcob.vigia</string>
  <key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-i</string>
    <string>$REPO/scripts/rodar_dia.sh</string><string>--plantao</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>MOTORCOB_DADOS</key><string>$DADOS</string>
    <key>MOTORCOB_PYTHON</key><string>$(command -v "$PY")</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DADOS/logs/vigia.log</string>
  <key>StandardErrorPath</key><string>$DADOS/logs/vigia.log</string>
</dict></plist>
PL
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "Vigia ligada em tempo real: a cada 5 segundos o Mac olha o site; arquivo novo = lista na hora."
  echo "Enquanto a vigia roda, o Mac não dorme sozinho (caffeinate). Tampa fechada ou desligado: para."
  echo "Para desligar: launchctl unload $PLIST && rm $PLIST"
elif [ -n "${1:-}" ]; then
  VIGIA="$HOME/Library/LaunchAgents/br.com.contraponto.motorcob.vigia.plist"
  [ -f "$VIGIA" ] && { launchctl unload "$VIGIA" 2>/dev/null || true; rm "$VIGIA"; echo "Vigia desligada."; }
  HORA="${1%%:*}"; MIN="${1##*:}"
  PLIST="$HOME/Library/LaunchAgents/br.com.contraponto.motorcob.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>br.com.contraponto.motorcob</string>
  <key>ProgramArguments</key><array><string>$REPO/scripts/rodar_dia.sh</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>MOTORCOB_DADOS</key><string>$DADOS</string>
    <key>MOTORCOB_PYTHON</key><string>$(command -v "$PY")</string>
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>$((10#$HORA))</integer><key>Minute</key><integer>$((10#$MIN))</integer>
  </dict>
  <key>StandardOutPath</key><string>$DADOS/logs/agendamento.log</string>
  <key>StandardErrorPath</key><string>$DADOS/logs/agendamento.log</string>
</dict></plist>
PL
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "Agendado todo dia às $1 (se o Mac estiver dormindo, roda ao acordar)."
  echo "Para cancelar: launchctl unload $PLIST && rm $PLIST"
fi
