"""Mensageria: envio dos lotes da Lista do dia (SMS e e-mail) pelos fornecedores das rotas.

Duas etapas:
* criar_lotes (na rodada do dia, por credor): lê saida/<dia>/ids/<canal>.csv (id_cliente;contato[;mensagem]),
  monta um lote por canal e grava no banco SÓ o ID do cliente, o destino mascarado e o hash do destino.
  Contato e texto ficam no servidor: <credor>/mensageria/lote_<id>.json.
* processar (o plantão chama a cada minuto): envia os lotes agendados dentro da janela do canal pelo plano de
  rota (cada mensagem vai a um fornecedor sorteado pelo % do tráfego; se ele falhar, os outros na ordem de
  reserva), grava o que cada fornecedor enviou e quanto custou (margem por cliente), grava o resultado, o descadastro ("SAIR", link) e o retorno para
  o motor (<credor>/canais_mensageria/<canal>/*.csv → entregue, inexistente, bloqueio).

Modo "simulado" (padrão): nenhum fornecedor é chamado e nada entra no consumo da fatura. O Simulador
responde de forma estável pelo hash do destino (~96% entregue, ~3% inexistente, ~1% descadastro no SMS).
MOTORCOB_SIMULAR_QUEDA=zenvia,... simula fornecedor fora do ar para testar a reserva.
Modo "real" só vale para fornecedor com adaptador em ADAPTADORES_REAIS (entra quando o acesso for liberado).

Regras de cobrança (SQL 13):
* SMS até 160 caracteres (acima disso a mensagem é bloqueada). Antes do envio, a operadora do número é consultada
  (cache de 30 dias, só pelo hash); número inválido não sai, e o plano pode ter rota própria por operadora. Cada
  resposta do cliente é cobrada pelo preço do SMS.
* RCS Basic (texto até 160) ou Single (acima disso, ou coluna tipo_rcs = single). Agente conversacional: a resposta
  do cliente transforma aquele envio em sessão Conversacional e, por 24 h, novas mensagens ao mesmo número não
  custam nada (rcs_sessao). Agente não conversacional: a resposta é ignorada.
Banco sem o SQL 13: o motor segue como antes (sem RCS, sem operadora, sem colunas novas).
"""
import csv
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

SP = ZoneInfo("America/Sao_Paulo")
CANAIS = ("sms", "email", "rcs")
LIMITE_SMS = 160
LIMITE_RCS_BASIC = 160
SESSAO_RCS_HORAS = 24
CACHE_OPERADORA_DIAS = 30
JANELA_PADRAO = ("08:00", "20:00")
POR_RODADA = 500            # mensagens por lote a cada minuto
MAX_TENTATIVAS = 3
MARCA = {"entregue": "entregue", "falhou": "inexistente", "descadastro": "bloqueio"}


# ------------------------------------------------------------------ destino: normalizar, mascarar, hash
def normalizar(canal: str, destino: str) -> str:
    if canal == "email":
        return (destino or "").strip().lower()
    d = re.sub(r"\D", "", destino or "")
    return d[2:] if re.fullmatch(r"55\d{10,11}", d) else d


def hash_destino(canal: str, destino: str) -> str:
    """Igual a public.hash_destino no banco: casa descadastro sem guardar o contato."""
    return hashlib.sha256(normalizar(canal, destino).encode("utf-8")).hexdigest()


def mascarar(canal: str, destino: str) -> str:
    n = normalizar(canal, destino)
    if canal == "email":
        nome, _, dominio = n.partition("@")
        return f"{nome[:2]}••@{dominio}"
    if len(n) == 11:
        return f"({n[:2]}) {n[2]}••••-••{n[-2:]}"
    return f"({n[:2]}) ••••-••{n[-2:]}"


# ------------------------------------------------------------------ fornecedores
class ErroFornecedor(Exception):
    """O fornecedor não aceitou o envio (fora do ar, sem adaptador, credencial): tenta a reserva."""


@dataclass
class Resultado:
    situacao: str            # entregue · falhou · descadastro
    motivo: str | None = None
    id_externo: str | None = None
    respondeu: bool = False  # o cliente respondeu (SMS: cobra a resposta; RCS conversacional: abre sessão)


class Simulador:
    def __init__(self, codigo: str, fora_do_ar: bool = False):
        self.codigo, self.fora_do_ar = codigo, fora_do_ar

    def enviar(self, canal: str, destino: str, texto: str, assunto: str | None = None) -> Resultado:
        if self.fora_do_ar:
            raise ErroFornecedor(f"{self.codigo} fora do ar (simulado)")
        h = hash_destino(canal, destino)
        n = int(h[:6], 16) % 1000
        ident = f"sim-{self.codigo}-{h[:12]}"
        if canal == "email":
            if n < 15:
                return Resultado("falhou", "caixa de e-mail inexistente (simulado)", ident)
            if n < 25:
                return Resultado("descadastro", "clicou em descadastrar (simulado)", ident)
        else:
            if n < 30:
                return Resultado("falhou", "número inexistente (simulado)", ident)
            if n < 40:
                return Resultado("descadastro", "respondeu SAIR (simulado)", ident)
        respondeu = 40 <= n < (90 if canal == "sms" else 120 if canal == "rcs" else 40)   # ~5% SMS, ~8% RCS
        return Resultado("entregue", None, ident, respondeu)


def operadora_simulada(destino: str) -> str:
    """Consulta de operadora de mentira, estável pelo número: vivo, claro, tim, oi, outras ou invalido (~1%)."""
    n = int(hash_destino("sms", destino)[6:12], 16) % 1000
    return ("invalido" if n < 10 else "vivo" if n < 390 else "claro" if n < 720 else "tim" if n < 960 else
            "oi" if n < 990 else "outras")


ADAPTADORES_REAIS: dict = {}     # codigo -> classe com .enviar(); entra quando cada fornecedor liberar o acesso
CONSULTAS_REAIS: dict = {}       # codigo -> função(destino) -> operadora; entra com o acesso do fornecedor


def adaptador(codigo: str, modo: str):
    if modo == "simulado":
        queda = {c.strip() for c in os.environ.get("MOTORCOB_SIMULAR_QUEDA", "").split(",") if c.strip()}
        return Simulador(codigo, codigo in queda)
    cls = ADAPTADORES_REAIS.get(codigo)
    if cls is None:
        raise ErroFornecedor(f"fornecedor {codigo} ainda sem integração")
    return cls()


def _tabela_nova(consulta, padrao):
    """Lê uma tabela do SQL 12; banco ainda sem ela (PostgREST 400/404) devolve o padrão."""
    from nuvem.supabase_api import ErroSupabase
    try:
        return consulta()
    except ErroSupabase as e:
        if e.status in (400, 404):
            return padrao
        raise


def banco_novo(sb) -> bool:
    """O banco já tem o SQL 13 (RCS, operadora, item e respostas nas mensagens)?"""
    return _tabela_nova(lambda: sb.selecionar("mensageria_planos_rota", {"id": "eq.0"}) is not None, False)


def plano_rota(sb, empresa_id, canal: str, modo: str) -> list[dict]:
    """Fornecedores do canal com o % do tráfego e a ordem de reserva: o plano da empresa, senão o padrão.
    Sem plano (banco ainda sem o SQL 12): as rotas antigas, principal com 100% e reservas com 0%."""
    ativos = {f["codigo"] for f in sb.selecionar("mensageria_fornecedores", {"ativo": "eq.true"}) or []
              if canal in (f.get("canais") or [])}

    def do_plano():
        planos = {p["id"]: p for p in sb.selecionar("mensageria_planos_rota", {"canal": f"eq.{canal}",
                                                                               "ativo": "eq.true"}) or []}
        proprio = sb.selecionar("mensageria_rota_empresa", {"empresa_id": f"eq.{empresa_id}",
                                                            "canal": f"eq.{canal}"}) or []
        pid = proprio[0]["plano_id"] if proprio and proprio[0]["plano_id"] in planos else \
            next((i for i, p in planos.items() if p.get("padrao")), None)
        return sb.selecionar("mensageria_plano_fornecedores", {"plano_id": f"eq.{pid}"}) or [] if pid else []

    itens = [{"fornecedor": i["fornecedor"], "percentual": float(i["percentual"]),
              "ordem_reserva": int(i.get("ordem_reserva") or 1), "operadora": i.get("operadora") or None}
             for i in _tabela_nova(do_plano, [])]
    if not itens:
        todas = [r for r in sb.selecionar("mensageria_rotas", {"canal": f"eq.{canal}", "ativo": "eq.true"}) or []]
        da_empresa = [r for r in todas if r.get("empresa_id") == empresa_id]
        escolhidas = sorted(da_empresa or [r for r in todas if r.get("empresa_id") is None],
                            key=lambda r: r["prioridade"])
        itens = [{"fornecedor": r["fornecedor"], "percentual": 100.0 if n == 0 else 0.0, "ordem_reserva": n + 1,
                  "operadora": None} for n, r in enumerate(escolhidas)]
    itens = [i for i in itens if i["fornecedor"] in ativos]
    if not itens and modo == "simulado":
        itens = [{"fornecedor": "simulador", "percentual": 100.0, "ordem_reserva": 1, "operadora": None}]
    return itens


def escolher(plano: list[dict], chave: str, operadora: str | None = None) -> list[str]:
    """Ordem de tentativa para uma mensagem: o primeiro sorteado pelo % do tráfego (sempre o mesmo para a mesma
    chave) e depois os demais na ordem de reserva. Com operadora: as linhas dela, se o plano tiver; senão as de
    "todas". Se o grupo inteiro falhar, os fornecedores das outras linhas entram como última reserva.
    Fornecedor desativado sai do plano e os outros dividem o tráfego."""
    grupo = [p for p in plano if operadora and p.get("operadora") == operadora] or \
        [p for p in plano if not p.get("operadora")]
    resto = []
    for p in sorted(plano, key=lambda p: (p["ordem_reserva"], -p["percentual"], p["fornecedor"])):
        if p not in grupo and p["fornecedor"] not in resto and p["fornecedor"] not in {g["fornecedor"] for g in grupo}:
            resto.append(p["fornecedor"])
    return _sortear(grupo, chave) + resto


def _sortear(plano: list[dict], chave: str) -> list[str]:
    reserva = [p["fornecedor"] for p in sorted(plano, key=lambda p: (p["ordem_reserva"], -p["percentual"],
                                                                    p["fornecedor"]))]
    com_trafego = sorted((p for p in plano if p["percentual"] > 0), key=lambda p: p["fornecedor"])
    total = sum(p["percentual"] for p in com_trafego)
    if not total:
        return reserva
    x = int(hashlib.sha256(chave.encode("utf-8")).hexdigest()[:12], 16) / 16 ** 12 * total
    acum, primeiro = 0.0, com_trafego[-1]["fornecedor"]
    for p in com_trafego:
        acum += p["percentual"]
        if x < acum:
            primeiro = p["fornecedor"]
            break
    return [primeiro] + [f for f in reserva if f != primeiro]


def custos(sb, item: str, dia: date) -> dict:
    """{fornecedor: custo por mensagem vigente no dia}."""
    linhas = _tabela_nova(lambda: sb.selecionar("mensageria_custos", {"item": f"eq.{item}"}) or [], [])
    saida, desde = {}, {}
    for c in linhas:
        v = str(c["vigente_desde"])[:10]
        if v <= dia.isoformat() and v >= desde.get(c["fornecedor"], ""):
            saida[c["fornecedor"]], desde[c["fornecedor"]] = float(c["custo"]), v
    return saida


# ------------------------------------------------------------------ janela do canal
def janela(canal_cfg: dict | None, dia: date) -> tuple[str, str] | None:
    """(início, fim) do envio no dia, ou None: domingo, sábado sem envio ou canal desligado."""
    c = canal_cfg or {}
    if c.get("ativo") is False or dia.weekday() == 6 or (dia.weekday() == 5 and c.get("sabado") is False):
        return None
    return (c.get("janela_inicio") or JANELA_PADRAO[0], c.get("janela_fim") or JANELA_PADRAO[1])


def dentro(jan: tuple[str, str] | None, agora: datetime) -> bool:
    return bool(jan) and jan[0] <= agora.strftime("%H:%M") < jan[1]


# ------------------------------------------------------------------ arquivos locais
def _gravar_json(arq: Path, dados) -> None:
    arq.parent.mkdir(parents=True, exist_ok=True)
    tmp = arq.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    tmp.replace(arq)


def registros(pasta: Path) -> list:
    """Resultados da mensageria como retorno de canal do motor (mesmas regras de suspensão/bloqueio)."""
    from motor.retorno_canal import Registro
    saida = []
    for arq in sorted((Path(pasta) / "canais_mensageria").glob("*/*.csv")):
        with open(arq, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f, delimiter=";"):
                try:
                    saida.append(Registro(r["contato"], arq.parent.name, r["marca"], date.fromisoformat(r["data"]),
                                          arq.name))
                except (KeyError, ValueError):
                    continue
    return saida


def _anotar_retorno(pasta: Path, canal: str, lote_id: int, dia: date, linhas: list[tuple[str, str]]) -> None:
    if not linhas:
        return
    arq = Path(pasta) / "canais_mensageria" / canal / f"{dia.isoformat()}_lote{lote_id}.csv"
    arq.parent.mkdir(parents=True, exist_ok=True)
    novo = not arq.exists()
    with open(arq, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        if novo:
            w.writerow(["contato", "marca", "data"])
        w.writerows([(c, MARCA[s], dia.isoformat()) for c, s in linhas])


# ------------------------------------------------------------------ 1. criar os lotes do dia
def criar_lotes(sb, empresa_id, credor_id, pasta: Path, dia: date, canais_empresa: list[dict] | None = None,
                out=print) -> list[dict]:
    pasta = Path(pasta)
    mod = sb.selecionar("empresa_modulos", {"empresa_id": f"eq.{empresa_id}", "modulo": "eq.mensageria",
                                            "ativo": "eq.true"}) or []
    if not mod:
        return []
    novo = banco_novo(sb)
    liberados = [c for c in CANAIS if c in (mod[0].get("canais") or []) and (novo or c != "rcs")]
    cfg = (sb.selecionar("mensageria_config", {"empresa_id": f"eq.{empresa_id}"}) or [{}])[0]
    modo, aprovar = cfg.get("modo") or "simulado", cfg.get("aprovar_lotes") is not False
    canais_cfg = {c.get("canal"): c for c in canais_empresa or []}
    criados = []
    for canal in liberados:
        arq = pasta / "saida" / dia.isoformat() / "ids" / f"{canal}.csv"
        if not arq.exists():
            continue
        cid = credor_id or 0
        if sb.selecionar("mensageria_lotes", {"empresa_id": f"eq.{empresa_id}", "credor_id": f"eq.{cid}",
                                               "data": f"eq.{dia.isoformat()}", "canal": f"eq.{canal}"}):
            continue                                  # o lote do dia já existe (rodada repetida)
        descad = {d["destino_hash"] for d in sb.selecionar("mensageria_descadastros", {
            "empresa_id": f"eq.{empresa_id}", "canal": f"eq.{canal}"}) or []}
        modelo = None
        if canal == "email":
            modelo = (sb.selecionar("mensageria_modelos_email", {"empresa_id": f"eq.{empresa_id}"}) or [None])[0]
            if modelo:          # única variável: {empresa}; nada do cliente entra no e-mail
                nome = ((sb.selecionar("empresas", {"id": f"eq.{empresa_id}"}) or [{}])[0].get("nome") or "")
                modelo = {k: (v.replace("{empresa}", nome) if isinstance(v, str) else v) for k, v in modelo.items()}
        linhas, locais, vistos = [], {}, set()
        with open(arq, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f, delimiter=";"):
                idc, contato = (r.get("id_cliente") or "").strip(), (r.get("contato") or "").strip()
                if not idc or not contato:
                    continue
                h = hash_destino(canal, contato)
                if h in vistos:
                    continue                          # mesmo destino duas vezes no dia: um envio só
                vistos.add(h)
                texto = (r.get("mensagem") or "").strip() if canal != "email" else (modelo or {}).get("corpo")
                item = canal
                if canal == "rcs":
                    item = ("rcs_single" if len(texto) > LIMITE_RCS_BASIC
                            or (r.get("tipo_rcs") or "").strip().lower() == "single" else "rcs_basic")
                motivo = ("descadastrado" if h in descad else
                          "sem frase no dia" if canal != "email" and not texto else
                          f"frase acima de {LIMITE_SMS} caracteres" if canal == "sms" and len(texto) > LIMITE_SMS else
                          "sem modelo de e-mail" if canal == "email" and not modelo else None)
                linhas.append({"id_cliente": idc[:80], "destino_mascara": mascarar(canal, contato), "destino_hash": h,
                               "situacao": "bloqueada" if motivo else "pendente", "motivo": motivo,
                               **({"item": item} if novo else {})})
                if not motivo:
                    locais[(idc[:80], h)] = {"contato": contato, "texto": texto, "item": item,
                                             "assunto": (modelo or {}).get("assunto"),
                                             "remetente": (modelo or {}).get("remetente_nome")}
        if not linhas:
            continue
        jan = janela(canais_cfg.get(canal), dia)
        bloq = sum(1 for l in linhas if l["situacao"] == "bloqueada")
        situacao, motivo_lote = ("aguardando_aprovacao" if aprovar else "agendado"), None
        if not locais:
            situacao, motivo_lote = "concluido", "nada a enviar: todos bloqueados"
        elif jan is None:
            situacao, motivo_lote = "cancelado", "sem envio hoje (domingo, sábado sem envio ou canal desligado)"
        jan = jan or JANELA_PADRAO
        lote = sb.inserir("mensageria_lotes", [{
            "empresa_id": empresa_id, "credor_id": cid, "data": dia.isoformat(), "canal": canal, "modo": modo,
            "situacao": situacao, "total": len(linhas), "bloqueadas": bloq, "janela_inicio": jan[0],
            "janela_fim": jan[1], "motivo": motivo_lote}], retornar=True)[0]
        gravadas = sb.inserir("mensageria_mensagens", [{**l, "lote_id": lote["id"], "empresa_id": empresa_id}
                                                       for l in linhas], retornar=True)
        _gravar_json(pasta / "mensageria" / f"lote_{lote['id']}.json",
                     {str(m["id"]): locais[(m["id_cliente"], m["destino_hash"])] for m in gravadas
                      if (m["id_cliente"], m["destino_hash"]) in locais})
        out(f"  mensageria: lote {canal.upper()} com {len(linhas)} mensagens ({bloq} bloqueadas) — "
            f"{'aguardando aprovação' if situacao == 'aguardando_aprovacao' else situacao}")
        criados.append(lote)
    return criados


# ------------------------------------------------------------------ 2. enviar
def _pastas(sb, dados: Path, empresa_ids: set) -> dict:
    """{(empresa_id, credor_id 0/id): pasta}"""
    from nuvem.sincronizar import credores
    saida = {}
    for emp in sb.selecionar("empresas", {"id": f"in.({','.join(str(i) for i in sorted(empresa_ids))})"}) or []:
        for u in credores(sb, dados, emp):
            saida[(emp["id"], u["id"] or 0)] = u["pasta"]
    return saida


def _consumo(sb, empresa_id, dia: date, por_item: dict) -> None:
    """Consumo do mês para a fatura (só envio real). rcs_sessao não é cobrado."""
    comp = dia.replace(day=1).isoformat()
    for item, n in por_item.items():
        if not n or item == "rcs_sessao":
            continue
        atual = sb.selecionar("consumo_mensageria", {"empresa_id": f"eq.{empresa_id}", "competencia": f"eq.{comp}",
                                                     "item": f"eq.{item}"}) or [{}]
        sb.inserir("consumo_mensageria", [{"empresa_id": empresa_id, "competencia": comp, "item": item,
                                           "quantidade": int(atual[0].get("quantidade") or 0) + n}],
                   conflito="empresa_id,competencia,item")


def _consumo_fornecedor(sb, empresa_id, dia: date, modo: str, contagem: dict) -> None:
    """Soma no mês o que cada fornecedor fez por item e operadora, com o custo do dia (sem custo cadastrado conta
    à parte; sessão do RCS não custa). contagem: {(fornecedor, operadora, item): n}."""
    comp = dia.replace(day=1).isoformat()
    tabela = {}

    def gravar():
        for (f, op, item), n in contagem.items():
            if item not in tabela:
                tabela[item] = custos(sb, item, dia)
            unit = 0.0 if item == "rcs_sessao" else tabela[item].get(f)
            chave = {"empresa_id": f"eq.{empresa_id}", "competencia": f"eq.{comp}", "item": f"eq.{item}",
                     "fornecedor": f"eq.{f}", "operadora": f"eq.{op}", "modo": f"eq.{modo}"}
            atual = (sb.selecionar("mensageria_consumo_fornecedor", chave) or [{}])[0]
            sb.inserir("mensageria_consumo_fornecedor", [{
                "empresa_id": empresa_id, "competencia": comp, "item": item, "fornecedor": f, "operadora": op,
                "modo": modo, "quantidade": int(atual.get("quantidade") or 0) + n,
                "quantidade_sem_custo": int(atual.get("quantidade_sem_custo") or 0) + (0 if unit is not None else n),
                "custo": round(float(atual.get("custo") or 0) + n * (unit or 0.0), 5)}],
                conflito="empresa_id,competencia,item,fornecedor,operadora,modo")
        return True

    if contagem:
        _tabela_nova(gravar, False)


# ------------------------------------------------------------------ operadora do número (SMS)
def _fornecedor_consulta(sb, modo: str) -> str | None:
    marcados = [f["codigo"] for f in sb.selecionar("mensageria_fornecedores", {"ativo": "eq.true"}) or []
                if f.get("consulta_operadora")]
    if marcados:
        return sorted(marcados)[0]
    return "simulador" if modo == "simulado" else None


def operadoras(sb, pendentes: list[tuple[str, str]], modo: str, agora: datetime) -> tuple[dict, dict]:
    """{hash: operadora} dos números (cache de 30 dias no envio real) e {fornecedor: consultas feitas}.
    Sem fornecedor de consulta no envio real: operadora desconhecida (usa as rotas de "todas")."""
    saida, feitas = {}, {}
    forn = _fornecedor_consulta(sb, modo)
    if modo == "real":
        limite = (agora - timedelta(days=CACHE_OPERADORA_DIAS)).isoformat()
        hashes = sorted({h for h, _ in pendentes})
        for i in range(0, len(hashes), 50):
            for c in sb.selecionar("mensageria_operadoras", {"destino_hash": f"in.({','.join(hashes[i:i + 50])})"}) or []:
                if str(c.get("consultado_em") or "") >= limite:
                    saida[c["destino_hash"]] = c["operadora"]
    consulta = (operadora_simulada if modo == "simulado" else CONSULTAS_REAIS.get(forn)) if forn else None
    novos = []
    for h, contato in pendentes:
        if h in saida or consulta is None:
            continue
        saida[h] = consulta(contato)
        feitas[forn] = feitas.get(forn, 0) + 1
        novos.append({"destino_hash": h, "operadora": saida[h], "consultado_em": agora.isoformat()})
    if novos and modo == "real":
        sb.inserir("mensageria_operadoras", novos, conflito="destino_hash")
    return saida, feitas


def _sessoes_abertas(sb, empresa_id, agora: datetime) -> set:
    return {x["destino_hash"] for x in sb.selecionar("mensageria_sessoes_rcs", {
        "empresa_id": f"eq.{empresa_id}", "fim": f"gt.{agora.isoformat()}"}) or []}


def processar(sb, dados: Path, agora: datetime | None = None, out=print) -> dict:
    """Envia o que estiver no horário. Devolve {lote_id: {enviadas, situacao}}."""
    agora = (agora or datetime.now(SP)).astimezone(SP)
    hoje = agora.date()
    lotes = sb.selecionar("mensageria_lotes", {"situacao": "in.(agendado,enviando)"}, ordem="id.asc") or []
    if not lotes:
        return {}
    novo = banco_novo(sb)
    pastas = _pastas(sb, Path(dados), {l["empresa_id"] for l in lotes})
    resumo = {}
    for lote in lotes:
        lid, eid, canal, modo = lote["id"], lote["empresa_id"], lote["canal"], lote["modo"]
        filtro = {"id": f"eq.{lid}"}
        dia = date.fromisoformat(lote["data"])
        if dia < hoje:
            sb.atualizar("mensageria_lotes", filtro, {"situacao": "cancelado", "concluido_em": agora.isoformat(),
                                                      "motivo": "não enviado no dia (fora da janela)"})
            resumo[lid] = {"enviadas": 0, "situacao": "cancelado"}
            continue
        if dia > hoje or not dentro((lote.get("janela_inicio"), lote.get("janela_fim")), agora) \
                or janela({"sabado": True}, hoje) is None:
            continue
        pasta = pastas.get((eid, lote.get("credor_id") or 0))
        arq = pasta / "mensageria" / f"lote_{lid}.json" if pasta else None
        if not arq or not arq.exists():
            sb.atualizar("mensageria_lotes", filtro, {"situacao": "cancelado", "concluido_em": agora.isoformat(),
                                                      "motivo": "arquivo do lote não encontrado no servidor"})
            resumo[lid] = {"enviadas": 0, "situacao": "cancelado"}
            continue
        locais = json.loads(arq.read_text(encoding="utf-8"))
        plano = plano_rota(sb, eid, canal, modo)
        if not plano:
            sb.atualizar("mensageria_lotes", filtro, {"motivo": f"sem rota ativa para {canal}"})
            continue
        cfg = (sb.selecionar("mensageria_config", {"empresa_id": f"eq.{eid}"}) or [{}])[0]
        conversacional = cfg.get("rcs_agente") == "conversacional"
        descad = {d["destino_hash"] for d in sb.selecionar("mensageria_descadastros", {
            "empresa_id": f"eq.{eid}", "canal": f"eq.{canal}"}) or []}
        pend = sb.selecionar("mensageria_mensagens", {"lote_id": f"eq.{lid}", "situacao": "eq.pendente"},
                             ordem="id.asc", limite=POR_RODADA) or []
        oper, consultas = {}, {}
        if canal == "sms" and novo:
            oper, consultas = operadoras(sb, [(m["destino_hash"], locais[str(m["id"])]["contato"]) for m in pend
                                              if str(m["id"]) in locais and m["destino_hash"] not in descad],
                                         modo, agora)
        sessoes = _sessoes_abertas(sb, eid, agora) if canal == "rcs" else set()
        mudadas, retorno, novos_descad, novas_sessoes = [], [], [], []
        contagem, por_item = {}, {}
        cont = {"enviadas": 0, "entregues": 0, "falhas": 0, "descadastros": 0, "bloqueadas": 0, "respostas": 0}
        motivo_lote, parou = None, False

        def contar(f, op, item, n=1):
            contagem[(f, op or "", item)] = contagem.get((f, op or "", item), 0) + n
            por_item[item] = por_item.get(item, 0) + n

        for f, n in consultas.items():
            contagem[(f, "", "consulta_operadora")] = n
        for m in pend:
            if parou:
                break
            loc = locais.get(str(m["id"]))
            base = {**m, "atualizado_em": agora.isoformat()}
            op = oper.get(m["destino_hash"])
            if m["destino_hash"] in descad or not loc or op == "invalido":
                mudadas.append({**base, "situacao": "bloqueada",
                                "motivo": ("contato não encontrado no servidor" if not loc else
                                           "número inválido (consulta de operadora)" if op == "invalido" else
                                           "descadastrado"),
                                **({"operadora": op} if novo and op else {})})
                cont["bloqueadas"] += 1
                continue
            res, usado, erro = None, None, None
            for f in escolher(plano, f"{lid}:{m['id']}", op):
                try:
                    res = adaptador(f, modo).enviar(canal, loc["contato"], loc["texto"], loc.get("assunto"))
                    usado = f
                    break
                except ErroFornecedor as e:
                    erro = str(e)
            if res is None:                          # todos fora: tenta no próximo minuto
                tent = int(m.get("tentativas") or 0) + 1
                mudadas.append({**base, "tentativas": tent, "motivo": erro[:200],
                                **({"situacao": "falhou"} if tent >= MAX_TENTATIVAS else {})})
                if tent >= MAX_TENTATIVAS:
                    cont["falhas"] += 1
                motivo_lote, parou = f"fornecedores indisponíveis: {erro}"[:300], True
                continue
            item = loc.get("item") or canal
            respondeu = res.respondeu and res.situacao == "entregue"
            if canal == "rcs":
                if m["destino_hash"] in sessoes:
                    item = "rcs_sessao"                       # dentro das 24 h da conversa: sem custo
                elif respondeu and conversacional:
                    item = "rcs_conversacional"               # a resposta transforma o envio em sessão
                    sessoes.add(m["destino_hash"])
                    novas_sessoes.append({"empresa_id": eid, "destino_hash": m["destino_hash"],
                                          "inicio": agora.isoformat(),
                                          "fim": (agora + timedelta(hours=SESSAO_RCS_HORAS)).isoformat()})
                respondeu = respondeu and conversacional
            contar(usado, op, item)
            if canal == "sms" and respondeu:
                contar(usado, op, "sms_resposta")
            mudadas.append({**base, "situacao": res.situacao, "motivo": res.motivo, "fornecedor": usado,
                            "id_externo": res.id_externo, "tentativas": int(m.get("tentativas") or 0) + 1,
                            "enviado_em": agora.isoformat(),
                            **({"item": item, "operadora": op,
                                "respondida_em": agora.isoformat() if respondeu else None} if novo else {})})
            cont["enviadas"] += 1
            cont["respostas"] += int(respondeu)
            cont[{"entregue": "entregues", "falhou": "falhas", "descadastro": "descadastros"}[res.situacao]] += 1
            retorno.append((loc["contato"], res.situacao))
            if res.situacao == "descadastro":
                novos_descad.append({"empresa_id": eid, "canal": canal, "destino_hash": m["destino_hash"],
                                     "destino_mascara": m["destino_mascara"],
                                     "origem": "link" if canal == "email" else "resposta"})
                descad.add(m["destino_hash"])
        if mudadas:
            sb.inserir("mensageria_mensagens", mudadas, conflito="id")
        if novos_descad:
            sb.inserir("mensageria_descadastros", novos_descad, conflito="empresa_id,canal,destino_hash")
        if novas_sessoes:
            sb.inserir("mensageria_sessoes_rcs", novas_sessoes)
        _anotar_retorno(pasta, canal, lid, dia, retorno)
        if modo == "real" and por_item:
            _consumo(sb, eid, dia, por_item)
        _consumo_fornecedor(sb, eid, dia, modo, contagem)
        resta = (len(pend) == POR_RODADA or parou) and sb.selecionar(
            "mensageria_mensagens", {"lote_id": f"eq.{lid}", "situacao": "eq.pendente"}, limite=1)
        situacao = "enviando" if resta else "concluido"
        somar = cont if novo else {k: v for k, v in cont.items() if k != "respostas"}
        sb.atualizar("mensageria_lotes", filtro, {
            **{k: int(lote.get(k) or 0) + v for k, v in somar.items()}, "situacao": situacao,
            "motivo": motivo_lote, "atualizado_em": agora.isoformat(),
            **({"concluido_em": agora.isoformat()} if situacao == "concluido" else {})})
        if cont["enviadas"] or situacao == "concluido":
            out(f"mensageria: lote {lid} ({canal}) +{cont['enviadas']} enviadas — {situacao}")
        resumo[lid] = {**cont, "situacao": situacao}
    return resumo
