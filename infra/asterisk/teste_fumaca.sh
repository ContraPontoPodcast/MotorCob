#!/bin/bash
# Teste de fumaça da imagem do Asterisk: monta, sobe com um banco fictício (IPs de documentação, sem senha real)
# e confere que PJSIP, dialplan, AMD, MixMonitor e ARI estão de pé. Não liga para ninguém.
#   bash infra/asterisk/teste_fumaca.sh [--sem-build]   (na raiz do repositório; precisa de Docker)
# Atrás de proxy com CA própria: MOTORCX_BUILD_CA=/caminho/ca.crt bash infra/asterisk/teste_fumaca.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
IMG=motorcx-asterisk:fumaca
NOME=motorcx-ast-fumaca
TMP="$(mktemp -d)"
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

if [ "${1:-}" != "--sem-build" ]; then
  docker build ${MOTORCX_BUILD_CA:+--secret id=ca,src="$MOTORCX_BUILD_CA"} -f infra/asterisk/Dockerfile -t "$IMG" .
fi

SENHA_ARI="fumaca-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
printf '%s\n' "$SENHA_ARI" > "$TMP/ari_senha"
python3 - "$TMP/voz.json" <<'PY'
import json, sys
from tests.test_voz_gerador import dados_exemplo
json.dump(dados_exemplo(), open(sys.argv[1], "w"))
PY
chmod 755 "$TMP"; chmod 644 "$TMP/ari_senha" "$TMP/voz.json"   # o contêiner roda como uid 10010

docker run -d --name "$NOME" -e MOTORCX_SEM_SENHAS=1 \
  -e MOTORCX_IP_EXTERNO=203.0.113.10 -e MOTORCX_REDE_LOCAL=10.60.0.0/24 \
  -v "$TMP:/run/motorcx:ro" "$IMG" >/dev/null
# espera o Asterisk subir (o ARI escuta só em 127.0.0.1 dentro do contêiner)
for _ in $(seq 1 30); do
  docker exec "$NOME" asterisk -rx "core waitfullybooted" >/dev/null 2>&1 && break
  sleep 1
done
ax() { docker exec "$NOME" asterisk -rx "$1" 2>&1 || true; }
tem() { local s; s="$(ax "$1")"; grep -qi -- "$2" <<<"$s"; }     # sem pipe: grep -q + pipefail daria SIGPIPE
falha() { echo "FALHOU: $*" >&2; docker logs --tail 50 "$NOME" >&2; exit 1; }

tem "core show version" "Asterisk 22" || falha "versão"
for m in res_pjsip.so chan_pjsip.so res_ari.so res_stasis.so app_amd.so app_mixmonitor.so app_transfer.so \
         res_http_websocket.so; do
  tem "module show like $m" "$m.*Running" || falha "módulo $m não carregou"
done
tem "pjsip show endpoints" "tr-1-10" || falha "endpoint do tronco"
tem "pjsip show endpoints" "tr-1-11" || falha "endpoint do tronco com senha"
tem "pjsip show endpoints" "pv-elevenlabs" || falha "endpoint do provedor de voz"
tem "pjsip show endpoint tr-2-99" "unable to find" || falha "tronco inativo apareceu"
tem "pjsip show transports" "transport-tcp" || falha "transporte TCP"
tem "dialplan show motorcx-saida-1-movel_vc1" "1010\${EXTEN}@tr-1-10" || falha "rota com tech prefix"
tem "dialplan show motorcx-atendeu" "AMD(" || falha "contexto do AMD"
tem "dialplan show motorcx-transferir" "Transfer(" || falha "contexto da transferência"
tem "ari show users" "motorcx" || falha "usuário do ARI"
tem "core show function PJSIP_RESPONSE_HEADER" "Syntax" || falha "função PJSIP_RESPONSE_HEADER (cabeçalho da Khomp)"
tem "core show application AMD" "Syntax" || falha "aplicação AMD"
PERM="$(docker exec "$NOME" stat -c %a /etc/asterisk/motorcx/pjsip_motorcx.conf /etc/asterisk/ari.conf)"
[ "$(sort -u <<<"$PERM")" = 600 ] || falha "permissão dos arquivos com senha: $PERM"
# ARI (só em 127.0.0.1 dentro do contêiner): sem senha recusa (401), com senha responde a versão 22
docker exec -i -e SENHA_ARI="$SENHA_ARI" "$NOME" python3 - <<'PY' || falha "ARI"
import base64, json, os, urllib.error, urllib.request
url = "http://127.0.0.1:8088/ari/asterisk/info"
try:
    urllib.request.urlopen(url, timeout=5)
    raise SystemExit("ARI respondeu sem senha")
except urllib.error.HTTPError as e:
    assert e.code == 401, e.code
auth = base64.b64encode(("motorcx:" + os.environ["SENHA_ARI"]).encode()).decode()
info = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": "Basic " + auth}),
                                        timeout=5))
assert info["system"]["version"].startswith("22."), info["system"]["version"]
print("ARI ok:", info["system"]["version"])
PY
echo "FUMAÇA OK"
