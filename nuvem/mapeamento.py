"""Mapeamento por credor: o cliente aponta no site, uma vez, para quais colunas o MotorCob olha nos
arquivos de ocorrência, acordo e pagamento, e marca cada resultado de ocorrência (CPC, número
errado, não contatar; sem marca = sem contato). O motor:

- sugere o mapeamento (o que entendeu sozinho) e lista as colunas do último arquivo;
- registra cada código de ocorrência que aparece (quantas vezes, primeira e última data);
- SEGURA os arquivos de um tipo ainda não mapeado em <pasta>/aguardando/ e as linhas com código
  ainda não marcado (ficam na quarentena da rodada); quando o cliente confirma, a vigia roda de
  novo e tudo é relido — nada se perde.

Empresa com empresas/<slug>.json no repositório: o que está lá já vale como mapeado; o que o
cliente confirmar no site passa por cima.
"""
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

TIPOS = ("ocorrencia", "acordo", "baixa")
PASTA = {"ocorrencia": "ocorrencias", "acordo": "acordo", "baixa": "baixa"}
NOME = {"ocorrencia": "ocorrência", "acordo": "acordo", "baixa": "pagamento"}
ESPERA = "aguardando"
RESULTADOS = ("cpc", "sem_contato", "terceiro", "opt_out")   # = motor.voz.GENERICOS_SITE (CHECK do banco; teste)


def _agora():
    return datetime.now(timezone.utc).isoformat()


def _arquivos(p: Path) -> list[Path]:
    from motor.entrada import data_do_arquivo
    if not p.exists():
        return []
    return sorted((x for x in p.iterdir() if x.is_file() and not x.name.startswith(".")),
                  key=lambda x: (data_do_arquivo(x), x.name))


CARGAS = {"base": "bruto", "incremental": "incremental"}   # carga geral: espera o mapeamento das colunas (SQL 74)


def liberar(pasta: Path):
    """Volta os arquivos segurados para a pasta do tipo (a rodada decide de novo o que segurar)."""
    for t in TIPOS:
        for a in _arquivos(pasta / PASTA[t] / ESPERA):
            a.replace(pasta / PASTA[t] / a.name)
    for d in CARGAS.values():
        for a in _arquivos(pasta / d / ESPERA):
            a.replace(pasta / d / a.name)


# ------------------------------------------------------------------ carga geral (SQL 74)
NOME_FALTA = {"cliente": "o código do cliente (ou o CPF)", "saldo": "o saldo",
              "atraso": "os dias de atraso (ou o vencimento)", "contato": "o telefone ou o e-mail"}


def mapa_base(sb, eid, cid) -> dict | None:
    """Colunas da carga geral apontadas no site (confirmadas), ou None. Banco sem o SQL 74: None (só a detecção)."""
    from nuvem.supabase_api import ErroSupabase
    if eid is None:
        return None
    try:
        linhas = [m for m in _do_credor(sb, "mapeamento_arquivos", eid, cid) if m.get("tipo") == "base"]
    except ErroSupabase:
        return None
    m = linhas[0] if linhas else {}
    return m.get("colunas") if m.get("confirmado") and isinstance(m.get("colunas"), dict) else None


def registrar_base(sb, eid, cid, arq: Path, sugestao: dict):
    """O que o motor viu na última carga (cabeçalho e sugestão; só nomes de coluna). Colunas/confirmado são do site."""
    from nuvem.supabase_api import ErroSupabase
    if eid is None or arq is None:
        return
    visto = {"arquivo": arq.name, "cabecalho": sugestao.get("cabecalho") or [], "visto_em": _agora(),
             "sugerido": sugestao.get("sugerido") or {}}
    try:
        atual = [m for m in _do_credor(sb, "mapeamento_arquivos", eid, cid) if m.get("tipo") == "base"]
        if atual and atual[0].get("id"):
            sb.atualizar("mapeamento_arquivos", {"id": f"eq.{atual[0]['id']}"}, visto)
        else:
            sb.inserir("mapeamento_arquivos", [{"empresa_id": eid, "credor_id": cid, "tipo": "base", **visto}])
    except ErroSupabase:   # banco sem o SQL 74 (tipo 'base' fora do CHECK): segue sem registrar
        pass


def segurar_carga(destinos: list[Path]) -> list[Path]:
    """Carga geral que não deu para ler: espera em <bruto|incremental>/aguardando/ (não é apagada nem rejeitada)."""
    saida = []
    for d in destinos:
        if d.exists():
            (d.parent / ESPERA).mkdir(parents=True, exist_ok=True)
            novo = d.parent / ESPERA / d.name
            d.replace(novo)
            saida.append(novo)
    return saida


def msg_carga(faltam: list[str], fixas: dict | None, cabecalho: list[str], carteira: str = "") -> str:
    """Mensagem da carga que espera o mapeamento: o que falta, em português, e onde apontar."""
    itens = [NOME_FALTA[f] for f in faltam if f in NOME_FALTA]
    partes = []
    if itens:
        n = len(itens)
        lista = itens[0] if n == 1 else ", ".join(itens[:-1]) + " e " + itens[-1]
        partes.append(f"Faltou apontar {n} coluna{'s' if n > 1 else ''} da carga: {lista}.")
    sumiram = sorted({c for k, v in (fixas or {}).items() for c in ([v] if isinstance(v, str) else v or [])
                      if isinstance(c, str) and c not in cabecalho})
    if sumiram:
        partes.append("As colunas que você apontou e não vieram neste arquivo: " + ", ".join(sumiram[:6]) + ".")
    if not partes:
        partes.append("Não conseguimos ler as colunas desta carga.")
    onde = f"Carteiras › {carteira} › Configurações › Arquivos" if carteira else "Configurações da carteira › Arquivos"
    return (" ".join(partes) + " O arquivo está guardado: ele entra assim que você apontar as colunas (no "
            f"Assistente de implantação ou em {onde}).")


def _segurar(pasta: Path, tipo: str) -> list[str]:
    nomes = []
    for a in _arquivos(pasta / PASTA[tipo]):
        (pasta / PASTA[tipo] / ESPERA).mkdir(parents=True, exist_ok=True)
        a.replace(pasta / PASTA[tipo] / ESPERA / a.name)
        nomes.append(a.name)
    return nomes


def segurado(destino: Path) -> bool:
    return not destino.exists() and (destino.parent / ESPERA / destino.name).exists()


def _do_credor(sb, tabela, eid, cid) -> list[dict]:
    filtro = {"empresa_id": f"eq.{eid}", **({"credor_id": f"eq.{cid}"} if cid is not None else {})}
    return [x for x in sb.selecionar(tabela, filtro) or [] if x.get("credor_id") == cid]


def _propriedades(arq: Path, tipo: str, colunas: dict) -> dict:
    """Separador, codificação, formato de data, decimal (e canais/tipos) pelas colunas escolhidas."""
    from motor.detectar import _canal, _decimal, _formato_data, _n, _valores, ler
    enc, delim, _, amostra = ler(arq)
    datas = [colunas.get(k) for k in ("data", "vencimento") if colunas.get(k)]
    lay = {"arquivo": "*", "delimitador": delim, "encoding": enc, "colunas": dict(colunas),
           "formato_data": _formato_data(amostra, datas)}
    if tipo == "ocorrencia":
        if colunas.get("canal"):
            lay["canais"] = {v: c for v in sorted(set(_valores(amostra, colunas["canal"]))) if (c := _canal(v))}
    else:
        lay["decimal"] = _decimal(amostra, [colunas.get("valor")])
        if tipo == "baixa" and colunas.get("tipo"):
            tipos = {}
            for v in set(_valores(amostra, colunas["tipo"])):
                n = _n(v)
                if any(k in n for k in ("QUIT", "TOTAL", "LIQUID", "INTEGRAL")) or n == "Q":
                    tipos[v] = "quitacao"
                elif "PARCIAL" in n or n in ("P", "AMORT", "AMORTIZACAO"):
                    tipos[v] = "parcial"
                elif "PARCELA" in n or "ACORDO" in n or n in ("PA", "A"):
                    tipos[v] = "parcela"
            lay["tipos"] = tipos
    return lay


def _sugestao(arq: Path, tipo: str, base_id: str | None, base_contrato: str | None) -> dict:
    from motor.detectar import layout_arquivo, layout_ocorrencia
    from motor.ingestao import LayoutInvalido
    try:
        if tipo == "ocorrencia":
            return layout_ocorrencia([arq], base_id, {})["colunas"]
        return layout_arquivo(arq, tipo, base_id, base_contrato, {})["colunas"]
    except (LayoutInvalido, KeyError, IndexError, UnicodeDecodeError):
        return {}


def aplicar(sb, eid, cid, pasta: Path, entrada, repo: bool, out=print):
    """Aplica o mapeamento do site sobre a entrada (arquivo do repositório ou layout automático).
    Devolve (entrada a usar, info). info: {"aguardando": {tipo: [arquivos]}, "codigos_novos": {código: linhas},
    "codigos_do_arquivo": {arquivo: [códigos novos]}, "sem_tabela": bool}."""
    from motor.detectar import ler, sugestao_site
    from motor.entrada import data_do_arquivo
    from nuvem.supabase_api import ErroSupabase
    info = {"aguardando": {}, "codigos_novos": {}, "codigos_do_arquivo": {}, "sem_tabela": False}
    if entrada is None:
        return entrada, info
    try:
        mapas = {m["tipo"]: m for m in _do_credor(sb, "mapeamento_arquivos", eid, cid)}
        codigos = {c["codigo"]: c for c in _do_credor(sb, "ocorrencia_codigos", eid, cid)}
    except ErroSupabase:     # banco sem as tabelas novas: segue como antes
        info["sem_tabela"] = True
        return entrada, info
    origem = Path(entrada) if repo else pasta / "config" / "entrada_automatica.json"
    dados = json.loads(origem.read_text(encoding="utf-8"))
    base_col = (dados.get("base") or {}).get("colunas") or {}
    agora = _agora()
    sug_oc = None
    for tipo in TIPOS:
        arqs = _arquivos(pasta / PASTA[tipo])
        if not arqs:
            continue
        ultimo = arqs[-1]
        try:
            cab = ler(ultimo)[2]
        except (UnicodeDecodeError, IndexError):
            cab = []
        visto = {"arquivo": ultimo.name, "cabecalho": cab, "visto_em": agora,
                 "sugerido": _sugestao(ultimo, tipo, base_col.get("id_cliente"), base_col.get("id_contrato"))}
        m = mapas.get(tipo) or {}
        if m.get("id"):      # só o que é do motor; colunas/confirmado são do cliente
            sb.atualizar("mapeamento_arquivos", {"id": f"eq.{m['id']}"}, visto)
        else:
            sb.inserir("mapeamento_arquivos", [{"empresa_id": eid, "credor_id": cid, "tipo": tipo, **visto}])
        chave = "ocorrencia" if tipo == "ocorrencia" else tipo
        if m.get("confirmado") and m.get("colunas"):
            lay = _propriedades(ultimo, tipo, m["colunas"])
            if tipo == "ocorrencia":
                antes = (dados.get("ocorrencia") or [{}])[0]
                lay["resultados"] = dict(antes.get("resultados") or {}) if repo else {}
                dados["ocorrencia"] = [lay]
            else:
                if repo and dados.get(tipo, {}).get("tipos") and not lay.get("tipos"):
                    lay["tipos"] = dados[tipo]["tipos"]
                dados[tipo] = lay
        elif repo and dados.get(chave):
            pass                                   # o arquivo do repositório já diz como ler
        else:
            if tipo == "ocorrencia" and visto["sugerido"].get("resultado"):
                # sem colunas confirmadas: os códigos já aparecem (pela coluna sugerida) para mapear tudo de uma vez
                antes = (dados.get("ocorrencia") or [{}])[0]
                sug_oc = {**_propriedades(ultimo, tipo, visto["sugerido"]), "resultados": antes.get("resultados") or {}}
            info["aguardando"][tipo] = _segurar(pasta, tipo)
            dados.pop(chave, None)
            out(f"  {NOME[tipo]}: {len(info['aguardando'][tipo])} arquivo(s) aguardando o mapeamento das colunas")

    # códigos de resultado da ocorrência: só vale o que o cliente marcou (ou o arquivo do repositório)
    oc = (dados.get("ocorrencia") or [None])[0]
    arqs = _arquivos(pasta / PASTA["ocorrencia"])
    confirmado = bool(oc)
    if not oc and sug_oc:
        oc, arqs = sug_oc, _arquivos(pasta / PASTA["ocorrencia"] / ESPERA)
    if oc and arqs:
        col = oc["colunas"]["resultado"]
        vistos, primeira, ultima, por_arquivo = Counter(), {}, {}, {}
        for a in arqs:
            dia = data_do_arquivo(a).isoformat()
            try:
                with open(a, newline="", encoding=oc.get("encoding", "utf-8-sig"), errors="replace") as f:
                    cods = [(linha.get(col) or "").strip()
                            for linha in csv.DictReader(f, delimiter=oc.get("delimitador", ";"))]
            except csv.Error:
                continue
            cods = [c for c in cods if c]
            vistos.update(cods)
            por_arquivo[a.name] = set(cods)
            for c in set(cods):
                primeira[c] = min(primeira.get(c, dia), dia)
                ultima[c] = max(ultima.get(c, dia), dia)
        do_repo = dict(oc.get("resultados") or {}) if repo else {}
        marcados = {c: r["resultado"] for c, r in codigos.items() if r.get("mapeado") and r.get("resultado")}
        resultados = {**do_repo, **marcados}
        novos_reg = []
        for c, n in vistos.items():
            antes = codigos.get(c[:200]) or {}
            linha = {"qtd": n, "primeira_vez": min(primeira[c], antes.get("primeira_vez") or primeira[c]),
                     "ultima_vez": max(ultima[c], antes.get("ultima_vez") or ultima[c]),
                     "sugerido": do_repo.get(c) or sugestao_site(c), "visto_em": agora}
            if antes.get("id"):  # resultado/mapeado são do cliente: não mexe
                if any(str(antes.get(k)) != str(v) for k, v in linha.items() if k != "visto_em"):
                    sb.atualizar("ocorrencia_codigos", {"id": f"eq.{antes['id']}"}, linha)
            else:
                novos_reg.append({"empresa_id": eid, "credor_id": cid, "codigo": c[:200], **linha})
        if novos_reg:
            sb.inserir("ocorrencia_codigos", novos_reg)
        if confirmado:   # coluna confirmada: some o código não marcado que não aparece mais (de coluna errada)
            for c, r in codigos.items():
                if not r.get("mapeado") and c not in {k[:200] for k in vistos} and r.get("id"):
                    sb.apagar("ocorrencia_codigos", {"id": f"eq.{r['id']}"})
        if confirmado:
            oc["resultados"] = resultados
        novos = {c: n for c, n in vistos.items() if c not in resultados}
        info["codigos_novos"] = novos
        info["codigos_do_arquivo"] = {a: sorted(c for c in cs if c in novos) for a, cs in por_arquivo.items()
                                      if any(c in novos for c in cs)}
        if novos:
            out(f"  ocorrência: {len(novos)} resultado(s) ainda não marcados no site: "
                + ", ".join(f"'{c}'" for c in list(novos)[:8]))
    efetiva = pasta / "config" / "entrada_efetiva.json"
    efetiva.parent.mkdir(parents=True, exist_ok=True)
    efetiva.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    return efetiva, info


def alertas(info: dict, credor: str) -> list[str]:
    onde = f"Credores → {credor} → Configurações" if credor else "Credores → Configurações"
    saida = []
    if info.get("sem_tabela"):
        saida.append("BANCO: rode supabase/atualizar_producao_2026-10.sql para ativar as Configurações do credor "
                     "(mapeamento de arquivos e ocorrências). Até lá o MotorCob segue lendo sozinho.")
    for tipo, arqs in info.get("aguardando", {}).items():
        if arqs:
            saida.append(f"MAPEAMENTO: {len(arqs)} arquivo(s) de {NOME[tipo]} aguardando — aponte as colunas em "
                         f"{onde} → Arquivos. Depois disso o MotorCob processa sozinho.")
    novos = info.get("codigos_novos") or {}
    if novos:
        saida.append(f"OCORRÊNCIAS PARA MARCAR: {len(novos)} resultado(s) novo(s) ("
                     + ", ".join(f"'{c}' {n}x" for c, n in sorted(novos.items(), key=lambda x: -x[1])[:8])
                     + f"). Marque CPC, número errado ou não contatar em {onde} → Ocorrências; as linhas "
                     "esperam e entram assim que marcar.")
    return saida
