#!/bin/bash
# Ponta a ponta no Docker, sem operadora real: o Asterisk da imagem, três "operadoras" SIPp e o orquestrador de
# verdade (AriHttp + WebSocket) dentro da rede do contêiner do Asterisk.
#   A (172.31.250.20) recusa com 503 -> failover para B
#   B (172.31.250.21) toca, atende e ecoa o RTP -> AMD, Stasis, provedor (Simulador), BYE
#   C (172.31.250.22) responde 404 -> número inexistente (Q.850 1 / SIP 404)
# Confere também o Request-URI que cada operadora recebeu (tech prefix + DDD + número).
#   bash infra/asterisk/teste_ponta_a_ponta.sh [--sem-build]      (na raiz do repositório; precisa de Docker)
set -euo pipefail
cd "$(dirname "$0")/../.."
IMG=motorcx-asterisk:fumaca
AUX=motorcx-e2e-aux
REDE=motorcx-e2e
TMP="$(mktemp -d)"
limpar() {
  docker rm -f motorcx-e2e-ast motorcx-e2e-a motorcx-e2e-b motorcx-e2e-c >/dev/null 2>&1 || true
  docker network rm "$REDE" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpar EXIT
limpar; TMP="$(mktemp -d)"

if [ "${1:-}" != "--sem-build" ]; then
  docker build ${MOTORCX_BUILD_CA:+--secret id=ca,src="$MOTORCX_BUILD_CA"} -f infra/asterisk/Dockerfile -t "$IMG" .
fi
docker build -q -t "$AUX" -f infra/asterisk/teste/Dockerfile.sipp infra/asterisk/teste >/dev/null

docker network create --subnet 172.31.250.0/24 "$REDE" >/dev/null
chmod 755 "$TMP"
head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TMP/ari_senha"
cat > "$TMP/voz.json" <<'JSON'
{"voz_troncos": [
  {"id": 20, "empresa_id": 1, "referencia": "Operadora A (503)", "host": "172.31.250.20", "autenticacao": "ip", "canais": 5, "cps": 50, "ddd_origem": "11", "bina": "1130000000"},
  {"id": 21, "empresa_id": 1, "referencia": "Operadora B (atende)", "host": "172.31.250.21", "autenticacao": "ip", "canais": 5, "cps": 50, "ddd_origem": "11"},
  {"id": 22, "empresa_id": 1, "referencia": "Operadora C (404)", "host": "172.31.250.22", "autenticacao": "ip", "canais": 5, "cps": 50, "ddd_origem": "11"}],
 "voz_rotas": [
  {"id": 1, "empresa_id": 1, "tronco_id": 20, "prioridade": 1, "tech_prefix": "11", "tipo": "movel_vc1", "preco_minuto": 0.05},
  {"id": 2, "empresa_id": 1, "tronco_id": 21, "prioridade": 2, "tech_prefix": "22", "tipo": "movel_vc1", "preco_minuto": 0.04},
  {"id": 3, "empresa_id": 1, "tronco_id": 22, "prioridade": 1, "tech_prefix": "33", "tipo": "fixo_local", "preco_minuto": 0.02}],
 "voz_transferencias": [],
 "voz_config": [{"empresa_id": 1, "provedor": "simulador", "gravar": false, "limite_simultaneas": 5}]}
JSON
chmod 644 "$TMP"/*

for x in "a 20 recusa_503.xml" "b 21 atende.xml" "c 22 recusa_404.xml"; do
  set -- $x
  docker run -d --name "motorcx-e2e-$1" --network "$REDE" --ip "172.31.250.$2" \
    -v "$PWD/infra/asterisk/teste:/cen:ro" -v "$TMP:/log" "$AUX" \
    sipp -sf "/cen/$3" -i "172.31.250.$2" -p 5060 -rtp_echo -nostdin -trace_msg -message_file "/log/sipp_$1.log" \
    >/dev/null
done
docker run -d --name motorcx-e2e-ast --network "$REDE" --ip 172.31.250.10 -v "$TMP:/run/motorcx:ro" "$IMG" >/dev/null
for _ in $(seq 1 30); do
  docker exec motorcx-e2e-ast asterisk -rx "core waitfullybooted" >/dev/null 2>&1 && break
  sleep 1
done

rc=0
docker run --rm --network container:motorcx-e2e-ast -v "$PWD:/app:ro" -v "$TMP:/dados:ro" -e PYTHONDONTWRITEBYTECODE=1 -e E2E_DEBUG="${E2E_DEBUG:-}" \
  "$AUX" python3 /app/infra/asterisk/teste/e2e.py /dados/voz.json /dados/ari_senha || rc=$?

falha() { echo "FALHOU: $*" >&2; rc=1; }
grep -q "INVITE sip:1111988887770@172.31.250.20" "$TMP/sipp_a.log" || falha "operadora A não recebeu 11+DDD+número"
grep -q "INVITE sip:2211988887770@172.31.250.21" "$TMP/sipp_b.log" || falha "operadora B não recebeu 22+DDD+número (failover)"
grep -q "INVITE sip:331133334444@172.31.250.22" "$TMP/sipp_c.log" || falha "operadora C não recebeu 33+DDD+número"
grep -q "^BYE " "$TMP/sipp_b.log" || falha "a chamada atendida não terminou com BYE"
if [ "$rc" != 0 ]; then
  docker logs --tail 40 motorcx-e2e-ast >&2
  [ -n "${E2E_DEBUG:-}" ] && cat "$TMP"/sipp_b.log >&2
  exit 1
fi
echo "PONTA A PONTA OK"
