"""Retroalimentação do Speech Analytics (SQL 60): o que as ligações ensinam vira recomendação para a estratégia e
para a política do credor, sempre com evidência e nunca aplicada sozinha.

Regras (só agregados de voz_conversao_dia, voz_resultado_por_motivo e da função renitencia_voz; nada por cliente):
  regua        horário (manhã, tarde, noite) com mais acordo × o de menos, por carteira → rascunho de estratégia com a
               trava de horário (travas.horario, motor/travas.py) na janela que converte mais.
  renitencia   depois de "ocupado", tentar de novo em 45 a 90 min × em menos de 30 min (CPC por tentativa) →
               rascunho de estratégia com travas.ligacoes.intervalo_ocupado = 45.
  frases       frase-código que aparece mais nas ligações com acordo do que nas sem acordo → frase nova desligada.
  fluxo        oferta que converte mais × a que converte menos (o Fluxo do agente decide a ordem; sem rascunho
               automático enquanto o Fluxo não está neste banco).
  canal        quem pede WhatsApp × quem não pede (só observação: o motor ainda não tem regra de canal preferido).
  propensao    motivo com pagamento acima da média (modo sombra: o comitê decide com 200 casos ou mais).
Piso de toda regra (decisão 5 do dono): n >= 200 em cada grupo, diferença >= 5 p.p. e nenhum grupo exibido com menos
de 30. O banco repete o piso no check de recomendacoes e cuida dos 90 dias da dispensada
(registrar_recomendacao_voz). "Aplicar" é do site (aplicar_recomendacao) e só cria rascunho.

Impacto (job diário): 28 dias depois de o rascunho entrar em uso (conferir_rascunhos_recomendacoes marca
"aplicada"), mede a mesma métrica no mesmo recorte, 28 dias antes × 28 dias depois, e grava em
recomendacao_impacto. Antes × depois não é teste A/B (a tela avisa).

Relatório ao credor (dia 1 de cada mês): só agregados, grupos de 30 ou mais, nada por cliente nem por operador.
Estimativa de impacto de cada recomendação de política = metade da diferença observada, com faixa de 25% a 75%
(decisão 4 do dono): `estimar_impacto`.

    python3 -m motor.retroalimentacao --empresa 12 [--hoje 2026-11-01] [--relatorio]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

PISO_N = 200            # por grupo
PISO_DIF = 5.0          # pontos percentuais
PISO_GRUPO = 30         # nada exibido com menos que isso
JANELA_DIAS = 28        # antes × depois e janela de leitura das regras
FRACAO_CENTRAL, FRACAO_MIN, FRACAO_MAX = 0.5, 0.25, 0.75

HORARIOS = {"manha": ("08:00", "12:00", "de manhã"), "tarde": ("12:00", "17:00", "à tarde"),
            "noite": ("17:00", "20:00", "à noite")}
# frases-código do agente (codigos_voz_validos ampliado pela VM) → texto sugerido para o rascunho da frase
FRASES = {
    "reconheceu_dificuldade": ("Reconhecer a dificuldade antes da oferta",
                               "Entendo que o momento está difícil. Vamos achar um valor que caiba no seu mês?"),
    "resumiu_acordo": ("Resumir o acordo antes de encerrar",
                       "Antes de desligar, deixa eu repetir o combinado: o valor, a data e por onde pagar."),
    "link_na_ligacao": ("Mandar o link durante a ligação",
                        "Posso te mandar agora o link de pagamento por mensagem, enquanto a gente conversa?"),
    "dia_vencimento": ("Deixar escolher o dia do vencimento",
                       "Qual dia do mês fica melhor para você pagar? Posso colocar o vencimento nesse dia."),
}
MOTIVOS = {"esquecimento": "Esqueceu", "reducao_renda": "Redução de renda", "desemprego": "Desemprego",
           "outras_dividas": "Outras dívidas", "aguardando_recebimento": "Aguardando receber",
           "contestacao": "Contesta a dívida", "nao_reconhece": "Não reconhece", "fraude_alegada": "Alega fraude",
           "insatisfacao_servico": "Insatisfeito com o serviço", "outro": "Outro"}
OBJECOES = {"valor_alto": "Valor alto", "parcela_alta": "Parcela alta", "juros": "Juros",
            "sem_dinheiro_agora": "Sem dinheiro agora", "quer_desconto": "Quer desconto",
            "desconfia_golpe": "Desconfia de golpe", "quer_por_escrito": "Quer por escrito",
            "quer_falar_humano": "Quer falar com uma pessoa", "outro": "Outro"}
SINAIS = {"idade_confusao": "Idade avançada e confusão", "desemprego_recente": "Desemprego recente",
          "saude": "Saúde", "luto": "Luto"}


@dataclass
class Recomendacao:
    destino: str
    regra: str
    chave: str
    titulo: str
    texto: str
    evidencia: dict
    proposta: dict = field(default_factory=dict)
    credor_id: int | None = None

    def para_rpc(self, empresa_id: int) -> dict:
        return {"empresa": empresa_id, "credor": self.credor_id, "destino": self.destino, "regra": self.regra,
                "chave": self.chave, "titulo": self.titulo, "texto": self.texto, "evidencia": self.evidencia,
                "proposta": self.proposta}


# ------------------------------------------------------------------ contas
def pct(parte: float, base: float, casas: int = 1) -> float | None:
    """Percentual com piso de 30 na base (grupo pequeno não aparece)."""
    if base is None or base < PISO_GRUPO:
        return None
    return round(100.0 * (parte or 0) / base, casas)


def comparar(n_a: int, s_a: int, n_b: int, s_b: int, rotulo_a: str, rotulo_b: str, unidade: str) -> dict | None:
    """Evidência A × B se passar no piso (n >= 200 em cada lado, diferença >= 5 p.p., A melhor que B)."""
    if n_a < PISO_N or n_b < PISO_N:
        return None
    pa, pb = 100.0 * s_a / n_a, 100.0 * s_b / n_b
    if pa - pb < PISO_DIF:
        return None
    return {"n_a": int(n_a), "n_b": int(n_b), "pct_a": round(pa, 1), "pct_b": round(pb, 1), "rotulo_a": rotulo_a,
            "rotulo_b": rotulo_b, "unidade": unidade}


def estimar_impacto(base: float, diferenca_pp: float) -> dict:
    """Metade da diferença observada aplicada à base, com faixa de 25% a 75% (decisão 4 do dono). Não é promessa."""
    efeito = max(0.0, float(base)) * max(0.0, float(diferenca_pp)) / 100.0
    return {"centro": round(efeito * FRACAO_CENTRAL), "min": round(efeito * FRACAO_MIN),
            "max": round(efeito * FRACAO_MAX)}


def _br(v: float) -> str:
    return f"{v:.1f}".replace(".", ",")


def _somar(linhas: list[dict], dimensao: str, chave=("credor_id", "valor")) -> dict:
    out: dict = {}
    for r in linhas:
        if r.get("dimensao") != dimensao:
            continue
        k = tuple(r.get(c) or 0 for c in chave) if len(chave) > 1 else r.get(chave[0])
        a = out.setdefault(k, [0, 0])
        a[0] += int(r.get("conversas") or 0)
        a[1] += int(r.get("com_acordo") or 0)
    return out


# ------------------------------------------------------------------ regras
def regra_horario(conversao: list[dict]) -> list[Recomendacao]:
    por = _somar(conversao, "horario")
    credores = {k[0] for k in por}
    recs = []
    for cr in sorted(credores):
        faixas = {k[1]: v for k, v in por.items() if k[0] == cr and k[1] in HORARIOS and v[0] >= PISO_N}
        if len(faixas) < 2:
            continue
        taxa = {f: v[1] / v[0] for f, v in faixas.items()}
        melhor, pior = max(taxa, key=taxa.get), min(taxa, key=taxa.get)
        ev = comparar(*faixas[melhor], *faixas[pior], f"{HORARIOS[melhor][0]}–{HORARIOS[melhor][1]}",
                      f"{HORARIOS[pior][0]}–{HORARIOS[pior][1]}", "% acordo")
        if not ev:
            continue
        de, ate, nome = HORARIOS[melhor]
        recs.append(Recomendacao(
            "regua", "horario", f"regua:horario:{cr}:{melhor}",
            f"Ligar {nome}, entre {de} e {ate}",
            f"Nesta carteira, as ligações {nome} viram acordo {_br(ev['pct_a'])}% das vezes; {HORARIOS[pior][2]}, "
            f"{_br(ev['pct_b'])}%. O rascunho limita a janela de horário da estratégia.",
            ev, {"definicao": {"travas": {"horario": {"ligado": True, "de": de, "ate": ate}}}}, cr or None))
    return recs


def regra_renitencia(renitencia: list[dict]) -> list[Recomendacao]:
    por: dict = {}
    for r in renitencia:
        a = por.setdefault((r.get("credor_id") or 0, r.get("faixa")), [0, 0])
        a[0] += int(r.get("tentativas") or 0)
        a[1] += int(r.get("cpcs") or 0)
    recs = []
    for cr in sorted({k[0] for k in por}):
        cedo, depois = por.get((cr, "ate_30"), [0, 0]), por.get((cr, "45_90"), [0, 0])
        ev = comparar(depois[0], depois[1], cedo[0], cedo[1], "45 a 90 min", "menos de 30 min", "% CPC por tentativa")
        if not ev:
            continue
        recs.append(Recomendacao(
            "renitencia", "intervalo_ocupado", f"renitencia:ocupado:{cr}",
            "Depois de \"ocupado\", esperar 45 min para ligar de novo",
            "Tentar logo depois do ocupado quase nunca atende e gasta a tentativa do dia.",
            ev, {"definicao": {"travas": {"ligacoes": {"ligado": True, "intervalo_ocupado": 45}}}}, cr or None))
    return recs


def regra_frases(conversao: list[dict]) -> list[Recomendacao]:
    tot = _somar(conversao, "total", ("valor",)).get("todas", [0, 0])
    com, sem = tot[1], tot[0] - tot[1]
    recs = []
    for codigo, (c, a) in sorted(_somar(conversao, "frase", ("valor",)).items()):
        if codigo not in FRASES or c < PISO_GRUPO:
            continue
        ev = comparar(com, a, sem, c - a, "nas ligações com acordo", "nas sem acordo", "% das ligações")
        if not ev:
            continue
        titulo, texto = FRASES[codigo]
        recs.append(Recomendacao(
            "frases", "frase_converte", f"frases:{codigo}", titulo,
            "Associação, não causa: por isso vira frase em rascunho para testar, não regra.",
            ev, {"texto": texto, "canal": "agente_voz"}))
    return recs


def regra_ofertas(conversao: list[dict]) -> list[Recomendacao]:
    of = {k: v for k, v in _somar(conversao, "oferta", ("valor",)).items() if v[0] >= PISO_N}
    if len(of) < 2:
        return []
    taxa = {k: v[1] / v[0] for k, v in of.items()}
    melhor, pior = max(taxa, key=taxa.get), min(taxa, key=taxa.get)
    ev = comparar(*of[melhor], *of[pior], f"{melhor.upper()} primeiro", f"{pior.upper()} primeiro", "% acordo")
    if not ev:
        return []
    return [Recomendacao("fluxo", "ordem_ofertas", f"fluxo:ofertas:{melhor}:{pior}",
                         f"Oferecer {melhor.upper()} antes de {pior.upper()}",
                         "A ordem das ofertas fica no Fluxo do agente; a mudança passa pelo teste do fluxo antes de entrar em uso.",
                         ev, {"ofertas": [melhor, pior]})]


def regra_canal(conversao: list[dict]) -> list[Recomendacao]:
    can = _somar(conversao, "canal_preferido", ("valor",))
    wa = can.get("whatsapp", [0, 0])
    resto = [sum(v[0] for k, v in can.items() if k != "whatsapp"), sum(v[1] for k, v in can.items() if k != "whatsapp")]
    ev = comparar(resto[0], resto[1], wa[0], wa[1], "não pediram WhatsApp", "pediram WhatsApp", "% acordo na voz")
    if not ev:
        return []
    return [Recomendacao("canal", "canal_preferido", "canal:whatsapp",
                         "Quem pede WhatsApp converte menos na voz",
                         "Vale levar quem diz \"prefiro WhatsApp\" para o WhatsApp na Orquestração (o código fica só "
                         "até a gravação ser apagada).", ev, {"canal": "whatsapp"})]


def regra_propensao(por_motivo: list[dict]) -> list[Recomendacao]:
    tot = [0, 0]
    mot: dict = {}
    for r in por_motivo:
        m = mot.setdefault(r.get("motivo"), [0, 0])
        m[0] += int(r.get("conversas") or 0)
        m[1] += int(r.get("pagamentos") or 0)
        tot[0] += int(r.get("conversas") or 0)
        tot[1] += int(r.get("pagamentos") or 0)
    recs = []
    for motivo, (c, p) in sorted(mot.items()):
        ev = comparar(c, p, tot[0], tot[1], MOTIVOS.get(motivo, motivo), "média", "% pagou em 30 dias")
        if ev:
            recs.append(Recomendacao(
                "propensao", "motivo_paga", f"propensao:{motivo}",
                f"Observar \"{MOTIVOS.get(motivo, motivo).lower()}\" como variável",
                "Em sombra: não muda a ordem nem o canal de ninguém. O comitê decide com 200 casos ou mais por motivo.",
                ev, {"motivo": motivo}))
    return recs


def gerar(conversao: list[dict], renitencia: list[dict], por_motivo: list[dict]) -> list[Recomendacao]:
    return (regra_horario(conversao) + regra_renitencia(renitencia) + regra_frases(conversao)
            + regra_ofertas(conversao) + regra_canal(conversao) + regra_propensao(por_motivo))


# ------------------------------------------------------------------ impacto (antes × depois, 28 dias)
def medir(antes: tuple[int, int], depois: tuple[int, int]) -> dict | None:
    """(conversas, acordos) antes e depois → percentuais, ou None se algum lado tem menos de 30."""
    a, d = pct(antes[1], antes[0]), pct(depois[1], depois[0])
    if a is None or d is None:
        return None
    return {"antes": a, "depois": d, "n_antes": int(antes[0]), "n_depois": int(depois[0])}


def janela_impacto(aplicada: date) -> tuple[tuple[date, date], tuple[date, date]]:
    return ((aplicada - timedelta(days=JANELA_DIAS), aplicada - timedelta(days=1)),
            (aplicada, aplicada + timedelta(days=JANELA_DIAS - 1)))


# ------------------------------------------------------------------ relatório ao credor
def _item(rotulo: str, n: int, base: int) -> dict | None:
    p = pct(n, base)
    return None if p is None or n < PISO_GRUPO else {"rotulo": rotulo, "n": int(n), "pct": p}


def montar_relatorio(credor: dict, competencia: date, conversao: list[dict], alertas: list[dict],
                     outras: list[dict]) -> dict | None:
    """Conteúdo do relatório (só agregados; o banco recusa qualquer n < 30). `outras` = carteiras da mesma empresa
    com política e conversão, para comparar a parcela mínima. None se a carteira teve menos de 30 conversas."""
    tot = _somar(conversao, "total", ("valor",)).get("todas", [0, 0])
    n, acordos = tot
    if n < PISO_GRUPO:
        return None
    mot = _somar(conversao, "motivo", ("valor",))
    obj = _somar(conversao, "objecao", ("valor",))
    base_mot = sum(v[0] for v in mot.values())
    base_obj = sum(v[0] for v in obj.values())
    motivos = [x for x in (_item(MOTIVOS.get(k, k), v[0], base_mot) for k, v in sorted(mot.items(), key=lambda kv: -kv[1][0])) if x]
    barreiras = [x for x in (_item(OBJECOES.get(k, k), v[0], base_obj) for k, v in sorted(obj.items(), key=lambda kv: -kv[1][0])) if x]
    contest = [x for x in (_item(MOTIVOS[k], mot.get(k, [0])[0], base_mot) for k in ("nao_reconhece", "contestacao", "fraude_alegada")) if x]
    sinais: dict = {}
    for a in alertas:
        if a.get("tipo") == "vulnerabilidade" and a.get("sinal") in SINAIS:
            sinais[a["sinal"]] = sinais.get(a["sinal"], 0) + int(a.get("qtd") or 1)
    vulner = [x for x in (_item(SINAIS[k], v, n) for k, v in sorted(sinais.items(), key=lambda kv: -kv[1])) if x]
    recs = []
    pol = credor.get("politica") or {}
    parcela_alta = obj.get("parcela_alta", [0, 0])
    if pol.get("parcela_minima") is not None and parcela_alta[0] >= PISO_GRUPO:
        menores = [o for o in outras if (o.get("politica") or {}).get("parcela_minima") is not None
                   and o["politica"]["parcela_minima"] < pol["parcela_minima"] and o.get("conversas", 0) >= PISO_N]
        if menores and n >= PISO_N:
            ref = max(menores, key=lambda o: o["acordos"] / o["conversas"])
            pa, pb = 100.0 * ref["acordos"] / ref["conversas"], 100.0 * acordos / n
            if pa - pb >= PISO_DIF:
                minimo = ref["politica"]["parcela_minima"]
                recs.append({"id": "parcela_minima",
                             "titulo": f"Parcela mínima de R$ {minimo:,.0f} também nesta carteira".replace(",", "."),
                             "evidencia": f"{pct(parcela_alta[0], base_obj):.0f}% das objeções são parcela alta. Na carteira com "
                                          f"parcela mínima de R$ {minimo:,.0f}, a conversão foi {pa:.1f}% contra {pb:.1f}%. "
                                          "Carteiras diferentes também diferem em perfil e atraso: a comparação indica, não prova."
                                          .replace(",", "X").replace(".", ",").replace("X", "."),
                             "n": int(parcela_alta[0]), "unidade": "acordos a mais por mês",
                             "estimativa": estimar_impacto(parcela_alta[0], pa - pb)})
    venc = mot.get("aguardando_recebimento", [0, 0])
    if venc[0] >= PISO_N and n - venc[0] >= PISO_N:
        pa, pb = 100.0 * venc[1] / venc[0], 100.0 * (acordos - venc[1]) / (n - venc[0])
        if abs(pa - pb) >= PISO_DIF and not pol.get("dia_vencimento_livre"):
            recs.append({"id": "dia_vencimento", "titulo": "Deixar o devedor escolher o dia do vencimento",
                         "evidencia": f"{pct(venc[0], base_mot):.0f}% esperam receber (salário ou benefício) para pagar."
                                      .replace(".", ","),
                         "n": int(venc[0]), "unidade": "acordos a mais por mês",
                         "estimativa": estimar_impacto(venc[0], abs(pa - pb))})
    return {
        "competencia": competencia.isoformat(),
        "resumo": {"conversas": {"n": int(n)}, "acordo_pct": pct(acordos, n),
                   "principal_barreira": barreiras[0]["rotulo"] if barreiras else None,
                   "principal_barreira_pct": barreiras[0]["pct"] if barreiras else None,
                   "contestam_pct": round(sum(x["pct"] for x in contest), 1) if contest else None},
        "secoes": [
            {"id": "motivos", "titulo": "O que os devedores dizem", "itens": motivos},
            {"id": "barreiras", "titulo": "Barreiras da política", "itens": barreiras},
            {"id": "contestacao", "titulo": "Contestações, cadastro e fraude", "itens": contest},
            {"id": "vulnerabilidade", "titulo": "Vulnerabilidade", "itens": vulner},
        ],
        "recomendacoes": recs,
    }


# ------------------------------------------------------------------ banco (service_role)
def _ler(sb, tabela: str, filtros: dict, limite: int = 50000) -> list[dict]:
    return sb.selecionar(tabela, filtros, limite=limite) or []


def _periodo(de: date, ate: date) -> str:
    return f"(data.gte.{de.isoformat()},data.lte.{ate.isoformat()})"


def publicar_recomendacoes(sb, empresa_id: int, hoje: date) -> int:
    de, ate = hoje - timedelta(days=JANELA_DIAS), hoje - timedelta(days=1)
    conv = _ler(sb, "voz_conversao_dia", {"empresa_id": f"eq.{int(empresa_id)}", "and": _periodo(de, ate)})
    mot = _ler(sb, "voz_resultado_por_motivo", {"empresa_id": f"eq.{int(empresa_id)}", "and": _periodo(de, ate)})
    ren = sb.rpc("renitencia_voz", {"empresa": empresa_id, "de": de.isoformat(), "ate": ate.isoformat()}) or []
    n = 0
    for r in gerar(conv, ren, mot):
        if sb.rpc("registrar_recomendacao_voz", r.para_rpc(empresa_id)) is not None:
            n += 1
    return n


def medir_impactos(sb, empresa_id: int, hoje: date) -> int:
    sb.rpc("conferir_rascunhos_recomendacoes", {})
    aplicadas = _ler(sb, "recomendacoes", {"empresa_id": f"eq.{int(empresa_id)}", "situacao": "eq.aplicada"})
    n = 0
    for rec in aplicadas:
        quando = date.fromisoformat(str(rec.get("aplicada_em"))[:10])
        if (hoje - quando).days < JANELA_DIAS:
            continue                                         # ainda medindo (a tela mostra "dia X de 28")
        (a0, a1), (d0, d1) = janela_impacto(quando)
        filtro = {"empresa_id": f"eq.{int(empresa_id)}", "dimensao": "eq.total"}
        if rec.get("credor_id"):
            filtro["credor_id"] = f"eq.{int(rec['credor_id'])}"
        antes = _ler(sb, "voz_conversao_dia", dict(filtro, **{"and": _periodo(a0, a1)}))
        depois = _ler(sb, "voz_conversao_dia", dict(filtro, **{"and": _periodo(d0, d1)}))
        m = medir((sum(int(x["conversas"]) for x in antes), sum(int(x["com_acordo"]) for x in antes)),
                  (sum(int(x["conversas"]) for x in depois), sum(int(x["com_acordo"]) for x in depois)))
        if m is None:
            continue
        sb.inserir("recomendacao_impacto", [{"rec_id": rec["id"], "metrica": "acordo_pct", **m, "janela_dias": JANELA_DIAS}],
                   conflito="rec_id,metrica")
        n += 1
    return n


def gerar_relatorios(sb, empresa_id: int, competencia: date) -> int:
    """Rascunho do relatório de cada carteira no mês (dia 1: o mês anterior)."""
    ini = competencia.replace(day=1)
    fim = (ini.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    credores = _ler(sb, "credores", {"empresa_id": f"eq.{int(empresa_id)}", "ativo": "eq.true"})
    conv = _ler(sb, "voz_conversao_dia", {"empresa_id": f"eq.{int(empresa_id)}", "and": _periodo(ini, fim)})
    alertas = _ler(sb, "voz_alertas", {"empresa_id": f"eq.{int(empresa_id)}", "tipo": "eq.vulnerabilidade",
                                       "and": f"(criado_em.gte.{ini.isoformat()},criado_em.lt.{(fim + timedelta(days=1)).isoformat()})"})
    resumo = []
    for c in credores:
        linhas = [x for x in conv if x.get("credor_id") == c["id"] and x.get("dimensao") == "total"]
        resumo.append({"id": c["id"], "politica": c.get("politica"), "conversas": sum(int(x["conversas"]) for x in linhas),
                       "acordos": sum(int(x["com_acordo"]) for x in linhas)})
    n = 0
    for c in credores:
        conteudo = montar_relatorio(c, ini, [x for x in conv if x.get("credor_id") == c["id"]],
                                    [{"tipo": a.get("tipo"), "sinal": a.get("sinal")} for a in alertas
                                     if a.get("credor_id") == c["id"]],
                                    [r for r in resumo if r["id"] != c["id"]])
        if conteudo is None:
            continue
        sb.rpc("gravar_relatorio_credor", {"empresa": empresa_id, "credor": c["id"], "competencia": ini.isoformat(),
                                           "conteudo": conteudo})
        n += 1
    return n


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Retroalimentação do Speech Analytics (recomendações, impacto e relatório)")
    ap.add_argument("--empresa", type=int, required=True)
    ap.add_argument("--hoje", type=date.fromisoformat, default=date.today())
    ap.add_argument("--relatorio", action="store_true", help="gera o rascunho do relatório ao credor do mês anterior")
    a = ap.parse_args(argv)
    from nuvem.sincronizar import carregar_config
    from nuvem.supabase_api import Supabase
    sb = Supabase(*carregar_config(Path(os.environ.get("MOTORCOB_DADOS", Path.home() / "MotorCob-dados"))))
    out = {"recomendacoes": publicar_recomendacoes(sb, a.empresa, a.hoje), "impactos": medir_impactos(sb, a.empresa, a.hoje)}
    if a.relatorio:
        out["relatorios"] = gerar_relatorios(sb, a.empresa, (a.hoje.replace(day=1) - timedelta(days=1)).replace(day=1))
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
