"""Gerador da configuração do Asterisk a partir do banco (troncos, rotas e transferências em JSON).

Saída (dois arquivos incluídos pelos .conf fixos da imagem, infra/asterisk/conf):
  pjsip_motorcx.conf       transportes, um endpoint/aor/identify(/auth) por tronco, por destino de transferência e
                           por provedor de voz ligado por SIP (ElevenLabs). Senha só aqui, lida do Secret Manager pela
                           referência; o arquivo é gravado com permissão 0600.
  extensions_motorcx.conf  dialplan: entrada recusada; contexto da chamada atendida (AMD + MixMonitor + volta ao
                           Stasis); transferência por REFER; saída por empresa e tipo de número com tech prefix,
                           prioridade, failover e teto de canais por tronco (GROUP_COUNT). O CPS por tronco fica como
                           variável global e é aplicado pelo orquestrador (o Asterisk não limita CPS por endpoint).
                           SQL 83 · B4: a saída só aceita número nacional (DDD + fixo de 10 ou móvel de 11 dígitos);
                           emergência, 0300/0500/0800/0900, internacional e curtos não casam com nada e não saem.
Destinos (SQL 83 · B4): tronco ou transferência com host interno, reservado, de loopback ou do MotorCX (o IP externo,
a rede local e as faixas de voz_enderecos_motorcx), inclusive DEPOIS de resolver o nome aqui dentro do contêiner,
fica de fora (aviso no stderr, sem derrubar as outras empresas), com as rotas e transferências que dependem dele.

Uso (dentro do contêiner, pela VM; nunca imprime senha):
  python3 -m voz.asterisk.gerador --dados /run/motorcx/voz.json --saida /etc/asterisk/motorcx \\
      --ip-externo 203.0.113.10 --rede-local 10.158.0.0/20 [--sem-senhas]
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import sys
import tempfile
from pathlib import Path

from voz import banco as B
from voz import destinos as DST
from voz.segredos import Dicionario, Resolvedor, SecretManager, Tardio

APP_ARI = "motorcx"
DIR_GRAVACOES = "/var/spool/asterisk/motorcx"
CAB = "; GERADO por voz/asterisk/gerador.py a partir do banco (voz_troncos, voz_rotas, voz_transferencias).\n" \
      "; Não edite à mão: a VM regera e recarrega o Asterisk a cada mudança.\n"
# AMD do Asterisk: initialSilence, greeting, afterGreetingSilence, totalAnalysisTime, minimumWordLength,
# betweenWordsSilence, maximumNumberOfWords, silenceThreshold, maximumWordLength (ms). Ponto de partida comum em
# discadores brasileiros; calibrar com gravações reais.
AMD_PADRAO = "2500,1500,800,5000,100,50,3,256,5000"
DURMAX_PADRAO_S = 1200     # SQL 113 · D5: 20 min quando o canal não é de um tronco conhecido
# o que vem nos provedores ligados por SIP (ex.: ElevenLabs). Endereço oficial no README/plano, não aqui.
CAMPOS_PROVEDOR = ("nome", "host", "porta", "transporte", "codecs")


def _codecs(cs) -> str:
    return ",".join(cs)


def _contato(host: str, porta: int, transporte: str) -> str:
    return f"sip:{host}:{porta}" + (f";transport={transporte}" if transporte != "udp" else "")


def _transportes(usados: set[str], ip_externo: str, redes_locais: list[str], porta: int, tls: dict | None) -> list[str]:
    linhas = []
    for proto in ("udp", "tcp", "tls"):
        if proto not in usados:
            continue
        if proto == "tls" and not tls:
            raise B.DadosInvalidos("há tronco/destino TLS mas faltam --tls-cert e --tls-chave")
        p = porta + 1 if proto == "tls" else porta
        linhas += [f"[transport-{proto}]", "type=transport", f"protocol={proto}", f"bind=0.0.0.0:{p}"]
        if ip_externo:
            linhas += [f"external_media_address={ip_externo}", f"external_signaling_address={ip_externo}"]
        linhas += [f"local_net={r}" for r in redes_locais]
        if proto == "tls":
            linhas += [f"cert_file={tls['cert']}", f"priv_key_file={tls['chave']}", "method=tlsv1_2"]
        linhas.append("")
    return linhas


# SQL 113 · Telefonia T4: envio das teclas (voz_troncos.dtmf -> dtmf_mode do PJSIP) e como a bina vai na ligação
DTMF_PJSIP = {"auto": "auto", "rfc4733": "rfc4733", "inband": "inband", "info": "info"}
CABECALHO_PJSIP = {"from_pai": ("send_pai=yes", "send_rpid=no"), "from": ("send_pai=no", "send_rpid=no"),
                   "rpid": ("send_pai=no", "send_rpid=yes")}


def _endpoint(nome: str, transporte: str, codecs, host: str, porta: int, *, auth: str | None = None,
              from_user: str | None = None, callerid: str | None = None, dtmf: str = "rfc4733",
              cabecalho_bina: str = "from_pai", qualify: bool = True) -> list[str]:
    ep = [f"[{nome}]", "type=endpoint", f"transport=transport-{transporte}", "context=motorcx-entrada",
          "disallow=all", f"allow={_codecs(codecs)}", f"aors={nome}", "direct_media=no", "rtp_symmetric=yes",
          "force_rport=yes", "rewrite_contact=yes", f"dtmf_mode={DTMF_PJSIP[dtmf]}", *CABECALHO_PJSIP[cabecalho_bina],
          "trust_id_outbound=yes", "allow_subscribe=no", "allow_transfer=yes", "media_encryption=no"]
    if auth:
        ep.append(f"outbound_auth={auth}")
    if from_user:
        ep.append(f"from_user={from_user}")
    if callerid:
        ep.append(f"callerid=<{callerid}>")
    ep.append("")
    ep += [f"[{nome}]", "type=aor", f"contact={_contato(host, porta, transporte)}",
           f"qualify_frequency={60 if qualify else 0}", "qualify_timeout=3.0", ""]
    ep += [f"[{nome}-id]", "type=identify", f"endpoint={nome}", f"match={host}", ""]
    return ep


def gerar_pjsip(dados: B.DadosVoz, segredos: Resolvedor, ip_externo: str = "", redes_locais=(),
                porta_sip: int = 5060, tls: dict | None = None, provedores_sip: list | None = None) -> str:
    """Texto do pjsip_motorcx.conf. SQL 114 · Telefonia T5: o tronco INATIVO também sobe como endpoint, só para o
    "Testar a rota" (voz/testador.py liga por ele pelo ARI); ele não entra em nenhuma saída do dialplan e o orquestrador
    só usa tronco ativo. Segredo ausente: erro (não sobe sem senha; filtrar_senhas tira o tronco antes)."""
    if ip_externo:
        ipaddress.ip_address(ip_externo)
    redes = [str(ipaddress.ip_network(r, strict=False)) for r in redes_locais]
    provedores_sip = provedores_sip or []
    troncos = list(dados.troncos)
    tfs = [x for x in dados.transferencias if x.ativo and x.tronco_id is None]
    usados = {t.transporte for t in troncos} | {x.transporte for x in tfs} | \
             {str(p.get("transporte", "udp")) for p in provedores_sip} | {"udp"}
    out = [CAB, "[global]", "type=global", "user_agent=MotorCX", "endpoint_identifier_order=ip,username", ""]
    out += _transportes(usados, ip_externo, redes, porta_sip, tls)
    out.append("; ---------------- troncos das empresas (voz_troncos)")
    for t in sorted(troncos, key=lambda t: (t.empresa_id, t.id)):
        out.append(f"; empresa {t.empresa_id} · {t.referencia.replace(chr(10), ' ')} · {t.canais} canais · {t.cps:g} CPS"
                   + ("" if t.ativo else " · INATIVO: só para o teste da rota"))
        auth = f"{t.nome}-auth" if t.autenticacao == "senha" else None
        out += _endpoint(t.nome, t.transporte, t.codecs, t.host, t.porta, auth=auth,
                         from_user=t.from_usuario or (t.usuario if auth else t.bina), callerid=t.bina, dtmf=t.dtmf,
                         cabecalho_bina=t.cabecalho_bina, qualify=t.verificar_options)
        if auth:
            senha = segredos.valor(t.segredo_ref)
            if not senha or "\n" in senha or "\r" in senha:
                raise B.DadosInvalidos(f"tronco {t.id}: segredo vazio ou com quebra de linha")
            # SQL 103: ";" abre comentário no .conf do Asterisk; "\;" é o ponto e vírgula literal
            out += [f"[{auth}]", "type=auth", "auth_type=userpass", f"username={t.usuario}",
                    f"password={senha.replace(';', chr(92) + ';')}", *([f"realm={t.realm}"] if t.realm else []), ""]
    out.append("; ---------------- destinos de transferência (voz_transferencias; 'ponte pelo tronco' usa o tronco)")
    for x in sorted(tfs, key=lambda x: (x.empresa_id, x.id)):
        out += _endpoint(x.nome, x.transporte, ("alaw", "ulaw"), x.host, x.porta)
    out.append("; ---------------- provedores de voz ligados por SIP")
    for p in provedores_sip:
        nome = f"pv-{p['nome']}"
        if not B.HOST.match(str(p.get("host", ""))) or not str(p["nome"]).isidentifier():
            raise B.DadosInvalidos(f"provedor SIP inválido: {p.get('nome')}")
        out += _endpoint(nome, str(p.get("transporte", "udp")), tuple(p.get("codecs") or ("ulaw", "alaw")),
                         p["host"], int(p.get("porta", 5060)))
    return "\n".join(out).rstrip() + "\n"


def _var_tronco(t: B.Tronco) -> str:
    return t.nome.upper().replace("-", "_")


def gerar_extensions(dados: B.DadosVoz, amd: str = AMD_PADRAO) -> str:
    """Texto do extensions_motorcx.conf."""
    troncos = {t.id: t for t in dados.troncos if t.ativo}
    out = [CAB, "[globals]", f"MOTORCX_APP={APP_ARI}", f"MOTORCX_AMD_PARAMS={amd}"]
    for t in sorted(troncos.values(), key=lambda t: t.id):
        out += [f"MOTORCX_CANAIS_{_var_tronco(t)}={t.canais}", f"MOTORCX_CPS_{_var_tronco(t)}={t.cps:g}",
                f"MOTORCX_DURMAX_{_var_tronco(t)}={t.duracao_max_min * 60}"]
    out += ["",
            "; nada entra pelos troncos (receptivo de retorno ainda não existe): recusa com 21 (call rejected)",
            "[motorcx-entrada]",
            "exten => _[0-9+*#a-zA-Z].,1,NoOp(MotorCX: entrada recusada)",
            " same => n,Hangup(21)",
            "exten => s,1,Hangup(21)",
            "exten => i,1,Hangup(21)",
            "",
            "; chamada atendida: o orquestrador (ARI) manda o canal para cá; AMD (ou o resultado da Khomp, se vier),",
            "; MixMonitor só em pessoa e volta ao Stasis com o resultado. Variáveis: MOTORCX_ID, MOTORCX_AMD (1|0),",
            "; MOTORCX_GRAVAR (1|0), MOTORCX_GRAVACAO (arquivo, sem telefone no nome).",
            "; SQL 113 · D5: duração máxima por tronco (canal PJSIP/tr-<empresa>-<tronco>-…); sem o tronco, 20 min",
            "[motorcx-atendeu]",
            "exten => s,1,NoOp(MotorCX ${MOTORCX_ID})",
            " same => n,Set(MOTORCX_CANAL=${CHANNEL(name)})",
            " same => n,Set(MOTORCX_DURMAX=${MOTORCX_DURMAX_TR_${CUT(MOTORCX_CANAL,-,2)}_${CUT(MOTORCX_CANAL,-,3)}})",
            f" same => n,Set(TIMEOUT(absolute)=${{IF($[\"${{MOTORCX_DURMAX}}\" = \"\"]?{DURMAX_PADRAO_S}:${{MOTORCX_DURMAX}})}})",
            " same => n,Set(MOTORCX_KHOMP_CC=${PJSIP_RESPONSE_HEADER(read,X-Khomp-Analytics-CC)})",
            " same => n,GotoIf($[\"${MOTORCX_AMD}\" != \"1\"]?pessoa)",
            " same => n,AMD(${MOTORCX_AMD_PARAMS})",
            " same => n,GotoIf($[\"${AMDSTATUS}\" = \"HUMAN\" | \"${AMDSTATUS}\" = \"NOTSURE\"]?pessoa)",
            " same => n,Stasis(${MOTORCX_APP},amd,${AMDSTATUS},${AMDCAUSE},${MOTORCX_KHOMP_CC})",
            " same => n,Hangup()",
            " same => n(pessoa),GotoIf($[\"${MOTORCX_GRAVAR}\" != \"1\"]?volta)",
            f" same => n,MixMonitor({DIR_GRAVACOES}/${{MOTORCX_GRAVACAO}}.wav)",
            " same => n(volta),Stasis(${MOTORCX_APP},amd,${IF($[\"${AMDSTATUS}\" = \"\"]?SEM_AMD:${AMDSTATUS})},"
            "${AMDCAUSE},${MOTORCX_KHOMP_CC})",
            " same => n,Hangup()",
            "",
            "; transferência por REFER para o discador do cliente. MOTORCX_TF_URI vem do orquestrador com os",
            "; cabeçalhos X-MotorCX escolhidos em voz_transferencias.cabecalhos embutidos no Refer-To",
            "; (id da chamada, id da ação, ação, motivo; nunca CPF, nome ou valor).",
            "[motorcx-transferir]",
            "exten => refer,1,NoOp(MotorCX transferência ${MOTORCX_ID})",
            " same => n,Transfer(PJSIP/${MOTORCX_TF_URI})",
            " same => n,Stasis(${MOTORCX_APP},transferencia,${TRANSFERSTATUS},${TRANSFERSTATUSPROTOCOL})",
            " same => n,Hangup()",
            ""]
    # saída por empresa e tipo de número: chamada de teste e reserva sem o orquestrador (mesma ordem de failover).
    # EXTEN = DDD + número; o formato de discagem do tronco decide o que vai entre o tech prefix e o DDD.
    grupos: dict[tuple[int, str], list] = {}
    for r in dados.rotas:
        if r.tronco_id in troncos:
            grupos.setdefault((r.empresa_id, r.tipo), []).append(r)
    for (emp, tipo), rotas in sorted(grupos.items()):
        rotas = sorted(rotas, key=lambda r: (r.prioridade, r.id))
        # só uma vigência por tech prefix na saída (a mais recente; preço não afeta a discagem)
        vistos, unicas = set(), []
        for r in sorted(rotas, key=lambda r: (r.prioridade, r.id, -(r.vigente_desde.toordinal() if r.vigente_desde
                                                                     else 0))):
            k = (r.tronco_id, r.tech_prefix)
            if k not in vistos:
                vistos.add(k)
                unicas.append(r)
        out += [f"; empresa {emp} · {tipo}: prioridade 1 primeiro; CHANUNAVAIL/CONGESTION ou tronco cheio -> próxima",
                "; só número nacional (SQL 83): móvel DDD+9+8 dígitos ou fixo DDD+[2-5]+7 dígitos; o resto não casa",
                f"[motorcx-saida-{emp}-{tipo}]"]
        for padrao in DST.PADROES_DIALPLAN:
            out.append(f"exten => {padrao},1,NoOp(MotorCX saída)")
            for i, r in enumerate(unicas, start=1):
                t = troncos[r.tronco_id]
                v = _var_tronco(t)
                out += [f" same => n(r{i}),GotoIf($[${{GROUP_COUNT({t.nome}@motorcx)}} >= ${{MOTORCX_CANAIS_{v}}}]"
                        f"?r{i + 1})",
                        f" same => n,Set(GROUP(motorcx)={t.nome})",
                        f" same => n,Set(MOTORCX_TECH_PREFIX={r.tech_prefix})",
                        f" same => n,Set(MOTORCX_ROTA_ID={r.id})",
                        f" same => n,Dial(PJSIP/{t.discar(r.prefixo_discagem, '${EXTEN}')}@{t.nome},"
                        f"{t.toque_max_s},S({t.duracao_max_min * 60}))",
                        f" same => n,GotoIf($[\"${{DIALSTATUS}}\" = \"CHANUNAVAIL\" | \"${{DIALSTATUS}}\" = "
                        f"\"CONGESTION\"]?r{i + 1})",
                        " same => n,Hangup()"]
            out.append(f" same => n(r{len(unicas) + 1}),Hangup(34)")
        out += ["exten => i,1,Hangup(1)", ""]
    return "\n".join(out).rstrip() + "\n"


def gravar(pasta: Path, nome: str, texto: str, modo: int) -> Path:
    """Grava atômico (arquivo temporário + rename) com a permissão pedida desde a criação."""
    pasta.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=pasta, prefix=f".{nome}.")
    try:
        os.fchmod(fd, modo)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(texto)
        os.replace(tmp, pasta / nome)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return pasta / nome


def filtrar_destinos(dados: B.DadosVoz, proprios=(), resolver=None) -> tuple[B.DadosVoz, list[str]]:
    """SQL 83 · B4: tira os troncos e transferências com destino recusado (voz/destinos.py › motivo_host), as rotas
    desses troncos e as transferências que saem por eles. Devolve (dados filtrados, avisos sem endereço nem senha)."""
    avisos: list[str] = []
    fora: set[int] = set()
    troncos = []
    for t in dados.troncos:
        motivo = DST.motivo_host(t.host, proprios, resolver)
        if motivo:
            fora.add(t.id)
            avisos.append(f"tronco {t.id} (empresa {t.empresa_id}) ficou de fora: {motivo}")
        else:
            troncos.append(t)
    tfs = []
    for x in dados.transferencias:
        motivo = (f"o tronco {x.tronco_id} ficou de fora" if x.tronco_id in fora
                  else DST.motivo_host(x.host, proprios, resolver))
        if motivo:
            avisos.append(f"transferência {x.id} (empresa {x.empresa_id}) ficou de fora: {motivo}")
        else:
            tfs.append(x)
    rotas = [r for r in dados.rotas if r.tronco_id not in fora]
    return B.DadosVoz(troncos=troncos, rotas=rotas, transferencias=tfs, configs=dados.configs), avisos


def filtrar_senhas(dados: B.DadosVoz, segredos: Resolvedor) -> tuple[B.DadosVoz, Resolvedor, list[str]]:
    """SQL 103 · PR T1: tira o tronco com autenticação por senha cuja senha o cofre não entrega (ainda não guardada pela
    tela, apagada, sem permissão) ou que não cabe no arquivo, com as rotas e transferências dele, em vez de parar a
    configuração de TODAS as empresas. Lê cada senha uma vez e devolve um resolvedor só com as que valem.
    Os avisos não têm senha nem nome de segredo."""
    lidas: dict[str, str] = {}
    fora: set[int] = set()
    avisos: list[str] = []
    for t in dados.troncos:
        if t.autenticacao != "senha":          # SQL 114: o inativo também sobe (para o teste), então também precisa
            continue
        try:
            senha = lidas[t.segredo_ref] if t.segredo_ref in lidas else segredos.valor(t.segredo_ref)
        except (LookupError, ValueError) as ex:
            fora.add(t.id)
            avisos.append(f"tronco {t.id} (empresa {t.empresa_id}) ficou de fora: senha indisponível no cofre "
                          f"({ex.__class__.__name__}); guarde a senha pela tela Telefonia")
            continue
        if not senha or "\n" in senha or "\r" in senha:
            fora.add(t.id)
            avisos.append(f"tronco {t.id} (empresa {t.empresa_id}) ficou de fora: senha vazia ou com quebra de linha")
            continue
        lidas[t.segredo_ref] = senha
    if not fora:
        return dados, Dicionario(lidas), avisos
    troncos = [t for t in dados.troncos if t.id not in fora]
    tfs = []
    for x in dados.transferencias:
        if x.tronco_id in fora:
            avisos.append(f"transferência {x.id} (empresa {x.empresa_id}) ficou de fora: o tronco {x.tronco_id} ficou de fora")
        else:
            tfs.append(x)
    rotas = [r for r in dados.rotas if r.tronco_id not in fora]
    return (B.DadosVoz(troncos=troncos, rotas=rotas, transferencias=tfs, configs=dados.configs), Dicionario(lidas),
            avisos)


def gerar(entrada: dict, saida: Path, segredos: Resolvedor, ip_externo: str = "", redes_locais=(),
          tls: dict | None = None, resolver=None) -> dict:
    """Gera os dois arquivos. Devolve só contagens (seguras para log). `resolver` (o main usa o DNS): confere os
    nomes dos destinos depois de resolver, aqui dentro do contêiner (SQL 83 · B4)."""
    dados = B.carregar(entrada)
    proprios = DST.proprios_do_ambiente(ip_externo, redes_locais, entrada.get("enderecos_motorcx") or [])
    dados, avisos = filtrar_destinos(dados, proprios, resolver)
    dados, segredos, sem_senha = filtrar_senhas(dados, segredos)
    avisos += sem_senha
    for a in avisos:
        print(f"AVISO: {a}. Os outros seguem.", file=sys.stderr)
    pj = gerar_pjsip(dados, segredos, ip_externo, redes_locais, tls=tls,
                     provedores_sip=entrada.get("provedores_sip") or [])
    ex = gerar_extensions(dados)
    gravar(saida, "pjsip_motorcx.conf", pj, 0o600)
    gravar(saida, "extensions_motorcx.conf", ex, 0o640)
    return {"troncos": sum(t.ativo for t in dados.troncos), "troncos_so_teste": sum(not t.ativo for t in dados.troncos),
            "rotas": len(dados.rotas),
            "transferencias": sum(x.ativo for x in dados.transferencias),
            "provedores_sip": len(entrada.get("provedores_sip") or []), "destinos_recusados": len(avisos) - len(sem_senha),
            "sem_senha": sum(1 for a in sem_senha if a.startswith("tronco "))}


def recarregar(ari) -> None:
    """Recarrega PJSIP e dialplan pelo ARI (PUT /asterisk/modules/{nome})."""
    for modulo in ("res_pjsip.so", "pbx_config.so"):
        ari.recarregar_modulo(modulo)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Gera pjsip_motorcx.conf e extensions_motorcx.conf a partir do banco.")
    ap.add_argument("--dados", required=True, help="JSON com voz_troncos, voz_rotas, voz_transferencias")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--ip-externo", default=os.environ.get("MOTORCX_IP_EXTERNO", ""))
    ap.add_argument("--rede-local", action="append", default=[])
    ap.add_argument("--tls-cert")
    ap.add_argument("--tls-chave")
    ap.add_argument("--sem-senhas", action="store_true", help="pré-visualização: senha vira um marcador")
    a = ap.parse_args(argv)
    entrada = json.loads(Path(a.dados).read_text(encoding="utf-8"))
    seg = Dicionario(marcador="SEM-SENHA-PREVIA") if a.sem_senhas else Tardio(SecretManager)
    tls = {"cert": a.tls_cert, "chave": a.tls_chave} if a.tls_cert and a.tls_chave else None
    try:
        res = gerar(entrada, Path(a.saida), seg, a.ip_externo, a.rede_local, tls, resolver=DST.resolver_dns)
    except (B.DadosInvalidos, LookupError, ValueError) as ex:
        print(f"ERRO: {ex}", file=sys.stderr)
        return 2
    print(json.dumps(res, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
