"""Link rastreável por ação: resolve a atribuição do disparo pulverizado.

Cada ação (cliente x contato x canal x campanha) sai com um token único. Quando
o cliente chega ao portal de autonegociação por aquele link, o token diz
exatamente qual contato e qual canal o trouxeram — mesmo que SMS, WhatsApp,
RCS e e-mail tenham saído ao mesmo tempo.

- clique no link           → engajamento naquele contato/canal (não prova titularidade)
- login autenticado        → CERTIFICA o contato (quem recebeu o link é o cliente)
- acordo fechado no portal → conversão atribuída à ação de origem

O token é um HMAC da ação: não carrega dado pessoal, não dá para adivinhar sem
o segredo e é o mesmo se a ação for gerada de novo (idempotente).
"""
import base64
import csv
import hashlib
import hmac
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path

from .certificacao import Evento
from .taxonomia import CANAIS_EMAIL

CANAIS_COM_LINK = ("sms", "whatsapp", "rcs", "email")

# evento do portal -> resultado da taxonomia, por canal de origem do link
RESULTADO_PORTAL = {
    "clique": {"sms": "clique_link", "whatsapp": "clique_link", "rcs": "clique_link", "email": "clique"},
    "login": {c: "acesso_portal_autenticado" for c in CANAIS_COM_LINK},
    "acordo": {c: "acesso_portal_autenticado" for c in CANAIS_COM_LINK},  # acordo exige login
}


@dataclass(frozen=True)
class Acao:
    token: str
    campanha: str
    mensagem_id: str
    id_cliente: str
    contato: str
    tipo: str
    canal: str
    link: str
    preparada_em: str  # data ISO


def gerar_token(segredo: str, campanha: str, id_cliente: str, contato: str, canal: str) -> str:
    if not segredo:
        raise ValueError("segredo do rastreio não configurado")
    msg = "|".join((campanha, id_cliente, contato, canal)).encode()
    dig = hmac.new(segredo.encode(), msg, hashlib.sha256).digest()
    return base64.b32encode(dig[:10]).decode().lower()  # 16 caracteres, seguro para URL e SMS


def preparar_disparo(plano: list[dict], campanha: str, mensagem_id: str, base_url: str,
                     segredo: str, hoje: date, ordem: int | None = 1,
                     canais: tuple[str, ...] | None = None) -> list[Acao]:
    """Transforma linhas do plano em ações rastreáveis (uma por cliente x contato x canal).

    ordem=1 pega só a 1ª ação de cada cliente; ordem=None pega todas (disparo pulverizado).
    Canais de voz também viram ação (o registro é o mesmo), só que sem link.
    """
    acoes, vistos = [], set()
    for a in plano:
        if ordem is not None and int(a["ordem"]) != ordem:
            continue
        if canais and a["canal"] not in canais:
            continue
        chave = (a["id_cliente"], a["contato"], a["canal"])
        if chave in vistos:
            continue
        vistos.add(chave)
        token = gerar_token(segredo, campanha, *chave)
        link = base_url.rstrip("/") + "/" + token if a["canal"] in CANAIS_COM_LINK else ""
        acoes.append(Acao(token, campanha, mensagem_id, a["id_cliente"], a["contato"],
                          a.get("tipo") or ("email" if a["canal"] in CANAIS_EMAIL else "telefone"),
                          a["canal"], link, hoje.isoformat()))
    return acoes


def salvar_acoes(caminho: str | Path, acoes: list[Acao]):
    """Acrescenta ao registro de ações (append): o registro é a memória da atribuição."""
    caminho = Path(caminho)
    novo = not caminho.exists()
    caminho.parent.mkdir(parents=True, exist_ok=True)
    existentes = {a.token for a in carregar_acoes(caminho).values()} if not novo else set()
    with open(caminho, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(Acao.__dataclass_fields__))
        if novo:
            w.writeheader()
        w.writerows(asdict(a) for a in acoes if a.token not in existentes)


def carregar_acoes(caminho: str | Path) -> dict[str, Acao]:
    with open(caminho, newline="", encoding="utf-8") as f:
        return {l["token"]: Acao(**l) for l in csv.DictReader(f)}


@dataclass
class Conversao:
    token: str
    campanha: str
    mensagem_id: str
    id_cliente: str
    contato: str
    canal: str
    valor_acordo: float
    ocorrido_em: str


def ler_log_portal(caminho: str | Path, acoes: dict[str, Acao]):
    """Log do portal (token;evento;ocorrido_em[;valor_acordo]) → eventos + conversões.

    Retorna (eventos, conversoes, relatorio). Token desconhecido não vira evidência:
    pode ser link adulterado, de outro ambiente ou de campanha fora do registro.
    """
    eventos, conversoes = [], []
    rel = Counter()
    with open(caminho, newline="", encoding="utf-8") as f:
        for n, l in enumerate(csv.DictReader(f, delimiter=";"), start=2):
            rel["linhas"] += 1
            token, evento = (l.get("token") or "").strip().lower(), (l.get("evento") or "").strip().lower()
            acao = acoes.get(token)
            if acao is None:
                rel["token desconhecido"] += 1
                continue
            if evento not in RESULTADO_PORTAL or acao.canal not in CANAIS_COM_LINK:
                rel["evento inválido"] += 1
                continue
            try:
                quando = datetime.fromisoformat(l["ocorrido_em"].strip())
            except (ValueError, AttributeError, KeyError):
                rel["data inválida"] += 1
                continue
            eventos.append(Evento(acao.id_cliente, acao.contato, acao.tipo, acao.canal,
                                  RESULTADO_PORTAL[evento][acao.canal], quando.date(), 0.0,
                                  fornecedor="portal", id_externo=f"{token}:{evento}:{quando.isoformat()}"))
            rel[evento] += 1
            if evento == "acordo":
                try:
                    valor = float((l.get("valor_acordo") or "0").replace(",", "."))
                except ValueError:
                    valor = 0.0
                conversoes.append(Conversao(token, acao.campanha, acao.mensagem_id, acao.id_cliente,
                                            acao.contato, acao.canal, valor, quando.isoformat()))
    return eventos, conversoes, rel


def atribuicao_por_canal(acoes: dict[str, Acao], eventos_portal: list[Evento],
                         conversoes: list[Conversao]) -> dict[str, dict]:
    """Funil atribuído por canal: enviadas → clique → login → acordo (e R$)."""
    por = {}
    for a in acoes.values():
        d = por.setdefault(a.canal, Counter())
        d["acoes"] += 1
    tok_canal = {}
    for e in eventos_portal:
        tok = e.id_externo.split(":")[0]
        evento = e.id_externo.split(":")[1]
        tok_canal.setdefault((tok, evento), e.canal)
    for (tok, evento), canal in tok_canal.items():
        por.setdefault(canal, Counter())[evento] += 1  # conta ações únicas, não acessos repetidos
    for c in conversoes:
        por.setdefault(c.canal, Counter())["valor_acordos"] += c.valor_acordo
    return {canal: {"acoes": d["acoes"], "cliques": d["clique"], "logins": d["login"],
                    "acordos": d["acordo"], "valor_acordos": round(d["valor_acordos"], 2)}
            for canal, d in por.items()}
