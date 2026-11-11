"""Guarda da imagem do Asterisk: todo módulo de voz/ que o gerador importa precisa estar no COPY do Dockerfile.

Sem esta guarda, um `from voz import X` novo em voz/banco.py (ou em outro módulo copiado) só quebrava no teste de
fumaça do workflow imagem-voz, que roda depois do merge em main: a imagem deixava de ser publicada e os servidores de
voz ficavam na versão antiga sem nenhum aviso no PR (aconteceu de 08/11 a 11/11, com voz/destinos.py).
"""
from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DOCKERFILE = RAIZ / "infra" / "asterisk" / "Dockerfile"


def _copiados() -> set[str]:
    """Módulos de voz/ (arquivos soltos) e pacotes (pastas) que o Dockerfile copia para /opt/motorcx/voz/."""
    texto = DOCKERFILE.read_text(encoding="utf-8")
    mods: set[str] = set()
    for linha in texto.splitlines():
        if not linha.startswith("COPY ") or "/opt/motorcx/voz" not in linha:
            continue
        for origem in linha.split()[1:-1]:
            m = re.fullmatch(r"voz/([a-z_]+)\.py", origem)
            if m:
                mods.add(m.group(1))
            m = re.fullmatch(r"voz/([a-z_]+)/?", origem)
            if m:
                mods.add(m.group(1))
    return mods


def _imports_de_voz(arquivo: Path) -> set[str]:
    """Nomes de primeiro nível em voz/ importados no topo do módulo (imports dentro de funções ficam de fora: são
    caminhos opcionais que o gerador não percorre)."""
    arvore = ast.parse(arquivo.read_text(encoding="utf-8"))
    nomes: set[str] = set()
    for no in arvore.body:
        if isinstance(no, ast.ImportFrom) and no.module:
            partes = no.module.split(".")
            if partes[0] != "voz":
                continue
            if len(partes) == 1:
                nomes.update(a.name for a in no.names)
            else:
                nomes.add(partes[1])
        elif isinstance(no, ast.Import):
            for a in no.names:
                partes = a.name.split(".")
                if partes[0] == "voz" and len(partes) > 1:
                    nomes.add(partes[1])
    return nomes


class ImagemAsteriskTeste(unittest.TestCase):
    def test_copy_tem_todos_os_modulos_importados(self):
        copiados = _copiados()
        self.assertIn("banco", copiados)
        self.assertIn("asterisk", copiados)
        arquivos: list[Path] = []
        for m in sorted(copiados):
            caminho = RAIZ / "voz" / m
            if caminho.is_dir():
                arquivos.extend(sorted(caminho.glob("*.py")))
            else:
                arquivos.append(caminho.with_suffix(".py"))
        faltando: dict[str, set[str]] = {}
        for arq in arquivos:
            if arq.name == "__init__.py" and arq.parent.name == "voz":
                continue
            for nome in _imports_de_voz(arq) - copiados:
                faltando.setdefault(nome, set()).add(str(arq.relative_to(RAIZ)))
        self.assertEqual(faltando, {}, "acrescente ao COPY de infra/asterisk/Dockerfile: "
                         + ", ".join(f"voz/{n}.py (importado em {sorted(v)})" for n, v in sorted(faltando.items())))


if __name__ == "__main__":
    unittest.main()
