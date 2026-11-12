"""Ofertas prontas do arquivo (mailing) para o agente de voz (SQL 130; SPEC_OFERTAS_v2).

O MotorCX NÃO calcula oferta: lê as colunas `oferta1..3_*` que o cliente apontou no mapeamento da carga e guarda os
números como vieram. Campos (o mesmo contrato da API, SPEC §4):

    oferta{n}_id (opcional; sem ele vira "arq-<n>"), _parcelas, _valor_parcela, _desconto (só em %, Q11), _entrada,
    _validade, _valor_total, _vencimento

Obrigatórios: parcelas, valor_parcela e validade. Número em pt-BR ("1.500,50", "R$ 1.200,00") ou com ponto decimal;
data em DD/MM/AAAA, AAAA-MM-DD ou DD-MM-AAAA (o formato do layout primeiro).

A oferta é DESCARTADA, nunca corrigida (SPEC §6), quando:
  incompleta    falta parcelas, valor da parcela ou validade, ou um campo não é número/data (desconto com "R$" ou
                acima de 100 também);
  vencida       validade anterior ao dia da carga (a validade igual ao dia vale; a VM confere de novo no dia da ligação);
  conta         com o total: entrada + parcelas × valor da parcela difere dele em mais de 1% E de R$ 0,05.
A alçada não é aplicada aqui (pode mudar depois da rotina): quem descarta acima dela é a VM, na hora da ligação.

Vários contratos do mesmo cliente com oferta: vale o do contrato da ligação; sem ele, o de maior saldo (`principal`),
e o relatório conta o caso (Q12). Uma carga geral nova troca todas as ofertas (as incrementais da mesma rodada
sobrescrevem o contrato que trouxerem).

Saída local: `base/ofertas.csv` (id_cliente;contrato;principal;ofertas em JSON), reescrito a cada carga, só com quem
está na carga. Nada disso é dado pessoal, mas as colunas nunca viram atributo, prévia ou saída. Só biblioteca padrão.
"""
from __future__ import annotations

import csv
import json
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

CAMPOS = ("id", "parcelas", "valor_parcela", "desconto", "entrada", "validade", "valor_total", "vencimento")
OBRIGATORIOS = ("parcelas", "valor_parcela", "validade")
MAX_OFERTAS = 3
ARQUIVO = "ofertas.csv"
FORMATOS_DATA = ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%d.%m.%Y", "%Y%m%d")
RE_ID = re.compile(r"^[A-Za-z0-9_.\-]{1,40}$")
MOTIVOS = ("incompleta", "vencida", "conta")


def chave(n: int, campo: str) -> str:
    """Nome do campo no mapeamento da carga: oferta1_parcelas, oferta3_validade…"""
    return f"oferta{n}_{campo}"


CHAVES = tuple(chave(n, c) for n in range(1, MAX_OFERTAS + 1) for c in CAMPOS)


# ------------------------------------------------------------------ leitura dos valores (sem corrigir nada)
def numero(texto) -> float | None:
    """'1.500,50' · '1500,50' · '1500.50' · 'R$ 1.200,00' · '40%' → float. Vazio ou outra coisa: None."""
    if texto is None:
        return None
    t = str(texto).strip().replace("R$", "").replace("%", "").replace(" ", "").replace(" ", "")
    if not t:
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    elif t.count(".") > 1:
        t = t.replace(".", "")
    try:
        v = float(t)
    except ValueError:
        return None
    return v if v == v and v not in (float("inf"), float("-inf")) else None


def data(texto, formato: str | None = None) -> date | None:
    v = (str(texto or "")).strip()
    if not v:
        return None
    for f in ((formato,) if formato else ()) + FORMATOS_DATA:
        for tentativa in (v, v.split(" ")[0], v.split("T")[0]):
            try:
                return datetime.strptime(tentativa, f).date()
            except ValueError:
                continue
    return None


def conta_fecha(o: dict) -> bool:
    """Sem total: não há o que conferir. Com ele: entrada + parcelas × parcela ≈ total (1% ou R$ 0,05)."""
    tot = o.get("valor_total")
    if tot is None:
        return True
    calc = float(o.get("entrada") or 0) + int(o["parcelas"]) * float(o["valor_parcela"])
    dif = abs(calc - float(tot))
    return not (dif > 0.05 and dif > abs(float(tot)) * 0.01)


def oferta(valores: dict, n: int, formato: str | None = None) -> tuple[dict | None, str | None]:
    """{campo: texto} da oferta n de uma linha → (oferta no contrato da API, None) ou (None, motivo) ou (None, None)
    quando a linha não traz nada dessa oferta."""
    bruto = {c: (str(valores.get(c) or "")).strip() for c in CAMPOS}
    if not any(bruto.values()):
        return None, None
    if any(not bruto[c] for c in OBRIGATORIOS):
        return None, "incompleta"
    o: dict = {"id": bruto["id"] or f"arq-{n}"}
    if not RE_ID.match(o["id"]):
        return None, "incompleta"
    parc = numero(bruto["parcelas"])
    vp = numero(bruto["valor_parcela"])
    val = data(bruto["validade"], formato)
    if parc is None or parc != int(parc) or not 1 <= parc <= 120 or vp is None or vp <= 0 or val is None:
        return None, "incompleta"
    o.update(parcelas=int(parc), valor_parcela=round(vp, 2), validade=val.isoformat())
    if bruto["desconto"]:
        d = numero(bruto["desconto"])
        if "R$" in bruto["desconto"].upper() or d is None or not 0 <= d <= 100:
            return None, "incompleta"          # desconto só em % (Q11)
        o["desconto_pct"] = round(d, 2)
    for c in ("entrada", "valor_total"):
        if bruto[c]:
            v = numero(bruto[c])
            if v is None or v < 0:
                return None, "incompleta"
            o[c] = round(v, 2)
    if bruto["vencimento"]:
        venc = data(bruto["vencimento"], formato)
        if venc is None:
            return None, "incompleta"
        o["vencimento"] = venc.isoformat()
    return o, None


def descarte(o: dict, hoje: date) -> str | None:
    """Motivo de descarte de uma oferta já lida (vencida ou conta que não fecha), ou None."""
    if date.fromisoformat(o["validade"]) < hoje:
        return "vencida"
    if not conta_fecha(o):
        return "conta"
    return None


# ------------------------------------------------------------------ arquivo local (base/ofertas.csv)
CAMPOS_CSV = ("id_cliente", "contrato", "principal", "ofertas")


def gravar(pasta: str | Path, linhas: list[dict]) -> None:
    caminho = Path(pasta) / ARQUIVO
    tmp = caminho.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS_CSV, delimiter=";", extrasaction="ignore")
        w.writeheader()
        for l in linhas:
            w.writerow({**l, "principal": "1" if l["principal"] else "0",
                        "ofertas": json.dumps(l["ofertas"], ensure_ascii=False, separators=(",", ":"))})
    os.chmod(tmp, 0o600)
    tmp.replace(caminho)


def apagar(pasta: str | Path) -> None:
    (Path(pasta) / ARQUIVO).unlink(missing_ok=True)


def ler(pasta: str | Path) -> list[dict]:
    caminho = Path(pasta) / ARQUIVO
    if not caminho.exists():
        return []
    out = []
    with open(caminho, newline="", encoding="utf-8") as f:
        for l in csv.DictReader(f, delimiter=";"):
            try:
                ofs = json.loads(l.get("ofertas") or "[]")
            except ValueError:
                continue
            if l.get("id_cliente") and isinstance(ofs, list) and 1 <= len(ofs) <= MAX_OFERTAS:
                out.append({"id_cliente": l["id_cliente"], "contrato": l.get("contrato") or "",
                            "principal": l.get("principal") == "1", "ofertas": ofs})
    return out


# ------------------------------------------------------------------ leitura da carga
@dataclass
class Leitura:
    """Ofertas da carga por cliente e contrato (e contagens para o relatório, nunca valores)."""
    mapeadas: bool = False
    por_cliente: dict = field(default_factory=dict)        # id_cliente -> {contrato: (saldo, [ofertas])}
    descartes: dict = field(default_factory=dict)          # id_cliente -> {motivo: n}

    def reiniciar(self) -> None:
        """Carga geral nova: as ofertas de antes saem (as do arquivo novo valem)."""
        self.por_cliente.clear()
        self.descartes.clear()

    def ler_linha(self, idc: str, contrato: str, saldo: float, linha: dict, cols: dict, hoje: date,
                  formato: str | None) -> None:
        """Uma linha (um contrato). `cols`: {oferta1_parcelas: COLUNA, …} do mapeamento."""
        boas: list = []
        desc: dict = {}
        for n in range(1, MAX_OFERTAS + 1):
            valores = {c: linha.get(cols[chave(n, c)]) for c in CAMPOS if cols.get(chave(n, c))}
            if not valores:
                continue
            o, motivo = oferta(valores, n, formato)
            if o is not None:
                motivo = descarte(o, hoje)
            if motivo:
                desc[motivo] = desc.get(motivo, 0) + 1
            elif o is not None and o["id"] not in {x["id"] for x in boas}:
                boas.append(o)
        if desc:
            d = self.descartes.setdefault(idc, {})
            for k, v in desc.items():
                d[k] = d.get(k, 0) + v
        contratos = self.por_cliente.setdefault(idc, {})
        if boas:
            contratos[contrato or ""] = (float(saldo or 0), boas)
        else:
            contratos.pop(contrato or "", None)

    def _escolhidos(self, na_carga: set) -> dict:
        """id_cliente -> [(contrato, principal, ofertas)] (principal = maior saldo; empate, o 1º contrato em ordem)."""
        out = {}
        for idc in sorted(set(self.por_cliente) & na_carga):
            cts = self.por_cliente[idc]
            if not cts:
                continue
            princ = sorted(cts.items(), key=lambda kv: (-kv[1][0], kv[0]))[0][0]
            out[idc] = [(ct, ct == princ, ofs) for ct, (_, ofs) in sorted(cts.items())]
        return out

    def linhas(self, na_carga: set) -> list[dict]:
        return [{"id_cliente": idc, "contrato": ct, "principal": p, "ofertas": ofs}
                for idc, cts in self._escolhidos(na_carga).items() for ct, p, ofs in cts]

    def relatorio(self, na_carga: set) -> dict:
        """Só contagens de quem está na carga (nunca valor)."""
        esc = self._escolhidos(na_carga)
        tot = {m: 0 for m in MOTIVOS}
        for idc, d in self.descartes.items():
            if idc in na_carga:
                for m, n in d.items():
                    tot[m] = tot.get(m, 0) + n
        return {"colunas": self.mapeadas, "clientes_na_carga": len(na_carga), "clientes_com_oferta": len(esc),
                "ofertas": sum(len(ofs) for cts in esc.values() for _, p, ofs in cts if p),
                "varios_contratos": sum(1 for cts in esc.values() if len(cts) > 1),
                "descartadas": tot}
