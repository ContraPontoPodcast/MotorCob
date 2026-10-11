"""Mensageria: envio dos lotes da Lista do dia (SMS e e-mail) pelos fornecedores das rotas.

Duas etapas:
* criar_lotes (na rodada do dia, por credor): lê saida/<dia>/ids/<canal>.csv (id_cliente;contato[;mensagem]),
  monta um lote por canal e grava no banco SÓ o ID do cliente, o destino mascarado e o hash do destino.
  Contato e texto ficam no servidor: <credor>/mensageria/lote_<id>.json.
* processar (o plantão chama a cada minuto): envia os lotes agendados dentro da janela do canal, pela rota
  (principal e, se ela falhar, a reserva), grava o resultado, o descadastro ("SAIR", link) e o retorno para
  o motor (<credor>/canais_mensageria/<canal>/*.csv → entregue, inexistente, bloqueio).

Modo "simulado" (padrão): nenhum fornecedor é chamado e nada entra no consumo da fatura. O Simulador
responde de forma estável pelo hash do destino (~96% entregue, ~3% inexistente, ~1% descadastro no SMS).
MOTORCOB_SIMULAR_QUEDA=zenvia,... simula fornecedor fora do ar para testar a reserva.
Modo "real" só vale para fornecedor com adaptador em ADAPTADORES_REAIS (entra quando o acesso for liberado).
"""
import csv
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

SP = ZoneInfo("America/Sao_Paulo")
CANAIS = ("sms", "email")
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
        return Resultado("entregue", None, ident)


ADAPTADORES_REAIS: dict = {}     # codigo -> classe com .enviar(); entra quando cada fornecedor liberar o acesso


def adaptador(codigo: str, modo: str):
    if modo == "simulado":
        queda = {c.strip() for c in os.environ.get("MOTORCOB_SIMULAR_QUEDA", "").split(",") if c.strip()}
        return Simulador(codigo, codigo in queda)
    cls = ADAPTADORES_REAIS.get(codigo)
    if cls is None:
        raise ErroFornecedor(f"fornecedor {codigo} ainda sem integração")
    return cls()


def rotas(sb, empresa_id, canal: str, modo: str) -> list[str]:
    """Fornecedores do canal na ordem (principal, reserva…): os da empresa, senão os padrão."""
    ativos = {f["codigo"] for f in sb.selecionar("mensageria_fornecedores", {"ativo": "eq.true"}) or []
              if canal in (f.get("canais") or [])}
    todas = [r for r in sb.selecionar("mensageria_rotas", {"canal": f"eq.{canal}", "ativo": "eq.true"}) or []
             if r["fornecedor"] in ativos]
    da_empresa = [r for r in todas if r.get("empresa_id") == empresa_id]
    escolhidas = da_empresa or [r for r in todas if r.get("empresa_id") is None]
    ordem = [r["fornecedor"] for r in sorted(escolhidas, key=lambda r: r["prioridade"])]
    return ordem or (["simulador"] if modo == "simulado" else [])


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
    liberados = [c for c in CANAIS if c in (mod[0].get("canais") or [])]
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
                texto = (r.get("mensagem") or "").strip() if canal == "sms" else (modelo or {}).get("corpo")
                motivo = ("descadastrado" if h in descad else
                          "sem frase no dia" if canal == "sms" and not texto else
                          "sem modelo de e-mail" if canal == "email" and not modelo else None)
                linhas.append({"id_cliente": idc[:80], "destino_mascara": mascarar(canal, contato), "destino_hash": h,
                               "situacao": "bloqueada" if motivo else "pendente", "motivo": motivo})
                if not motivo:
                    locais[(idc[:80], h)] = {"contato": contato, "texto": texto,
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


def _consumo(sb, empresa_id, dia: date, canal: str, n: int) -> None:
    comp = dia.replace(day=1).isoformat()
    atual = sb.selecionar("consumo_mensageria", {"empresa_id": f"eq.{empresa_id}", "competencia": f"eq.{comp}",
                                                 "item": f"eq.{canal}"}) or [{}]
    sb.inserir("consumo_mensageria", [{"empresa_id": empresa_id, "competencia": comp, "item": canal,
                                       "quantidade": int(atual[0].get("quantidade") or 0) + n}],
               conflito="empresa_id,competencia,item")


def processar(sb, dados: Path, agora: datetime | None = None, out=print) -> dict:
    """Envia o que estiver no horário. Devolve {lote_id: {enviadas, situacao}}."""
    agora = (agora or datetime.now(SP)).astimezone(SP)
    hoje = agora.date()
    lotes = sb.selecionar("mensageria_lotes", {"situacao": "in.(agendado,enviando)"}, ordem="id.asc") or []
    if not lotes:
        return {}
    pastas = _pastas(sb, Path(dados), {l["empresa_id"] for l in lotes})
    resumo = {}
    for lote in lotes:
        lid, eid, canal = lote["id"], lote["empresa_id"], lote["canal"]
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
        ordem = rotas(sb, eid, canal, lote["modo"])
        if not ordem:
            sb.atualizar("mensageria_lotes", filtro, {"motivo": f"sem rota ativa para {canal}"})
            continue
        descad = {d["destino_hash"] for d in sb.selecionar("mensageria_descadastros", {
            "empresa_id": f"eq.{eid}", "canal": f"eq.{canal}"}) or []}
        pend = sb.selecionar("mensageria_mensagens", {"lote_id": f"eq.{lid}", "situacao": "eq.pendente"},
                             ordem="id.asc", limite=POR_RODADA) or []
        mudadas, retorno, novos_descad = [], [], []
        cont = {"enviadas": 0, "entregues": 0, "falhas": 0, "descadastros": 0, "bloqueadas": 0}
        motivo_lote, parou = None, False
        for m in pend:
            if parou:
                break
            loc = locais.get(str(m["id"]))
            base = {**m, "atualizado_em": agora.isoformat()}
            if m["destino_hash"] in descad or not loc:
                mudadas.append({**base, "situacao": "bloqueada",
                                "motivo": "descadastrado" if loc else "contato não encontrado no servidor"})
                cont["bloqueadas"] += 1
                continue
            res, usado, erro = None, None, None
            for f in ordem:
                try:
                    res = adaptador(f, lote["modo"]).enviar(canal, loc["contato"], loc["texto"], loc.get("assunto"))
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
            mudadas.append({**base, "situacao": res.situacao, "motivo": res.motivo, "fornecedor": usado,
                            "id_externo": res.id_externo, "tentativas": int(m.get("tentativas") or 0) + 1,
                            "enviado_em": agora.isoformat()})
            cont["enviadas"] += 1
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
        _anotar_retorno(pasta, canal, lid, dia, retorno)
        if lote["modo"] == "real" and cont["enviadas"]:
            _consumo(sb, eid, dia, canal, cont["enviadas"])
        resta = (len(pend) == POR_RODADA or parou) and sb.selecionar(
            "mensageria_mensagens", {"lote_id": f"eq.{lid}", "situacao": "eq.pendente"}, limite=1)
        situacao = "enviando" if resta else "concluido"
        sb.atualizar("mensageria_lotes", filtro, {
            **{k: int(lote.get(k) or 0) + v for k, v in cont.items()}, "situacao": situacao,
            "motivo": motivo_lote, "atualizado_em": agora.isoformat(),
            **({"concluido_em": agora.isoformat()} if situacao == "concluido" else {})})
        if cont["enviadas"] or situacao == "concluido":
            out(f"mensageria: lote {lid} ({canal}) +{cont['enviadas']} enviadas — {situacao}")
        resumo[lid] = {**cont, "situacao": situacao}
    return resumo
