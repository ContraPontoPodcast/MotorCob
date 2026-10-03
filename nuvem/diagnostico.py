"""Diagnóstico do MotorCob no Mac: por que o arquivo continua "pendente" no site?

Uso:  scripts/diagnostico.sh        (ou: python3 -m nuvem.diagnostico)

Confere, em ordem, tudo o que precisa estar certo para a vigia pegar os arquivos do site e
diz o que fazer em cada ponto que falhar. Não mostra a chave do Supabase nem dado de cliente.
"""
import os
import subprocess
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

PLIST = Path.home() / "Library" / "LaunchAgents" / "br.com.contraponto.motorcob.vigia.plist"
PLIST_DIARIO = Path.home() / "Library" / "LaunchAgents" / "br.com.contraponto.motorcob.plist"


def main():
    dados = Path(os.environ.get("MOTORCOB_DADOS", Path.home() / "MotorCob-dados"))
    problemas = []

    def ok(t):
        print(f"  ✅ {t}")

    def ruim(t, fazer):
        print(f"  ❌ {t}")
        problemas.append(fazer)

    def info(t):
        print(f"  ·  {t}")

    print("MOTORCOB — DIAGNÓSTICO\n")
    print("1. Programa")
    v = sys.version_info
    (ok if v >= (3, 11) else lambda t: ruim(t, "Instale o Python 3.12: brew install python@3.12"))(
        f"Python {v.major}.{v.minor}")
    try:
        subprocess.run(["git", "-C", str(RAIZ), "fetch", "-q", "origin", "main"], timeout=60, check=True,
                       capture_output=True)
        atras = subprocess.run(["git", "-C", str(RAIZ), "rev-list", "--count", "HEAD..origin/main"],
                               capture_output=True, text=True).stdout.strip()
        if atras == "0":
            ok("MotorCob na versão mais nova")
        else:
            ruim("MotorCob desatualizado", "Atualize: cd ~/MotorCob && git pull")
    except Exception:  # noqa: BLE001
        info("não consegui conferir a versão no GitHub (sem internet?)")

    print("\n2. Ligação com o site (Supabase)")
    env = dados / "config" / "supabase.env"
    if not env.exists():
        ruim(f"falta {env}", "Ligue o Mac ao site: cd ~/MotorCob && scripts/configurar_nuvem.sh")
        return fim(problemas)
    ok("configuração encontrada (a chave não é mostrada)")
    from nuvem.sincronizar import arquivo_entrada, carregar_config, empresas_com_carga_nova
    from nuvem.supabase_api import Supabase
    try:
        url, chave = carregar_config(dados)
        sb = Supabase(url, chave)
        empresas = sb.selecionar("empresas", {"ativa": "eq.true"}, ordem="slug.asc") or []
        ok(f"conectado a {url.split('//')[-1].split('/')[0]}")
    except Exception as ex:  # noqa: BLE001
        ruim(f"não conectou: {str(ex)[:200]}",
             "Refaça a ligação com a URL e a chave service_role certas: scripts/configurar_nuvem.sh")
        return fim(problemas)
    try:
        sb.selecionar("credores", limite=1)
        ok("banco atualizado (credores)")
        tem_credores = True
    except Exception:  # noqa: BLE001
        ruim("o banco ainda não tem credores",
             "Rode no Supabase (SQL Editor) o arquivo supabase/atualizar_producao_2026-10.sql")
        tem_credores = False
    if not empresas:
        ruim("nenhuma empresa ativa no site", "Cadastre/ative a empresa em Empresas no site")

    print("\n3. Arquivos no site")
    pend = sb.selecionar("envios", {"status": "eq.pendente"}, ordem="enviado_em.asc") or []
    nomes = {e["id"]: e["slug"] for e in empresas}
    credores = {c["id"]: c["codigo"] for c in (sb.selecionar("credores") or [])} if tem_credores else {}
    try:
        pedidos = sb.selecionar("pedidos_rotina", {"status": "in.(pendente,rodando)"}, ordem="id.asc") or []
    except Exception:  # noqa: BLE001 — banco sem a tabela de pedidos
        pedidos = []
    for p in pedidos:
        quando = (p.get("pedido_em") or "")[:16].replace("T", " ")
        cred = credores.get(p.get("credor_id"), "todas")
        msg = (f"Reenquadrar agora: pedido {p['status']} desde {quando} · {nomes.get(p['empresa_id'], p['empresa_id'])} · "
               f"carteira {cred}")
        if p["status"] == "rodando":
            info(msg)
        else:
            ruim(msg, "A vigia pega em até 5 segundos: confira a seção 5 (vigia ligada e em tempo real)")
    if not pend:
        info("nenhum arquivo pendente")
    for e in pend:
        quando = (e.get("enviado_em") or "")[:16].replace("T", " ")
        emp = nomes.get(e["empresa_id"], f"empresa {e['empresa_id']} (inativa?)")
        cred = credores.get(e.get("credor_id"), "todos" if e.get("credor_id") is None else e.get("credor_id"))
        print(f"  ·  pendente: {e['nome_original']} · tipo {e['tipo']} · {emp} · credor {cred} · enviado {quando}")
        if e["empresa_id"] not in nomes:
            ruim(f"{e['nome_original']}: a empresa do arquivo não está ativa",
                 "Ative a empresa em Empresas no site")
        if e["tipo"] not in ("base", "incremental", "retirada", "acordo", "baixa"):
            info(f"   ({e['tipo']} não dispara a lista sozinho: entra junto com a próxima carga/retirada/"
                 f"acordo/baixa, ou rode scripts/rodar_dia.sh)")
    try:
        novos = empresas_com_carga_nova(dados, sb, hoje=date.today())
        if novos:
            info("a vigia vai rodar agora (arquivo novo, orquestração alterada ou rotina do dia): "
                 + ", ".join(e["slug"] for e in novos))
        elif any(e["tipo"] in ("base", "incremental", "retirada", "acordo", "baixa") for e in pend):
            ruim("a vigia está ignorando o arquivo porque a última tentativa deu erro com ele",
                 "Rode na mão para ver o erro: scripts/rodar_dia.sh  (ou suba o arquivo de novo)")
    except Exception as ex:  # noqa: BLE001
        ruim(f"a vigia não consegue consultar os arquivos: {str(ex)[:200]}",
             "Mande esta mensagem para o suporte do MotorCob")
    for emp in empresas:
        lay = arquivo_entrada(emp)
        info(f"{emp['slug']}: leitura dos arquivos " + ("configurada (empresas/%s.json)" % emp["slug"] if lay
                                                       else "automática (confira o alerta no Início)"))
        ult = sb.selecionar("execucoes", {"empresa_id": f"eq.{emp['id']}"}, ordem="iniciada_em.desc", limite=3) or []
        for x in ult:
            quando = (x.get("iniciada_em") or "")[:16].replace("T", " ")
            msg = f"última rotina {quando}: {x['status']}" + (f" — {x.get('erro')[:300]}" if x.get("erro") else "")
            (ok if x["status"] == "ok" else info)(f"{emp['slug']} · {msg}")
            res = x.get("resumo") or {}
            if res.get("sem_acao") and x is ult[0]:
                info("   hoje: " + ", ".join(f"{k} {v}" for k, v in res["sem_acao"].items()))
                prox = next((p for p in res.get("proximos") or [] if p.get("clientes")), None)
                if prox and not (res.get("sem_acao") or {}).get("com_acao"):
                    info(f"   lista vazia hoje; próxima em {prox['data']} com ~{prox['clientes']} clientes")
        if not ult:
            info(f"{emp['slug']}: a rotina ainda não rodou nenhuma vez")

    print("\n4. Orquestração (o que o MotorCob vai usar em cada carteira)")
    try:
        _orquestracao(sb, dados, empresas, ok, ruim, info)
    except Exception as ex:  # noqa: BLE001
        info(f"não consegui ler a orquestração: {str(ex)[:200]}")

    print("\n5. Vigia (plantão em tempo real: olha o site a cada 5 segundos)")
    if sys.platform == "darwin":
        if PLIST.exists():
            ok("vigia instalada")
            if "--plantao" not in PLIST.read_text(encoding="utf-8"):
                ruim("a vigia instalada é a antiga (olha o site só a cada 2 minutos)",
                     "Troque pela de tempo real: cd ~/MotorCob && MOTORCOB_PYTHON=python3.12 scripts/instalar_mac.sh vigiar")
            lista = subprocess.run(["launchctl", "list"], capture_output=True, text=True).stdout
            if "br.com.contraponto.motorcob.vigia" in lista:
                ok("vigia ligada")
            else:
                ruim("vigia instalada mas desligada", "Ligue: MOTORCOB_PYTHON=python3.12 scripts/instalar_mac.sh vigiar")
        else:
            ruim("vigia não instalada", "Instale: cd ~/MotorCob && MOTORCOB_PYTHON=python3.12 scripts/instalar_mac.sh vigiar")
        if PLIST_DIARIO.exists():
            info("também há o agendamento diário (06:30)")
        try:
            pm = subprocess.run(["pmset", "-g"], capture_output=True, text=True).stdout
            linha = next((l for l in pm.splitlines() if l.strip().startswith("sleep")), "")
            if linha and linha.split()[1] != "0":
                info(f"o Mac dorme sozinho ({linha.strip()}): com ele dormindo a vigia não roda")
        except Exception:  # noqa: BLE001
            pass
    else:
        info("não é um Mac: a vigia (launchd) não se aplica")
    for nome in ("vigia_ultimo_erro.log", "vigia.log", f"vigia_{datetime.now():%Y-%m-%d}.log"):
        arq = dados / "logs" / nome
        if arq.exists() and arq.stat().st_size:
            linhas = arq.read_text(encoding="utf-8", errors="replace").strip().splitlines()[-6:]
            print(f"  ·  {nome} (fim):")
            for l in linhas:
                print(f"       {l[:220]}")
    return fim(problemas)


def _orquestracao(sb, dados, empresas, ok, ruim, info):
    from motor.estrategia import validar_estrategia
    from nuvem.sincronizar import credores, credores_com_orquestracao_nova, segmento_vale
    for emp in empresas:
        estr = {e["id"]: e for e in sb.selecionar("estrategias", {"empresa_id": f"eq.{emp['id']}"}) or []}
        padrao_emp = next((e for e in estr.values() if e.get("padrao")), None)
        clusters = sb.selecionar("clusters", {"empresa_id": f"eq.{emp['id']}"}, ordem="ordem.asc") or []
        try:
            vinc = {}
            for l in sb.selecionar("segmentos_carteira", {"empresa_id": f"eq.{emp['id']}"}) or []:
                vinc.setdefault(l["cluster_id"], {})[l["credor_id"]] = bool(l.get("ativo", True))
        except Exception:  # noqa: BLE001
            vinc = {}
        mudou = credores_com_orquestracao_nova(sb, emp)
        for u in credores(sb, dados, emp):
            nome = emp["slug"] + (f" / {u['codigo']}" if u["id"] is not None else "")
            base = estr.get(u.get("estrategia_id")) or padrao_emp
            origem = "da carteira" if estr.get(u.get("estrategia_id")) else "padrão da empresa"
            if u.get("demais_ativo") is False:
                info(f"{nome} · Demais clientes: DESLIGADO (quem não cai em segmento fica sem ação)")
            else:
                info(f"{nome} · Demais clientes: " + (f"esteira '{base['nome']}' ({origem})" if base
                                                       else "playbook MotorCob (nenhuma esteira padrão escolhida)"))
            em_uso = [c for c in clusters if c.get("ativo") and segmento_vale(c, u["id"], vinc)]
            for c in em_uso:
                e = estr.get(c.get("estrategia_id"))
                info(f"   segmento {c['codigo']} ({c.get('nome') or ''}) → " +
                     (f"esteira '{e['nome']}'" if e else "esteira padrão acima"))
            if not em_uso:
                info("   nenhum segmento em uso nesta carteira")
            if u["id"] in mudou:
                ruim(f"{nome}: a orquestração mudou depois da última rotina",
                     "A vigia refaz a lista em até 1 minuto; para já: scripts/rodar_dia.sh")
        for e in estr.values():
            _, avisos = validar_estrategia(e.get("definicao") or {}, e.get("nome") or str(e["id"]))
            if avisos:
                info(f"esteira '{e.get('nome')}': o MotorCob ignora — " + "; ".join(avisos[:3]))
            else:
                ok(f"esteira '{e.get('nome')}' entendida por inteiro")


def fim(problemas):
    print()
    if not problemas:
        print("Tudo certo. Se ainda estiver pendente, rode na mão e veja a mensagem: scripts/rodar_dia.sh")
        return 0
    print("O QUE FAZER (na ordem):")
    for i, p in enumerate(dict.fromkeys(problemas), 1):
        print(f"  {i}. {p}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
