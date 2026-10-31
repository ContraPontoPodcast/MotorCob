"""Gera o comando que define a senha do papel motorcx_voz (SQL 57) SEM a senha em texto: lê a senha da entrada
padrão (direto do Secret Manager) e escreve na saída o ALTER ROLE com o verificador SCRAM-SHA-256, para ir direto ao
psql. A senha não aparece na tela, no histórico, na linha de comando nem no log do banco (só o verificador).

  gcloud secrets versions access latest --secret=motorcx-voz-db-senha \\
    | python3 infra/asterisk/senha_motorcx_voz.py | psql "<conexão do postgres>" -v ON_ERROR_STOP=1 -q

Só biblioteca padrão. O formato é o do Postgres: SCRAM-SHA-256$<iterações>:<sal>$<StoredKey>:<ServerKey>.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import sys

ITERACOES = 4096
PAPEL = "motorcx_voz"


def verificador(senha: str, sal: bytes | None = None, iteracoes: int = ITERACOES) -> str:
    sal = sal if sal is not None else os.urandom(16)
    salgada = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), sal, iteracoes)
    stored = hashlib.sha256(hmac.new(salgada, b"Client Key", "sha256").digest()).digest()
    server = hmac.new(salgada, b"Server Key", "sha256").digest()
    b64 = lambda b: base64.b64encode(b).decode()   # noqa: E731
    return f"SCRAM-SHA-256${iteracoes}:{b64(sal)}${b64(stored)}:{b64(server)}"


def comando(senha: str, sal: bytes | None = None) -> str:
    # senha gerada pelo README: só letras e dígitos (o SASLprep não muda nada); 32 a 128 caracteres
    if not re.fullmatch(r"[A-Za-z0-9]{32,128}", senha):
        raise ValueError("a senha precisa ter de 32 a 128 letras e dígitos (gere como no README, seção 7)")
    return f"alter role {PAPEL} with password '{verificador(senha, sal)}';\n"


def main() -> int:
    senha = sys.stdin.read().strip()
    try:
        sys.stdout.write(comando(senha))
    except ValueError as ex:
        print(f"ERRO: {ex}", file=sys.stderr)
        return 2
    finally:
        del senha
    return 0


if __name__ == "__main__":
    sys.exit(main())
