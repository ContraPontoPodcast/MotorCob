"""Retorno de canal: o status que cada fornecedor devolve por número/e-mail (DLR do SMS, entrega,
leitura e clique do RCS/WhatsApp, hard e soft bounce do e-mail, discagem da voz) retroalimenta a
base. É apartado do CPC: o arquivo só tem o contato e o status — fala do NÚMERO, não do cliente.

O cliente mapeia uma vez, por canal, a coluna do contato e a do status (e a data, se houver) e marca
cada status com uma das marcas:

    inexistente  número/e-mail não existe (DLR permanente, hard bounce, número inexistente)
    temporario   não chegou agora (DLR temporário, aparelho desligado, soft bounce/caixa cheia)
    entregue     chegou: o contato existe e está ativo
    lido         leu / abriu
    clique       clicou, respondeu, interagiu
    bloqueio     pediu para não receber (opt-out, bloqueio, descadastro)

Regras (por contato × canal, na ordem das datas; qualquer positivo — entregue, lido, clique —
desfaz inexistente e pausa anteriores):

* SMS inexistente (DLR de não entregue): SUSPENSÃO ESCALONADA do número em tudo que vai para o
  celular (SMS, RCS, WhatsApp e voz nesse número): 1ª falha 7 dias, 2ª 15, 3ª 30, 4ª 90, 5ª 120; depois
  reabre para uma próxima tentativa (nova falha volta a suspender pelo último degrau). Falha durante a
  suspensão não conta; um entregue/lido/clique zera a contagem. Os outros contatos do cliente assumem.
* Voz "número inexistente": a telefonia pode falhar, então sozinha suspende SÓ A VOZ nesse número, na
  mesma escada. Junção: as falhas do SMS e da voz somam na mesma contagem; quando o SMS também falhou, a
  suspensão vale para tudo que vai para o celular. Atendeu/caixa postal (positivo) zera.
* RCS inexistente: aparelho sem RCS → sai do RCS (o senão automático leva para o SMS; a estratégia
  pode usar WhatsApp e voz) e é retestado depois de dias_rever (60).
* WhatsApp inexistente: sem conta → sai do WhatsApp e é retestado depois de dias_rever (15).
* E-mail inexistente (hard bounce): sai do e-mail.
* Voz inexistente (número não existe): sai de todos os canais de telefone.
* Temporário: temporarios_pausa seguidos (sem positivo no meio) → pausa de dias_pausa no canal.
* Bloqueio: sai do canal (vale até o cliente voltar a ser cadastrado; não é desfeito por entrega).
* Trava de lote: arquivo com LOTE_MINIMO+ linhas e mais de limite_lote de "inexistente" é falha do
  fornecedor (rota), não dos números — os "inexistente" dele não valem, e vira alerta.

Os números (pausa, retestar, lote) são as regras de renitência de cada canal, configuráveis na
página Canais (regras_de); PADRAO é o ponto de partida.

Entregue/lido/clique também viram evidência na certificação do contato (lido e clique só quando o
número é de um único cliente: num número compartilhado não dá para saber quem leu).
"""
import csv
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

from . import normalizacao as norm
from .certificacao import Evento

CANAIS = ("sms", "rcs", "whatsapp", "email", "voz")
MARCAS = ("inexistente", "temporario", "entregue", "lido", "clique", "bloqueio")
POSITIVAS = ("entregue", "lido", "clique")
CANAIS_VOZ = ("discador", "agente_voz")
TELEFONE = ("sms", "rcs", "whatsapp") + CANAIS_VOZ
LOTE_MINIMO = 200
LIMITE_LOTE = 0.5
# regras de renitência por canal (página Canais do site; o que não vier usa o padrão)
#   temporarios_pausa: falhas temporárias seguidas para pausar · dias_pausa: duração da pausa
#   inexistente: "escalonar" (SMS e voz: suspensão escalonada do número, ver escalonamento) · "bloquear"
#                (sai do canal) · "retestar" (sai e volta depois de dias_rever) · "ignorar"
#   escalonamento: dias de suspensão a cada DLR de não entregue (1ª, 2ª, ...; depois repete o último)
#   limite_lote: fração de "inexistente" num arquivo (com LOTE_MINIMO+ linhas) que indica falha do fornecedor
PADRAO = {
    "sms": {"temporarios_pausa": 3, "dias_pausa": 30, "inexistente": "escalonar", "dias_rever": 60, "limite_lote": 0.5,
            "escalonamento": [7, 15, 30, 90, 120]},
    "rcs": {"temporarios_pausa": 3, "dias_pausa": 30, "inexistente": "retestar", "dias_rever": 60, "limite_lote": 0.5},
    "whatsapp": {"temporarios_pausa": 3, "dias_pausa": 30, "inexistente": "retestar", "dias_rever": 15,
                 "limite_lote": 0.5},
    "email": {"temporarios_pausa": 3, "dias_pausa": 30, "inexistente": "bloquear", "dias_rever": 60, "limite_lote": 0.5},
    "voz": {"temporarios_pausa": 0, "dias_pausa": 30, "inexistente": "escalonar", "dias_rever": 60, "limite_lote": 0.5,
            "escalonamento": [7, 15, 30, 90, 120]},
}
CANAL_DA_CONFIG = {"sms": "sms", "rcs": "rcs", "whatsapp": "whatsapp", "email": "email", "voz": "discador"}


def regras_de(canais_empresa: list[dict] | None) -> dict:
    """Regras de cada canal: o padrão com o que a empresa configurou (canais_empresa.regras_retorno)."""
    cfg = {c.get("canal"): c.get("regras_retorno") or {} for c in canais_empresa or []}
    saida = {}
    for canal, base in PADRAO.items():
        r = {**base, **{k: v for k, v in (cfg.get(CANAL_DA_CONFIG[canal]) or {}).items() if k in base and v is not None}}
        try:
            r["temporarios_pausa"] = max(0, int(r["temporarios_pausa"]))
            r["dias_pausa"] = max(1, int(r["dias_pausa"]))
            r["dias_rever"] = max(1, int(r["dias_rever"]))
            r["limite_lote"] = min(1.0, max(0.05, float(r["limite_lote"])))
            if "escalonamento" in base:
                esc = [min(365, max(1, int(d))) for d in (r["escalonamento"] or [])][:10]
                r["escalonamento"] = esc or list(base["escalonamento"])
        except (TypeError, ValueError):
            r = dict(base)
        validas = ("escalonar", "bloquear", "retestar", "ignorar") if canal in ("sms", "voz") \
            else ("bloquear", "retestar", "ignorar")
        if r["inexistente"] not in validas:
            r["inexistente"] = base["inexistente"]
        saida[canal] = r
    return saida


NOME = {"sms": "SMS", "rcs": "RCS", "whatsapp": "WhatsApp", "email": "E-mail", "voz": "Voz"}

# resultado da taxonomia para a certificação (canal do motor, resultado)
EVIDENCIA = {
    "sms": {"entregue": ("sms", "entregue"), "lido": ("sms", "entregue"), "clique": ("sms", "clique_link")},
    "rcs": {"entregue": ("rcs", "entregue"), "lido": ("rcs", "lido"), "clique": ("rcs", "clique_link")},
    "whatsapp": {"entregue": ("whatsapp", "entregue"), "lido": ("whatsapp", "lido"),
                 "clique": ("whatsapp", "clique_link")},
    "email": {"entregue": ("email", "entregue"), "lido": ("email", "abertura"), "clique": ("email", "clique")},
    "voz": {"entregue": ("discador", "caixa_postal"), "lido": ("discador", "caixa_postal"),
            "clique": ("discador", "atendida_sem_cpc")},
}


def _n(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]+", " ", s.upper()).strip()


# palavras dos fornecedores mais comuns (SMPP/DLR, e-mail, RCS, discador) → marca sugerida
_SUGESTOES = [
    ("bloqueio", ("OPT OUT", "OPTOUT", "DESCADASTR", "UNSUBSCRIB", "BLOQUE", "BLOCK", "SAIR", "STOP", "SPAM",
                  "COMPLAIN", "DENUNCIA", "NAO PERTURBE", "BLACKLIST")),
    ("temporario", ("SOFT", "TEMPOR", "CAIXA CHEIA", "MAILBOX FULL", "EXPIRED", "EXPIRAD", "DESLIGAD", "FORA DE AREA",
                    "AUSENTE", "ABSENT", "OCUPAD", "BUSY", "NAO ATEND", "NO ANSWER", "TIMEOUT", "TENTE", "RETRY",
                    "THROTTL", "INDISPONIV", "UNAVAILABLE", "DEFERRED", "ADIAD")),
    ("inexistente", ("HARD", "UNDELIV", "NAO ENTREG", "NAO_ENTREG", "INEXIST", "INVALID", "UNKNOWN", "DESCONHECID",
                     "NOT EXIST", "NAO EXIST", "REJECT", "REJEIT", "FAILED", "FALH", "ERRO", "ERROR", "BOUNCE",
                     "NAO SUPORT", "NOT SUPPORT", "SEM SUPORTE", "SEM CONTA", "NO ACCOUNT", "NOT ON WHATSAPP",
                     "NUMERO ERRADO", "DISCONNECTED", "NAO COMPLETA")),
    ("clique", ("CLIQ", "CLIC", "CLICK", "RESPOND", "RESPOST", "REPLY", "INTERA", "ATENDID", "ATENDEU", "ANSWERED")),
    ("lido", ("LIDO", "LIDA", "READ", "ABERT", "OPEN", "VISUALIZ", "SEEN")),
    ("entregue", ("ENTREG", "DELIVR", "DELIVERED", "DELIVERY OK", "RECEBID", "RECEIVED", "SUCESS", "SUCCESS",
                  "CAIXA POSTAL", "VOICEMAIL", "ACCEPTED", "ACEIT")),
]


def sugerir_marca(codigo: str) -> str | None:
    """Marca sugerida para um status de fornecedor (o cliente confirma no site)."""
    n = _n(codigo)
    if not n:
        return None
    if n in ("OK", "1"):
        return "entregue"
    if n in ("NOK", "NAO OK", "0"):
        return None
    for marca, chaves in _SUGESTOES:
        if any(k in n for k in chaves):
            # "NAO ENTREGUE" contém "ENTREG": a ordem acima já trata (inexistente vem antes de entregue)
            return marca
    return None


def detectar_colunas(cabecalho: list[str], linhas: list[dict]) -> dict:
    """Sugere {contato, status, data} olhando nomes e valores das colunas."""
    def valores(col):
        return [str(l.get(col) or "").strip() for l in linhas[:200] if str(l.get(col) or "").strip()]
    sug = {}
    pont = []
    for col in cabecalho:
        vs = valores(col)
        if not vs:
            continue
        n = _n(col)
        tel = sum(1 for v in vs if norm.telefone(v)) / len(vs)
        mail = sum(1 for v in vs if norm.email(v)) / len(vs)
        bonus = 1 if any(k in n for k in ("TEL", "FONE", "PHONE", "CELULAR", "MSISDN", "NUMERO", "EMAIL", "DESTIN")) else 0
        pont.append((max(tel, mail) + 0.2 * bonus, col))
    if pont:
        melhor = max(pont)
        if melhor[0] >= 0.6:
            sug["contato"] = melhor[1]
    status = []
    for col in cabecalho:
        if col == sug.get("contato"):
            continue
        vs = valores(col)
        if not vs:
            continue
        n = _n(col)
        distintos = len(set(vs))
        reconhece = sum(1 for v in set(vs) if sugerir_marca(v)) / max(1, distintos)
        nome = 1 if any(k in n for k in ("STATUS", "SITUAC", "RESULT", "EVENT", "DLR", "RETORNO", "ESTADO")) else 0
        if distintos <= 40:
            status.append((reconhece + nome, col))
    if status:
        sug["status"] = max(status)[1]
    for col in cabecalho:
        if col in sug.values():
            continue
        vs = valores(col)[:50]
        if vs and sum(1 for v in vs if _data(v)) / len(vs) >= 0.8:
            sug["data"] = col
            break
    return sug


def _data(v: str) -> date | None:
    v = (v or "").strip()
    for fmt, n in (("%d/%m/%Y %H:%M:%S", 19), ("%d/%m/%Y %H:%M", 16), ("%d/%m/%Y", 10), ("%Y-%m-%d %H:%M:%S", 19),
                   ("%Y-%m-%dT%H:%M:%S", 19), ("%Y-%m-%d %H:%M", 16), ("%Y-%m-%d", 10), ("%d-%m-%Y", 10),
                   ("%d/%m/%y", 8), ("%Y%m%d", 8)):
        try:
            return datetime.strptime(v[:n], fmt).date()
        except ValueError:
            continue
    return None


def abrir(arq: Path):
    """(linhas, cabeçalho, encoding, delimitador) — tenta utf-8 e latin-1, ; , tab |."""
    bruto = Path(arq).read_bytes()
    for enc in ("utf-8-sig", "latin-1"):
        try:
            txt = bruto.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    primeira = txt.splitlines()[0] if txt else ""
    delim = max((";", ",", "\t", "|"), key=primeira.count)
    leitor = csv.DictReader(txt.splitlines(), delimiter=delim)
    linhas = list(leitor)
    return linhas, [c for c in (leitor.fieldnames or []) if c], enc, delim


@dataclass
class Registro:
    contato: str
    canal: str          # sms, rcs, whatsapp, email, voz
    marca: str
    data: date
    arquivo: str


@dataclass
class RelatorioArquivo:
    arquivo: str
    canal: str
    linhas: int = 0
    aproveitadas: int = 0
    contato_invalido: int = 0
    sem_marca: Counter = field(default_factory=Counter)     # status ainda não marcado no site
    por_marca: Counter = field(default_factory=Counter)
    lote_travado: bool = False
    clientes: int = 0                                       # números que são de algum cliente da base

    def dicionario(self) -> dict:
        return {"arquivo": self.arquivo, "canal": self.canal, "linhas": self.linhas, "aproveitadas": self.aproveitadas,
                "contato_invalido": self.contato_invalido, "por_marca": dict(self.por_marca),
                "status_para_marcar": dict(self.sem_marca), "lote_travado": self.lote_travado,
                "da_base": self.clientes}


def ler_arquivo(arq: Path, canal: str, colunas: dict, marcas: dict[str, str], dia_arquivo: date,
                limite_lote: float = LIMITE_LOTE):
    """Lê um arquivo de retorno de canal. colunas: {contato, status, data?}; marcas: {status: marca}.
    Devolve (registros, relatório). Status sem marca fica de fora (conta em sem_marca)."""
    linhas, _, _, _ = abrir(arq)
    rel = RelatorioArquivo(Path(arq).name, canal)
    tipo = "email" if canal == "email" else "telefone"
    regs = []
    for l in linhas:
        rel.linhas += 1
        contato = norm.contato(str(l.get(colunas.get("contato")) or ""), tipo)
        if not contato:
            rel.contato_invalido += 1
            continue
        st = str(l.get(colunas.get("status")) or "").strip()
        marca = marcas.get(st[:200])
        if marca not in MARCAS:
            if st:
                rel.sem_marca[st[:200]] += 1
            continue
        d = _data(str(l.get(colunas["data"]) or "")) if colunas.get("data") else None
        regs.append(Registro(contato, canal, marca, d or dia_arquivo, rel.arquivo))
        rel.por_marca[marca] += 1
    rel.aproveitadas = len(regs)
    if rel.aproveitadas >= LOTE_MINIMO and rel.por_marca["inexistente"] / rel.aproveitadas > limite_lote:
        rel.lote_travado = True
        regs = [r for r in regs if r.marca != "inexistente"]
    return regs, rel


def _restricoes_inexistente(canal: str) -> list[str]:
    return {"sms": ["sms:inexistente", "rcs:inexistente"], "rcs": ["rcs:sem_suporte"],
            "whatsapp": ["whatsapp:sem_conta"], "email": ["email:inexistente"],
            "voz": [f"{c}:inexistente" for c in TELEFONE]}[canal]


def avaliar(registros: list[Registro], donos: dict[str, list[str]], hoje: date, regras: dict | None = None):
    """Aplica as regras. donos: contato -> [id_cliente] (quem tem esse contato na base).
    Devolve (eventos para a certificação, restrições {contato: {restrição}}, situação [linhas da
    higienização], resumo)."""
    regras = regras or regras_de(None)
    por_chave = defaultdict(list)
    for r in registros:
        if r.data <= hoje:
            por_chave[(r.contato, r.canal)].append(r)
    restricoes = defaultdict(set)
    situacao, eventos = [], []
    resumo = defaultdict(Counter)
    for (contato, canal), rs in por_chave.items():
        rs.sort(key=lambda r: (r.data, MARCAS.index(r.marca)))
        inexistente = temp_ini = bloqueio = ultimo_pos = None
        temps = 0
        for r in rs:
            if r.marca in POSITIVAS:
                inexistente, temps, ultimo_pos = None, 0, r.data
            elif r.marca == "inexistente":
                inexistente = r.data
            elif r.marca == "temporario":
                temps += 1
                temp_ini = r.data
            elif r.marca == "bloqueio":
                bloqueio = r.data
        dono = donos.get(contato) or []
        for c in Counter(r.marca for r in rs):
            resumo[canal][c] += 1
        linha = {"contato": contato, "canal": NOME[canal], "clientes": " ".join(sorted(dono)[:5]),
                 "ultimo_positivo": ultimo_pos.isoformat() if ultimo_pos else ""}
        if bloqueio:
            alvo = CANAIS_VOZ if canal == "voz" else (canal,)
            restricoes[contato].update(f"{c}:opt_out" for c in alvo)
            situacao.append({**linha, "situacao": "bloqueio (não enviar)", "desde": bloqueio.isoformat(), "ate": ""})
            resumo[canal]["contatos_bloqueados"] += 1
        rg = regras[canal]
        if rg["inexistente"] == "escalonar":
            inexistente = None                                   # suspensão escalonada (abaixo, SMS + voz juntos)
        if inexistente and rg["inexistente"] != "ignorar":
            rever = rg["inexistente"] == "retestar"
            if not rever or (hoje - inexistente).days <= rg["dias_rever"]:
                restricoes[contato].update(_restricoes_inexistente(canal))
                ate = (inexistente.toordinal() + rg["dias_rever"]) if rever else None
                txt = {"sms": "inexistente no SMS (fora do SMS e do RCS; voz ainda pode atender)",
                       "rcs": "sem RCS no aparelho", "whatsapp": "sem conta no WhatsApp",
                       "email": "e-mail inexistente (hard bounce)", "voz": "número inexistente"}[canal]
                situacao.append({**linha, "situacao": txt, "desde": inexistente.isoformat(),
                                 "ate": date.fromordinal(ate).isoformat() if ate else ""})
                resumo[canal]["contatos_inexistentes"] += 1
        if rg["temporarios_pausa"] and temps >= rg["temporarios_pausa"] and (hoje - temp_ini).days <= rg["dias_pausa"]:
            restricoes[contato].update(f"{c}:pausa" for c in (CANAIS_VOZ if canal == "voz" else (canal,)))
            situacao.append({**linha, "situacao": f"pausa ({temps} falhas temporárias seguidas)",
                             "desde": temp_ini.isoformat(),
                             "ate": date.fromordinal(temp_ini.toordinal() + rg["dias_pausa"]).isoformat()})
            resumo[canal]["contatos_em_pausa"] += 1
        # evidência para a certificação (só positivos; um evento por dia e marca)
        vistos = set()
        for r in rs:
            if r.marca not in POSITIVAS or (r.data, r.marca) in vistos:
                continue
            vistos.add((r.data, r.marca))
            marca = r.marca if len(dono) == 1 else "entregue"
            canal_m, res = EVIDENCIA[canal][marca]
            for idc in dono:
                eventos.append(Evento(idc, contato, "email" if canal == "email" else "telefone", canal_m, res, r.data,
                                      fornecedor=f"canal:{canal}", id_externo=f"{r.arquivo}|{contato}|{r.data}|{r.marca}",
                                      origem=r.arquivo))
        if ultimo_pos and not (bloqueio or inexistente):
            resumo[canal]["contatos_ativos"] += 1
    # suspensão escalonada do número: DLR de não entregue no SMS e "número inexistente" na voz somam na
    # mesma contagem; o alcance depende de quem falhou (só a voz → só voz; o SMS entrou → tudo do celular)
    por_numero = defaultdict(list)
    for (contato, canal), rs in por_chave.items():
        if canal in ("sms", "voz") and regras[canal]["inexistente"] == "escalonar":
            por_numero[contato] += rs
    for contato, rs in por_numero.items():
        sus = _suspensao(rs, regras, hoje)
        if not sus:
            continue
        alvo, falhas, fontes, ini, fim = sus
        restricoes[contato].update(f"{c}:suspenso" for c in alvo)
        dono = donos.get(contato) or []
        quem = " + ".join(NOME[c] for c in ("sms", "voz") if c in fontes)
        onde = "tudo que vai para este celular" if "sms" in fontes else "só a voz neste número"
        situacao.append({"contato": contato, "canal": quem, "clientes": " ".join(sorted(dono)[:5]),
                         "ultimo_positivo": "", "situacao": f"suspenso: {falhas}ª falha ({quem}) — "
                         f"{(fim - ini).days} dias, {onde}", "desde": ini.isoformat(), "ate": fim.isoformat()})
        resumo["sms" if "sms" in fontes else "voz"]["contatos_suspensos"] += 1
    return eventos, dict(restricoes), situacao, {c: dict(v) for c, v in resumo.items()}


def _suspensao(rs: list[Registro], regras: dict, hoje: date):
    """Escada de suspensão do número (SMS e voz juntos). Cada falha fora da suspensão em curso sobe um
    degrau; um positivo (entregue/lido/clique, em qualquer dos dois) zera. Falha do SMS durante uma
    suspensão só de voz conta (é outro canal confirmando) e estende o alcance para tudo do celular.
    Devolve (canais, falhas, fontes, início, fim) da suspensão em vigor ou None."""
    participa = {c for c in ("sms", "voz") if regras[c]["inexistente"] == "escalonar"}
    escala = regras["sms" if "sms" in participa else "voz"]["escalonamento"]
    falhas, fim, ini, fontes = 0, None, None, set()
    for r in sorted(rs, key=lambda r: (r.data, MARCAS.index(r.marca))):
        if r.marca in POSITIVAS:
            falhas, fim, fontes = 0, None, set()
        elif r.marca == "inexistente":
            em_curso = fim is not None and r.data < fim
            if em_curso and (r.canal in fontes or "sms" in fontes):
                continue                                  # o que já está suspenso não falha de novo
            falhas += 1
            fontes.add(r.canal)
            ini, fim = r.data, date.fromordinal(r.data.toordinal() + escala[min(falhas, len(escala)) - 1])
    if not fim or hoje >= fim:
        return None
    return (TELEFONE if "sms" in fontes else CANAIS_VOZ), falhas, fontes, ini, fim


def aplicar_restricoes(certs: dict, restricoes: dict[str, set]):
    """Junta as restrições do retorno de canal às certificações ({(id, contato): Certificacao})."""
    if not restricoes:
        return certs
    for (_, contato), cert in certs.items():
        extra = restricoes.get(contato)
        if extra:
            cert.restricoes = set(cert.restricoes) | extra
    return certs
