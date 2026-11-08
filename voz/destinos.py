"""Destinos perigosos (SQL 83 · B4; revisão do especialista C13, G16 e G17): para onde o MotorCX nunca liga.

  motivo_host(host, proprios, resolver)  endereço do tronco ou do destino da transferência. Recusa IP interno,
                                         reservado ou de loopback, os IPs do próprio MotorCX e nomes que resolvam
                                         para algum deles (com `resolver`, DEPOIS do DNS: o banco só vê o nome).
  motivo_numero(numero)                  número discado: só nacional de 10 ou 11 dígitos (DDD válido + fixo ou móvel).
                                         Recusa emergência e serviços curtos (190, 192, 193, 199, 100…), 0300, 0500,
                                         0800, 0900, internacional (00 ou + sem 55) e qualquer número curto.

Cópia fiel da regra do banco (public.voz_host_motivo e public.voz_faixas_reservadas do SQL 83):
tests/test_voz_destinos.py confere a paridade das faixas e dos sufixos; supabase/testes/testar_rls.py roda os mesmos
casos (tests/dados/voz_destinos_casos.json) no Postgres.

As faixas de documentação (TEST-NET 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) NÃO estão na lista: não são
roteadas na internet (não levam à rede interna de ninguém) e são os endereços fictícios dos exemplos e testes.
Só biblioteca padrão (vai no contêiner do Asterisk, que leva só voz/).
"""
from __future__ import annotations

import ipaddress
import re
import socket
from typing import Callable, Iterable

# IPv4 que nunca é destino (mesma lista de public.voz_faixas_reservadas no SQL 83)
FAIXAS_RESERVADAS = (
    "0.0.0.0/8",          # "esta rede"
    "10.0.0.0/8",         # privada
    "100.64.0.0/10",      # CGNAT (compartilhada)
    "127.0.0.0/8",        # loopback
    "169.254.0.0/16",     # link-local (metadados da nuvem: 169.254.169.254)
    "172.16.0.0/12",      # privada
    "192.0.0.0/24",       # protocolos IETF
    "192.168.0.0/16",     # privada
    "198.18.0.0/15",      # testes de desempenho
    "224.0.0.0/4",        # multicast
    "240.0.0.0/4",        # reservada (inclui 255.255.255.255)
)
_REDES = tuple(ipaddress.ip_network(f) for f in FAIXAS_RESERVADAS)
# nomes que só existem em rede interna, de metadados ou que embutem um IP (mesma lista do banco)
SUFIXOS_PROIBIDOS = ("localhost", "local", "internal", "intranet", "lan", "home", "corp", "localdomain",
                     "home.arpa", "in-addr.arpa", "ip6.arpa", "invalid", "metadata",
                     "nip.io", "sslip.io", "xip.io", "localtest.me", "lvh.me")
IPV4 = re.compile(r"^[0-9]{1,3}(\.[0-9]{1,3}){3}$")

# DDDs válidos no Brasil (Anatel); um número com outro DDD não sai
DDDS = frozenset({
    "11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "22", "24", "27", "28",
    "31", "32", "33", "34", "35", "37", "38", "41", "42", "43", "44", "45", "46", "47", "48", "49",
    "51", "53", "54", "55", "61", "62", "63", "64", "65", "66", "67", "68", "69",
    "71", "73", "74", "75", "77", "79", "81", "82", "83", "84", "85", "86", "87", "88", "89",
    "91", "92", "93", "94", "95", "96", "97", "98", "99",
})
# padrões do plano de discagem do Asterisk (EXTEN = DDD + número): móvel 11 dígitos e fixo 10 dígitos
PADROES_DIALPLAN = ("_[1-9][1-9]9XXXXXXXX", "_[1-9][1-9][2-5]XXXXXXX")
NAO_GEOGRAFICOS = ("0300", "0303", "0500", "0800", "0900")

Resolver = Callable[[str], Iterable[str]]


def ip_proibido(ip: str, proprios: Iterable = ()) -> bool:
    """IP (v4 ou v6) interno, reservado, de loopback ou do próprio MotorCX."""
    try:
        a = ipaddress.ip_address(str(ip).split("%", 1)[0])
    except ValueError:
        return True
    if a.version == 6:
        if a.ipv4_mapped is not None:
            return ip_proibido(str(a.ipv4_mapped), proprios)
        if not a.is_global or a.is_multicast:
            return True
    elif any(a in r for r in _REDES):
        return True
    return any(_contem(p, a) for p in proprios)


def _contem(faixa, a) -> bool:
    try:
        rede = ipaddress.ip_network(str(faixa).strip(), strict=False)
    except ValueError:
        return False
    return rede.version == a.version and a in rede


def _nome(host: str) -> str:
    return str(host or "").strip().lower().rstrip(".")


def motivo_host(host: str, proprios: Iterable = (), resolver: Resolver | None = None) -> str | None:
    """None se o host pode ser destino; senão o motivo (uma frase, sem o endereço). `proprios`: IPs ou faixas do
    MotorCX (voz_enderecos_motorcx + IP externo e rede da VM). `resolver(nome) -> IPs`: sem ele, só a regra estática
    (a do banco); com ele, TODOS os IPs do nome precisam passar (nome que não resolve também é recusado)."""
    h = _nome(host)
    proprios = tuple(proprios or ())
    if not h:
        return "endereço vazio"
    if IPV4.match(h):
        try:
            ipaddress.IPv4Address(h)
        except ValueError:
            return "IPv4 inválido"
        if ip_proibido(h):
            return "endereço em rede interna, reservada ou de loopback"
        if ip_proibido(h, proprios):
            return "endereço do próprio MotorCX"
        return None
    if ":" in h:
        return "IPv6 direto não é aceito: use um nome"
    if any(h == s or h.endswith("." + s) for s in SUFIXOS_PROIBIDOS):
        return "nome de rede interna ou que aponta para um IP interno"
    if resolver is None:
        return None
    try:
        ips = {str(x) for x in resolver(h)}
    except (OSError, UnicodeError, ValueError):
        ips = set()
    if not ips:
        return "o nome não resolve"
    if any(ip_proibido(x) for x in ips):
        return "o nome resolve para rede interna, reservada ou de loopback"
    if any(ip_proibido(x, proprios) for x in ips):
        return "o nome resolve para o próprio MotorCX"
    return None


def resolver_dns(nome: str) -> list[str]:
    """Todos os IPs (A e AAAA) do nome, como o Asterisk vai ver."""
    return sorted({ai[4][0] for ai in socket.getaddrinfo(nome, None)})


def motivo_numero(numero) -> str | None:
    """None se o número é nacional discável (DDD válido + 10 ou 11 dígitos, fixo 2–5 ou móvel 9); senão o motivo,
    sem o número. Aceita +55, 55 e o zero de longa distância na frente (o que a carteira costuma trazer)."""
    bruto = str(numero or "").strip()
    if bruto.startswith("+") and not bruto.startswith("+55"):
        return "número internacional"
    n = "".join(c for c in bruto if c.isdigit())
    if n.startswith("00"):
        return "número internacional"
    if any(n.startswith(p) for p in NAO_GEOGRAFICOS):
        return "número 0300, 0500, 0800 ou 0900"
    if len(n) in (12, 13) and n.startswith("55"):
        n = n[2:]
    elif len(n) in (11, 12) and n.startswith("0"):
        n = n[1:]
    if len(n) < 10:
        return "número curto, de emergência ou de serviço"
    if len(n) > 11:
        return "número com dígitos demais"
    if n[:2] not in DDDS:
        return "DDD inexistente"
    if len(n) == 11 and n[2] != "9":
        return "celular precisa começar com 9"
    if len(n) == 10 and n[2] not in "2345":
        return "fixo precisa começar com 2, 3, 4 ou 5"
    return None


def proprios_do_ambiente(ip_externo: str = "", redes_locais: Iterable = (), extras: Iterable = ()) -> tuple:
    """IPs e faixas do MotorCX: o IP externo e a rede da VM (metadados) e as linhas de voz_enderecos_motorcx."""
    out = []
    for x in [ip_externo, *(redes_locais or ()), *(extras or ())]:
        x = str(x or "").strip()
        if not x:
            continue
        for parte in x.replace(";", ",").split(","):
            parte = parte.strip()
            try:
                out.append(str(ipaddress.ip_network(parte, strict=False)))
            except ValueError:
                continue
    return tuple(dict.fromkeys(out))


def host_da_transferencia(destino_sip: str) -> str:
    """Host do destino SIP (sip:usuario@host[:porta][;transport=…])."""
    m = re.match(r"^sips?:[^@]+@([^:;]+)", str(destino_sip or "").strip())
    return m.group(1) if m else ""
