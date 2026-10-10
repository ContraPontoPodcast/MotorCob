#!/bin/bash
# Leva os dados do motor do Mac para a nuvem: gera ~/MotorCob-dados.tgz (estado, bases, histórico),
# SEM a pasta config/ (a chave fica só no Secret Manager do Google) e sem logs.
# Antes, desliga o plantão do Mac para os dois não rodarem ao mesmo tempo.
set -euo pipefail
DADOS="${MOTORCOB_DADOS:-$HOME/MotorCob-dados}"
SAIDA="$HOME/MotorCob-dados.tgz"
PLIST="$HOME/Library/LaunchAgents/br.com.contraponto.motorcob.vigia.plist"
DIARIO="$HOME/Library/LaunchAgents/br.com.contraponto.motorcob.plist"
for p in "$PLIST" "$DIARIO"; do
  if [ -f "$p" ]; then
    launchctl unload "$p" 2>/dev/null || true
    mv "$p" "$p.desligado-nuvem"
    echo "Plantão do Mac desligado ($(basename "$p")). Para religar: mv '$p.desligado-nuvem' '$p' && launchctl load '$p'"
  fi
done
sleep 2
if pgrep -f "nuvem.sincronizar" >/dev/null; then
  echo "Ainda há uma rodada do motor em andamento no Mac; espere terminar e rode de novo." >&2
  exit 1
fi
[ -d "$DADOS" ] || { echo "Pasta de dados não encontrada: $DADOS" >&2; exit 1; }
tar -czf "$SAIDA" -C "$DADOS" --exclude='./config' --exclude='./logs' --exclude='.DS_Store' .
chmod 600 "$SAIDA"
echo "Pronto: $SAIDA ($(du -h "$SAIDA" | cut -f1)). Siga o passo 5 do docs/NUVEM_GCP.md."
