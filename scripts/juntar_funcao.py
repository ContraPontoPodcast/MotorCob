"""Junta uma Edge Function num arquivo só (para colar no editor do Supabase): o index.ts e todos os arquivos locais
que ele importa, direta ou indiretamente (regras.ts, servico.ts, demonstrativo.ts, conhecimento.ts...), na ordem
certa, com os imports externos (jsr:, npm:) reunidos no topo.

    python3 scripts/juntar_funcao.py > MotorCob_funcao_admin-usuarios.ts
    python3 scripts/juntar_funcao.py api > MotorCob_funcao_api.ts
    python3 scripts/juntar_funcao.py assistente > MotorCob_funcao_assistente.ts   (inclui o conhecimento.ts)
    python3 scripts/juntar_funcao.py cobranca > MotorCob_funcao_cobranca.ts       (inclui servico e demonstrativo)
"""
import re
import sys
from pathlib import Path

NOME = sys.argv[1] if len(sys.argv) > 1 else "admin-usuarios"
PASTA = Path(__file__).resolve().parent.parent / "supabase" / "functions" / NOME
# um import inteiro, mesmo em várias linhas: import { a, type B } from "origem";
IMPORT = re.compile(r'^import\s[^;]*?\sfrom\s+"([^"]+)";[ \t]*\n?', re.M | re.S)
NOMEADO = re.compile(r'^import\s+\{([^}]*)\}\s+from\s+"([^"]+)";?$', re.S)

ordem, vistos = [], set()
externos: dict[str, list[str]] = {}     # origem -> nomes importados (import { ... } from "origem")
outros: list[str] = []                   # import * as X / default: entram como estão, sem repetir


def visitar(arquivo: str) -> None:
    if arquivo in vistos:
        return
    vistos.add(arquivo)
    texto = (PASTA / arquivo).read_text(encoding="utf-8")
    for m in IMPORT.finditer(texto):
        origem = m.group(1)
        if origem.startswith("./"):
            visitar(origem[2:])
            continue
        trecho = m.group(0).strip()
        n = NOMEADO.match(trecho)
        if n:
            lista = externos.setdefault(origem, [])
            for nome in (x.strip() for x in n.group(1).split(",")):
                if nome and nome not in lista:
                    lista.append(nome)
        elif trecho not in outros:
            outros.append(trecho)
    ordem.append((arquivo, IMPORT.sub("", texto).strip("\n")))


visitar("index.ts")
saida = [f"// Edge Function {NOME} num arquivo só: gerado por scripts/juntar_funcao.py. Não edite aqui; edite os"
         f" arquivos de supabase/functions/{NOME}/ e gere de novo."]
saida += [f'import {{ {", ".join(nomes)} }} from "{origem}";' for origem, nomes in externos.items()] + outros
for arquivo, corpo in ordem:
    saida.append(f"\n// ---- {arquivo}\n{corpo}")
print("\n".join(saida))
