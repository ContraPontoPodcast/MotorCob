#!/bin/bash
# Script de início da VM "motorcob" (roda como root a cada boot; vem do preparar_projeto.sh).
# Monta o disco de dados, instala o Docker e liga o plantão do motor como serviço do sistema:
#   motorcob.service            plantão (o mesmo do Mac), reinicia sozinho se cair
#   motorcob-atualizar.timer    05:20 todo dia: baixa a imagem nova e reinicia fora de rodada
#   motorcob-comite.timer       dia 1º às 07:00: relatório do comitê do mês anterior
#   motorcob-restaurar          comando para trazer os dados do Mac (veja docs/NUVEM_GCP.md)
#   motorcob-pausar             para o plantão e o mantém parado (mesmo após reiniciar) até restaurar/retomar
set -euo pipefail
exec > >(logger -t motorcob-inicio) 2>&1

META=http://metadata.google.internal/computeMetadata/v1/instance/attributes
meta() { curl -fsS -H 'Metadata-Flavor: Google' "$META/$1"; }

timedatectl set-timezone America/Sao_Paulo || true

# disco de dados (separado do disco do sistema; tem snapshot diário)
DISCO=/dev/disk/by-id/google-motorcob-dados
mkdir -p /var/motorcob
if [ -e "$DISCO" ]; then
  blkid "$DISCO" >/dev/null 2>&1 || mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$DISCO"
  grep -q '/var/motorcob ' /etc/fstab || echo "$DISCO /var/motorcob ext4 discard,defaults,nofail 0 2" >> /etc/fstab
  mountpoint -q /var/motorcob || mount /var/motorcob
fi
mkdir -p /var/motorcob/dados
chown 10001:10001 /var/motorcob/dados
chmod 700 /var/motorcob/dados

if ! command -v docker >/dev/null; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io
fi
systemctl enable --now docker
# atualizações de segurança automáticas do sistema
if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q unattended-upgrades
fi

cat > /usr/local/bin/motorcob-rodar <<'SH'
#!/bin/bash
# Busca a imagem e a chave e roda o plantão. A chave fica só em memória (/run, tmpfs), legível só pelo root.
set -euo pipefail
META=http://metadata.google.internal/computeMetadata/v1/instance/attributes
meta() { curl -fsS -H 'Metadata-Flavor: Google' "$META/$1"; }
IMAGEM="$(meta motorcob-imagem)"
URL="$(meta motorcob-supabase-url)"
install -d -m 700 /run/motorcob
umask 077
CHAVE="$(gcloud secrets versions access latest --secret=motorcob-supabase-key)"
printf 'MOTORCOB_SUPABASE_URL=%s\nMOTORCOB_SUPABASE_KEY=%s\n' "$URL" "$CHAVE" > /run/motorcob/supabase.env
unset CHAVE
gcloud auth configure-docker "${IMAGEM%%/*}" --quiet >/dev/null 2>&1
docker pull -q "$IMAGEM" >/dev/null || docker image inspect "$IMAGEM" >/dev/null   # sem rede: usa a que tem
docker rm -f motorcob >/dev/null 2>&1 || true
# --init: o motor recebe o pedido de parar (sem ele, o Python como processo 1 ignora e o stop espera o limite)
exec docker run --rm --init --name motorcob \
  --env-file /run/motorcob/supabase.env \
  --read-only --tmpfs /tmp:rw,size=512m --tmpfs /home/motorcob:rw,size=16m \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 \
  -v /var/motorcob/dados:/dados \
  --log-driver gcplogs --log-opt gcp-log-cmd=false --log-opt labels=motorcob \
  "$IMAGEM"
SH
chmod 750 /usr/local/bin/motorcob-rodar

cat > /usr/local/bin/motorcob-atualizar <<'SH'
#!/bin/bash
# Baixa a imagem nova; se mudou, reinicia o plantão quando não houver rodada em andamento.
set -euo pipefail
IMAGEM="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/attributes/motorcob-imagem)"
gcloud auth configure-docker "${IMAGEM%%/*}" --quiet >/dev/null 2>&1
ANTES="$(docker inspect --format '{{.Image}}' motorcob 2>/dev/null || true)"
docker pull -q "$IMAGEM" >/dev/null
DEPOIS="$(docker image inspect --format '{{.Id}}' "$IMAGEM")"
if [ "$ANTES" != "$DEPOIS" ]; then
  mkdir -p /var/motorcob/dados/logs
  flock -w 1800 /var/motorcob/dados/logs/.rodando.lock systemctl restart motorcob
  logger -t motorcob "motor atualizado para ${DEPOIS:7:12}"
fi
docker image prune -f >/dev/null
SH
chmod 750 /usr/local/bin/motorcob-atualizar

cat > /usr/local/bin/motorcob-restaurar <<'SH'
#!/bin/bash
# Traz os dados do Mac: sudo motorcob-restaurar /caminho/MotorCob-dados.tgz
set -euo pipefail
ARQ="${1:?informe o arquivo .tgz gerado por scripts/exportar_dados_mac.sh}"
systemctl stop motorcob
DESTINO=/var/motorcob/dados
if [ -n "$(ls -A "$DESTINO" 2>/dev/null)" ]; then
  mv "$DESTINO" "$DESTINO.antes-$(date +%Y%m%d%H%M%S)"
  install -d -m 700 -o 10001 -g 10001 "$DESTINO"
fi
tar -xzf "$ARQ" -C "$DESTINO" --no-same-owner
rm -rf "$DESTINO/config"            # na nuvem a chave vem do Secret Manager, nunca de arquivo
chown -R 10001:10001 "$DESTINO"
rm -f /var/motorcob/PAUSADO
systemctl start motorcob
echo "Dados restaurados em $DESTINO e plantão religado."
SH
chmod 750 /usr/local/bin/motorcob-restaurar

cat > /usr/local/bin/motorcob-pausar <<'SH'
#!/bin/bash
# Para o plantão e o mantém parado, mesmo se a VM reiniciar. Para voltar: sudo motorcob-retomar
set -euo pipefail
touch /var/motorcob/PAUSADO
systemctl stop motorcob
echo "Plantão da nuvem pausado."
SH
cat > /usr/local/bin/motorcob-retomar <<'SH'
#!/bin/bash
set -euo pipefail
rm -f /var/motorcob/PAUSADO
systemctl start motorcob
echo "Plantão da nuvem ligado."
SH
chmod 750 /usr/local/bin/motorcob-pausar /usr/local/bin/motorcob-retomar

cat > /etc/systemd/system/motorcob.service <<'UNIT'
[Unit]
Description=MotorCob - plantão do motor
After=docker.service network-online.target var-motorcob.mount
Wants=network-online.target
Requires=docker.service
ConditionPathExists=!/var/motorcob/PAUSADO

[Service]
ExecStart=/usr/local/bin/motorcob-rodar
ExecStop=/usr/bin/docker stop -t 60 motorcob
Restart=always
RestartSec=30
TimeoutStopSec=90

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/motorcob-atualizar.service <<'UNIT'
[Unit]
Description=MotorCob - atualiza a imagem do motor
[Service]
Type=oneshot
ExecStart=/usr/local/bin/motorcob-atualizar
UNIT
cat > /etc/systemd/system/motorcob-atualizar.timer <<'UNIT'
[Unit]
Description=MotorCob - atualização diária
[Timer]
OnCalendar=*-*-* 05:20
Persistent=true
[Install]
WantedBy=timers.target
UNIT

cat > /etc/systemd/system/motorcob-comite.service <<'UNIT'
[Unit]
Description=MotorCob - relatório do comitê do mês anterior
[Service]
Type=oneshot
ExecStart=/bin/bash -c 'docker exec motorcob scripts/relatorio_mes.sh "$(date -d "$(date +%%Y-%%m-01) -1 day" +%%Y-%%m)"'
UNIT
cat > /etc/systemd/system/motorcob-comite.timer <<'UNIT'
[Unit]
Description=MotorCob - comitê todo dia 1º
[Timer]
OnCalendar=*-*-01 07:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now motorcob-atualizar.timer motorcob-comite.timer
systemctl enable motorcob.service
if [ -e /var/motorcob/PAUSADO ]; then
  echo "MotorCob: pausado (sudo motorcob-retomar ou motorcob-restaurar para ligar)."
else
  systemctl restart motorcob.service
  echo "MotorCob: serviço ligado."
fi
