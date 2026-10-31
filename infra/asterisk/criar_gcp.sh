#!/bin/bash
# Cria a infraestrutura do Asterisk do MotorCX no Google Cloud, em São Paulo (southamerica-east1).
# Rode UMA vez no Cloud Shell (console.cloud.google.com › ícone ">_"). Pode rodar de novo: o que já existe é
# mantido e as listas de IP do firewall e a regra de retenção são atualizadas para o que está abaixo.
#
#   bash criar_gcp.sh [ID-DO-PROJETO]
#
# Cria:
#   - rede "motorcx-voz" e sub-rede em São Paulo
#   - 2 IPs estáticos externos (um por VM; são os IPs que as operadoras liberam)
#   - firewall: SIP (5060 UDP/TCP, 5061 TLS) só dos IPs da lista abaixo; RTP 10000–20000 UDP dos mesmos IPs;
#     SSH só pelo IAP do Google; nada mais entra
#   - conta de serviço "motorcx-asterisk" com o mínimo: lê só os segredos motorcx-voz-*, grava e lê objetos só no
#     bucket de gravações, escreve log e métrica
#   - segredo "motorcx-voz-ari-senha" com uma senha aleatória para o ARI (gerada aqui, nunca exibida)
#   - bucket de gravações em São Paulo, privado, com exclusão automática depois de RETENCAO_DIAS (padrão 90) e
#     chave própria no Cloud KMS (CMEK) opcional
#   - 2 VMs (zonas a e b), Shielded VM, Debian 12, com Docker instalado no primeiro boot
#
# Não pede nem imprime nenhum segredo. Não instala o Asterisk: a imagem (infra/asterisk/Dockerfile) é publicada
# pelo GitHub e iniciada na VM (README).
set -euo pipefail

# ======================================================================= EDITE AQUI
# IPs (ou faixas CIDR) de SINALIZAÇÃO e MÍDIA das operadoras de todas as empresas. Peça à operadora a lista de
# IPs do SBC dela (sinalização e mídia). Um por linha. Os valores abaixo são EXEMPLOS de documentação (RFC 5737)
# e o script se recusa a rodar enquanto estiverem aqui.
IPS_OPERADORAS=(
  198.51.100.10/32
  203.0.113.0/28
)
# Provedores de voz ligados por SIP (ex.: ElevenLabs) e discadores dos clientes que recebem transferência por
# ponte (pela mídia). Deixe vazio se ainda não houver.
IPS_PROVEDORES_VOZ=(
)
IPS_DISCADORES_CLIENTES=(
)
RETENCAO_DIAS="${RETENCAO_DIAS:-90}"            # mínimo 90 (decisão do dono); sem teto
USAR_CMEK="${USAR_CMEK:-0}"                      # 1 = bucket cifrado com chave própria no Cloud KMS
MAQUINA="${MAQUINA:-n2-standard-4}"
DISCO_GB="${DISCO_GB:-50}"
# ======================================================================= fim

PROJETO="${1:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJETO" ] || { echo "Informe o ID do projeto: bash criar_gcp.sh meu-projeto-123" >&2; exit 1; }
REGIAO=southamerica-east1
ZONAS=(southamerica-east1-a southamerica-east1-b)
REDE=motorcx-voz
SUBREDE=motorcx-voz-sp
FAIXA_SUBREDE=10.60.0.0/24
TAG=motorcx-asterisk
SA_NOME=motorcx-asterisk
BUCKET="${BUCKET:-${PROJETO}-motorcx-gravacoes}"
KMS_ANEL=motorcx-voz
KMS_CHAVE=gravacoes
SEGREDO_ARI=motorcx-voz-ari-senha
IAP=35.235.240.0/20

existe() { "$@" >/dev/null 2>&1; }
passo() { printf '\n== %s\n' "$*"; }
falha() { echo "ERRO: $*" >&2; exit 1; }

# ---------------------------------------------------------------- conferências antes de mexer em qualquer coisa
CIDR='^([0-9]{1,3}\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?$'
ORIGENS=()
for ip in "${IPS_OPERADORAS[@]}" "${IPS_PROVEDORES_VOZ[@]}" "${IPS_DISCADORES_CLIENTES[@]}"; do
  [[ "$ip" =~ $CIDR ]] || falha "IP/faixa inválido na lista: '$ip'"
  [[ "$ip" == 0.0.0.0* ]] && falha "0.0.0.0 abriria o SIP para a internet inteira"
  [[ "$ip" == */* ]] || ip="$ip/32"
  ORIGENS+=("$ip")
done
[ "${#IPS_OPERADORAS[@]}" -gt 0 ] || falha "a lista IPS_OPERADORAS está vazia"
for ip in "${ORIGENS[@]}"; do
  case "$ip" in 192.0.2.*|198.51.100.*|203.0.113.*)
    falha "a lista ainda tem IPs de exemplo ($ip). Edite IPS_OPERADORAS no topo do script com os IPs reais." ;;
  esac
done
[[ "$RETENCAO_DIAS" =~ ^[0-9]+$ ]] && [ "$RETENCAO_DIAS" -ge 90 ] || falha "RETENCAO_DIAS precisa ser um número ≥ 90"
LISTA_ORIGENS="$(IFS=,; echo "${ORIGENS[*]}")"

gcloud config set project "$PROJETO" >/dev/null
NUM="$(gcloud projects describe "$PROJETO" --format='value(projectNumber)')"
SA="${SA_NOME}@${PROJETO}.iam.gserviceaccount.com"

passo "Ligando as APIs (1–2 minutos na primeira vez)"
gcloud services enable compute.googleapis.com secretmanager.googleapis.com storage.googleapis.com \
  iam.googleapis.com logging.googleapis.com monitoring.googleapis.com cloudkms.googleapis.com \
  iap.googleapis.com >/dev/null

passo "Rede e sub-rede em São Paulo"
existe gcloud compute networks describe "$REDE" || \
  gcloud compute networks create "$REDE" --subnet-mode=custom
existe gcloud compute networks subnets describe "$SUBREDE" --region="$REGIAO" || \
  gcloud compute networks subnets create "$SUBREDE" --network="$REDE" --region="$REGIAO" \
    --range="$FAIXA_SUBREDE" --enable-private-ip-google-access

passo "IPs estáticos externos"
for i in 1 2; do
  existe gcloud compute addresses describe "motorcx-ast-$i" --region="$REGIAO" || \
    gcloud compute addresses create "motorcx-ast-$i" --region="$REGIAO" --network-tier=PREMIUM \
      --description="Asterisk MotorCX $i (IP que a operadora libera)"
done

passo "Firewall (SIP e RTP só das origens da lista; SSH só pelo IAP)"
regra() {   # nome, regras, origens, descrição: cria ou atualiza as origens
  if existe gcloud compute firewall-rules describe "$1"; then
    gcloud compute firewall-rules update "$1" --rules="$2" --source-ranges="$3" >/dev/null
    echo "atualizada: $1"
  else
    gcloud compute firewall-rules create "$1" --network="$REDE" --direction=INGRESS --action=ALLOW \
      --rules="$2" --source-ranges="$3" --target-tags="$TAG" --description="$4" >/dev/null
    echo "criada: $1"
  fi
}
regra motorcx-voz-sip "udp:5060,tcp:5060,tcp:5061" "$LISTA_ORIGENS" "SIP das operadoras, provedores e discadores"
regra motorcx-voz-rtp "udp:10000-20000" "$LISTA_ORIGENS" "RTP (mídia) das mesmas origens do SIP"
regra motorcx-voz-ssh-iap "tcp:22" "$IAP" "SSH só pelo IAP do Google"

passo "Conta de serviço com privilégio mínimo"
existe gcloud iam service-accounts describe "$SA" || \
  gcloud iam service-accounts create "$SA_NOME" --display-name="Asterisk MotorCX (voz)"
for papel in roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA" --role="$papel" \
    --condition=None >/dev/null
done
# só os segredos com o prefixo motorcx-voz- (senhas de tronco e do ARI); nenhum outro segredo do projeto
gcloud projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA" \
  --role=roles/secretmanager.secretAccessor \
  --condition="expression=resource.name.startsWith(\"projects/${NUM}/secrets/motorcx-voz-\"),title=motorcx-voz-segredos,description=Asterisk le so segredos motorcx-voz-" \
  >/dev/null

passo "Senha do ARI no Secret Manager (gerada aqui, nunca exibida)"
if existe gcloud secrets describe "$SEGREDO_ARI"; then
  echo "Já existe (mantida)."
else
  head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 40 | \
    gcloud secrets create "$SEGREDO_ARI" --replication-policy=user-managed --locations="$REGIAO" --data-file=- \
    >/dev/null
  echo "Criada."
fi

CHAVE_KMS=""
if [ "$USAR_CMEK" = 1 ]; then
  passo "Chave própria (CMEK) no Cloud KMS em São Paulo"
  existe gcloud kms keyrings describe "$KMS_ANEL" --location="$REGIAO" || \
    gcloud kms keyrings create "$KMS_ANEL" --location="$REGIAO"
  existe gcloud kms keys describe "$KMS_CHAVE" --keyring="$KMS_ANEL" --location="$REGIAO" || \
    gcloud kms keys create "$KMS_CHAVE" --keyring="$KMS_ANEL" --location="$REGIAO" --purpose=encryption \
      --rotation-period=90d --next-rotation-time="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)"
  CHAVE_KMS="projects/${PROJETO}/locations/${REGIAO}/keyRings/${KMS_ANEL}/cryptoKeys/${KMS_CHAVE}"
  AGENTE_GCS="$(gcloud storage service-agent --project="$PROJETO")"
  gcloud kms keys add-iam-policy-binding "$KMS_CHAVE" --keyring="$KMS_ANEL" --location="$REGIAO" \
    --member="serviceAccount:${AGENTE_GCS}" --role=roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null
fi

passo "Bucket de gravações (privado, São Paulo, retenção de ${RETENCAO_DIAS} dias)"
if ! existe gcloud storage buckets describe "gs://$BUCKET"; then
  gcloud storage buckets create "gs://$BUCKET" --location="$REGIAO" --uniform-bucket-level-access \
    --public-access-prevention --default-storage-class=STANDARD \
    ${CHAVE_KMS:+--default-encryption-key="$CHAVE_KMS"}
elif [ -n "$CHAVE_KMS" ]; then
  gcloud storage buckets update "gs://$BUCKET" --default-encryption-key="$CHAVE_KMS" >/dev/null
fi
CICLO="$(mktemp)"
trap 'rm -f "$CICLO"' EXIT
if [ "$RETENCAO_DIAS" -ge 365 ]; then
  # retenção longa: depois de 90 dias vai para a classe Coldline (mais barata), e é apagada no fim
  printf '{"rule":[{"action":{"type":"SetStorageClass","storageClass":"COLDLINE"},"condition":{"age":90,"matchesStorageClass":["STANDARD"]}},{"action":{"type":"Delete"},"condition":{"age":%s}}]}\n' "$RETENCAO_DIAS" > "$CICLO"
else
  printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":%s}}]}\n' "$RETENCAO_DIAS" > "$CICLO"
fi
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$CICLO" >/dev/null
for papel in roles/storage.objectCreator roles/storage.objectViewer; do
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role="$papel" \
    >/dev/null
done

passo "VMs do Asterisk (uma por zona)"
INICIO="$(mktemp)"
trap 'rm -f "$CICLO" "$INICIO"' EXIT
cat > "$INICIO" <<'SH'
#!/bin/bash
# Primeiro boot da VM do Asterisk: fuso, Docker, pastas e ajustes de rede para RTP. Sem segredos aqui.
set -euo pipefail
timedatectl set-timezone America/Sao_Paulo || true
if ! command -v docker >/dev/null; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io unattended-upgrades
fi
systemctl enable --now docker
install -d -m 750 -o 10010 -g 10010 /var/motorcx/gravacoes
install -d -m 700 /run/motorcx
cat > /etc/sysctl.d/90-motorcx-voz.conf <<'EOF'
net.core.rmem_max=16777216
net.core.wmem_max=16777216
net.ipv4.udp_rmem_min=16384
EOF
sysctl --system >/dev/null || true
SH
for i in 1 2; do
  VM="motorcx-ast-$i"
  ZONA="${ZONAS[$((i - 1))]}"
  if existe gcloud compute instances describe "$VM" --zone="$ZONA"; then
    echo "Já existe: $VM ($ZONA)"
    continue
  fi
  IP="$(gcloud compute addresses describe "motorcx-ast-$i" --region="$REGIAO" --format='value(address)')"
  gcloud compute instances create "$VM" --zone="$ZONA" --machine-type="$MAQUINA" \
    --subnet="$SUBREDE" --address="$IP" --network-tier=PREMIUM --tags="$TAG" \
    --service-account="$SA" --scopes=cloud-platform \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size="${DISCO_GB}GB" --boot-disk-type=pd-balanced \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring --deletion-protection \
    --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE,motorcx-bucket="$BUCKET",motorcx-ip-externo="$IP" \
    --metadata-from-file=startup-script="$INICIO" >/dev/null
  echo "Criada: $VM ($ZONA)"
done

passo "Pronto. Mande estes IPs para as operadoras liberarem (sinalização SIP e mídia RTP 10000–20000):"
for i in 1 2; do
  printf '  motorcx-ast-%s  %s\n' "$i" "$(gcloud compute addresses describe "motorcx-ast-$i" --region="$REGIAO" --format='value(address)')"
done
echo
echo "Bucket de gravações: gs://$BUCKET (retenção ${RETENCAO_DIAS} dias${CHAVE_KMS:+, CMEK})"
echo "Origens liberadas no firewall: $LISTA_ORIGENS"
echo "Para incluir uma operadora nova: edite IPS_OPERADORAS no topo e rode o script de novo."
