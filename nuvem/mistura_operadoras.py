"""Mistura de operadoras (market share de celulares) atualizada todo mês com os dados abertos da Anatel.

Fonte: Painéis de Dados da Anatel › Acessos › Telefonia Móvel, o arquivo
`acessos_telefonia_movel.zip` (≈ 3,3 GB, atualizado todo mês). Não baixamos o zip inteiro: o servidor aceita
pedidos por intervalo de bytes (Range), então lemos só o diretório do zip (o fim do arquivo) e, dele, só o
membro `Acessos_Telefonia_Movel_<ano>_<1|2>S_Colunas.csv` do semestre mais recente (≈ 3 MB compactado,
≈ 40 MB descompactado, lido em fluxo). Esse CSV tem uma linha por prestadora × município × modalidade ×
tecnologia × produto e uma coluna por mês (`2026-07;2026-08;…`).

"Celulares" = todos os produtos menos M2M e PONTO_DE_SERVICO (é a conta que bate com o total oficial da
Anatel, `Acessos_Telefonia_Movel_Total.csv`). Operadora pelo Grupo Econômico: TELEFONICA → vivo,
TELECOM AMERICAS → claro, TELECOM ITALIA → tim; o resto vai para "outras".

Quando roda: no bloco diário da mensageria (`sincronizar.rodar_mensageria`), a partir do dia 5. Não faz
nada (nem acessa a rede) se a fonte já tem o mês esperado (dois meses atrás: a Anatel publica o mês M no
fim do mês M+1) ou se alguém editou a mistura no Console neste mês (a edição manual vale até a atualização
do mês seguinte). Anatel ainda sem mês novo: tenta no dia seguinte, sem aviso.

Nunca grava se a fonte falhar ou parecer errada (soma longe de 100, operadora que pula mais de 10 pontos,
total de celulares fora do razoável): cria um aviso no sino da equipe, um por mês. Nunca levanta exceção
para a rotina.

Uso manual (só lê, não grava): `python -m nuvem.mistura_operadoras --simular`
Forçar (grava mesmo com salto > 10 pontos e fora do calendário): `python -m nuvem.mistura_operadoras --forcar`
"""
import csv
import re
import struct
import unicodedata
import urllib.request
import zlib
from datetime import date, datetime, timezone

URL = "https://www.anatel.gov.br/dadosabertos/paineis_de_dados/acessos/acessos_telefonia_movel.zip"
MEMBRO = re.compile(r"^Acessos_Telefonia_Movel_(\d{4})_([12])S_Colunas\.csv$")
OPERADORAS = ("vivo", "claro", "tim", "outras")
GRUPOS = {"TELEFONICA": "vivo", "VIVO": "vivo", "TELECOM AMERICAS": "claro", "CLARO": "claro",
          "TELECOM ITALIA": "tim", "TIM": "tim"}
FORA_CELULARES = {"M2M", "PONTO_DE_SERVICO"}
MESES = ("janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
         "novembro", "dezembro")
PREFIXO_FONTE = "Anatel (dados abertos)"
DIA = 5                       # roda a partir deste dia do mês
SALTO_MAXIMO = 10.0           # pontos percentuais por operadora em relação ao valor atual
TOTAL_MINIMO = 100_000_000    # celulares no Brasil: ~220 milhões em 2026; abaixo disso, leitura errada
TIMEOUT = 60
TETO_COMPACTADO = 64 << 20    # 64 MB: o membro tem ~3 MB
TETO_DESCOMPACTADO = 512 << 20
TETO_DIRETORIO = 1 << 20
BLOCO = 1 << 20


class ErroFonte(RuntimeError):
    """A fonte da Anatel falhou ou mudou de formato."""


# ------------------------------------------------------------------ download (por intervalo de bytes)
def _intervalo(url: str, ini: int, fim: int | None = None, timeout: int = TIMEOUT):
    """Abre a resposta de um intervalo de bytes. Recusa 200 (o servidor mandaria o zip inteiro)."""
    faixa = f"bytes={ini}-" if fim is None else f"bytes={ini}-{fim}"
    if ini < 0:
        faixa = f"bytes={ini}"
    r = urllib.request.urlopen(urllib.request.Request(url, headers={"Range": faixa}), timeout=timeout)
    if r.status != 206:
        r.close()
        raise ErroFonte(f"servidor sem suporte a intervalo (HTTP {r.status})")
    return r


def _tamanho_total(cabecalho: str | None) -> int:
    m = re.search(r"/(\d+)$", cabecalho or "")
    if not m:
        raise ErroFonte("resposta sem Content-Range")
    return int(m.group(1))


def diretorio(fim_do_zip: bytes, tamanho: int) -> dict[str, tuple[int, int]]:
    """Lê o diretório central do zip (os últimos bytes do arquivo): {nome: (deslocamento, tamanho compactado)}.
    Só método deflate (8). Entende zip64."""
    base = tamanho - len(fim_do_zip)
    i = fim_do_zip.rfind(b"PK\x05\x06")
    if i < 0:
        raise ErroFonte("fim do zip não encontrado")
    qtd, tam_dir, ini_dir = struct.unpack("<HII", fim_do_zip[i + 10:i + 20])
    j = fim_do_zip.rfind(b"PK\x06\x06", 0, i)
    if j >= 0:
        qtd, tam_dir, ini_dir = struct.unpack("<QQQ", fim_do_zip[j + 32:j + 56])
    p = ini_dir - base
    if p < 0:
        raise ErroFonte("diretório do zip maior que o trecho lido")
    membros = {}
    for _ in range(qtd):
        if fim_do_zip[p:p + 4] != b"PK\x01\x02":
            raise ErroFonte("diretório do zip inválido")
        metodo, = struct.unpack("<H", fim_do_zip[p + 10:p + 12])
        compactado, = struct.unpack("<I", fim_do_zip[p + 20:p + 24])
        descompactado, = struct.unpack("<I", fim_do_zip[p + 24:p + 28])
        n_nome, n_extra, n_coment = struct.unpack("<HHH", fim_do_zip[p + 28:p + 34])
        desloc, = struct.unpack("<I", fim_do_zip[p + 42:p + 46])
        nome = fim_do_zip[p + 46:p + 46 + n_nome].decode("cp437")
        extra = fim_do_zip[p + 46 + n_nome:p + 46 + n_nome + n_extra]
        q = 0
        while q + 4 <= len(extra):                       # zip64: os campos 0xFFFFFFFF vêm no extra 0x0001
            ident, tam = struct.unpack("<HH", extra[q:q + 4])
            if ident == 1:
                valores = list(struct.unpack("<" + "Q" * (tam // 8), extra[q + 4:q + 4 + tam - tam % 8]))
                if descompactado == 0xFFFFFFFF and valores:
                    valores.pop(0)
                if compactado == 0xFFFFFFFF and valores:
                    compactado = valores.pop(0)
                if desloc == 0xFFFFFFFF and valores:
                    desloc = valores.pop(0)
            q += 4 + tam
        if metodo == 8:
            membros[nome] = (desloc, compactado)
        p += 46 + n_nome + n_extra + n_coment
    return membros


def escolher_membro(nomes) -> str:
    """O CSV por colunas do semestre mais recente."""
    candidatos = []
    for n in nomes:
        m = MEMBRO.match(n)
        if m:
            candidatos.append(((int(m.group(1)), int(m.group(2))), n))
    if not candidatos:
        raise ErroFonte("zip sem Acessos_Telefonia_Movel_<ano>_<S>S_Colunas.csv")
    return max(candidatos)[1]


def _linhas_do_membro(url: str, desloc: int, compactado: int):
    """Linhas de texto do membro, descompactadas em fluxo, com teto de tamanho."""
    if compactado > TETO_COMPACTADO:
        raise ErroFonte(f"arquivo da Anatel maior que o esperado ({compactado} bytes compactados)")
    with _intervalo(url, desloc, desloc + 29) as r:
        cab = r.read(30)
    if cab[:4] != b"PK\x03\x04":
        raise ErroFonte("cabeçalho do membro inválido")
    n_nome, n_extra = struct.unpack("<HH", cab[26:30])
    ini = desloc + 30 + n_nome + n_extra
    dz = zlib.decompressobj(-15)
    total = 0
    resto = b""
    with _intervalo(url, ini, ini + compactado - 1) as r:
        while True:
            pedaco = r.read(BLOCO)
            if not pedaco:
                break
            dados = dz.decompress(pedaco)
            total += len(dados)
            if total > TETO_DESCOMPACTADO:
                raise ErroFonte("arquivo da Anatel maior que o esperado (descompactado)")
            linhas = (resto + dados).split(b"\n")
            resto = linhas.pop()
            for linha in linhas:
                yield linha.decode("utf-8-sig").rstrip("\r")
    resto += dz.flush()
    if resto.strip():
        yield resto.decode("utf-8-sig").rstrip("\r")


def baixar(url: str = URL, mes_atual: str | None = None):
    """Baixa só o necessário e devolve (mês 'AAAA-MM', {operadora: acessos}) ou None se a Anatel ainda não tem
    mês mais novo que `mes_atual`."""
    with _intervalo(url, -65536) as r:
        tamanho = _tamanho_total(r.headers.get("Content-Range"))
        fim = r.read(TETO_DIRETORIO)
    membros = diretorio(fim, tamanho)
    nome = escolher_membro(membros)
    linhas = _linhas_do_membro(url, *membros[nome])
    try:
        return contar(linhas, mes_atual)
    finally:
        linhas.close()                                  # fecha a conexão se parou cedo


# ------------------------------------------------------------------ leitura e conta
def _sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").upper().strip()


def operadora(grupo: str, empresa: str = "") -> str:
    return GRUPOS.get(_sem_acento(grupo)) or GRUPOS.get(_sem_acento(empresa)) or "outras"


def contar(linhas, mes_atual: str | None = None):
    """Lê o CSV por colunas (separador ';') e devolve (mês completo mais recente, {operadora: acessos de
    celulares}). Para cedo e devolve None se o arquivo não tem mês mais novo que `mes_atual`."""
    leitor = csv.reader(linhas, delimiter=";")
    try:
        cab = [c.strip().lstrip("﻿") for c in next(leitor)]
    except StopIteration:
        raise ErroFonte("arquivo vazio") from None
    pos = {c: i for i, c in enumerate(cab)}
    faltam = [c for c in ("Grupo Econômico", "Empresa", "Tipo de Produto") if c not in pos]
    if faltam:
        raise ErroFonte(f"colunas não encontradas: {', '.join(faltam)}")
    meses = sorted(c for c in cab if re.fullmatch(r"\d{4}-\d{2}", c))
    if not meses:
        raise ErroFonte("nenhuma coluna de mês (AAAA-MM)")
    if mes_atual and meses[-1] <= mes_atual:
        return None
    g, e, t = pos["Grupo Econômico"], pos["Empresa"], pos["Tipo de Produto"]
    soma = {m: {o: 0 for o in OPERADORAS} for m in meses}
    for linha in leitor:
        if len(linha) < len(cab) or linha[t].strip().upper() in FORA_CELULARES:
            continue
        op = operadora(linha[g], linha[e])
        for m in meses:
            v = linha[pos[m]].strip()
            if v:
                try:
                    soma[m][op] += int(v)
                except ValueError:
                    raise ErroFonte(f"valor não numérico em {m}: {v[:20]!r}") from None
    # mês completo: o mais recente com total de pelo menos 90% do mês anterior (coluna recém-aberta fica fora)
    escolhido = None
    for i in range(len(meses) - 1, -1, -1):
        tot = sum(soma[meses[i]].values())
        ant = sum(soma[meses[i - 1]].values()) if i > 0 else 0
        if tot > 0 and (i == 0 or tot >= 0.9 * ant):
            escolhido = meses[i]
            break
    if not escolhido:
        raise ErroFonte("nenhum mês com dados")
    if mes_atual and escolhido <= mes_atual:
        return None
    return escolhido, soma[escolhido]


def participacao(acessos: dict) -> dict:
    """{operadora: %} com duas casas e soma exatamente 100 (o arredondamento vai para a maior)."""
    total = sum(acessos.get(o, 0) for o in OPERADORAS)
    if total <= 0:
        raise ErroFonte("total de acessos zerado")
    p = {o: round(acessos.get(o, 0) * 100 / total, 2) for o in OPERADORAS}
    maior = max(p, key=p.get)
    p[maior] = round(p[maior] + 100 - sum(p.values()), 2)
    return p


def problemas(novo: dict, acessos: dict, atual: dict, forcar: bool = False) -> list[str]:
    """O que impede gravar. Vazio = pode gravar."""
    erros = []
    if set(novo) != set(OPERADORAS):
        erros.append("faltam operadoras")
        return erros
    if any(not 0 <= v <= 100 for v in novo.values()):
        erros.append("percentual fora de 0–100")
    if abs(sum(novo.values()) - 100) > 0.05:
        erros.append(f"a soma deu {sum(novo.values()):.2f}%")
    total = sum(acessos.values())
    if total < TOTAL_MINIMO:
        erros.append(f"total de celulares baixo demais ({total:,})".replace(",", "."))
    if any(novo[o] < 5 for o in ("vivo", "claro", "tim")):
        erros.append("Vivo, Claro ou TIM abaixo de 5%")
    if not forcar:
        for o in OPERADORAS:
            if o in atual and abs(novo[o] - atual[o]) > SALTO_MAXIMO:
                erros.append(f"{o} pularia de {atual[o]:.1f}% para {novo[o]:.1f}%")
    return erros


# ------------------------------------------------------------------ fonte, calendário e gravação
def fonte(mes: str) -> str:
    ano, m = mes.split("-")
    return f"{PREFIXO_FONTE} · {MESES[int(m) - 1]}/{ano} · celulares"


def mes_da_fonte(texto: str | None) -> str | None:
    """'AAAA-MM' de uma fonte gravada por este módulo; None para fonte manual (Teleco, digitada etc.)."""
    m = re.match(re.escape(PREFIXO_FONTE) + r" · (\w+)/(\d{4})", texto or "")
    if not m or m.group(1).lower() not in MESES:
        return None
    return f"{m.group(2)}-{MESES.index(m.group(1).lower()) + 1:02d}"


def mes_esperado(hoje: date) -> str:
    """A Anatel publica o mês M no fim de M+1: no começo do mês, o mais novo é de dois meses atrás."""
    a, m = hoje.year, hoje.month - 2
    if m <= 0:
        a, m = a - 1, m + 12
    return f"{a}-{m:02d}"


def _editada_no_mes(linhas: list[dict], hoje: date) -> bool:
    """Alguém salvou pelo Console (atualizado_por preenchido) neste mês: a edição manual vale até o próximo."""
    for l in linhas:
        if l.get("atualizado_por") and str(l.get("atualizado_em") or "")[:7] == hoje.isoformat()[:7]:
            return True
    return False


def _aviso(sb, hoje: date, titulo: str, texto: str, out=print) -> None:
    from nuvem import avisos
    try:
        avisos.criar(sb, "equipe", titulo, texto, tipo="atencao", link="/console/fornecedores",
                     chave=f"mistura_operadoras:{hoje.isoformat()[:7]}")
    except Exception as ex:  # noqa: BLE001 — sem sino, segue (o log fica)
        out(f"mistura de operadoras: aviso não gravado ({ex})")


def atualizar(sb, hoje: date | None = None, buscar=None, forcar: bool = False, simular: bool = False,
              out=print) -> dict:
    """Atualiza a mistura com o mês mais recente da Anatel. Devolve {'status': ..., ...}.
    status: fora_do_dia · em_dia · manual · sem_mes_novo · gravada · simulada · recusada · falhou."""
    hoje = hoje or date.today()
    buscar = buscar or baixar
    linhas = (sb.selecionar("mensageria_mistura_operadoras") or []) if sb is not None else []
    atual = {str(l.get("operadora")): float(l.get("percentual") or 0) for l in linhas}
    mes_atual = max((m for m in (mes_da_fonte(l.get("fonte")) for l in linhas) if m), default=None)
    if not (forcar or simular):
        if hoje.day < DIA:
            return {"status": "fora_do_dia"}
        if mes_atual and mes_atual >= mes_esperado(hoje):
            return {"status": "em_dia", "mes": mes_atual}
        if _editada_no_mes(linhas, hoje):
            return {"status": "manual"}
    try:
        r = buscar(mes_atual=mes_atual)
    except Exception as ex:  # noqa: BLE001 — rede, formato, tamanho: não grava, avisa uma vez por mês
        out(f"mistura de operadoras: fonte da Anatel falhou ({ex})")
        if not simular:
            _aviso(sb, hoje, "Mistura de operadoras sem atualização",
                   f"Não deu para ler os dados abertos da Anatel ({str(ex)[:200]}). A mistura atual continua valendo; "
                   "confira no Console › Fornecedores e rotas.", out)
        return {"status": "falhou", "erro": str(ex)}
    if r is None:
        out(f"mistura de operadoras: Anatel ainda sem mês mais novo que {mes_atual}")
        return {"status": "sem_mes_novo", "mes": mes_atual}
    mes, acessos = r
    novo = participacao(acessos)
    erros = problemas(novo, acessos, atual, forcar)
    resumo = {"mes": mes, "fonte": fonte(mes), "percentuais": novo, "acessos": acessos, "anteriores": atual}
    if erros:
        out(f"mistura de operadoras: Anatel {mes} recusada: {'; '.join(erros)}")
        if not simular:
            _aviso(sb, hoje, "Mistura de operadoras não atualizada",
                   f"Os dados da Anatel de {fonte(mes).split(' · ')[1]} parecem errados ({'; '.join(erros)[:250]}). "
                   "A mistura atual continua valendo; confira no Console › Fornecedores e rotas.", out)
        return {"status": "recusada", "problemas": erros, **resumo}
    if simular:
        return {"status": "simulada", **resumo}
    # mesma regra da RPC salvar_mistura_operadoras (que exige uma pessoa da equipe): as quatro, soma 100
    sb.inserir("mensageria_mistura_operadoras",
               [{"operadora": o, "percentual": novo[o], "fonte": resumo["fonte"], "atualizado_em": datetime.now(timezone.utc).isoformat(),
                 "atualizado_por": None} for o in OPERADORAS], conflito="operadora")
    out(f"mistura de operadoras: {resumo['fonte']} — " + ", ".join(f"{o} {novo[o]:.2f}%" for o in OPERADORAS))
    return {"status": "gravada", **resumo}


def rodar(sb, out=print, hoje: date | None = None, buscar=None) -> dict:
    """Chamada da rotina diária: nunca levanta exceção."""
    try:
        return atualizar(sb, hoje, buscar, out=out)
    except Exception as ex:  # noqa: BLE001 — a mistura nunca para a rotina
        out(f"mistura de operadoras: erro ignorado ({ex})")
        return {"status": "falhou", "erro": str(ex)}


def _principal(argv=None) -> int:
    import argparse
    import json
    ap = argparse.ArgumentParser(description="Mistura de operadoras pelos dados abertos da Anatel")
    ap.add_argument("--simular", action="store_true", help="só baixa e mostra; não grava nada")
    ap.add_argument("--forcar", action="store_true", help="grava mesmo com salto > 10 pontos e fora do calendário")
    a = ap.parse_args(argv)
    sb = None
    if not a.simular:
        import os
        from pathlib import Path
        from nuvem.sincronizar import Supabase, carregar_config
        sb = Supabase(*carregar_config(Path(os.environ.get("MOTORCOB_DADOS", Path.home() / "MotorCob-dados"))))
    r = atualizar(sb, forcar=a.forcar, simular=a.simular)
    print(json.dumps(r, ensure_ascii=False, indent=2))
    return 0 if r["status"] in ("gravada", "simulada", "em_dia", "sem_mes_novo") else 1


if __name__ == "__main__":
    raise SystemExit(_principal())
