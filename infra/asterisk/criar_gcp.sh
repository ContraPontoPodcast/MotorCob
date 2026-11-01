#!/bin/bash
# Cria a infraestrutura do Asterisk do MotorCX no Google Cloud, em São Paulo (southamerica-east1).
# Rode no Cloud Shell (console.cloud.google.com › ícone ">_"). Pode rodar de novo: o que já existe é mantido e
# as listas de IP do firewall e a retenção são atualizadas para o que está abaixo.
#
#   bash criar_gcp.sh [ID-DO-PROJETO]                          infraestrutura (uma vez)
#   bash criar_gcp.sh empresa <id> <dias> [ID-DO-PROJETO]      bucket de gravações da empresa (um por empresa)
#   bash criar_gcp.sh chave-leitura [ID-DO-PROJETO]             chave JSON da conta de leitura das gravações, num
#                                                              arquivo temporário (para o GCS_GRAVACOES_CHAVE do
#                                                              Supabase); o script nunca mostra o conteúdo
#
# Infraestrutura:
#   - rede "motorcx-voz" e sub-rede em São Paulo
#   - 2 IPs estáticos externos (um por VM; são os IPs que as operadoras liberam)
#   - firewall: SIP (5060 UDP/TCP, 5061 TLS) só dos IPs da lista abaixo; RTP 10000–20000 UDP dos mesmos IPs;
#     SSH só pelo IAP do Google; HTTPS 8443 (proxy Caddy: webhook da ElevenLabs e simulador do Fluxo, cada rota só
#     com o recurso ligado e protegida por assinatura HMAC) das origens de ORIGENS_HTTPS; 80 só para o desafio do
#     Let's Encrypt (o Caddy responde ali só o desafio e o redirecionamento); nada mais entra
#   - conta de serviço "motorcx-asterisk" com o mínimo: lê só os segredos motorcx-voz-* e motorcx-crm-* (credenciais
#     dos conectores de CRM), grava e lê objetos só nos buckets de gravações, escreve log e métrica e chama os
#     modelos da Vertex AI (roles/aiplatform.user: embedding do Speech Analytics e da busca semântica,
#     voz/analise/trechos.py)
#   - conta de serviço "motorcx-gravacoes-leitura", sem papel nenhum no projeto: só lê objetos nos buckets de
#     gravações (dado pelo modo empresa). A chave dela é o GCS_GRAVACOES_CHAVE da Edge Function gravacoes (URL
#     assinada para ouvir a gravação no site); gere com o modo chave-leitura
#   - segredo "motorcx-voz-ari-senha" com uma senha aleatória para o ARI (gerada aqui, nunca exibida)
#   - chave própria no Cloud KMS (CMEK) para as gravações, opcional (USAR_CMEK=1)
#   - 2 VMs (zonas a e b), Shielded VM, Debian 12; no boot, vm_inicio.sh instala o Docker e os serviços
#     (Asterisk, orquestrador, configuração e transcrição)
# Empresa (decisão do dono: um bucket por empresa, com a retenção dela):
#   - bucket <projeto>-motorcx-grav-e<id> em São Paulo, privado, apagando depois de <dias> (mínimo 90, sem teto;
#     a partir de 365 dias passa para Coldline aos 90), CMEK se a chave existir ou USAR_CMEK=1, e acesso só da
#     conta motorcx-asterisk (grava e lê) e da motorcx-gravacoes-leitura (só lê). O nome vai para
#     voz_config.bucket_gravacoes da empresa.
# Chave de leitura (chave-leitura): cria uma chave nova da motorcx-gravacoes-leitura num arquivo 0600 do Cloud Shell
#   e diz como colar no Supabase e apagar (shred). Rode de novo para trocar a chave (e apague a antiga, como indicado).
#
# Não pede nem imprime nenhum segredo. Não instala o Asterisk: a imagem (infra/asterisk/Dockerfile) é publicada
# pelo GitHub e iniciada na VM (README).
set -euo pipefail

# ======================================================================= EDITE AQUI
# IPs (ou faixas CIDR) de SINALIZAÇÃO e MÍDIA das operadoras de todas as empresas. Peça à operadora a lista de
# IPs do SBC dela (sinalização e mídia). Um por linha. Os valores abaixo são EXEMPLOS de documentação (RFC 5737)
# e o script se recusa a rodar enquanto estiverem aqui.
# Ainda não tem os IPs? Deixe vazio: o script cria tudo e mantém o SIP FECHADO. Depois que a operadora mandar os
# IPs dela, preencha aqui e rode de novo (só o firewall muda).
IPS_OPERADORAS=(
)
# Provedores de voz ligados por SIP (ex.: ElevenLabs) e discadores dos clientes que recebem transferência por
# ponte (pela mídia). Deixe vazio se ainda não houver.
IPS_PROVEDORES_VOZ=(
)
IPS_DISCADORES_CLIENTES=(
)
# Quem chama o proxy HTTPS da 8443: a ElevenLabs (webhook pós-chamada) e as Edge Functions do Supabase (simulador
# do Fluxo). Nenhum dos dois tem IP de origem fixo publicado, por isso o padrão é a internet toda e quem protege é a
# assinatura HMAC de cada rota. Se a ElevenLabs e o Supabase passarem a ter IPs fixos, ponha só eles aqui (CIDR).
ORIGENS_HTTPS=(
  0.0.0.0/0
)
USAR_CMEK="${USAR_CMEK:-0}"                      # 1 = bucket cifrado com chave própria no Cloud KMS
MAQUINA="${MAQUINA:-e2-standard-2}"      # piloto; antes do volume real: MAQUINA=n2-standard-4 (dá para trocar depois)
DISCO_GB="${DISCO_GB:-50}"
# ======================================================================= fim

MODO=infra
if [ "${1:-}" = empresa ]; then
  MODO=empresa
  EMPRESA_ID="${2:-}"
  RETENCAO_DIAS="${3:-}"
  shift 3 || true
elif [ "${1:-}" = chave-leitura ]; then
  MODO=chave-leitura
  shift
fi
PROJETO="${1:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJETO" ] || { echo "Informe o ID do projeto: bash criar_gcp.sh meu-projeto-123" >&2; exit 1; }
if [[ "$PROJETO" =~ ^[0-9]+$ ]]; then   # veio o NÚMERO do projeto: descobre o ID
  PROJETO="$(gcloud projects describe "$PROJETO" --format='value(projectId)')"
  echo "Projeto: $PROJETO"
fi
REGIAO=southamerica-east1
ZONAS=(southamerica-east1-a southamerica-east1-b)
REDE=motorcx-voz
SUBREDE=motorcx-voz-sp
FAIXA_SUBREDE=10.60.0.0/24
TAG=motorcx-asterisk
SA_NOME=motorcx-asterisk
SA_LEITURA_NOME=motorcx-gravacoes-leitura      # GCS_GRAVACOES_CHAVE (Edge Function gravacoes): só lê as gravações
KMS_ANEL=motorcx-voz
KMS_CHAVE=gravacoes
SEGREDO_ARI=motorcx-voz-ari-senha
IAP=35.235.240.0/20

existe() { "$@" >/dev/null 2>&1; }
passo() { printf '\n== %s\n' "$*"; }
falha() { echo "ERRO: $*" >&2; exit 1; }

CHAVE_KMS_NOME="projects/${PROJETO}/locations/${REGIAO}/keyRings/${KMS_ANEL}/cryptoKeys/${KMS_CHAVE}"
SA_LEITURA="${SA_LEITURA_NOME}@${PROJETO}.iam.gserviceaccount.com"

garantir_sa_leitura() {   # conta de leitura das gravações: sem papel no projeto, só leitura nos buckets (modo empresa)
  existe gcloud iam service-accounts describe "$SA_LEITURA" || \
    gcloud iam service-accounts create "$SA_LEITURA_NOME" \
      --display-name="Leitura das gravações (Edge Function gravacoes, GCS_GRAVACOES_CHAVE)" >/dev/null
}

# ======================================================================= modo chave-leitura: GCS_GRAVACOES_CHAVE
if [ "$MODO" = chave-leitura ]; then
  gcloud config set project "$PROJETO" >/dev/null
  garantir_sa_leitura
  umask 077
  ARQ="$(mktemp --suffix=.json "${HOME:-/tmp}/gcs-gravacoes-chave.XXXXXX")"
  # o conteúdo vai só para o arquivo (0600); nada da chave passa pela tela
  if ! gcloud iam service-accounts keys create "$ARQ" --iam-account="$SA_LEITURA" >/dev/null 2>&1; then
    shred -u "$ARQ" 2>/dev/null || rm -f "$ARQ"
    falha "não foi possível criar a chave de $SA_LEITURA (a política da organização pode proibir chaves de conta de serviço: iam.disableServiceAccountKeyCreation)"
  fi
  cat <<FIM

Chave nova da $SA_LEITURA gravada em:
  $ARQ
(o conteúdo não foi mostrado; o arquivo só pode ser lido por você)

1. Abra o arquivo no editor do Cloud Shell:   cloudshell edit "$ARQ"
   e copie o conteúdo inteiro (o JSON todo, do { ao }).
2. Supabase › Edge Functions › Secrets › Add new secret: nome GCS_GRAVACOES_CHAVE, valor = o JSON copiado.
   Não cole em nenhum outro lugar (chat, e-mail, documento).
3. Apague o arquivo:                           shred -u "$ARQ"
4. Trocou a chave? Depois de abrir uma gravação no site, apague a antiga (a nova é a de data mais recente):
     gcloud iam service-accounts keys list --iam-account=$SA_LEITURA --managed-by=user
     gcloud iam service-accounts keys delete <ID-DA-CHAVE-ANTIGA> --iam-account=$SA_LEITURA
FIM
  exit 0
fi

garantir_cmek() {   # cria (se pedido) a chave do Cloud KMS e dá ao agente do GCS o uso dela; ecoa o nome ou nada
  if [ "$USAR_CMEK" = 1 ]; then
    existe gcloud kms keyrings describe "$KMS_ANEL" --location="$REGIAO" || \
      gcloud kms keyrings create "$KMS_ANEL" --location="$REGIAO" >&2
    existe gcloud kms keys describe "$KMS_CHAVE" --keyring="$KMS_ANEL" --location="$REGIAO" || \
      gcloud kms keys create "$KMS_CHAVE" --keyring="$KMS_ANEL" --location="$REGIAO" --purpose=encryption \
        --rotation-period=90d --next-rotation-time="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)" >&2
  fi
  if existe gcloud kms keys describe "$KMS_CHAVE" --keyring="$KMS_ANEL" --location="$REGIAO"; then
    gcloud kms keys add-iam-policy-binding "$KMS_CHAVE" --keyring="$KMS_ANEL" --location="$REGIAO" \
      --member="serviceAccount:$(gcloud storage service-agent --project="$PROJETO")" \
      --role=roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null
    echo "$CHAVE_KMS_NOME"
  fi
}

# ======================================================================= modo empresa: bucket de gravações
if [ "$MODO" = empresa ]; then
  [[ "$EMPRESA_ID" =~ ^[1-9][0-9]{0,9}$ ]] || falha "uso: bash criar_gcp.sh empresa <id> <dias> [projeto]"
  [[ "$RETENCAO_DIAS" =~ ^[0-9]+$ ]] && [ "$RETENCAO_DIAS" -ge 90 ] || falha "a retenção precisa ser um número ≥ 90 dias"
  gcloud config set project "$PROJETO" >/dev/null
  SA="${SA_NOME}@${PROJETO}.iam.gserviceaccount.com"
  existe gcloud iam service-accounts describe "$SA" || falha "rode antes: bash criar_gcp.sh $PROJETO (infraestrutura)"
  BUCKET="${PROJETO}-motorcx-grav-e${EMPRESA_ID}"
  passo "Bucket da empresa $EMPRESA_ID: gs://$BUCKET (retenção de $RETENCAO_DIAS dias)"
  CHAVE_KMS="$(garantir_cmek)"
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
    printf '{"rule":[{"action":{"type":"SetStorageClass","storageClass":"COLDLINE"},"condition":{"age":90,"matchesStorageClass":["STANDARD"]}},{"action":{"type":"Delete"},"condition":{"age":%s}}]}\n' "$RETENCAO_DIAS" > "$CICLO"
  else
    printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":%s}}]}\n' "$RETENCAO_DIAS" > "$CICLO"
  fi
  gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$CICLO" --update-labels="motorcx-empresa=${EMPRESA_ID}" >/dev/null
  for papel in roles/storage.objectCreator roles/storage.objectViewer; do
    gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role="$papel" \
      >/dev/null
  done
  # Edge Function gravacoes (GCS_GRAVACOES_CHAVE): só leitura, para a URL assinada de 5 min
  garantir_sa_leitura
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA_LEITURA" \
    --role=roles/storage.objectViewer >/dev/null
  echo
  echo "Pronto. Grave em voz_config.bucket_gravacoes da empresa $EMPRESA_ID: $BUCKET"
  echo "(${RETENCAO_DIAS} dias${CHAVE_KMS:+, CMEK}). Para mudar a retenção, rode de novo com outro número de dias."
  exit 0
fi

# ======================================================================= modo infraestrutura
# ---------------------------------------------------------------- conferências antes de mexer em qualquer coisa
CIDR='^([0-9]{1,3}\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?$'
ORIGENS=()
for ip in "${IPS_OPERADORAS[@]}" "${IPS_PROVEDORES_VOZ[@]}" "${IPS_DISCADORES_CLIENTES[@]}"; do
  [[ "$ip" =~ $CIDR ]] || falha "IP/faixa inválido na lista: '$ip'"
  [[ "$ip" == 0.0.0.0* ]] && falha "0.0.0.0 abriria o SIP para a internet inteira"
  [[ "$ip" == */* ]] || ip="$ip/32"
  ORIGENS+=("$ip")
done
for ip in "${ORIGENS[@]}"; do
  case "$ip" in 192.0.2.*|198.51.100.*|203.0.113.*)
    falha "a lista ainda tem IPs de exemplo ($ip). Edite IPS_OPERADORAS no topo do script com os IPs reais." ;;
  esac
done
LISTA_ORIGENS="$(IFS=,; echo "${ORIGENS[*]}")"

gcloud config set project "$PROJETO" >/dev/null
NUM="$(gcloud projects describe "$PROJETO" --format='value(projectNumber)')"
SA="${SA_NOME}@${PROJETO}.iam.gserviceaccount.com"

passo "Ligando as APIs (1–2 minutos na primeira vez)"
gcloud services enable compute.googleapis.com secretmanager.googleapis.com storage.googleapis.com \
  iam.googleapis.com logging.googleapis.com monitoring.googleapis.com cloudkms.googleapis.com \
  iap.googleapis.com aiplatform.googleapis.com >/dev/null

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

passo "Firewall (SIP e RTP só das origens da lista; SSH só pelo IAP; HTTPS 8443 e desafio 80 do proxy)"
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
if [ "${#ORIGENS[@]}" -gt 0 ]; then
  regra motorcx-voz-sip "udp:5060,tcp:5060,tcp:5061" "$LISTA_ORIGENS" "SIP das operadoras, provedores e discadores"
  regra motorcx-voz-rtp "udp:10000-20000" "$LISTA_ORIGENS" "RTP (mídia) das mesmas origens do SIP"
else
  echo "Sem IPs de operadora ainda: SIP e RTP continuam FECHADOS. Preencha IPS_OPERADORAS e rode de novo."
  LISTA_ORIGENS="(nenhuma, SIP fechado)"
fi
regra motorcx-voz-ssh-iap "tcp:22" "$IAP" "SSH só pelo IAP do Google"
# proxy HTTPS (Caddy, vm_inicio.sh + motorcx-voz-https): 8443 das origens de ORIGENS_HTTPS; 80 para o Let's Encrypt
# validar o certificado (o Let's Encrypt não publica os IPs de validação)
[ "${#ORIGENS_HTTPS[@]}" -gt 0 ] || falha "ORIGENS_HTTPS vazio: ponha as origens do webhook e das Edge Functions"
regra motorcx-voz-https "tcp:8443" "$(IFS=,; echo "${ORIGENS_HTTPS[*]}")" "HTTPS do proxy Caddy (webhook ElevenLabs, simulador)"
regra motorcx-voz-acme "tcp:80" "0.0.0.0/0" "Desafio HTTP do Let's Encrypt para o certificado do proxy"

passo "Conta de serviço com privilégio mínimo"
existe gcloud iam service-accounts describe "$SA" || \
  gcloud iam service-accounts create "$SA_NOME" --display-name="Asterisk MotorCX (voz)"
# log, métrica e Vertex AI (roles/aiplatform.user: o predict do embedding em São Paulo, voz/analise/trechos.py)
for papel in roles/logging.logWriter roles/monitoring.metricWriter roles/aiplatform.user; do
  gcloud projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA" --role="$papel" \
    --condition=None >/dev/null
done
# só os segredos com o prefixo motorcx-voz- (senhas de tronco, ARI, chaves da voz) e motorcx-crm- (credenciais dos
# conectores de CRM: a referência crm/<empresa>/<conector>/<versão> do SQL 58 vira motorcx-crm-...); nenhum outro
# segredo do projeto
CONDICAO_ANTIGA="expression=resource.name.startsWith(\"projects/${NUM}/secrets/motorcx-voz-\"),title=motorcx-voz-segredos,description=Asterisk le so segredos motorcx-voz-"
CONDICAO_SEGREDOS="expression=resource.name.startsWith(\"projects/${NUM}/secrets/motorcx-voz-\") || resource.name.startsWith(\"projects/${NUM}/secrets/motorcx-crm-\"),title=motorcx-voz-crm-segredos,description=Asterisk le so segredos motorcx-voz- e motorcx-crm-"
gcloud projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA" \
  --role=roles/secretmanager.secretAccessor --condition="$CONDICAO_SEGREDOS" >/dev/null
# a condição antiga (só motorcx-voz-) é coberta pela nova: sai para não ficarem duas (se não existe, segue)
gcloud projects remove-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA" \
  --role=roles/secretmanager.secretAccessor --condition="$CONDICAO_ANTIGA" >/dev/null 2>&1 || true

passo "Conta de leitura das gravações (Edge Function gravacoes; a leitura em cada bucket vem do modo empresa)"
garantir_sa_leitura
echo "$SA_LEITURA (chave para o Supabase: bash criar_gcp.sh chave-leitura $PROJETO)"

passo "Senha do ARI no Secret Manager (gerada aqui, nunca exibida)"
if existe gcloud secrets describe "$SEGREDO_ARI"; then
  echo "Já existe (mantida)."
else
  head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 40 | \
    gcloud secrets create "$SEGREDO_ARI" --replication-policy=user-managed --locations="$REGIAO" --data-file=- \
    >/dev/null
  echo "Criada."
fi

if [ "$USAR_CMEK" = 1 ]; then
  passo "Chave própria (CMEK) no Cloud KMS em São Paulo (usada pelos buckets das empresas)"
  garantir_cmek >/dev/null
fi

passo "Repositório de imagens (Artifact Registry, o GitHub publica asterisk e voz-orquestrador)"
existe gcloud artifacts repositories describe motorcob --location="$REGIAO" || \
  gcloud artifacts repositories create motorcob --repository-format=docker --location="$REGIAO" >/dev/null
gcloud artifacts repositories add-iam-policy-binding motorcob --location="$REGIAO" \
  --member="serviceAccount:$SA" --role=roles/artifactregistry.reader >/dev/null

passo "VMs do Asterisk (uma por zona)"
AQUI="$(cd "$(dirname "$0")" && pwd)"
INICIO="$AQUI/vm/vm_inicio.sh"
[ -f "$INICIO" ] || falha "falta $INICIO (rode o script de dentro do repositório: infra/asterisk/)"
# scripts e unidades systemd vão como metadados (arquivo-<nome>); o vm_inicio.sh instala no boot
ARQUIVOS="startup-script=$INICIO"
for f in "$AQUI"/vm/motorcx-*; do
  ARQUIVOS="$ARQUIVOS,arquivo-$(basename "$f")=$f"
done
for i in 1 2; do
  VM="motorcx-ast-$i"
  ZONA="${ZONAS[$((i - 1))]}"
  if existe gcloud compute instances describe "$VM" --zone="$ZONA"; then
    # já existe: só atualiza os scripts e serviços (valem no próximo boot ou com: sudo google_metadata_script_runner startup)
    gcloud compute instances add-metadata "$VM" --zone="$ZONA" --metadata-from-file="$ARQUIVOS" >/dev/null
    echo "Já existe: $VM ($ZONA) — scripts atualizados"
    continue
  fi
  IP="$(gcloud compute addresses describe "motorcx-ast-$i" --region="$REGIAO" --format='value(address)')"
  gcloud compute instances create "$VM" --zone="$ZONA" --machine-type="$MAQUINA" \
    --subnet="$SUBREDE" --address="$IP" --network-tier=PREMIUM --tags="$TAG" \
    --service-account="$SA" --scopes=cloud-platform \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size="${DISCO_GB}GB" --boot-disk-type=pd-balanced \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring --deletion-protection \
    --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE,motorcx-ip-externo="$IP",motorcx-projeto="$PROJETO",motorcx-rede-local="$FAIXA_SUBREDE",motorcx-parte="$i/2" \
    --metadata-from-file="$ARQUIVOS" >/dev/null
  echo "Criada: $VM ($ZONA)"
done

passo "Pronto. Mande estes IPs para as operadoras liberarem (sinalização SIP e mídia RTP 10000–20000):"
for i in 1 2; do
  printf '  motorcx-ast-%s  %s\n' "$i" "$(gcloud compute addresses describe "motorcx-ast-$i" --region="$REGIAO" --format='value(address)')"
done
echo
echo "Origens liberadas no firewall: $LISTA_ORIGENS"
echo "Proxy HTTPS (webhook da ElevenLabs e simulador): https://<IP com hífens>.sslip.io:8443 (ex.: 35-198-40-10.sslip.io)"
echo "Bucket de gravações: um por empresa — bash criar_gcp.sh empresa <id> <dias> $PROJETO"
echo "Chave do GCS_GRAVACOES_CHAVE (Supabase): bash criar_gcp.sh chave-leitura $PROJETO"
echo "Para incluir uma operadora nova: edite IPS_OPERADORAS no topo e rode o script de novo."
