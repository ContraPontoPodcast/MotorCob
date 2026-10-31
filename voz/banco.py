"""Leitura das tabelas de voz (SQL 56: voz_troncos, voz_rotas, voz_transferencias, voz_chamadas, voz_config).

As tabelas nascem em outra branch (claude/voz-banco). Aqui só há a INTERFACE descrita na seção 0 do plano e na
lista V1–V25 do protótipo: o JSON que a VM busca do banco (uma lista de linhas por tabela) vira dataclasses.
Se um nome de coluna mudar no SQL final, ajuste só o dicionário COLUNAS abaixo (campo interno -> coluna).

Nenhuma coluna guarda senha: o tronco com autenticação por senha traz só `segredo_ref` (nome do segredo no
Secret Manager), resolvido em voz/segredos.py na hora de gerar o pjsip.conf.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

# ------------------------------------------------------------------ nomes de coluna (ajuste aqui)
COLUNAS: dict[str, dict[str, str]] = {
    # V2
    "voz_troncos": {
        "id": "id", "empresa_id": "empresa_id", "referencia": "referencia", "operadora": "operadora",
        "host": "host", "porta": "porta", "transporte": "transporte", "autenticacao": "autenticacao",
        "usuario": "usuario", "segredo_ref": "segredo_ref", "codecs": "codecs", "canais": "canais", "cps": "cps",
        "bina": "bina", "ddd_origem": "ddd_origem", "formato_discagem": "formato_discagem", "csp": "csp",
        "ativo": "ativo",
    },
    # V20
    "voz_rotas": {
        "id": "id", "empresa_id": "empresa_id", "tronco_id": "tronco_id", "prioridade": "prioridade",
        "tech_prefix": "tech_prefix", "tipo": "tipo", "cadencia_inicial_s": "cadencia_inicial_s",
        "cadencia_incremento_s": "cadencia_incremento_s", "preco_minuto": "preco_minuto",
        "vigente_desde": "vigente_desde", "vigente_ate": "vigente_ate",
    },
    # V25
    "voz_transferencias": {
        "id": "id", "empresa_id": "empresa_id", "destino_sip": "destino_sip", "metodo": "metodo",
        "tech_prefix": "tech_prefix", "cabecalhos": "cabecalhos", "tronco_id": "tronco_id", "ativo": "ativo",
    },
    # V1, V16, V24
    "voz_config": {
        "empresa_id": "empresa_id", "credor_id": "credor_id", "modo": "modo", "provedor": "provedor",
        "limite_simultaneas": "limite_simultaneas", "pico_multiplo": "pico_multiplo",
        "abandono_max_pct": "abandono_max_pct", "freio_ritmo_pct": "freio_ritmo_pct",
        "alo_fake_liberado": "alo_fake_liberado", "alo_fake": "alo_fake", "alo_fake_max_s": "alo_fake_max_s",
        "alo_fake_audio_ref": "alo_fake_audio_ref", "gravar": "gravar", "retencao_dias": "retencao_dias",
        "transcrever": "transcrever", "transcrever_min_segundos": "transcrever_min_segundos",
        "bucket_gravacoes": "bucket_gravacoes",
    },
    # V21 / V24 / V25: uma linha por tentativa (o número discado não vai para o banco)
    "voz_chamadas": {
        "empresa_id": "empresa_id", "credor_id": "credor_id", "id_cliente": "id_cliente", "id_acao": "id_acao",
        "id_chamada": "id_chamada", "resultado": "resultado", "duracao_s": "duracao_s", "billsec": "billsec",
        "tech_prefix": "tech_prefix", "rota_id": "rota_id", "segundos_tarifados": "segundos_tarifados",
        "preco_minuto": "preco_minuto", "custo_operadora": "custo_operadora", "no_pico": "no_pico",
        "transferencia_resultado": "transferencia_resultado", "tem_gravacao": "tem_gravacao",
        "ocorrido_em": "ocorrido_em", "fluxo_versao_id": "fluxo_versao_id", "bloco_final": "bloco_final",
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
CONFLITO = {"voz_chamadas": ("id_chamada",), "consumo_voz": ("empresa_id", "dia", "tech_prefix"),
            "voz_fluxo_passos": ("empresa_id", "id_chamada", "ordem")}


def para_colunas(tabela: str, linha: dict) -> dict:
    """Campos internos -> nomes de coluna do banco (o que não está no mapa não vai)."""
    m = COLUNAS[tabela]
    return {m[k]: v for k, v in linha.items() if k in m}


def conflito(tabela: str) -> str:
    return ",".join(COLUNAS[tabela][k] for k in CONFLITO[tabela])

TRANSPORTES = ("udp", "tcp", "tls")
# o que vai no Request-URI depois do tech prefix: DDD+número · 0+CSP+DDD+número · 55+DDD+número
FORMATOS_DISCAGEM = ("tech_ddd_numero", "tech_0_csp_ddd_numero", "tech_55_ddd_numero")
AUTENTICACOES = ("ip", "senha")
TIPOS_ROTA = ("fixo_local", "fixo_ldn", "movel_vc1", "movel_vc2_vc3")
METODOS_TRANSFERENCIA = ("refer", "ponte")
# mesmo padrão do check de mensageria_fornecedores.segredo_ref
SEGREDO_REF = re.compile(r"^[A-Za-z0-9_\-/.]{1,120}$")
TECH_PREFIX = re.compile(r"^[0-9]{1,8}$")
HOST = re.compile(r"^[A-Za-z0-9.\-]{1,253}$")
SIP_URI = re.compile(r"^sip:([A-Za-z0-9_.+\-]{1,64})@([A-Za-z0-9.\-]{1,253})(?::(\d{1,5}))?(?:;transport=(udp|tcp|tls))?$")
CABECALHO = re.compile(r"^X-[A-Za-z0-9\-]{1,40}$")
CODECS_OK = ("alaw", "ulaw", "g729", "g722", "opus", "gsm")


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

    def vigente(self, dia: date) -> bool:
        return (self.vigente_desde is None or self.vigente_desde <= dia) and \
            (self.vigente_ate is None or dia <= self.vigente_ate)


@dataclass(frozen=True)
class Transferencia:
    id: int
    empresa_id: int
    destino_sip: str
    metodo: str = "refer"
    tech_prefix: str = ""
    cabecalhos: dict = field(default_factory=dict)   # fixos (nunca CPF/nome/valor)
    tronco_id: int | None = None                     # "ponte pelo tronco": sai pelo tronco da empresa
    ativo: bool = True

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
    def transporte(self) -> str:
        return SIP_URI.match(self.destino_sip).group(4) or "udp"


@dataclass(frozen=True)
class ConfigVoz:
    empresa_id: int
    credor_id: int | None = None
    modo: str = "simulado"
    provedor: str = "simulador"
    limite_simultaneas: int | None = None     # nulo = canais dos troncos
    pico_multiplo: int = 1                    # 1 = desligado, até 3
    abandono_max_pct: float = 3.0
    freio_ritmo_pct: float = 60.0
    alo_fake_liberado: bool = False
    alo_fake: bool = False
    alo_fake_max_s: int = 4
    alo_fake_audio_ref: str | None = None
    gravar: bool = True
    retencao_dias: int = 90
    transcrever: bool = True
    transcrever_min_segundos: int = 5
    bucket_gravacoes: str | None = None       # um bucket por empresa (criar_gcp.sh empresa <id> <dias>)

    @property
    def alo_fake_ativo(self) -> bool:
        return self.alo_fake_liberado and self.alo_fake


# ------------------------------------------------------------------ leitura
def ler_tronco(linha: dict) -> Tronco:
    t = "voz_troncos"
    tid = _int(_v(linha, t, "id"), "voz_troncos.id", 1)
    onde = f"voz_troncos[{tid}]"
    host = str(_v(linha, t, "host", "")).strip()
    if not HOST.match(host):
        raise DadosInvalidos(f"{onde}: host inválido")
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
    return Tronco(id=tid, empresa_id=_int(_v(linha, t, "empresa_id"), f"{onde}.empresa_id", 1),
                  referencia=str(_v(linha, t, "referencia", f"tronco {tid}"))[:80], host=host,
                  porta=_int(_v(linha, t, "porta", 5060), f"{onde}.porta", 1, 65535), transporte=transp,
                  autenticacao=aut, usuario=str(usuario) if usuario else None, segredo_ref=str(ref) if ref else None,
                  codecs=codecs, canais=_int(_v(linha, t, "canais", 30), f"{onde}.canais", 1, 10000), cps=cps,
                  operadora=str(_v(linha, t, "operadora", ""))[:60], bina=bina, ddd_origem=ddd,
                  formato_discagem=fmt, csp=csp, ativo=_bool(_v(linha, t, "ativo"), True))


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
                vigente_ate=_data(_v(linha, t, "vigente_ate")))


def ler_transferencia(linha: dict) -> Transferencia:
    t = "voz_transferencias"
    xid = _int(_v(linha, t, "id"), "voz_transferencias.id", 1)
    onde = f"voz_transferencias[{xid}]"
    dest = str(_v(linha, t, "destino_sip", "")).strip()
    if not SIP_URI.match(dest):
        raise DadosInvalidos(f"{onde}: destino_sip inválido (sip:usuario@host[:porta][;transport=udp|tcp|tls])")
    met = str(_v(linha, t, "metodo", "refer")).lower()
    if met not in METODOS_TRANSFERENCIA:
        raise DadosInvalidos(f"{onde}: método '{met}' (refer|ponte)")
    tp = str(_v(linha, t, "tech_prefix", "") or "")
    if tp and not TECH_PREFIX.match(tp):
        raise DadosInvalidos(f"{onde}: tech_prefix '{tp}'")
    cab = _v(linha, t, "cabecalhos", {}) or {}
    for k, v in cab.items():
        if not CABECALHO.match(k) or not re.match(r"^[A-Za-z0-9_.:\-/ ]{0,80}$", str(v)):
            raise DadosInvalidos(f"{onde}: cabeçalho fixo inválido '{k}' (só X-..., valor curto sem caracteres "
                                 "especiais)")
    tr = _v(linha, t, "tronco_id")
    return Transferencia(id=xid, empresa_id=_int(_v(linha, t, "empresa_id"), f"{onde}.empresa_id", 1),
                         destino_sip=dest, metodo=met, tech_prefix=tp, cabecalhos=dict(cab),
                         tronco_id=int(tr) if tr else None, ativo=_bool(_v(linha, t, "ativo"), True))


def ler_config(linha: dict) -> ConfigVoz:
    t = "voz_config"
    eid = _int(_v(linha, t, "empresa_id"), "voz_config.empresa_id", 1)
    onde = f"voz_config[{eid}]"
    lim = _v(linha, t, "limite_simultaneas")
    cred = _v(linha, t, "credor_id")
    return ConfigVoz(
        empresa_id=eid, credor_id=int(cred) if cred else None, modo=str(_v(linha, t, "modo", "simulado")),
        provedor=str(_v(linha, t, "provedor", "simulador")),
        limite_simultaneas=_int(lim, f"{onde}.limite_simultaneas", 1) if lim is not None else None,
        pico_multiplo=_int(_v(linha, t, "pico_multiplo", 1), f"{onde}.pico_multiplo", 1, 3),
        abandono_max_pct=float(_v(linha, t, "abandono_max_pct", 3.0)),
        freio_ritmo_pct=float(_v(linha, t, "freio_ritmo_pct", 60.0)),
        alo_fake_liberado=_bool(_v(linha, t, "alo_fake_liberado"), False), alo_fake=_bool(_v(linha, t, "alo_fake"), False),
        alo_fake_max_s=_int(_v(linha, t, "alo_fake_max_s", 4), f"{onde}.alo_fake_max_s", 1, 15),
        alo_fake_audio_ref=_v(linha, t, "alo_fake_audio_ref"), gravar=_bool(_v(linha, t, "gravar"), True),
        retencao_dias=_int(_v(linha, t, "retencao_dias", 90), f"{onde}.retencao_dias", 90),
        transcrever=_bool(_v(linha, t, "transcrever"), True),
        transcrever_min_segundos=_int(_v(linha, t, "transcrever_min_segundos", 5), f"{onde}.transcrever_min_segundos",
                                      0, 600),
        bucket_gravacoes=_bucket(_v(linha, t, "bucket_gravacoes"), onde))


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
