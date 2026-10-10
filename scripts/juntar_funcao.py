"""Junta index.ts + regras.ts da função admin-usuarios num arquivo só (para colar no editor do Supabase).

    python3 scripts/juntar_funcao.py > MotorCob_funcao_admin-usuarios.ts
"""
from pathlib import Path

PASTA = Path(__file__).resolve().parent.parent / "supabase" / "functions" / "admin-usuarios"
regras = (PASTA / "regras.ts").read_text(encoding="utf-8")
index = (PASTA / "index.ts").read_text(encoding="utf-8")
linhas = [l for l in index.splitlines() if 'from "./regras.ts"' not in l]
cab, corpo = [], []
for l in linhas:
    (cab if not corpo and (l.startswith("//") or l.startswith("import ")) else corpo).append(l)
print("\n".join(cab) + "\n\n// ---- regras.ts\n" + regras + "\n// ---- index.ts\n" + "\n".join(corpo))
