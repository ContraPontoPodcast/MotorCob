"""Leitura das tabelas de voz (SQL 56: voz_troncos, voz_rotas, voz_transferencias, voz_chamadas, voz_config).

O JSON que a VM busca do banco (uma lista de linhas por tabela, como o PostgREST devolve) vira dataclasses.
COLUNAS (campo interno -> coluna) é o contrato com o SQL 56: supabase/testes/testar_voz_contrato.py aplica as
migrações e confere que cada coluna daqui existe, com tipo compatível. Se um nome mudar no SQL, muda só aqui.
Campo que não é coluna de voz_config: limite_simultaneas, que voz/configuracao.py traz de
voz_divisao_concorrencia.limite (a concorrência contratada dividida pelo banco).

Nenhuma coluna guarda senha: o tronco com autenticação por senha traz só `segredo_ref` (nome do segredo no
Secret Manager), resolvido em voz/segredos.py na hora de gerar o pjsip.conf.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Callable

from voz import destinos as D

# ------------------------------------------------------------------ nomes de coluna (ajuste aqui)
COLUNAS: dict[str, dict[str, str]] = {
    # V2
    "voz_troncos": {
        "id": "id", "empresa_id": "empresa_id", "referencia": "referencia", "operadora": "operadora",
        "host": "host", "porta": "porta", "transporte": "transporte", "autenticacao": "autenticacao",
        "usuario": "usuario", "segredo_ref": "segredo_ref", "codecs": "codecs", "canais": "canais", "cps": "cps",
        "bina": "bina", "ddd_origem": "ddd_origem", "formato_discagem": "formato_discagem", "csp": "csp",
        "ativo": "ativo",
        # SQL 113 · Telefonia T4 (todos com padrão: banco sem o SQL 113 lê como antes)
        "dtmf": "dtmf", "realm": "realm", "from_usuario": "from_usuario", "cabecalho_bina": "cabecalho_bina",
        "toque_max_s": "toque_max_s", "duracao_max_min": "duracao_max_min", "verificar_options": "verificar_options",
    },
    # V20
    "voz_rotas": {
        "id": "id", "empresa_id": "empresa_id", "tronco_id": "tronco_id", "prioridade": "prioridade",
        "tech_prefix": "tech_prefix", "tipo": "tipo", "cadencia_inicial_s": "cadencia_inicial_s",
        "cadencia_incremento_s": "cadencia_incremento_s", "preco_minuto": "preco_minuto",
        "vigente_desde": "vigente_desde", "vigente_ate": "vigente_ate",
        "enviar_prefixo": "enviar_prefixo",          # SQL 113 · G14: false = a operadora não usa prefixo
    },
    # V25
    "voz_transferencias": {
        "id": "id", "empresa_id": "empresa_id", "destino_sip": "destino_sip", "metodo": "metodo",
        "tech_prefix": "tech_prefix", "cabecalhos": "cabecalhos", "tronco_id": "tronco_id", "ativo": "ativo",
        "credor_id": "credor_id", "simultaneas": "simultaneas",
    },
    # V1, V16, V24
    "voz_config": {
        "empresa_id": "empresa_id", "modo": "modo", "provedor": "provedor", "pico_multiplo": "pico_multiplo",
        "abandono_max_pct": "abandono_max_pct", "freio_ritmo_pct": "freio_ritmo_pct",
        "alo_fake_liberado": "alo_fake_liberado", "alo_fake": "alo_fake", "alo_fake_max_s": "alo_fake_max_s",
        "alo_fake_audio_ref": "alo_fake_audio_ref", "gravar": "gravar", "aviso_gravacao": "aviso_gravacao",
        "retencao_dias": "retencao_dias",
        "transcrever": "transcrever", "transcrever_min_segundos": "transcrever_min_segundos",
        "bucket_gravacoes": "bucket_gravacoes", "variaveis": "variaveis",
        "voz_id": "voz_id",          # a voz da empresa na Montagem (só vale se liberada na VM, tts_vozes)
    },
    # V4: a divisão da concorrência contratada (view; a VM lê o limite de cada empresa)
    "voz_divisao_concorrencia": {"empresa_id": "empresa_id", "limite": "limite"},
    # V21 / V24 / V25: uma linha por tentativa (o número discado não vai para o banco). A tarifação (rota_id,
    # segundos_tarifados, preco_minuto, custo_operadora) é do gatilho tarifar_chamada_voz: a VM só LÊ essas colunas.
    "voz_chamadas": {
        "empresa_id": "empresa_id", "credor_id": "credor_id", "id_cliente": "id_cliente", "id_acao": "id_acao",
        "id_chamada": "id_chamada", "canal": "canal", "modo": "modo", "provedor": "provedor",
        "ocorrido_em": "ocorrido_em", "atendida_em": "atendida_em", "encerrada_em": "encerrada_em",
        "duracao_s": "duracao_s", "billsec": "billsec", "causa_sip": "causa_sip", "causa_q850": "causa_q850",
        "dialstatus": "dialstatus", "amd": "amd", "resultado_ia": "resultado_ia", "resultado": "resultado",
        "origem_resultado": "origem_resultado", "destino": "destino", "identidade_confirmada": "identidade_confirmada",
        "transferencia": "transferencia", "transferida_em": "transferida_em", "no_pico": "no_pico",
        "tronco_id": "tronco_id", "tech_prefix": "tech_prefix", "data_promessa": "data_promessa",
        "valor_promessa": "valor_promessa", "retorno_em": "retorno_em", "tem_gravacao": "tem_gravacao",
        "rota_id": "rota_id", "segundos_tarifados": "segundos_tarifados", "preco_minuto": "preco_minuto",
        "custo_operadora": "custo_operadora",
        "fluxo_versao_id": "fluxo_versao_id", "bloco_final": "bloco_final",
        # SQL 65 · Resubmit e contato por passada
        "lote_id": "lote_id", "onda_id": "onda_id", "destino_hash": "destino_hash", "passada": "passada",
        "situacao_origem": "situacao_origem", "resubmit_id": "resubmit_id",
        # SQL 125 · minuto falado com a IA (a VM mede; cadência, preço e valor são do gatilho tarifar_ia_chamada_voz)
        "ia_inicio_em": "ia_inicio_em", "ia_fim_em": "ia_fim_em", "ia_retomada_em": "ia_retomada_em",
        "ia_trechos": "ia_trechos", "segundos_ia": "segundos_ia", "segundos_sessao_ia": "segundos_sessao_ia",
    },
    # SQL 65 · cada decisão do Resubmit (automático ou "Reenviar agora"): só destino_hash, nunca o telefone
    "voz_resubmits": {
        "ref": "ref", "empresa_id": "empresa_id", "credor_id": "credor_id", "lote_id": "lote_id",
        "id_chamada_origem": "id_chamada_origem", "id_cliente": "id_cliente", "destino_hash": "destino_hash",
        "situacao_origem": "situacao_origem", "passada": "passada", "origem": "origem", "pedido_id": "pedido_id", "reciclagem_id": "reciclagem_id",
        "decisao": "decisao", "motivo_fora": "motivo_fora", "nao_antes_de": "nao_antes_de", "onda_id": "onda_id",
        "criado_em": "criado_em",
    },
    # SQL 58 · um evento por bloco e uma linha por chamada a conector (só códigos)
    "voz_fluxo_passos": {
        "empresa_id": "empresa_id", "id_chamada": "id_chamada", "fluxo_versao_id": "fluxo_versao_id", "ordem": "ordem",
        "bloco_id": "bloco_id", "modo": "modo", "entrou_em": "entrou_em", "saida_quando": "saida_quando",
        "intencao": "intencao", "confianca_faixa": "confianca_faixa", "motivo_devolucao": "motivo_devolucao",
        "trava": "trava", "turnos": "turnos",
    },
    "crm_chamadas": {
        "empresa_id": "empresa_id", "conector_id": "conector_id", "conector_versao": "conector_versao",
        "id_chamada": "id_chamada", "id_cliente": "id_cliente", "fluxo_versao_id": "fluxo_versao_id",
        "bloco_id": "bloco_id", "tentativa": "tentativa", "http_status": "http_status", "classe": "classe",
        "latencia_ms": "latencia_ms", "resultado_codigo": "resultado_codigo",
        "ofertas_acima_alcada": "ofertas_acima_alcada", "usou_alternativa": "usou_alternativa",
    },
    # V22: por empresa, dia e tech prefix
    "consumo_voz": {
        "empresa_id": "empresa_id", "dia": "dia", "tech_prefix": "tech_prefix", "rota_id": "rota_id",
        "chamadas": "chamadas", "chamadas_atendidas": "chamadas_atendidas", "segundos_atendidos": "segundos_atendidos",
        "segundos_tarifados": "segundos_tarifados", "custo_estimado": "custo_estimado", "sem_custo": "sem_custo",
    },
}

# chave de conflito (upsert) de cada tabela gravada pela VM
CONFLITO = {"voz_chamadas": ("empresa_id", "id_chamada", "canal"), "consumo_voz": ("empresa_id", "dia", "tech_prefix"),
            "voz_fluxo_passos": ("empresa_id", "id_chamada", "ordem"), "voz_resubmits": ("empresa_id", "ref")}
# colunas de voz_chamadas que só o gatilho do banco escreve (a VM nunca manda: reenvio não conflita com a tarifação)
SO_DO_BANCO = {"voz_chamadas": ("rota_id", "segundos_tarifados", "preco_minuto", "custo_operadora")}


def para_colunas(tabela: str, linha: dict) -> dict:
    """Campos internos -> nomes de coluna do banco (o que não está no mapa, ou é só do banco, não vai)."""
    m, fora = COLUNAS[tabela], SO_DO_BANCO.get(tabela, ())
    return {m[k]: v for k, v in linha.items() if k in m and k not in fora}


def conflito(tabela: str) -> str:
    return ",".join(COLUNAS[tabela][k] for k in CONFLITO[tabela])

TRANSPORTES = ("udp", "tcp", "tls")
# o que vai no Request-URI depois do tech prefix: DDD+número · 0+CSP+DDD+número · 55+DDD+número · +55 DDD número
FORMATOS_DISCAGEM = ("tech_ddd_numero", "tech_0_csp_ddd_numero", "tech_55_ddd_numero", "tech_e164")
# SQL 113 · Telefonia T4: envio das teclas e como a bina vai na ligação
DTMFS = ("auto", "rfc4733", "inband", "info")
CABECALHOS_BINA = ("from_pai", "from", "rpid")
AUTENTICACOES = ("ip", "senha")
TIPOS_ROTA = ("fixo_local", "fixo_ldn", "movel_vc1", "movel_vc2_vc3")
METODOS_TRANSFERENCIA = ("refer", "ponte")
# mesmo padrão do check de mensageria_fornecedores.segredo_ref
SEGREDO_REF = re.compile(r"^[A-Za-z0-9_\-/.]{1,120}$")
TECH_PREFIX = re.compile(r"^[0-9]{1,8}$")
HOST = re.compile(r"^[A-Za-z0-9.\-]{1,253}$")
SIP_URI = re.compile(r"^sips?:([A-Za-z0-9_.+\-]{1,64})@([A-Za-z0-9.\-]{1,253})(?::(\d{1,5}))?(?:;transport=(udp|tcp|tls))?$")
VOZ_ID = re.compile(r"[A-Za-z0-9_\-]{2,80}")          # voz_config.voz_id (mesmo formato do banco)
# cabeçalhos X-MotorCX que a transferência pode levar (voz_transferencias.cabecalhos, text[] com check no SQL 56)
CABECALHOS_TRANSFERENCIA = ("X-MotorCX-Id-Chamada", "X-MotorCX-Id-Acao", "X-MotorCX-Acao", "X-MotorCX-Motivo")
CODECS_OK = ("alaw", "ulaw", "g729", "g722", "opus", "gsm")
# public.variaveis_voz() do SQL 56 (cópia de motor/voz.py › VARIAVEIS_VOZ: o contêiner do Asterisk leva só voz/,
# sem o motor; tests/test_voz_gerador.py confere a paridade e testar_voz_contrato.py, a do banco). Nunca CPF.
VARIAVEIS_VOZ = ("primeiro_nome", "credor", "saldo", "dias_atraso", "vencimento", "link_pagamento",
                 "valor_minimo", "parcelas_max", "desconto_max", "assessoria")   # assessoria: nome da empresa (SQL 58)
# voz_config.variaveis: o padrão do banco (o que vai ao provedor se a empresa não escolheu)
VARIAVEIS_PADRAO = ("primeiro_nome", "credor", "link_pagamento")


class DadosInvalidos(ValueError):
    pass


def _v(linha: dict, tabela: str, campo: str, padrao=None):
    col = COLUNAS[tabela].get(campo, campo)
    v = linha.get(col)
    return padrao if v is None or v == "" else v


def _int(v, onde: str, lo: int | None = None, hi: int | None = None) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise DadosInvalidos(f"{onde}: inteiro inválido {v!r}") from None
    if (lo is not None and n < lo) or (hi is not None and n > hi):
        raise DadosInvalidos(f"{onde}: {n} fora de [{lo}, {hi}]")
    return n


def _bool(v, padrao: bool) -> bool:
    if v is None or v == "":
        return padrao
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in ("1", "true", "t", "sim", "s", "yes")


def _data(v) -> date | None:
    if v in (None, ""):
        return None
    return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])


# ------------------------------------------------------------------ dataclasses
@dataclass(frozen=True)
class Tronco:
    id: int
    empresa_id: int
    referencia: str
    host: str
    porta: int = 5060
    transporte: str = "udp"
    autenticacao: str = "ip"
    usuario: str | None = None
    segredo_ref: str | None = None
    codecs: tuple = ("alaw", "ulaw")
    canais: int = 30
    cps: float = 5.0
    operadora: str = ""
    bina: str | None = None          # número exibido (do cliente; não é dado pessoal)
    ddd_origem: str | None = None    # DDD de onde o tronco sai (tipo da rota: local × LDN, VC1 × VC2/3)
    formato_discagem: str = "tech_ddd_numero"
    csp: str | None = None           # código de seleção de prestadora (2 dígitos), só no formato com CSP
    ativo: bool = True
    # SQL 113 · Telefonia T4
    dtmf: str = "auto"               # auto (RFC 4733 ou no áudio) | rfc4733 | inband | info
    realm: str | None = None         # domínio de autenticação (só se a operadora pedir)
    from_usuario: str | None = None  # número/usuário no "De" (vazio = bina, ou o usuário com senha)
    cabecalho_bina: str = "from_pai"  # from_pai (De + P-Asserted-Identity) | from | rpid
    toque_max_s: int = 30            # desiste da ligação que não atende nesse tempo (D5)
    duracao_max_min: int = 20        # derruba a ligação pendurada (D5)
    verificar_options: bool = True   # OPTIONS a cada 60 s

    @property
    def nome(self) -> str:
        """Nome do endpoint no Asterisk (estável: muda só se o id mudar)."""
        return f"tr-{self.empresa_id}-{self.id}"

    @property
    def meio(self) -> str:
        """O que entra entre o tech prefix e o DDD+número."""
        if self.formato_discagem == "tech_0_csp_ddd_numero":
            return "0" + (self.csp or "")
        if self.formato_discagem == "tech_55_ddd_numero":
            return "55"
        if self.formato_discagem == "tech_e164":
            return "+55"
        return ""

    def discar(self, tech_prefix: str, nacional: str) -> str:
        """Request-URI do número (nacional = DDD + número, sem 0 nem 55)."""
        return f"{tech_prefix}{self.meio}{nacional}"


@dataclass(frozen=True)
class Rota:
    id: int
    empresa_id: int
    tronco_id: int
    prioridade: int
    tech_prefix: str
    tipo: str
    cadencia_inicial_s: int = 30
    cadencia_incremento_s: int = 6
    preco_minuto: float | None = None
    vigente_desde: date | None = None
    vigente_ate: date | None = None
    enviar_prefixo: bool = True      # SQL 113 · G14: false = tech_prefix é só o código interno (vigência e custo)

    @property
    def prefixo_discagem(self) -> str:
        """O que vai no Request-URI antes do número: o tech prefix, ou nada se a operadora não usa."""
        return self.tech_prefix if self.enviar_prefixo else ""

    def vigente(self, dia: date) -> bool:
        return (self.vigente_desde is None or self.vigente_desde <= dia) and \
            (self.vigente_ate is None or dia <= self.vigente_ate)


@dataclass(frozen=True)
class Transferencia:
    id: int
    empresa_id: int
    destino_sip: str
    metodo: str = "ponte"                           # padrão (decisão do dono, 08/11/2026); "refer" é opção avançada
    tech_prefix: str = ""
    cabecalhos: tuple = CABECALHOS_TRANSFERENCIA      # quais X-MotorCX vão (nunca CPF/nome/valor)
    tronco_id: int | None = None                     # "ponte pelo tronco": sai pelo tronco da empresa
    ativo: bool = True
    credor_id: int | None = None                     # nulo = a empresa toda
    simultaneas: int = 5                             # operadores para transferência ao mesmo tempo (SQL 111)

    @property
    def nome(self) -> str:
        return f"tf-{self.empresa_id}-{self.id}"

    @property
    def usuario(self) -> str:
        return SIP_URI.match(self.destino_sip).group(1)

    @property
    def host(self) -> str:
        return SIP_URI.match(self.destino_sip).group(2)

    @property
    def porta(self) -> int:
        p = SIP_URI.match(self.destino_sip).group(3)
        return int(p) if p else 5060

    @property
    def esquema(self) -> str:
        return "sips" if self.destino_sip.startswith("sips:") else "sip"

    @property
    def transporte(self) -> str:
        return SIP_URI.match(self.destino_sip).group(4) or ("tls" if self.esquema == "sips" else "udp")


@dataclass(frozen=True)
class ConfigVoz:
    empresa_id: int
    modo: str = "simulado"
    provedor: str = "simulador"
    limite_simultaneas: int | None = None     # voz_divisao_concorrencia.limite; nulo = canais dos troncos
    pico_multiplo: int = 1                    # 1 = desligado, até 3
    abandono_max_pct: float = 3.0
    freio_ritmo_pct: float = 60.0
    alo_fake_liberado: bool = False           # alo_fake*: colunas sem uso desde o V4 (o Alô fake saiu)
    alo_fake: bool = False
    alo_fake_max_s: int = 4
    alo_fake_audio_ref: str | None = None
    gravar: bool = True
    aviso_gravacao: bool = True               # SQL 83 · B6: ligado por padrão (a abertura diz que a ligação é gravada)
    retencao_dias: int = 90
    transcrever: bool = True
    transcrever_min_segundos: int = 5
    bucket_gravacoes: str | None = None       # um bucket por empresa (criar_gcp.sh empresa <id> <dias>)
    variaveis: tuple = VARIAVEIS_PADRAO       # quais variáveis_voz() a empresa manda ao provedor (só os nomes)
    voz_id: str | None = None                 # voz da empresa na Montagem; a VM só usa se estiver liberada nela


# ------------------------------------------------------------------ leitura
def ler_tronco(linha: dict) -> Tronco:
    t = "voz_troncos"
    tid = _int(_v(linha, t, "id"), "voz_troncos.id", 1)
    onde = f"voz_troncos[{tid}]"
    host = str(_v(linha, t, "host", "")).strip()
    if not HOST.match(host):
        raise DadosInvalidos(f"{onde}: host inválido")
    motivo = D.motivo_host(host)            # SQL 83 · B4: a regra estática do banco (sem DNS)
    if motivo:
        raise DadosInvalidos(f"{onde}: host recusado ({motivo})")
    transp = str(_v(linha, t, "transporte", "udp")).lower()
    if transp not in TRANSPORTES:
        raise DadosInvalidos(f"{onde}: transporte '{transp}' (udp|tcp|tls)")
    aut = str(_v(linha, t, "autenticacao", "ip")).lower()
    if aut not in AUTENTICACOES:
        raise DadosInvalidos(f"{onde}: autenticação '{aut}' (ip|senha)")
    ref = _v(linha, t, "segredo_ref")
    usuario = _v(linha, t, "usuario")
    if aut == "senha":
        if not ref or not SEGREDO_REF.match(str(ref)):
            raise DadosInvalidos(f"{onde}: autenticação por senha exige segredo_ref válido")
        if not usuario or not re.match(r"^[A-Za-z0-9_.+\-]{1,64}$", str(usuario)):
            raise DadosInvalidos(f"{onde}: autenticação por senha exige usuário")
    elif ref:
        raise DadosInvalidos(f"{onde}: autenticação por IP não leva segredo_ref")
    codecs = _v(linha, t, "codecs", ["alaw", "ulaw"])
    if isinstance(codecs, str):
        codecs = [c.strip() for c in codecs.replace(";", ",").split(",") if c.strip()]
    codecs = tuple(str(c).lower() for c in codecs)
    if not codecs or any(c not in CODECS_OK for c in codecs):
        raise DadosInvalidos(f"{onde}: codecs {codecs} (aceitos: {', '.join(CODECS_OK)})")
    bina = _v(linha, t, "bina")
    bina = "".join(ch for ch in str(bina) if ch.isdigit()) if bina else None
    ddd = _v(linha, t, "ddd_origem")
    if not ddd and bina:
        b = bina[2:] if len(bina) in (12, 13) and bina.startswith("55") else bina.lstrip("0")
        ddd = b[:2] if len(b) in (10, 11) else None
    ddd = str(ddd) if ddd else None
    if ddd and not re.match(r"^[1-9][1-9]$", ddd):
        raise DadosInvalidos(f"{onde}: ddd_origem inválido")
    fmt = str(_v(linha, t, "formato_discagem", "tech_ddd_numero"))
    if fmt not in FORMATOS_DISCAGEM:
        raise DadosInvalidos(f"{onde}: formato_discagem '{fmt}' ({', '.join(FORMATOS_DISCAGEM)})")
    csp = _v(linha, t, "csp")
    csp = str(csp) if csp is not None else None
    if fmt == "tech_0_csp_ddd_numero" and not (csp and re.match(r"^[0-9]{2}$", csp)):
        raise DadosInvalidos(f"{onde}: formato com CSP exige csp de 2 dígitos")
    cps = float(_v(linha, t, "cps", 5))
    if not 0 < cps <= 500:
        raise DadosInvalidos(f"{onde}: cps fora de (0, 500]")
    dtmf = str(_v(linha, t, "dtmf", "auto")).lower()
    if dtmf not in DTMFS:
        raise DadosInvalidos(f"{onde}: dtmf '{dtmf}' ({', '.join(DTMFS)})")
    realm = _v(linha, t, "realm")
    if realm is not None and not HOST.match(str(realm)):
        raise DadosInvalidos(f"{onde}: realm inválido")
    from_usuario = _v(linha, t, "from_usuario")
    if from_usuario is not None and not re.match(r"^[A-Za-z0-9_.+\-]{1,64}$", str(from_usuario)):
        raise DadosInvalidos(f"{onde}: from_usuario inválido")
    cab = str(_v(linha, t, "cabecalho_bina", "from_pai")).lower()
    if cab not in CABECALHOS_BINA:
        raise DadosInvalidos(f"{onde}: cabecalho_bina '{cab}' ({', '.join(CABECALHOS_BINA)})")
    return Tronco(id=tid, empresa_id=_int(_v(linha, t, "empresa_id"), f"{onde}.empresa_id", 1),
                  referencia=str(_v(linha, t, "referencia", f"tronco {tid}"))[:80], host=host,
                  porta=_int(_v(linha, t, "porta", 5060), f"{onde}.porta", 1, 65535), transporte=transp,
                  autenticacao=aut, usuario=str(usuario) if usuario else None, segredo_ref=str(ref) if ref else None,
                  codecs=codecs, canais=_int(_v(linha, t, "canais", 30), f"{onde}.canais", 1, 10000), cps=cps,
                  operadora=str(_v(linha, t, "operadora", ""))[:60], bina=bina, ddd_origem=ddd,
                  formato_discagem=fmt, csp=csp, ativo=_bool(_v(linha, t, "ativo"), True),
                  dtmf=dtmf, realm=str(realm) if realm else None, from_usuario=str(from_usuario) if from_usuario else None,
                  cabecalho_bina=cab, toque_max_s=_int(_v(linha, t, "toque_max_s", 30), f"{onde}.toque_max_s", 15, 45),
                  duracao_max_min=_int(_v(linha, t, "duracao_max_min", 20), f"{onde}.duracao_max_min", 5, 60),
                  verificar_options=_bool(_v(linha, t, "verificar_options"), True))


def ler_rota(linha: dict) -> Rota:
    t = "voz_rotas"
    rid = _int(_v(linha, t, "id"), "voz_rotas.id", 1)
    onde = f"voz_rotas[{rid}]"
    tp = str(_v(linha, t, "tech_prefix", ""))
    if not TECH_PREFIX.match(tp):
        raise DadosInvalidos(f"{onde}: tech_prefix '{tp}' (1 a 8 dígitos)")
    tipo = str(_v(linha, t, "tipo", ""))
    if tipo not in TIPOS_ROTA:
        raise DadosInvalidos(f"{onde}: tipo '{tipo}' ({', '.join(TIPOS_ROTA)})")
    preco = _v(linha, t, "preco_minuto")
    preco = float(preco) if preco is not None else None
    if preco is not None and preco < 0:
        raise DadosInvalidos(f"{onde}: preço negativo")
    return Rota(id=rid, empresa_id=_int(_v(linha, t, "empresa_id"), f"{onde}.empresa_id", 1),
                tronco_id=_int(_v(linha, t, "tronco_id"), f"{onde}.tronco_id", 1),
                prioridade=_int(_v(linha, t, "prioridade", 1), f"{onde}.prioridade", 1, 9), tech_prefix=tp, tipo=tipo,
                cadencia_inicial_s=_int(_v(linha, t, "cadencia_inicial_s", 30), f"{onde}.cadencia_inicial_s", 1),
                cadencia_incremento_s=_int(_v(linha, t, "cadencia_incremento_s", 6), f"{onde}.cadencia_incremento_s",
                                           1),
                preco_minuto=preco, vigente_desde=_data(_v(linha, t, "vigente_desde")),
                vigente_ate=_data(_v(linha, t, "vigente_ate")),
                enviar_prefixo=_bool(_v(linha, t, "enviar_prefixo"), True))


def ler_transferencia(linha: dict) -> Transferencia:
    t = "voz_transferencias"
    xid = _int(_v(linha, t, "id"), "voz_transferencias.id", 1)
    onde = f"voz_transferencias[{xid}]"
    dest = str(_v(linha, t, "destino_sip", "")).strip()
    if not SIP_URI.match(dest):
        raise DadosInvalidos(f"{onde}: destino_sip inválido (sip:usuario@host[:porta][;transport=udp|tcp|tls])")
    motivo = D.motivo_host(D.host_da_transferencia(dest))      # SQL 83 · B4
    if motivo:
        raise DadosInvalidos(f"{onde}: destino recusado ({motivo})")
    met = str(_v(linha, t, "metodo", "ponte")).lower()
    if met not in METODOS_TRANSFERENCIA:
        raise DadosInvalidos(f"{onde}: método '{met}' (refer|ponte)")
    tp = str(_v(linha, t, "tech_prefix", "") or "")
    if tp and not TECH_PREFIX.match(tp):
        raise DadosInvalidos(f"{onde}: tech_prefix '{tp}'")
    cab = ler_cabecalhos(_v(linha, t, "cabecalhos"), onde)
    tr = _v(linha, t, "tronco_id")
    cred = _v(linha, t, "credor_id")
    return Transferencia(id=xid, empresa_id=_int(_v(linha, t, "empresa_id"), f"{onde}.empresa_id", 1),
                         destino_sip=dest, metodo=met, tech_prefix=tp, cabecalhos=cab,
                         tronco_id=int(tr) if tr else None, ativo=_bool(_v(linha, t, "ativo"), True),
                         credor_id=int(cred) if cred else None,
                         simultaneas=_int(_v(linha, t, "simultaneas", 5) or 5, f"{onde}.simultaneas", 1, 500))


def ler_cabecalhos(v, onde: str) -> tuple:
    """voz_transferencias.cabecalhos (text[]): lista JSON do PostgREST ou literal do Postgres ('{a,b}'). Ausente =
    os quatro (o padrão do banco); lista vazia = nenhum. Só os nomes do check do SQL 56, na ordem deles."""
    if v is None:
        return CABECALHOS_TRANSFERENCIA
    v = _lista_texto(v, f"{onde}: cabecalhos")
    fora = [x for x in v if x not in CABECALHOS_TRANSFERENCIA]
    if fora:
        raise DadosInvalidos(f"{onde}: cabeçalho fora da lista do banco: {', '.join(map(str, fora))}")
    return tuple(x for x in CABECALHOS_TRANSFERENCIA if x in v)


def ler_config(linha: dict) -> ConfigVoz:
    t = "voz_config"
    eid = _int(_v(linha, t, "empresa_id"), "voz_config.empresa_id", 1)
    onde = f"voz_config[{eid}]"
    lim = _v(linha, t, "limite_simultaneas")
    return ConfigVoz(
        empresa_id=eid, modo=str(_v(linha, t, "modo", "simulado")),
        provedor=str(_v(linha, t, "provedor", "simulador")),
        limite_simultaneas=_int(lim, f"{onde}.limite_simultaneas", 0) if lim is not None else None,
        pico_multiplo=_int(_v(linha, t, "pico_multiplo", 1), f"{onde}.pico_multiplo", 1, 3),
        abandono_max_pct=float(_v(linha, t, "abandono_max_pct", 3.0)),
        freio_ritmo_pct=float(_v(linha, t, "freio_ritmo_pct", 60.0)),
        alo_fake_liberado=_bool(_v(linha, t, "alo_fake_liberado"), False), alo_fake=_bool(_v(linha, t, "alo_fake"), False),
        alo_fake_max_s=_int(_v(linha, t, "alo_fake_max_s", 4), f"{onde}.alo_fake_max_s", 1, 15),
        alo_fake_audio_ref=_v(linha, t, "alo_fake_audio_ref"), gravar=_bool(_v(linha, t, "gravar"), True),
        aviso_gravacao=_bool(_v(linha, t, "aviso_gravacao"), True),
        retencao_dias=_int(_v(linha, t, "retencao_dias", 90), f"{onde}.retencao_dias", 90),
        transcrever=_bool(_v(linha, t, "transcrever"), True),
        transcrever_min_segundos=_int(_v(linha, t, "transcrever_min_segundos", 5), f"{onde}.transcrever_min_segundos",
                                      0, 600),
        bucket_gravacoes=_bucket(_v(linha, t, "bucket_gravacoes"), onde),
        variaveis=ler_variaveis(_v(linha, t, "variaveis"), onde),
        voz_id=ler_voz_id(_v(linha, t, "voz_id")))


def ler_voz_id(v) -> str | None:
    """voz_config.voz_id: id da voz no provedor (o banco já confere o formato). Fora do formato vira None (a VM usa a
    padrão); nunca derruba a configuração."""
    return v if isinstance(v, str) and VOZ_ID.fullmatch(v) else None


def ler_variaveis(v, onde: str) -> tuple:
    """voz_config.variaveis (text[]): só nomes de variaveis_voz() (motor/voz.py › VARIAVEIS_VOZ), na ordem de lá.
    Ausente = o padrão do banco; lista vazia = nenhuma."""
    if v is None:
        return VARIAVEIS_PADRAO
    nomes = _lista_texto(v, f"{onde}: variaveis")
    fora = [x for x in nomes if x not in VARIAVEIS_VOZ]
    if fora:
        raise DadosInvalidos(f"{onde}: variável fora de variaveis_voz(): {', '.join(map(str, fora))}")
    return tuple(x for x in VARIAVEIS_VOZ if x in nomes)


def _lista_texto(v, onde: str) -> list:
    """text[] do banco: lista JSON do PostgREST ou literal do Postgres ('{a,b}')."""
    if isinstance(v, str):
        txt = v.strip()
        if not (txt.startswith("{") and txt.endswith("}")):
            raise DadosInvalidos(f"{onde} deve ser a lista do banco (text[])")
        v = [x.strip().strip('"') for x in txt[1:-1].split(",") if x.strip()]
    if not isinstance(v, (list, tuple)):
        raise DadosInvalidos(f"{onde} deve ser a lista do banco (text[])")
    return list(v)


def _bucket(v, onde: str) -> str | None:
    if v in (None, ""):
        return None
    if not re.match(r"^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$", str(v)):
        raise DadosInvalidos(f"{onde}: bucket_gravacoes inválido")
    return str(v)


@dataclass
class DadosVoz:
    troncos: list[Tronco] = field(default_factory=list)
    rotas: list[Rota] = field(default_factory=list)
    transferencias: list[Transferencia] = field(default_factory=list)
    configs: dict[int, ConfigVoz] = field(default_factory=dict)

    def troncos_da(self, empresa_id: int, ativos: bool = True) -> list[Tronco]:
        return [t for t in self.troncos if t.empresa_id == empresa_id and (t.ativo or not ativos)]

    def tronco(self, tronco_id: int) -> Tronco | None:
        return next((t for t in self.troncos if t.id == tronco_id), None)

    def config(self, empresa_id: int) -> ConfigVoz:
        return self.configs.get(empresa_id) or ConfigVoz(empresa_id=empresa_id)


# ------------------------------------------------------------------ isolamento: uma linha ruim não para as outras
# Antes, um tronco, rota ou transferência inválido fazia voz/configuracao.py manter a configuração anterior de TODAS as
# empresas (C16 / G7 da revisão do especialista). Agora a linha inválida fica de fora (com motivo e id, sem segredo) e o
# resto é publicado. Formato de cima errado (tabela que não é lista, linha que não é objeto, id ilegível, id repetido)
# continua sendo erro: aí não dá para saber o que é de quem, e a configuração anterior fica.
TABELAS_ISOLADAS = ("voz_troncos", "voz_rotas", "voz_transferencias")
_LEITORES = {"voz_troncos": "ler_tronco", "voz_rotas": "ler_rota", "voz_transferencias": "ler_transferencia"}
ITEM_SAUDE = "configuracao_invalida"     # fornecedor_saude.item da linha que ficou de fora
_NOME_CURTO = {"voz_troncos": "tronco", "voz_rotas": "rota", "voz_transferencias": "transferencia"}


@dataclass(frozen=True)
class LinhaIgnorada:
    tabela: str
    id: int
    empresa_id: int | None
    motivo: str                    # uma frase, sem senha nem segredo_ref (só o que ler_* diz)

    @property
    def referencia(self) -> str:
        """fornecedor_saude.referencia (^[A-Za-z0-9_.-]{0,40}$): tronco.12, rota.5, transferencia.3."""
        return f"{_NOME_CURTO[self.tabela]}.{self.id}"

    def texto(self) -> str:
        emp = f"empresa {self.empresa_id}" if self.empresa_id is not None else "empresa ilegível"
        return f"{self.tabela}[{self.id}] ({emp}) ficou de fora: {self.motivo}"


def _motivo(ex: Exception, onde: str) -> str:
    if isinstance(ex, DadosInvalidos):
        m = str(ex)
        return (m[len(onde) + 2:] if m.startswith(onde + ": ") else m)[:180]
    # erro do Python (float('x'), data ilegível…) pode trazer o valor: só o tipo do erro
    return f"valor em formato inesperado ({ex.__class__.__name__})"


def _empresa_da(linha: dict, tabela: str) -> int | None:
    try:
        return int(_v(linha, tabela, "empresa_id"))
    except (TypeError, ValueError):
        return None


def separar_validos(dados: dict, destino: Callable[[str], str | None] | None = None
                    ) -> tuple[dict, list[LinhaIgnorada]]:
    """Tira de `dados` as linhas inválidas de voz_troncos, voz_rotas e voz_transferencias (e a rota ou transferência
    que aponta para tronco que ficou de fora ou é de outra empresa). Devolve (cópia rasa de `dados` só com as linhas
    válidas, linhas ignoradas). Formato de cima errado levanta DadosInvalidos, como antes.
    `destino(host) -> motivo | None` (SQL 83 · B4): a conferência do host DEPOIS do DNS e contra os IPs do MotorCX
    (voz/destinos.py › motivo_host com resolver); o tronco ou a transferência recusada fica de fora sozinha."""
    saida = dict(dados)
    ignoradas: list[LinhaIgnorada] = []
    lidos: dict[str, list] = {}
    for tabela in TABELAS_ISOLADAS:
        linhas = dados.get(tabela) or []
        if not isinstance(linhas, list):
            raise DadosInvalidos(f"{tabela}: precisa ser uma lista de linhas")
        ok = []
        ler = globals()[_LEITORES[tabela]]
        for linha in linhas:
            if not isinstance(linha, dict):
                raise DadosInvalidos(f"{tabela}: linha que não é objeto")
            lid = _int(_v(linha, tabela, "id"), f"{tabela}.id", 1)       # sem id legível: erro de formato
            onde = f"{tabela}[{lid}]"
            try:
                obj = ler(linha)
                if destino is not None and tabela in ("voz_troncos", "voz_transferencias"):
                    motivo = destino(obj.host)
                    if motivo:
                        raise DadosInvalidos(f"{onde}: {'host' if tabela == 'voz_troncos' else 'destino'} "
                                             f"recusado ({motivo})")
                ok.append((linha, obj))
            except (DadosInvalidos, TypeError, ValueError, AttributeError) as ex:
                ignoradas.append(LinhaIgnorada(tabela, lid, _empresa_da(linha, tabela), _motivo(ex, onde)))
        lidos[tabela] = ok
    ids = [t.id for _, t in lidos["voz_troncos"]] + [x.id for x in ignoradas if x.tabela == "voz_troncos"]
    if len(ids) != len(set(ids)):
        raise DadosInvalidos("voz_troncos: id repetido")
    por_id = {t.id: t for _, t in lidos["voz_troncos"]}
    fora = {x.id for x in ignoradas if x.tabela == "voz_troncos"}

    def _tronco_ok(tabela, item, tronco_id, obrigatorio):
        if tronco_id is None and not obrigatorio:
            return True
        t = por_id.get(tronco_id)
        if t is not None and t.empresa_id == item.empresa_id:
            return True
        motivo = (f"o tronco {tronco_id} ficou de fora (com erro de configuração)" if tronco_id in fora
                  else f"o tronco {tronco_id} não existe na empresa {item.empresa_id}")
        ignoradas.append(LinhaIgnorada(tabela, item.id, item.empresa_id, motivo))
        return False

    saida["voz_troncos"] = [l for l, _ in lidos["voz_troncos"]]
    saida["voz_rotas"] = [l for l, r in lidos["voz_rotas"] if _tronco_ok("voz_rotas", r, r.tronco_id, True)]
    saida["voz_transferencias"] = [l for l, x in lidos["voz_transferencias"]
                                   if _tronco_ok("voz_transferencias", x, x.tronco_id, False)]
    return saida, ignoradas


def carregar(dados: dict) -> DadosVoz:
    """JSON {voz_troncos: [...], voz_rotas: [...], voz_transferencias: [...], voz_config: [...]} -> DadosVoz.
    Rota cujo tronco não existe ou é de outra empresa: erro (não se gera rota quebrada)."""
    d = DadosVoz(troncos=[ler_tronco(x) for x in dados.get("voz_troncos") or []],
                 rotas=[ler_rota(x) for x in dados.get("voz_rotas") or []],
                 transferencias=[ler_transferencia(x) for x in dados.get("voz_transferencias") or []],
                 configs={c.empresa_id: c for c in (ler_config(x) for x in dados.get("voz_config") or [])})
    ids = [t.id for t in d.troncos]
    if len(ids) != len(set(ids)):
        raise DadosInvalidos("voz_troncos: id repetido")
    por_id = {t.id: t for t in d.troncos}
    for r in d.rotas:
        t = por_id.get(r.tronco_id)
        if t is None or t.empresa_id != r.empresa_id:
            raise DadosInvalidos(f"voz_rotas[{r.id}]: tronco {r.tronco_id} não existe na empresa {r.empresa_id}")
    for x in d.transferencias:
        if x.tronco_id is not None:
            t = por_id.get(x.tronco_id)
            if t is None or t.empresa_id != x.empresa_id:
                raise DadosInvalidos(f"voz_transferencias[{x.id}]: tronco {x.tronco_id} não é da empresa")
    return d
