#!/bin/bash
# Início das VMs do Asterisk do MotorCX (roda como root a cada boot; vem do criar_gcp.sh pelo metadado
# startup-script). Instala o Docker e os serviços. Nenhum segredo aqui: eles são lidos do Secret Manager pela
# conta de serviço da VM em cada início de serviço e ficam só em /run (memória).
#   motorcx-asterisk.service           o Asterisk (contêiner, rede do host)
#   motorcx-voz-orquestrador.service   o plantão do orquestrador (empresas em modo real)
#   motorcx-voz-simulado.service       o plantão das empresas em modo simulado (nenhuma ligação)
#   motorcx-voz-config.timer           a cada 2 min: busca a configuração no banco e recarrega o Asterisk
#   motorcx-voz-transcricao.timer      a cada 10 min: transcreve as gravações importadas do discador do cliente
#   motorcx-voz-atualizar.timer        05:35: baixa as imagens novas e reinicia (fora da janela de discagem)
#   motorcx-voz-speech.timer           a cada 15 min: Speech Analytics das ligações transcritas (metadado
#                                      motorcx-speech-analytics=1; sem ele, sai sem fazer nada)
#   motorcx-voz-speech-noite.timer     02:40: agregados do dia do Speech Analytics e retroalimentação (mesmo metadado)
set -euo pipefail
exec > >(logger -t motorcx-voz-inicio) 2>&1

timedatectl set-timezone America/Sao_Paulo || true
if ! command -v docker >/dev/null; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io unattended-upgrades
fi
systemctl enable --now docker
gcloud auth configure-docker southamerica-east1-docker.pkg.dev --quiet >/dev/null 2>&1 || true

install -d -m 755 /var/motorcx /etc/motorcx
for d in gravacoes eventos importadas transcricoes modelos; do
  install -d -m 750 -o 10010 -g 10010 "/var/motorcx/$d"
done
cat > /etc/sysctl.d/90-motorcx-voz.conf <<'EOF'
net.core.rmem_max=16777216
net.core.wmem_max=16777216
net.ipv4.udp_rmem_min=16384
EOF
sysctl --system >/dev/null || true

META=http://metadata.google.internal/computeMetadata/v1/instance/attributes
baixar() { curl -fsS -H 'Metadata-Flavor: Google' "$META/$1"; }
for f in motorcx-voz-comum motorcx-voz-segredos motorcx-voz-rodar motorcx-voz-config motorcx-voz-atualizar; do
  baixar "arquivo-$f" > "/usr/local/bin/$f" 2>/dev/null && chmod 755 "/usr/local/bin/$f" || true
done
for u in motorcx-asterisk.service motorcx-voz-orquestrador.service motorcx-voz-simulado.service \
         motorcx-voz-config.service motorcx-voz-config.timer motorcx-voz-transcricao.service \
         motorcx-voz-transcricao.timer motorcx-voz-atualizar.service motorcx-voz-atualizar.timer \
         motorcx-voz-speech.service motorcx-voz-speech.timer motorcx-voz-speech-noite.service \
         motorcx-voz-speech-noite.timer; do
  baixar "arquivo-$u" > "/etc/systemd/system/$u" 2>/dev/null || true
done
systemctl daemon-reload
systemctl enable --now motorcx-voz-config.timer motorcx-voz-transcricao.timer motorcx-voz-atualizar.timer \
  motorcx-voz-speech.timer motorcx-voz-speech-noite.timer
systemctl enable --now motorcx-asterisk.service motorcx-voz-orquestrador.service motorcx-voz-simulado.service
