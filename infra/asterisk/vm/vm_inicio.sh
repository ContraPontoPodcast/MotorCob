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
#   motorcx-voz-speech-temas.timer     segunda 03:20: temas novos da semana (clusterização; mesmo metadado)
#   motorcx-voz-speech-buscas.service  contínuo: busca semântica do site (a cada 2 s; mesmo metadado)
#   motorcx-voz-simulador.service      simulador do Fluxo e roleplay em 127.0.0.1:8091 (metadado motorcx-simulador-fluxo=1)
#   caddy + motorcx-voz-https.timer    proxy HTTPS na 8443 (Caddy oficial, versão fixa): só as rotas dos recursos
#                                      ligados; certificado Let's Encrypt de <ip>.sslip.io (ou motorcx-dominio-https)
#   motorcx-voz-importador.timer       a cada 15 min: importa as gravações do discador do cliente (metadado
#                                      motorcx-importador-gravacoes=1; sem ele, sai sem fazer nada; SQL 64)
#   motorcx-voz-fluxo-noite.timer      02:50: métricas do dia do Fluxo do agente (funil e intenções por versão e bloco;
#                                      só códigos e contagens, sem IA; SQL 66)
#   motorcx-voz-gerar-fluxo.service    contínuo: gera o rascunho do fluxo a partir do pedido em texto (a cada 15 s;
#                                      metadado motorcx-gerar-fluxo=1; sem ele, sai sem fazer nada; SQL 58/66)
# Provedores de voz: /etc/motorcx/provedores.json e provedores_sip.json são da VM e nunca são sobrescritos. Se não
# existem, entra o padrão seguro: só a Montagem, com as REFERÊNCIAS das chaves no cofre (motorcx-provedores.padrao.json),
# e nenhum provedor SIP ([]). Exemplos completos: infra/asterisk/vm/provedores*.exemplo.json.
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

# Caddy (proxy HTTPS da 8443) pelo repositório oficial, versão fixa; o serviço só sobe com o Caddyfile do MotorCX
CADDY_VERSAO=2.8.4
instalar_caddy() {
  dpkg -s caddy 2>/dev/null | grep -q "^Version: $CADDY_VERSAO\$" && return 0
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-mark unhold caddy >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --allow-downgrades --allow-change-held-packages "caddy=$CADDY_VERSAO"
  apt-mark hold caddy >/dev/null
}
instalar_caddy || echo "Caddy não instalado agora (o proxy HTTPS fica parado; tenta de novo no próximo boot)"

META=http://metadata.google.internal/computeMetadata/v1/instance/attributes
baixar() { curl -fsS -H 'Metadata-Flavor: Google' "$META/$1"; }
# chave do metadado do arquivo: a MESMA expressão do criar_gcp.sh (o GCE só aceita [A-Za-z0-9_-] na chave);
# sem ela, tenta o nome antigo com ponto (compatibilidade)
chave_meta() { printf 'arquivo-%s' "$1" | tr -c 'A-Za-z0-9_-' '_'; }
baixar_arquivo() { baixar "$(chave_meta "$1")" 2>/dev/null || baixar "arquivo-$1" 2>/dev/null; }
for f in motorcx-voz-comum motorcx-voz-segredos motorcx-voz-rodar motorcx-voz-config motorcx-voz-atualizar \
         motorcx-voz-https; do
  baixar_arquivo "$f" > "/usr/local/bin/$f" && chmod 755 "/usr/local/bin/$f" || true
done
for u in motorcx-asterisk.service motorcx-voz-orquestrador.service motorcx-voz-simulado.service \
         motorcx-voz-config.service motorcx-voz-config.timer motorcx-voz-transcricao.service \
         motorcx-voz-transcricao.timer motorcx-voz-atualizar.service motorcx-voz-atualizar.timer \
         motorcx-voz-speech.service motorcx-voz-speech.timer motorcx-voz-speech-noite.service \
         motorcx-voz-speech-noite.timer motorcx-voz-speech-temas.service motorcx-voz-speech-temas.timer \
         motorcx-voz-speech-buscas.service motorcx-voz-simulador.service motorcx-voz-https.service \
         motorcx-voz-https.timer motorcx-voz-importador.service motorcx-voz-importador.timer \
         motorcx-voz-fluxo-noite.service motorcx-voz-fluxo-noite.timer motorcx-voz-gerar-fluxo.service; do
  baixar_arquivo "$u" > "/etc/systemd/system/$u" || true
done
install -d -m 755 /usr/local/share/motorcx/caddy
for c in motorcx-caddy.Caddyfile motorcx-caddy-simulador.caddy motorcx-caddy-elevenlabs.caddy; do
  baixar_arquivo "$c" > "/usr/local/share/motorcx/caddy/$c" || true
done
# provedores de voz: padrão seguro só quando o arquivo não existe (o que o dono gravou fica como está)
if [ ! -e /etc/motorcx/provedores.json ]; then
  padrao="$(baixar_arquivo motorcx-provedores.padrao.json || true)"
  json_ok() {   # objeto JSON (com python3 confere de verdade; sem ele, ao menos começa com "{")
    if command -v python3 >/dev/null; then
      python3 -c 'import json,sys; assert isinstance(json.load(sys.stdin), dict)' 2>/dev/null
    else
      [ "$(head -c 1)" = "{" ]
    fi
  }
  if [ -n "$padrao" ] && printf '%s' "$padrao" | json_ok; then
    printf '%s\n' "$padrao" | install -m 644 /dev/stdin /etc/motorcx/provedores.json
    echo "provedores.json padrão instalado (Montagem)"
  else
    echo "provedores.json padrão indisponível no metadado: sem provedores de IA até criar /etc/motorcx/provedores.json"
  fi
fi
[ -e /etc/motorcx/provedores_sip.json ] || printf '[]\n' | install -m 644 /dev/stdin /etc/motorcx/provedores_sip.json
systemctl daemon-reload
systemctl enable --now motorcx-voz-config.timer motorcx-voz-transcricao.timer motorcx-voz-atualizar.timer \
  motorcx-voz-speech.timer motorcx-voz-speech-noite.timer motorcx-voz-speech-temas.timer motorcx-voz-https.timer \
  motorcx-voz-importador.timer motorcx-voz-fluxo-noite.timer
systemctl enable --now motorcx-asterisk.service motorcx-voz-orquestrador.service motorcx-voz-simulado.service \
  motorcx-voz-speech-buscas.service motorcx-voz-simulador.service motorcx-voz-gerar-fluxo.service
systemctl enable caddy >/dev/null 2>&1 || true
/usr/local/bin/motorcx-voz-https || true          # rotas ligadas, certificado e reload (de novo a cada 2 min)
