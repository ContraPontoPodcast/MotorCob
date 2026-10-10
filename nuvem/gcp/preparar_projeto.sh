#!/bin/bash
# Prepara o projeto do Google Cloud para o MotorCob (rode UMA vez no Cloud Shell do console:
# console.cloud.google.com › ícone ">_" no topo). Pode rodar de novo: o que já existe é mantido.
#
#   bash preparar_projeto.sh [ID-DO-PROJETO]
#
# Cria, em São Paulo (southamerica-east1):
#   - Artifact Registry "motorcob" (onde o GitHub publica a imagem do motor)
#   - Secret Manager "motorcob-supabase-key" (a chave service_role, digitada aqui sem aparecer na tela)
#   - rede própria sem nenhuma porta aberta para a internet (só SSH pelo IAP do Google) e Cloud NAT para saída
#   - contas de serviço: motorcob-vm (lê a imagem e a chave) e motorcob-ci (o GitHub publica a imagem)
#   - acesso do GitHub sem chave guardada (Workload Identity Federation, só o repositório e o branch main)
#   - disco de dados separado (fica mesmo se a VM for recriada) com snapshot diário guardado por 14 dias
#   - a VM "motorcob" (sem IP público, Shielded VM), que liga o plantão sozinha (vm_inicio.sh)
set -euo pipefail

PROJETO="${1:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJETO" ] || { echo "Informe o ID do projeto: bash preparar_projeto.sh meu-projeto-123" >&2; exit 1; }
REGIAO=southamerica-east1
ZONA=southamerica-east1-a
REPO_GH="${MOTORCOB_REPO_GITHUB:-ContraPontoPodcast/MotorCob}"
MAQUINA="${MOTORCOB_MAQUINA:-e2-medium}"
DISCO_GB="${MOTORCOB_DISCO_GB:-30}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ -f "$AQUI/vm_inicio.sh" ] || { echo "Coloque o vm_inicio.sh na mesma pasta deste script." >&2; exit 1; }

gcloud config set project "$PROJETO" >/dev/null
NUM="$(gcloud projects describe "$PROJETO" --format='value(projectNumber)')"
existe() { "$@" >/dev/null 2>&1; }
passo() { printf '\n== %s\n' "$*"; }

passo "Ligando as APIs (leva 1–2 minutos na primeira vez)"
gcloud services enable compute.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com logging.googleapis.com \
  cloudresourcemanager.googleapis.com

passo "URL do Supabase"
URL="${MOTORCOB_SUPABASE_URL:-}"
if [ -z "$URL" ]; then read -r -p "URL do projeto Supabase (ex.: https://xxxx.supabase.co): " URL; fi
[[ "$URL" =~ ^https://[a-z0-9]+\.supabase\.co/?$ ]] || { echo "URL inválida: $URL" >&2; exit 1; }

passo "Chave service_role no Secret Manager"
if existe gcloud secrets describe motorcob-supabase-key; then
  echo "Já existe (para trocar: MOTORCOB_TROCAR_CHAVE=1 bash preparar_projeto.sh)."
  if [ "${MOTORCOB_TROCAR_CHAVE:-0}" = 1 ]; then
    read -r -s -p "Nova chave service_role (não aparece ao digitar): " CHAVE; echo
    printf '%s' "$CHAVE" | gcloud secrets versions add motorcob-supabase-key --data-file=-
    unset CHAVE
  fi
else
  read -r -s -p "Chave service_role do Supabase (Project Settings › API Keys; não aparece ao digitar): " CHAVE; echo
  [ -n "$CHAVE" ] || { echo "Chave vazia." >&2; exit 1; }
  printf '%s' "$CHAVE" | gcloud secrets create motorcob-supabase-key --replication-policy=user-managed \
    --locations="$REGIAO" --data-file=-
  unset CHAVE
fi

passo "Artifact Registry"
existe gcloud artifacts repositories describe motorcob --location="$REGIAO" || \
  gcloud artifacts repositories create motorcob --repository-format=docker --location="$REGIAO" \
    --description="Imagem do motor MotorCob"

passo "Contas de serviço"
for sa in motorcob-vm motorcob-ci; do
  existe gcloud iam service-accounts describe "$sa@$PROJETO.iam.gserviceaccount.com" || \
    gcloud iam service-accounts create "$sa" --display-name="MotorCob ${sa#motorcob-}"
done
SA_VM="motorcob-vm@$PROJETO.iam.gserviceaccount.com"
SA_CI="motorcob-ci@$PROJETO.iam.gserviceaccount.com"
gcloud artifacts repositories add-iam-policy-binding motorcob --location="$REGIAO" \
  --member="serviceAccount:$SA_VM" --role=roles/artifactregistry.reader >/dev/null
gcloud artifacts repositories add-iam-policy-binding motorcob --location="$REGIAO" \
  --member="serviceAccount:$SA_CI" --role=roles/artifactregistry.writer >/dev/null
gcloud secrets add-iam-policy-binding motorcob-supabase-key \
  --member="serviceAccount:$SA_VM" --role=roles/secretmanager.secretAccessor >/dev/null
for papel in roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA_VM" --role="$papel" \
    --condition=None >/dev/null
done

passo "Acesso do GitHub sem chave (Workload Identity Federation)"
existe gcloud iam workload-identity-pools describe github --location=global || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
existe gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github || \
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='$REPO_GH' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$SA_CI" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO_GH" >/dev/null

passo "Rede sem portas abertas (só SSH pelo IAP) e saída pela Cloud NAT"
existe gcloud compute networks describe motorcob-vpc || gcloud compute networks create motorcob-vpc --subnet-mode=custom
existe gcloud compute networks subnets describe motorcob-sp --region="$REGIAO" || \
  gcloud compute networks subnets create motorcob-sp --network=motorcob-vpc --region="$REGIAO" \
    --range=10.10.0.0/24 --enable-private-ip-google-access
existe gcloud compute firewall-rules describe motorcob-ssh-iap || \
  gcloud compute firewall-rules create motorcob-ssh-iap --network=motorcob-vpc --direction=INGRESS \
    --action=allow --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=motorcob
existe gcloud compute routers describe motorcob-router --region="$REGIAO" || \
  gcloud compute routers create motorcob-router --network=motorcob-vpc --region="$REGIAO"
existe gcloud compute routers nats describe motorcob-nat --router=motorcob-router --region="$REGIAO" || \
  gcloud compute routers nats create motorcob-nat --router=motorcob-router --region="$REGIAO" \
    --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges

passo "Disco de dados com snapshot diário (14 dias)"
existe gcloud compute resource-policies describe motorcob-diario --region="$REGIAO" || \
  gcloud compute resource-policies create snapshot-schedule motorcob-diario --region="$REGIAO" \
    --daily-schedule --start-time=06:00 --max-retention-days=14 --on-source-disk-delete=keep-auto-snapshots \
    --storage-location="$REGIAO"
existe gcloud compute disks describe motorcob-dados --zone="$ZONA" || \
  gcloud compute disks create motorcob-dados --zone="$ZONA" --size="${DISCO_GB}GB" --type=pd-balanced
gcloud compute disks add-resource-policies motorcob-dados --zone="$ZONA" --resource-policies=motorcob-diario \
  >/dev/null 2>&1 || true

passo "VM motorcob ($MAQUINA, sem IP público)"
IMAGEM="$REGIAO-docker.pkg.dev/$PROJETO/motorcob/motor:latest"
if existe gcloud compute instances describe motorcob --zone="$ZONA"; then
  gcloud compute instances add-metadata motorcob --zone="$ZONA" \
    --metadata=motorcob-imagem="$IMAGEM",motorcob-supabase-url="$URL",enable-oslogin=TRUE \
    --metadata-from-file=startup-script="$AQUI/vm_inicio.sh"
  echo "VM já existia: configuração atualizada (vale no próximo reinício: gcloud compute instances reset motorcob --zone=$ZONA)."
else
  gcloud compute instances create motorcob --zone="$ZONA" --machine-type="$MAQUINA" \
    --service-account="$SA_VM" --scopes=cloud-platform \
    --network=motorcob-vpc --subnet=motorcob-sp --no-address --tags=motorcob \
    --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=20GB --boot-disk-type=pd-balanced \
    --disk=name=motorcob-dados,device-name=motorcob-dados,mode=rw,auto-delete=no \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata=motorcob-imagem="$IMAGEM",motorcob-supabase-url="$URL",enable-oslogin=TRUE \
    --metadata-from-file=startup-script="$AQUI/vm_inicio.sh"
fi

cat <<FIM

==================================================================================
Pronto. Falta 1 passo no GitHub (para publicar a imagem do motor):
github.com/$REPO_GH › Settings › Secrets and variables › Actions › aba "Variables" › New variable:

  GCP_PROJETO       = $PROJETO
  GCP_WIF_PROVIDER  = projects/$NUM/locations/global/workloadIdentityPools/github/providers/github
  GCP_SA_CI         = $SA_CI

(não são segredos). Depois: Actions › "imagem" › Run workflow. Em ~3 minutos a VM baixa a imagem e o
plantão entra no ar. Acompanhar:  gcloud compute ssh motorcob --zone=$ZONA --tunnel-through-iap \\
  --command='sudo journalctl -u motorcob -f'
==================================================================================
FIM
