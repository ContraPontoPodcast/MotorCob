#!/bin/sh
# Início do contêiner do Asterisk do MotorCX.
#  1. ari.conf com a senha do ARI lida de arquivo (montado pela VM a partir do Secret Manager), modo 0600;
#  2. pjsip_motorcx.conf e extensions_motorcx.conf gerados do banco (/run/motorcx/voz.json), se existir;
#     sem o arquivo, sobe sem troncos (a VM regera e recarrega pelo ARI quando o banco mudar);
#  3. Asterisk em primeiro plano.
# Nunca imprime senha. Variáveis:
#   MOTORCX_ARI_USUARIO (padrão motorcx)  MOTORCX_ARI_SENHA_ARQUIVO (padrão /run/motorcx/ari_senha)
#   MOTORCX_DADOS_VOZ (padrão /run/motorcx/voz.json)  MOTORCX_IP_EXTERNO  MOTORCX_REDE_LOCAL (CIDR)
#   MOTORCX_GCP_PROJETO (Secret Manager)  MOTORCX_SEM_SENHAS=1 (só teste: senha de tronco vira marcador)
set -eu
umask 077
ETC=/etc/asterisk
USUARIO="${MOTORCX_ARI_USUARIO:-motorcx}"
ARQ_SENHA="${MOTORCX_ARI_SENHA_ARQUIVO:-/run/motorcx/ari_senha}"
DADOS="${MOTORCX_DADOS_VOZ:-/run/motorcx/voz.json}"

case "$USUARIO" in *[!A-Za-z0-9_]*|"") echo "MOTORCX_ARI_USUARIO inválido" >&2; exit 1;; esac
[ -r "$ARQ_SENHA" ] || { echo "falta a senha do ARI em $ARQ_SENHA (a VM grava a partir do Secret Manager)" >&2; exit 1; }
SENHA="$(head -n1 "$ARQ_SENHA")"
[ "${#SENHA}" -ge 16 ] || { echo "senha do ARI curta demais (mínimo 16)" >&2; exit 1; }
{
  printf '[general]\nenabled = yes\npretty = no\nallowed_origins =\n\n'
  printf '[%s]\ntype = user\nread_only = no\npassword = %s\n' "$USUARIO" "$SENHA"
} > "$ETC/ari.conf"
unset SENHA

if [ -r "$DADOS" ]; then
  set -- --dados "$DADOS" --saida "$ETC/motorcx"
  [ -n "${MOTORCX_IP_EXTERNO:-}" ] && set -- "$@" --ip-externo "$MOTORCX_IP_EXTERNO"
  [ -n "${MOTORCX_REDE_LOCAL:-}" ] && set -- "$@" --rede-local "$MOTORCX_REDE_LOCAL"
  [ "${MOTORCX_SEM_SENHAS:-0}" = 1 ] && set -- "$@" --sem-senhas
  python3 -m voz.asterisk.gerador "$@"
else
  echo "sem $DADOS: Asterisk sobe sem troncos" >&2
  [ -f "$ETC/motorcx/pjsip_motorcx.conf" ] || printf '[transport-udp]\ntype=transport\nprotocol=udp\nbind=0.0.0.0:5060\n' > "$ETC/motorcx/pjsip_motorcx.conf"
  [ -f "$ETC/motorcx/extensions_motorcx.conf" ] || printf '[motorcx-entrada]\nexten => _X.,1,Hangup(21)\n' > "$ETC/motorcx/extensions_motorcx.conf"
fi

exec asterisk -f -n
