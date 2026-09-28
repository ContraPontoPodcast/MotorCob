#!/bin/bash
# Instalação no Mac: pasta de dados, dependência do Excel, testes e (opcional)
# agendamento diário. Uso: scripts/instalar_mac.sh [HH:MM]   ex.: 06:30
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DADOS="${MOTORCOB_DADOS:-$HOME/MotorCob-dados}"
PY="${MOTORCOB_PYTHON:-python3}"

if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
  echo "Precisa de Python 3.11+. Instale com: brew install python@3.12  (Homebrew: https://brew.sh)" >&2
  exit 1
fi
echo "Python: $("$PY" --version)"
mkdir -p "$DADOS"/{base,retornos,logs,estado,saida,acoes}
echo "Pasta de dados: $DADOS"
"$PY" -m pip install --user --quiet openpyxl && echo "openpyxl instalado (Excel do comitê)"
(cd "$REPO" && "$PY" -m unittest -q) && echo "Testes OK"
chmod +x "$REPO"/scripts/*.sh

if [ -n "${1:-}" ]; then
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
