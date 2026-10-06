"""Retorno de canal no site: arquivos dos fornecedores (DLR do SMS, entrega/leitura/clique do RCS e
WhatsApp, bounces do e-mail, discagem da voz) enviados em Enviar arquivos → Retorno <canal>.

Como na ocorrência, o cliente mapeia uma vez, por credor e canal, a coluna do contato e a do status
(e da data, se houver) — tabela mapeamento_arquivos, tipo canal_<canal> — e marca cada status com uma
marca (tabela canal_codigos: inexistente, temporario, entregue, lido, clique, bloqueio). O motor
sugere as duas coisas. Arquivo de canal sem colunas confirmadas espera em canais/<canal>/aguardando/;
status sem marca fica de fora até ser marcado (os arquivos ficam guardados e são relidos a cada
rodada — quando o cliente marca, entra sozinho).
"""
from collections import Counter
from pathlib import Path

from motor.retorno_canal import CANAIS, LIMITE_LOTE, NOME, abrir, detectar_colunas, ler_arquivo, sugerir_marca

TIPOS = {f"canal_{c}": c for c in CANAIS}
PASTA = {t: f"canais/{c}" for t, c in TIPOS.items()}
ESPERA = "aguardando"


def _arquivos(p: Path) -> list[Path]:
    from motor.entrada import data_do_arquivo
    if not p.exists():
        return []
    return sorted((x for x in p.iterdir() if x.is_file() and not x.name.startswith(".")),
                  key=lambda x: (data_do_arquivo(x), x.name))


def liberar(pasta: Path):
    for c in CANAIS:
        for a in _arquivos(pasta / "canais" / c / ESPERA):
            a.replace(pasta / "canais" / c / a.name)


def _do_credor(sb, tabela, eid, cid, **filtro) -> list[dict]:
    f = {"empresa_id": f"eq.{eid}", **({"credor_id": f"eq.{cid}"} if cid is not None else {}),
         **{k: f"eq.{v}" for k, v in filtro.items()}}
    return [x for x in sb.selecionar(tabela, f) or [] if x.get("credor_id") == cid]


def preparar(sb, eid, cid, pasta: Path, regras: dict | None = None, out=print):
    """Lê os retornos de canal do credor com o mapeamento do site. Devolve (registros, info).
    info: {"aguardando": {tipo: [arquivos]}, "status_para_marcar": {canal: {status: linhas}},
           "relatorios": {arquivo: {...}}, "lotes_travados": [arquivo], "sem_tabela": bool}."""
    from datetime import datetime, timezone

    from motor.entrada import data_do_arquivo
    from nuvem.supabase_api import ErroSupabase
    info = {"aguardando": {}, "status_para_marcar": {}, "relatorios": {}, "lotes_travados": [], "sem_tabela": False}
    registros = []
    agora = datetime.now(timezone.utc).isoformat()
    for tipo, canal in TIPOS.items():
        pasta_c = pasta / "canais" / canal
        arqs = _arquivos(pasta_c)
        if not arqs:
            continue
        try:
            mapa = (_do_credor(sb, "mapeamento_arquivos", eid, cid, tipo=tipo) or [{}])[0]
            codigos = {c["codigo"]: c for c in _do_credor(sb, "canal_codigos", eid, cid, canal=canal)}
        except ErroSupabase:
            info["sem_tabela"] = True
            info["aguardando"][tipo] = _segurar(pasta_c, arqs)
            continue
        try:
            linhas, cab, _, _ = abrir(arqs[-1])
        except (UnicodeDecodeError, IndexError, OSError):
            linhas, cab = [], []
        sug = detectar_colunas(cab, linhas)
        visto = {"arquivo": arqs[-1].name, "cabecalho": cab, "visto_em": agora, "sugerido": sug}
        if mapa.get("id"):
            sb.atualizar("mapeamento_arquivos", {"id": f"eq.{mapa['id']}"}, visto)
        else:
            sb.inserir("mapeamento_arquivos", [{"empresa_id": eid, "credor_id": cid, "tipo": tipo, **visto}])
        confirmado = bool(mapa.get("confirmado") and (mapa.get("colunas") or {}).get("contato")
                          and (mapa.get("colunas") or {}).get("status"))
        colunas = mapa["colunas"] if confirmado else sug
        # status vistos (pela coluna confirmada ou, enquanto isso, pela sugerida): o cliente já pode marcar
        if colunas.get("status"):
            vistos, primeira, ultima = Counter(), {}, {}
            for a in arqs:
                dia = data_do_arquivo(a).isoformat()
                try:
                    ls = abrir(a)[0]
                except (UnicodeDecodeError, OSError):
                    continue
                cods = [str(l.get(colunas["status"]) or "").strip()[:200] for l in ls]
                cods = [c for c in cods if c]
                vistos.update(cods)
                for c in set(cods):
                    primeira[c] = min(primeira.get(c, dia), dia)
                    ultima[c] = max(ultima.get(c, dia), dia)
            novos = []
            for c, n in vistos.items():
                antes = codigos.get(c) or {}
                linha = {"qtd": n, "primeira_vez": min(primeira[c], antes.get("primeira_vez") or primeira[c]),
                         "ultima_vez": max(ultima[c], antes.get("ultima_vez") or ultima[c]),
                         "sugerido": sugerir_marca(c), "visto_em": agora}
                if antes.get("id"):          # marca/mapeado são do cliente
                    if any(str(antes.get(k)) != str(v) for k, v in linha.items() if k != "visto_em"):
                        sb.atualizar("canal_codigos", {"id": f"eq.{antes['id']}"}, linha)
                else:
                    novos.append({"empresa_id": eid, "credor_id": cid, "canal": canal, "codigo": c, **linha})
            if novos:
                sb.inserir("canal_codigos", novos)
        if not confirmado:
            info["aguardando"][tipo] = _segurar(pasta_c, arqs)
            out(f"  retorno {NOME[canal]}: {len(arqs)} arquivo(s) aguardando o mapeamento das colunas")
            continue
        marcas = {c: r["marca"] for c, r in codigos.items() if r.get("mapeado") and r.get("marca")}
        limite = ((regras or {}).get(canal) or {}).get("limite_lote", LIMITE_LOTE)
        sem_marca = Counter()
        for a in arqs:
            regs, rel = ler_arquivo(a, canal, colunas, marcas, data_do_arquivo(a), limite)
            registros += regs
            sem_marca.update(rel.sem_marca)
            info["relatorios"][a.name] = rel.dicionario()
            if rel.lote_travado:
                info["lotes_travados"].append(a.name)
        if sem_marca:
            info["status_para_marcar"][canal] = dict(sem_marca)
        out(f"  retorno {NOME[canal]}: {len(arqs)} arquivo(s), {sum(1 for r in registros if r.canal == canal)} "
            f"status aproveitados" + (f", {len(sem_marca)} status para marcar" if sem_marca else ""))
    return registros, info


def _segurar(pasta_c: Path, arqs: list[Path]) -> list[str]:
    (pasta_c / ESPERA).mkdir(parents=True, exist_ok=True)
    for a in arqs:
        a.replace(pasta_c / ESPERA / a.name)
    return [a.name for a in arqs]


def alertas(info: dict, credor: str) -> list[str]:
    onde = f"Credores → {credor} → Configurações → Canais" if credor else "Credores → Configurações → Canais"
    saida = []
    if info.get("sem_tabela"):
        saida.append("BANCO: rode supabase/atualizar_producao_2026-10.sql para ativar o Retorno de canal "
                     "(os arquivos ficam guardados e entram depois).")
        return saida
    for tipo, arqs in info.get("aguardando", {}).items():
        if arqs:
            saida.append(f"RETORNO DE CANAL: {len(arqs)} arquivo(s) de {NOME[TIPOS[tipo]]} aguardando — aponte a "
                         f"coluna do contato e a do status em {onde}. Depois disso o MotorCob lê sozinho.")
    for canal, sts in info.get("status_para_marcar", {}).items():
        saida.append(f"STATUS PARA MARCAR ({NOME[canal]}): " + ", ".join(
            f"'{c}' {n}x" for c, n in sorted(sts.items(), key=lambda x: -x[1])[:8])
            + f". Marque inexistente, temporário, entregue, lido, clique ou bloqueio em {onde}; as linhas entram "
              "assim que marcar.")
    for a in info.get("lotes_travados", []):
        saida.append(f"LOTE SUSPEITO: no arquivo {a} mais da metade dos envios voltou como inexistente — parece falha "
                     "do fornecedor (rota), não dos números. Nenhum número foi descartado por esse arquivo; confira "
                     "com o fornecedor.")
    return saida
