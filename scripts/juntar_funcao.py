"""Junta index.ts + regras.ts de uma Edge Function num arquivo só (para colar no editor do Supabase).

    python3 scripts/juntar_funcao.py > MotorCob_funcao_admin-usuarios.ts
    python3 scripts/juntar_funcao.py api > MotorCob_funcao_api.ts
    python3 scripts/juntar_funcao.py assistente > MotorCob_funcao_assistente.ts   (inclui o conhecimento.ts)
"""
import sys
from pathlib import Path

NOME = sys.argv[1] if len(sys.argv) > 1 else "admin-usuarios"
PASTA = Path(__file__).resolve().parent.parent / "supabase" / "functions" / NOME
regras = (PASTA / "regras.ts").read_text(encoding="utf-8")
index = (PASTA / "index.ts").read_text(encoding="utf-8")
# o import de ./regras.ts pode ocupar várias linhas: some com ele inteiro
inicio = next(i for i in range(len(index)) if index.startswith("import ", i) and "./regras.ts" in index[i:index.find(";", i)])
fim = index.find(";", inicio) + 1
index = index[:inicio] + index[fim:].lstrip("\n")
linhas = index.splitlines()
cab, corpo = [], []
for l in linhas:
    (cab if not corpo and (l.startswith("//") or l.startswith("import ")) else corpo).append(l)
# outros arquivos locais importados pelo index (ex.: conhecimento.ts do Assistente) entram inteiros também
extras = []
for l in list(cab):
    if l.startswith("import ") and '"./' in l:
        arq = l.split('"./', 1)[1].split('"', 1)[0]
        extras.append(f"// ---- {arq}\n" + (PASTA / arq).read_text(encoding="utf-8"))
        cab.remove(l)
print("\n".join(cab) + "\n\n// ---- regras.ts\n" + regras + "\n" + "\n".join(extras)
      + "\n// ---- index.ts\n" + "\n".join(corpo))
