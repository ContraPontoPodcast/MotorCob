"""Firewall das VMs de voz a partir do cadastro (SQL 104 · Telefonia, PR T2; G6 do parecer).

  python3 -m voz.firewall [--simular]

As regras do VPC motorcx-voz-sip (5060/5061) e motorcx-voz-rtp (10000–20000) aceitam só as origens listadas. Antes, a
lista era só à mão (infra/asterisk/criar_gcp.sh). Agora a VM junta, a cada 2 minutos:
  - a lista fixa do criar_gcp.sh (metadado motorcx-firewall-fixos da VM: operadoras antigas, provedores de voz,
    discadores), que o script já validou;
  - os IPs da operadora (troncos) e do PABX (transferências) que a equipe MotorCX liberou no banco
    (origens_firewall_voz; o banco já confere: IPv4, até /24, nunca rede interna nem do MotorCX).
Confere TUDO de novo aqui (motivo_origem, a mesma regra do banco em voz_ips_motivo), e só então, se mudou, atualiza
as duas regras pela API do Compute Engine com a conta da VM (papel motorcxVozFirewall: ler e atualizar só estas regras).
Nunca 0.0.0.0/0, nunca rede interna, nunca o próprio MotorCX; faixa do banco no máximo /24; no máximo MAX_ORIGENS.
Sem nenhuma origem, as regras ficam DESLIGADAS (SIP fechado), como o criar_gcp.sh faz com a lista vazia.
Banco fora do ar, origem recusada ou erro na API: não muda nada (o que está no ar continua) e registra o motivo.
Cada mudança (o que entrou e saiu) vai para voz_firewall_eventos (registrar_firewall_voz). Nada de senha ou dado de
pessoa passa por aqui: só IPs de operadoras e de PABX.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
import urllib.request

from voz import destinos as DST
from voz import gcp

REGRAS = ("motorcx-voz-sip", "motorcx-voz-rtp")
MAX_ORIGENS = 500
# origem de reserva para a regra desligada (o GCP exige ao menos uma); documentação (RFC 5737), nunca roteada
RESERVA_DESLIGADA = "192.0.2.1/32"
DOCUMENTACAO = tuple(ipaddress.ip_network(f) for f in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"))
METADADOS = "http://metadata.google.internal/computeMetadata/v1/instance/attributes/"
COMPUTE = "https://compute.googleapis.com/compute/v1/projects/{projeto}/global/firewalls/{regra}"


class FirewallRecusado(ValueError):
    pass


def motivo_origem(faixa: str, proprios=(), max_prefixo: int = 24) -> str | None:
    """Motivo (frase sem o endereço) para recusar a origem, ou None. `max_prefixo`: a faixa mais larga aceita
    (24 = /24 para o que vem do banco; a lista fixa do criar_gcp.sh aceita qualquer uma, menos /0)."""
    try:
        rede = ipaddress.ip_network(str(faixa).strip(), strict=False)
    except ValueError:
        return "origem inválida"
    if rede.version != 4:
        return "só IPv4"
    if rede.prefixlen == 0:
        return "0.0.0.0/0 abriria o SIP para a internet inteira"
    if rede.prefixlen < max_prefixo:
        return f"faixa grande demais: no máximo /{max_prefixo}"
    if any(rede.overlaps(r) for r in DST._REDES):
        return "endereço em rede interna, reservada ou de loopback"
    for p in proprios:
        try:
            if rede.overlaps(ipaddress.ip_network(str(p), strict=False)):
                return "endereço do próprio MotorCX"
        except ValueError:
            continue
    return None


def _canonica(faixa: str) -> str:
    return str(ipaddress.ip_network(str(faixa).strip(), strict=False))


def desejadas(fixas: list[str], do_banco: list[dict], proprios=()) -> tuple[list[str], list[str]]:
    """(origens em ordem, avisos). Origem recusada vira aviso e fica de fora; documentação (TEST-NET) do banco também
    (só existe em dado de teste). Erro alto (FirewallRecusado) se passar de MAX_ORIGENS."""
    saida: set[str] = set()
    avisos: list[str] = []
    for f in fixas:
        m = motivo_origem(f, proprios, max_prefixo=1)
        if m:
            avisos.append(f"lista fixa: origem recusada ({m})")
        else:
            saida.add(_canonica(f))
    for o in do_banco:
        f = str(o.get("origem", ""))
        m = motivo_origem(f, proprios)
        onde = f"{o.get('tipo')} {o.get('ref_id')} (empresa {o.get('empresa_id')})"
        if m:
            avisos.append(f"{onde}: origem recusada ({m})")
        elif any(ipaddress.ip_network(f, strict=False).overlaps(d) for d in DOCUMENTACAO):
            avisos.append(f"{onde}: endereço de documentação, fica de fora")
        else:
            saida.add(_canonica(f))
    if len(saida) > MAX_ORIGENS:
        raise FirewallRecusado(f"{len(saida)} origens passam do limite de {MAX_ORIGENS}: nada foi mudado")
    return sorted(saida, key=lambda x: ipaddress.ip_network(x)), avisos


def corpo_da_regra(origens: list[str]) -> dict:
    """PATCH da regra: com origens, ligada; sem nenhuma, desligada com a origem de reserva (SIP fechado)."""
    if origens:
        return {"sourceRanges": list(origens), "disabled": False}
    return {"sourceRanges": [RESERVA_DESLIGADA], "disabled": True}


def atuais(regra: dict) -> list[str]:
    if regra.get("disabled"):
        return []
    return sorted({_canonica(x) for x in regra.get("sourceRanges") or []}, key=lambda x: ipaddress.ip_network(x))


def metadado(nome: str, abrir=urllib.request.urlopen) -> str:
    req = urllib.request.Request(METADADOS + nome, headers={"Metadata-Flavor": "Google"})
    try:
        with abrir(req, timeout=5) as r:
            return r.read().decode().strip()
    except Exception:   # noqa: BLE001 — metadado ausente = vazio
        return ""


def lista_fixa(texto: str) -> list[str]:
    """Metadado motorcx-firewall-fixos: origens separadas por espaço (o criar_gcp.sh grava assim), vírgula ou linha."""
    return [x for x in re.split(r"[\s,]+", texto or "") if x]


def sincronizar(sb, projeto: str, vm: str, fixas: list[str], proprios=(), token=None, abrir=urllib.request.urlopen,
                simular: bool = False) -> dict:
    """Uma rodada. Devolve o resumo (seguro para log). Erro do banco ou da API: exceção, nada mudado."""
    do_banco = sb.rpc("origens_firewall_voz", {}) or []
    if not isinstance(do_banco, list):
        raise FirewallRecusado("resposta inesperada do banco")
    quero, avisos = desejadas(fixas, do_banco, proprios)
    tok = token or gcp.Token(abrir)
    mudou = []
    antes_todas: set[str] = set()
    for nome in REGRAS:
        url = COMPUTE.format(projeto=projeto, regra=nome)
        regra = gcp.requisitar("GET", url, tok, abrir=abrir)
        antes = atuais(regra)
        antes_todas |= set(antes)
        if antes == quero and bool(regra.get("disabled")) == (not quero):
            continue
        mudou.append(nome)
        if not simular:
            gcp.requisitar("PATCH", url, tok, json.dumps(corpo_da_regra(quero)).encode(), "application/json",
                           abrir=abrir)
    resumo = {"origens": len(quero), "mudou": mudou, "avisos": avisos,
              "adicionadas": sorted(set(quero) - antes_todas), "removidas": sorted(antes_todas - set(quero))}
    if mudou and not simular:
        registrar(sb, vm, resumo, True, "; ".join(avisos) or None)
    return resumo


def registrar(sb, vm: str, resumo: dict, ok: bool, detalhe: str | None) -> None:
    evento = {"vm": vm, "origens": resumo.get("origens", 0), "adicionadas": resumo.get("adicionadas", []),
              "removidas": resumo.get("removidas", []), "ok": ok, "detalhe": (detalhe or "")[:300] or None}
    try:
        sb.rpc("registrar_firewall_voz", {"evento": evento})
    except Exception as ex:   # noqa: BLE001 — o registro é melhor-esforço; a regra já foi aplicada
        print(f"AVISO: evento do firewall não registrado ({ex.__class__.__name__})", file=sys.stderr)


def main(argv=None, sb=None, abrir=urllib.request.urlopen) -> int:
    ap = argparse.ArgumentParser(description="Firewall das VMs de voz a partir do cadastro (SQL 104)")
    ap.add_argument("--simular", action="store_true", help="mostra o que mudaria, sem mudar")
    a = ap.parse_args(argv)
    projeto = os.environ.get("MOTORCX_GCP_PROJETO") or metadado("motorcx-projeto", abrir)
    vm = (os.environ.get("MOTORCX_VM_NOME") or "motorcx-voz").lower()
    if not projeto:
        print("ERRO: defina MOTORCX_GCP_PROJETO", file=sys.stderr)
        return 2
    fixas = lista_fixa(os.environ.get("MOTORCX_FIREWALL_FIXOS") or metadado("motorcx-firewall-fixos", abrir))
    proprios = DST.proprios_do_ambiente(os.environ.get("MOTORCX_IP_EXTERNO", ""),
                                        [os.environ.get("MOTORCX_REDE_LOCAL", "")])
    if sb is None:
        from voz.acesso import conectar_do_ambiente
        sb = conectar_do_ambiente()
    try:
        resumo = sincronizar(sb, projeto, vm, fixas, proprios, abrir=abrir, simular=a.simular)
    except FirewallRecusado as ex:
        print(f"ERRO: {ex}", file=sys.stderr)
        registrar(sb, vm, {}, False, str(ex))
        return 2
    except Exception as ex:   # noqa: BLE001 — banco ou API fora: nada mudou; tenta na próxima rodada
        print(f"ERRO: firewall não atualizado ({ex.__class__.__name__}: {str(ex)[:200]})", file=sys.stderr)
        return 3
    for av in resumo["avisos"]:
        print(f"AVISO: {av}", file=sys.stderr)
    print(json.dumps({k: resumo[k] for k in ("origens", "mudou", "adicionadas", "removidas")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
