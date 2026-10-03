"""Diagnóstico do MotorCob no Mac: por que o arquivo continua "pendente" no site?

Uso:  scripts/diagnostico.sh        (ou: python3 -m nuvem.diagnostico)

Confere, em ordem, tudo o que precisa estar certo para a vigia pegar os arquivos do site e
diz o que fazer em cada ponto que falhar. Não mostra a chave do Supabase nem dado de cliente.
"""
import os
import subprocess
import sys
from collections import Counter
from datetime import datetime
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
        novos = empresas_com_carga_nova(dados, sb)
        if novos:
            info("a vigia vai pegar agora: " + ", ".join(e["slug"] for e in novos))
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
        if not ult:
            info(f"{emp['slug']}: a rotina ainda não rodou nenhuma vez")

    print("\n4. Vigia (roda sozinha a cada 2 minutos)")
    if sys.platform == "darwin":
        if PLIST.exists():
            ok("vigia instalada")
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
