#!/usr/bin/env python3
"""Carteira DEMO 100% fictícia para mostrar o MotorCX a prospects.

Gera, nos formatos que o motor aceita hoje (layout automático de motor/detectar.py e o layout fixo
empresas/demo-assessoria-exemplo.json), os arquivos de duas carteiras — "Cartões" e "Veículos" — com
histórico de alguns meses, para que a Lista do dia, as personas, a Propensão (A–E) e a Matriz
tenham o que mostrar:

    <saida>/cartoes/1_carga_geral/          carga geral (data do arquivo = início do histórico)
    <saida>/cartoes/2_carga_incremental/    clientes novos (safra recente)
    <saida>/cartoes/3_ocorrencia/           tentativas do histórico com CPC sim/não, por canal
    <saida>/cartoes/4_acordo/               acordos (uma linha por parcela)
    <saida>/cartoes/5_baixa_pagamento/      pagamentos (parcela, quitação e parcial)
    <saida>/cartoes/6_retirada/             contratos devolvidos ao credor
    <saida>/veiculos/...                    o mesmo para Veículos
    <saida>/7_atualizacao_contatos_bureau/  retorno de enriquecimento (vale para as duas carteiras)
    <saida>/LEIA_ARQUIVOS.txt               o que enviar em cada cartão de "Enviar arquivos"

Dados fictícios por construção (nada aqui pode ser de uma pessoa real):
  * Nome:     "Cliente Demo 0001", "Cliente Demo 0002"...
  * CPF:      prefixo 000 + sequência + 1º DÍGITO VERIFICADOR ERRADO de propósito. Nenhum CPF real tem
              DV inválido. O motor aceita a linha (CPF é opcional): motor.normalizacao.cpf devolve None,
              o cliente só não é agrupado com outros IDs pelo CPF; o documento ainda liga o retorno do
              bureau (motor.entrada.documento não confere DV).
  * Celular:  (DDD) 90000-NNNN · Fixo: (DDD) 0000-NNNN. Número local não começa com 0 no Brasil, e a
              faixa 9 0000 não é usada; nada é enviado de qualquer jeito (ver docs/demo/LEIA_DEMO.md).
  * E-mail:   cliente.demo.NNNN@exemplo.invalid (.invalid é reservado pela RFC 2606: nunca entrega).

Só biblioteca padrão. Determinístico: a mesma --seed com a mesma --hoje gera os mesmos bytes.

Uso:
    python3 scripts/demo/gerar_carga_demo.py                       # 2.000 clientes em ./demo_saida/
    python3 scripts/demo/gerar_carga_demo.py --saida ~/Desktop/demo --clientes 3000 --seed 7
    python3 scripts/demo/gerar_carga_demo.py --hoje 2026-11-03 --sobrescrever

Nunca versionar a saída (demo_saida/ está no .gitignore).
"""
import argparse
import csv
import json
import math
import random
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]

# ------------------------------------------------------------------ cabeçalhos (os mesmos do layout fixo)
CAB_CARGA = ["COD_CLIENTE", "CONTRATO", "CPF", "NOME", "SALDO_DEVEDOR", "DT_VENCIMENTO", "DATA_ENTRADA", "PRODUTO",
             "UF", "DATA_NASCIMENTO", "CANAL_VENDA", "TEL1", "WHATS_TEL1", "RCS_TEL1", "TEL2", "WHATS_TEL2", "TEL3", "EMAIL"]
CAB_OCORRENCIA = ["COD_CLIENTE", "DT_ACAO", "CANAL", "OCORRENCIA"]
CAB_ACORDO = ["COD_CLIENTE", "NUM_ACORDO", "PARCELA", "VENCIMENTO", "VALOR"]
CAB_BAIXA = ["COD_CLIENTE", "CONTRATO", "NUM_ACORDO", "PARCELA", "DT_PAGAMENTO", "VALOR_PAGO", "TIPO"]
CAB_RETIRADA = ["CONTRATO", "DT_RETIRADA", "MOTIVO"]
BLOCO_FONE = ["DDD", "FONE", "TIPO-FONE", "RANKING", "SCORE", "POSSUI-WHATSAPP", "POSSUI-RCS", "NAO-PERTURBE"]
FONES_BUREAU = 3
CAB_BUREAU = ["NOME", "CPF/CNPJ"] + BLOCO_FONE * FONES_BUREAU + ["EMAIL-1", "EMAIL-2"]

# códigos de ocorrência (o layout fixo e o automático entendem todos; ver tests/test_kit_demo.py)
CPC, PROMESSA, RECUSA = "CPC", "PROMESSA DE PAGAMENTO", "RECUSA"
NAO_ATENDE, CAIXA_POSTAL, SEM_RESPOSTA = "NAO ATENDE", "CAIXA POSTAL", "ENTREGUE SEM RESPOSTA"
TERCEIRO, INVALIDO, OPT_OUT = "TERCEIRO", "NUMERO INVALIDO", "OPT OUT"
CANAL_CODIGO = {"whatsapp": "WHATSAPP", "rcs": "RCS", "sms": "SMS", "email": "EMAIL",
                "agente_voz": "AGENTE VIRTUAL", "discador": "DISCADOR"}
VOZ = ("discador", "agente_voz")

# ------------------------------------------------------------------ geografia (DDD reais, números fictícios)
DDDS = {"SP": (11, 12, 13, 14, 15, 16, 17, 18, 19), "RJ": (21, 22, 24), "MG": (31, 32, 33, 34, 35, 37, 38),
        "BA": (71, 73, 74, 75, 77), "PE": (81, 87), "CE": (85, 88), "RS": (51, 53, 54, 55),
        "PR": (41, 42, 43, 44, 45, 46), "SC": (47, 48, 49), "GO": (62, 64), "DF": (61,), "PA": (91, 93, 94),
        "AM": (92, 97), "MA": (98, 99), "ES": (27, 28)}
PESO_UF = {"SP": 30, "RJ": 11, "MG": 11, "BA": 7, "PE": 5, "CE": 5, "RS": 6, "PR": 6, "SC": 4, "GO": 4,
           "DF": 3, "PA": 3, "AM": 2, "MA": 2, "ES": 2}
NORDESTE_NORTE = {"BA", "PE", "CE", "MA", "PA", "AM"}

CARTEIRAS = (
    {"pasta": "cartoes", "nome": "Cartões", "prefixo": "CRT", "fracao": 0.55,
     "produtos": (("CARTAO_CLASSICO", 50), ("CARTAO_GOLD", 35), ("CARTAO_PLATINUM", 15)),
     "saldo_mediana": 1800.0, "saldo_sigma": 0.95, "saldo_min": 120.0, "saldo_max": 45000.0,
     "atraso": (5, 220), "dois_contratos": 0.18, "parcelas": (1, 6), "p_acordo": 0.09},
    {"pasta": "veiculos", "nome": "Veículos", "prefixo": "VEI", "fracao": 0.45,
     "produtos": (("LEVE", 62), ("MOTO", 25), ("PESADO", 13)),
     "saldo_mediana": 16000.0, "saldo_sigma": 0.7, "saldo_min": 1500.0, "saldo_max": 160000.0,
     "atraso": (15, 330), "dois_contratos": 0.06, "parcelas": (3, 12), "p_acordo": 0.07},
)
CANAIS_VENDA = (("APP", 45), ("LOJA", 35), ("CORRESPONDENTE", 20))
MOTIVOS_RETIRADA = (("devolução", 60), ("judicial", 25), ("óbito", 15))

# taxa de CPC por tentativa (antes dos multiplicadores): o que as personas vão descobrir
BASE_CPC = {"whatsapp": 0.15, "rcs": 0.08, "agente_voz": 0.07, "discador": 0.10, "sms": 0.04, "email": 0.015}
PESO_CANAL = {"whatsapp": 30, "sms": 18, "discador": 22, "agente_voz": 14, "rcs": 10, "email": 6}


# ------------------------------------------------------------------ CPF fictício (DV inválido de propósito)
def _dv_cpf(base9: str) -> str:
    base = base9
    for n in (9, 10):
        soma = sum(int(d) * p for d, p in zip(base, range(n + 1, 1, -1)))
        base += str((soma * 10 % 11) % 10)
    return base[-2:]


def cpf_ficticio(n: int) -> str:
    """000 + sequência de 6 dígitos + DV com o 1º dígito trocado: nunca é um CPF válido."""
    base = f"000{n:06d}"
    dv = _dv_cpf(base)
    return base + str((int(dv[0]) + 1) % 10) + dv[1]


def cpf_valido(d: str) -> bool:
    d = "".join(c for c in d if c.isdigit()).zfill(11)
    return len(d) == 11 and len(set(d)) > 1 and _dv_cpf(d[:9]) == d[9:]


# ------------------------------------------------------------------ telefones fictícios
class Telefones:
    """Celular (DDD) 90000-NNNN e fixo (DDD) 0000-NNNN, sem repetir. 10 mil de cada por DDD."""

    def __init__(self):
        self.prox = {}

    def novo(self, uf: str, ddd: int, celular: bool = True) -> str:
        opcoes = [ddd] + [d for d in DDDS[uf] if d != ddd]
        for d in opcoes:
            n = self.prox.get((d, celular), 0)
            if n <= 9999:
                self.prox[(d, celular)] = n + 1
                return f"{d}90000{n:04d}" if celular else f"{d}0000{n:04d}"
        raise ValueError(f"faixa fictícia esgotada para {uf}: diminua --clientes")


def formatar(tel: str) -> str:
    ddd, num = tel[:2], tel[2:]
    return f"({ddd}) {num[:-4]}-{num[-4:]}"


def _br(v: float) -> str:
    return f"{v:.2f}".replace(".", ",")


def _d(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _escolher(rng: random.Random, pares):
    total = sum(p for _, p in pares)
    x = rng.uniform(0, total)
    for valor, peso in pares:
        x -= peso
        if x <= 0:
            return valor
    return pares[-1][0]


def _feriados() -> set:
    try:
        dados = json.loads((RAIZ / "regras" / "regua.json").read_text(encoding="utf-8"))
        return {date.fromisoformat(d) for d in dados["janela"]["feriados"]}
    except (OSError, KeyError, ValueError):
        return set()


# ------------------------------------------------------------------ cliente
class Cliente:
    __slots__ = ("idc", "seq", "cart", "cpf", "uf", "ddd", "idade", "produto", "canal_venda", "contratos",
                 "atraso_entrada", "entrada", "incremental", "fones", "email", "alcance", "saldo", "nascimento")


def _novo_cliente(rng, cart, seq, num_carteira, entrada, incremental, tels):
    c = Cliente()
    c.seq, c.cart, c.incremental, c.entrada = seq, cart, incremental, entrada
    c.idc = f"{cart['prefixo']}{num_carteira:05d}"
    c.cpf = cpf_ficticio(seq)
    c.uf = _escolher(rng, list(PESO_UF.items()))
    c.ddd = rng.choice(DDDS[c.uf])
    c.idade = max(19, min(84, int(rng.gauss(44, 14))))
    c.nascimento = date(entrada.year - c.idade, 1, 1) + timedelta(days=rng.randint(0, 364))
    c.produto = _escolher(rng, cart["produtos"])
    c.canal_venda = _escolher(rng, CANAIS_VENDA)
    n_ct = 2 if rng.random() < cart["dois_contratos"] else 1
    total = min(cart["saldo_max"], max(cart["saldo_min"],
                                       rng.lognormvariate(math.log(cart["saldo_mediana"]), cart["saldo_sigma"])))
    if c.produto in ("PESADO", "CARTAO_PLATINUM"):
        total = min(cart["saldo_max"], total * 1.8)
    partes = [1.0] if n_ct == 1 else [0.7, 0.3]
    c.contratos = [(f"CT-{c.idc}-{i + 1}", round(total * p, 2)) for i, p in enumerate(partes)]
    c.saldo = sum(v for _, v in c.contratos)
    lo, hi = cart["atraso"]
    c.atraso_entrada = int(lo + (hi - lo) * rng.random() ** 1.6)
    # contatos: celular quase sempre; 2º celular e fixo às vezes; WhatsApp mais comum entre os jovens
    jovem = c.idade < 40
    c.fones = []
    if rng.random() < 0.93:
        c.fones.append((tels.novo(c.uf, c.ddd), True, rng.random() < (0.78 if jovem else 0.5),
                        rng.random() < 0.35))
    if rng.random() < 0.45:
        c.fones.append((tels.novo(c.uf, c.ddd), True, rng.random() < 0.3, False))
    if rng.random() < (0.25 if jovem else 0.55) or not c.fones:
        c.fones.append((tels.novo(c.uf, c.ddd, celular=False), False, False, False))
    c.email = f"cliente.demo.{seq:04d}@exemplo.invalid" if rng.random() < (0.7 if jovem else 0.4) else ""
    # alcançabilidade latente: uns respondem, outros quase nunca
    c.alcance = 0.12 if rng.random() < 0.12 else rng.uniform(0.5, 1.6)
    return c


def _taxa_cpc(c: Cliente, canal: str, dia: date) -> float:
    p = BASE_CPC[canal] * c.alcance
    if c.idade < 35:
        p *= {"whatsapp": 1.7, "email": 1.6, "rcs": 1.2, "discador": 0.55, "agente_voz": 0.7}.get(canal, 1.0)
    elif c.idade >= 55:
        p *= {"whatsapp": 0.45, "email": 0.5, "discador": 1.75, "agente_voz": 1.35, "sms": 1.25}.get(canal, 1.0)
    if c.saldo >= 5000 and canal == "discador":
        p *= 1.4
    if c.saldo < 1000 and canal in ("whatsapp", "sms"):
        p *= 1.2
    if c.uf in NORDESTE_NORTE and canal == "whatsapp":
        p *= 1.25
    if c.uf == "SP" and canal == "rcs":
        p *= 1.3
    atraso = c.atraso_entrada + (dia - c.entrada).days
    if atraso > 180:
        p *= 0.8
    return min(p, 0.6)


def _fator_pagar(c: Cliente, cart: dict, dia: date) -> float:
    """Quem paga: atraso menor e saldo menor pagam mais (é o que a Propensão vai aprender)."""
    atraso = c.atraso_entrada + (dia - c.entrada).days
    f = 1.9 if atraso <= 60 else 1.2 if atraso <= 120 else 0.75 if atraso <= 240 else 0.4
    if c.saldo < 0.6 * cart["saldo_mediana"]:
        f *= 1.5
    elif c.saldo > 2 * cart["saldo_mediana"]:
        f *= 0.6
    return f


def _canais(c: Cliente) -> list:
    cel = [f for f in c.fones if f[1]]
    saida = []
    if cel:
        saida += ["whatsapp", "sms"]
        if any(f[3] for f in cel):
            saida.append("rcs")
    if c.fones:
        saida += ["discador", "agente_voz"]
    if c.email:
        saida.append("email")
    return saida


# ------------------------------------------------------------------ geração
def gerar(saida, clientes: int = 2000, seed: int = 20261031, hoje: date | None = None,
          dias_historico: int = 120, sobrescrever: bool = False) -> dict:
    """Escreve os arquivos em `saida` e devolve um resumo. Ver o docstring do módulo."""
    hoje = hoje or date.today()
    if clientes < 20 or clientes > 20000:
        raise ValueError("--clientes deve ficar entre 20 e 20000")
    if dias_historico < 45 or dias_historico > 170:
        raise ValueError("--dias-historico deve ficar entre 45 e 170")
    saida = Path(saida).expanduser()
    nossos = [saida / c["pasta"] for c in CARTEIRAS] + [saida / "7_atualizacao_contatos_bureau",
                                                        saida / "LEIA_ARQUIVOS.txt"]
    if any(p.exists() for p in nossos):
        if not sobrescrever:
            raise FileExistsError(f"{saida} já tem uma carga demo. Use --sobrescrever ou outra --saida.")
        for p in nossos:
            if p.is_dir():
                shutil.rmtree(p)
            elif p.exists():
                p.unlink()
    rng = random.Random(seed)
    feriados = _feriados()
    tels = Telefones()
    inicio = hoje - timedelta(days=dias_historico)       # data da carga geral (início do histórico)
    data_inc = hoje - timedelta(days=10)                 # carga incremental (safra recente)
    ontem = hoje - timedelta(days=1)
    resumo = {"hoje": hoje.isoformat(), "seed": seed, "carteiras": {}}
    bureau = []
    seq = 0
    for cart in CARTEIRAS:
        n_cart = round(clientes * cart["fracao"]) if cart is CARTEIRAS[0] else clientes - seq
        n_inc = max(2, round(n_cart * 0.08))
        lista = []
        for k in range(n_cart):
            seq += 1
            incremental = k >= n_cart - n_inc
            entrada = data_inc if incremental else inicio - timedelta(days=_escolher(rng, ((60, 3), (30, 3), (0, 4))))
            lista.append(_novo_cliente(rng, cart, seq, k + 1, entrada, incremental, tels))
        res = _gerar_carteira(rng, cart, lista, saida / cart["pasta"], inicio, data_inc, ontem, feriados)
        resumo["carteiras"][cart["nome"]] = res
        bureau += [c for c in lista if rng.random() < 0.3]
    _gravar_bureau(rng, bureau, saida / "7_atualizacao_contatos_bureau" / f"atualizacao_contatos_{ontem}.csv", tels)
    resumo["bureau"] = len(bureau)
    _gravar_leia(saida / "LEIA_ARQUIVOS.txt", resumo, inicio, data_inc, ontem)
    return resumo


def _gerar_carteira(rng, cart, lista, pasta, inicio, data_inc, ontem, feriados) -> dict:
    ocorrencias, acordos, baixas, retiradas = [], [], [], []
    n_acordo = n_quit = n_ret = 0
    geral = [c for c in lista if not c.incremental]
    sai = {c.idc for c in rng.sample(geral, max(1, round(len(geral) * 0.015)))}   # devolvidos ao credor
    for c in lista:
        comeco = max(c.entrada, inicio) + timedelta(days=1)
        retirada_em = ontem - timedelta(days=rng.randint(1, 30)) if c.idc in sai else None
        pausa_ate, fim = None, ontem
        teve_acordo = False
        dia = comeco
        while dia <= fim:
            if retirada_em and dia >= retirada_em:
                break
            if dia.weekday() == 6 or dia in feriados or (pausa_ate and dia <= pausa_ate):
                dia += timedelta(days=1)
                continue
            if rng.random() >= (0.15 if dia.weekday() == 5 else 0.3):
                dia += timedelta(days=1)
                continue
            canal = _escolher(rng, [(k, PESO_CANAL[k]) for k in _canais(c)])
            hora = f"{rng.randint(8, 13 if dia.weekday() == 5 else 19):02d}:{rng.randint(0, 59):02d}"
            if rng.random() < _taxa_cpc(c, canal, dia):
                p_acordo = 0.0 if retirada_em else cart["p_acordo"] * _fator_pagar(c, cart, dia)
                r = rng.random()
                if not teve_acordo and r < p_acordo:
                    ocorrencias.append((dia, hora, c.idc, canal, PROMESSA))
                    teve_acordo, n_acordo = True, n_acordo + 1
                    fim_acordo = _acordo(rng, cart, c, dia, ontem, acordos, baixas)
                    if fim_acordo is None:
                        break                                  # pagando: sai das ações massivas
                    pausa_ate = fim_acordo                     # quebrou: volta a ser acionado depois
                elif r < p_acordo * 1.3 and dia + timedelta(days=6) <= ontem:
                    ocorrencias.append((dia, hora, c.idc, canal, PROMESSA))
                    pago = dia + timedelta(days=rng.randint(1, 6))
                    for ct, valor in c.contratos:
                        baixas.append((pago, c.idc, ct, "", "", valor, "QUITACAO"))
                    n_quit += 1
                    break
                elif r < p_acordo * 1.3 + 0.02 and not retirada_em:
                    ocorrencias.append((dia, hora, c.idc, canal, CPC))
                    pago = min(ontem, dia + timedelta(days=rng.randint(0, 4)))
                    ct, valor = c.contratos[0]
                    baixas.append((pago, c.idc, ct, "", "", round(valor * rng.uniform(0.1, 0.3), 2), "PARCIAL"))
                else:
                    ocorrencias.append((dia, hora, c.idc, canal, RECUSA if rng.random() < 0.25 else CPC))
            else:
                x = rng.random()
                if x < 0.003 and canal != "rcs":            # RCS não tem opt-out na taxonomia
                    ocorrencias.append((dia, hora, c.idc, canal, OPT_OUT))
                    break
                if canal in VOZ:
                    cod = TERCEIRO if x < 0.06 else INVALIDO if x < 0.10 else NAO_ATENDE if x < 0.70 else CAIXA_POSTAL
                else:
                    cod = INVALIDO if x < 0.04 else TERCEIRO if x < 0.048 else SEM_RESPOSTA   # < 2%: sem freio do WA
                ocorrencias.append((dia, hora, c.idc, canal, cod))
            dia += timedelta(days=1)
        if retirada_em:
            motivo = _escolher(rng, MOTIVOS_RETIRADA)
            retiradas += [(ct, retirada_em, motivo) for ct, _ in c.contratos]
            n_ret += 1

    pasta, nome = Path(pasta), cart["pasta"]
    inc = [c for c in lista if c.incremental]
    _gravar_carga(pasta / "1_carga_geral" / f"carga_geral_{nome}_{inicio}.csv", geral)
    _gravar_carga(pasta / "2_carga_incremental" / f"carga_incremental_{nome}_{data_inc}.csv", inc)
    _csv(pasta / "3_ocorrencia" / f"ocorrencias_{nome}_{ontem}.csv", CAB_OCORRENCIA,
         [(idc, f"{_d(d)} {h}", CANAL_CODIGO[canal], cod) for d, h, idc, canal, cod in sorted(ocorrencias)])
    _csv(pasta / "4_acordo" / f"acordos_{nome}_{ontem}.csv", CAB_ACORDO,
         [(idc, ida, n, _d(v), _br(valor)) for idc, ida, n, v, valor in acordos])
    _csv(pasta / "5_baixa_pagamento" / f"baixas_{nome}_{ontem}.csv", CAB_BAIXA,
         [(idc, ct, ida, n, _d(d), _br(v), t) for d, idc, ct, ida, n, v, t in sorted(baixas, key=lambda b: b[:2])])
    _csv(pasta / "6_retirada" / f"retiradas_{nome}_{ontem}.csv", CAB_RETIRADA,
         [(ct, _d(d), m) for ct, d, m in retiradas])
    return {"clientes": len(lista), "carga_geral": len(geral), "incremental": len(inc),
            "ocorrencias": len(ocorrencias), "acordos": n_acordo, "parcelas": len(acordos),
            "baixas": len(baixas), "quitacoes": n_quit, "retirados": n_ret}


def _acordo(rng, cart, c, dia, ontem, acordos, baixas):
    """Acordo fechado em `dia`. Devolve None se o cliente segue pagando, ou a data em que volta às ações."""
    ida = f"AC-{c.idc}-{dia:%y%m%d}"
    lo, hi = cart["parcelas"]
    n = rng.randint(lo, hi)
    total = c.saldo * rng.uniform(0.55, 0.9)
    valor = round(total / n, 2)
    v1 = dia + timedelta(days=rng.randint(3, 10))
    vencs = [v1 + timedelta(days=30 * i) for i in range(n)]
    for i, v in enumerate(vencs):
        acordos.append((c.idc, ida, i + 1, v, valor))
    perfil = _escolher(rng, (("em_dia", 50), ("atrasa_1a", 22), ("nao_paga", 28)))
    if perfil == "nao_paga":
        return v1 + timedelta(days=7)                    # quebra: volta ao estoque no D+6
    para_em = rng.randint(2, n + 2) if rng.random() < 0.15 else n + 1   # alguns param no meio
    for i, v in enumerate(vencs, start=1):
        if i >= para_em:
            return v + timedelta(days=7) if v + timedelta(days=7) <= ontem else None
        pago = v + timedelta(days=rng.randint(3, 20)) if (i == 1 and perfil == "atrasa_1a") \
            else v - timedelta(days=rng.randint(0, 3))
        if pago > ontem:
            break
        baixas.append((pago, c.idc, c.contratos[0][0], ida, i, valor, "PARCELA"))
    return None


# ------------------------------------------------------------------ gravação
def _csv(caminho: Path, cab, linhas):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";", lineterminator="\n")
        w.writerow(cab)
        w.writerows(linhas)


def _gravar_carga(caminho: Path, lista):
    linhas = []
    for c in lista:
        cel = [f for f in c.fones if f[1]]
        fixo = next((f for f in c.fones if not f[1]), None)
        t1 = cel[0] if cel else None
        t2 = cel[1] if len(cel) > 1 else None
        for ct, saldo in c.contratos:
            linhas.append([
                c.idc, ct, f"{c.cpf[:3]}.{c.cpf[3:6]}.{c.cpf[6:9]}-{c.cpf[9:]}", f"Cliente Demo {c.seq:04d}",
                _br(saldo), _d(c.entrada - timedelta(days=c.atraso_entrada)), _d(c.entrada), c.produto, c.uf,
                _d(c.nascimento), c.canal_venda,
                formatar(t1[0]) if t1 else "", ("S" if t1[2] else "N") if t1 else "",
                ("S" if t1[3] else "N") if t1 else "",
                formatar(t2[0]) if t2 else "", ("S" if t2[2] else "N") if t2 else "",
                formatar(fixo[0]) if fixo else "", c.email])
    _csv(caminho, CAB_CARGA, linhas)


def _gravar_bureau(rng, lista, caminho: Path, tels: Telefones):
    linhas = []
    for c in sorted(lista, key=lambda c: c.seq):
        blocos = []
        conhecidos = [f for f in c.fones if f[1]][:1]
        for f in conhecidos:                                   # confirma o celular que já existe
            blocos.append((f[0], True, 1, 4 + rng.randint(0, 1), int(f[2] or rng.random() < 0.3), int(f[3])))
        for k in range(rng.randint(1, FONES_BUREAU - len(blocos))):   # e traz números novos
            novo = tels.novo(c.uf, c.ddd, celular=rng.random() < 0.8)
            blocos.append((novo, novo[2] == "9", len(blocos) + 1, rng.randint(1, 5),
                           int(novo[2] == "9" and rng.random() < 0.6), int(novo[2] == "9" and rng.random() < 0.3)))
        linha = [f"Cliente Demo {c.seq:04d}", c.cpf]
        for tel, cel, rank, score, wa, rcs in blocos:
            linha += [tel[:2], tel[2:], "Celular" if cel else "Fixo", rank, score, wa, rcs,
                      int(rng.random() < 0.05)]
        linha += [""] * (len(BLOCO_FONE) * (FONES_BUREAU - len(blocos)))
        linha += [f"bureau.demo.{c.seq:04d}@exemplo.invalid" if rng.random() < 0.35 else "", ""]
        linhas.append(linha)
    _csv(caminho, CAB_BUREAU, linhas)


def _gravar_leia(caminho: Path, resumo: dict, inicio: date, data_inc: date, ontem: date):
    linhas = [
        "CARGA DEMO — DADOS 100% FICTÍCIOS (MotorCX)",
        f"Gerada para o dia {date.fromisoformat(resumo['hoje']):%d/%m/%Y} · seed {resumo['seed']}",
        "",
        "Envie em Enviar arquivos, escolhendo a carteira certa em cada envio, nesta ordem:",
        "  PASSO 1 (por carteira): 1_carga_geral → cartão 'Carga geral'; 2_carga_incremental → 'Carga incremental'.",
        "          Espere o envio ficar 'processado' antes do passo 2.",
        "  PASSO 2 (por carteira): 3_ocorrencia → 'Ocorrência'; 4_acordo → 'Acordo';",
        "          5_baixa_pagamento → 'Baixa / pagamento'; 6_retirada → 'Retirada'.",
        "  PASSO 3 (uma vez, sem carteira): 7_atualizacao_contatos_bureau → 'Atualização de contatos (bureau)'.",
        "",
        f"Histórico: carga geral de {inicio:%d/%m/%Y}, incremental de {data_inc:%d/%m/%Y}, "
        f"ocorrências/acordos/baixas até {ontem:%d/%m/%Y}.",
        "",
    ]
    for nome, r in resumo["carteiras"].items():
        linhas.append(f"{nome}: {r['clientes']} clientes ({r['carga_geral']} na geral + {r['incremental']} na "
                      f"incremental), {r['ocorrencias']} ocorrências, {r['acordos']} acordos ({r['parcelas']} "
                      f"parcelas), {r['baixas']} baixas, {r['quitacoes']} quitações, {r['retirados']} retirados.")
    linhas += [f"Bureau: {resumo['bureau']} clientes com contatos atualizados.", "",
               "Nomes 'Cliente Demo NNNN', CPF com dígito verificador inválido (prefixo 000), celulares (DDD) 90000-NNNN,",
               "fixos (DDD) 0000-NNNN e e-mails @exemplo.invalid. Nada disso pertence a uma pessoa real.",
               "Passo a passo completo: docs/demo/LEIA_DEMO.md. Não versione esta pasta."]
    caminho.write_text("\n".join(linhas) + "\n", encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Gera a carteira demo fictícia do MotorCX (Cartões e Veículos).")
    ap.add_argument("--saida", default="demo_saida", help="pasta de saída (padrão: ./demo_saida)")
    ap.add_argument("--clientes", type=int, default=2000, help="total de clientes nas duas carteiras (padrão 2000)")
    ap.add_argument("--seed", type=int, default=20261031, help="semente: mesma seed + mesma data = mesmos arquivos")
    ap.add_argument("--hoje", type=date.fromisoformat, default=None,
                    help="dia da demo (AAAA-MM-DD; padrão: hoje). O histórico termina na véspera.")
    ap.add_argument("--dias-historico", type=int, default=120, help="dias de histórico antes de --hoje (45 a 170)")
    ap.add_argument("--sobrescrever", action="store_true", help="apaga a carga demo anterior da pasta de saída")
    a = ap.parse_args(argv)
    try:
        r = gerar(a.saida, a.clientes, a.seed, a.hoje, a.dias_historico, a.sobrescrever)
    except (ValueError, FileExistsError) as ex:
        print(f"erro: {ex}", file=sys.stderr)
        return 2
    print((Path(a.saida).expanduser() / "LEIA_ARQUIVOS.txt").read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
