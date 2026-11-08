"""SQL 85 · Mensagens escritas sem a dívida antes da identidade (SMS, WhatsApp, RCS e e-mail).

Cobre: a migração roda duas vezes; public.mensagem_revela_divida com os mesmos casos de motor/trava_identidade.py
(tests/dados/mensagem_identidade_casos.json) e do site; o nome da empresa não conta como dívida; os textos já salvos que
revelam a dívida aparecem no raise notice só por id (frase "Padrão MotorCX" antiga, frase própria, template da
Mensageria, modelo de e-mail e estratégia com texto próprio) e nada é mudado; os neutros e os canais de voz não entram;
anon não chama a função.

Chamado pelo testar_rls.py; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_mensagem_identidade.py
Só dados fictícios (empresas e85-*).
"""
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL85 = RAIZ / "supabase" / "migrations" / "20270121000001_mensagem_identidade.sql"
CASOS = json.loads((RAIZ / "tests" / "dados" / "mensagem_identidade_casos.json").read_text(encoding="utf-8"))["casos"]


def sql(cmd, papel=None):
    pre = f"set role {papel}; " if papel else ""
    r = subprocess.run(BASE + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def caso(nome, cond, extra=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 85: " + nome + ("" if cond else f"  -> {extra}"))


def sv(cmd):
    ok, out, err = sql(cmd)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar():
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL85)], capture_output=True,
                       text=True)
    if r.returncode:
        print(r.stderr[-600:])
    return r


def q(t):
    return "'" + str(t).replace("'", "''") + "'"


def ids_do_aviso(saida, trecho):
    """ids listados na linha do raise notice que contém o trecho."""
    for linha in saida.splitlines():
        if trecho in linha:
            m = re.search(r"\((?:ids|empresas): ([0-9, ]+)\)", linha)
            return set(m.group(1).split(", ")) if m else set()
    return set()


r1, r2 = aplicar(), aplicar()
caso("a migração roda sem erro (duas vezes)", r1.returncode == 0 and r2.returncode == 0)

for c in CASOS:
    emp = "null" if c.get("empresa") is None else q(c["empresa"])
    ok, out, err = sql(f"select public.mensagem_revela_divida({q(c['texto'])}, {emp})")
    caso(f"trava: {c['texto'][:50]!r}", ok and out == ("t" if c["revela"] else "f"), out or err[:200])

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e85-{T}', 'Alfa Cobrança {T}') returning id")
NOME = f"Alfa Cobrança {T}"
ANTIGA = f"{NOME}: temos uma condição especial para o seu débito de {{saldo}}. Responda este SMS ou fale conosco."
NEUTRA = f"Olá, {{primeiro_nome}}. Você tem uma mensagem da {NOME}. Acesse: {{link}}"
F_PAD = sv(f"insert into public.frases (empresa_id, canal, nome, estagio, texto) values ({EA}, 'sms', "
           f"'Padrão MotorCX · Cliente novo', 'localizacao', {q(ANTIGA)}) returning id")
F_PAD_OK = sv(f"insert into public.frases (empresa_id, canal, nome, estagio, texto) values ({EA}, 'sms', "
              f"'Padrão MotorCX · Deu CPC', 'cpa', {q(NEUTRA)}) returning id")
F_PROP = sv(f"insert into public.frases (empresa_id, canal, nome, estagio, texto) values ({EA}, 'whatsapp', "
            f"'Lembrete {T}', 'preventivo', 'Sua parcela de {{valor_parcela}} vence amanhã.') returning id")
F_VOZ = sv(f"insert into public.frases (empresa_id, canal, nome, estagio, texto) values ({EA}, 'agente_voz', "
           f"'Voz {T}', 'cpa', 'Consta {{{{saldo}}}} em aberto.') returning id")
F_INATIVA = sv(f"insert into public.frases (empresa_id, canal, nome, estagio, texto, ativo) values ({EA}, 'sms', "
               f"'Antiga {T}', 'cpa', 'Seu saldo é {{saldo}}.', false) returning id")
TPL = sv(f"insert into public.mensageria_templates (empresa_id, canal, nome, conteudo) values ({EA}, 'sms', 'Tpl {T}', "
         f"'{{\"texto\": \"Negocie sua dívida: {{{{link}}}}\"}}') returning id")
TPL_OK = sv(f"insert into public.mensageria_templates (empresa_id, canal, nome, conteudo) values ({EA}, 'sms', 'Neutro {T}', "
            f"'{{\"texto\": \"Você tem uma mensagem. Acesse {{{{link}}}}\"}}') returning id")
sv(f"insert into public.mensageria_modelos_email (empresa_id, remetente_nome, assunto, corpo) values ({EA}, {q(NOME)}, "
   f"'Atualização do seu contrato', 'Prezado(a) cliente, há novidades. Acesse o link.')")
EST = sv(f"insert into public.estrategias (empresa_id, nome, definicao) values ({EA}, 'Est {T}', "
         f"'{{\"localizacao\": {{\"ordem\": [{{\"canal\": \"sms\", \"mensagem\": \"Pague seu boleto: {{link}}\"}}]}}}}') returning id")
EST_OK = sv(f"insert into public.estrategias (empresa_id, nome, definicao) values ({EA}, 'Est neutra {T}', "
            f"'{{\"segmentos\": [{{\"nome\": \"Acordo vencido\"}}], \"localizacao\": {{\"ordem\": [{{\"canal\": \"sms\", "
            f"\"mensagem\": {{\"frase_id\": {F_PAD_OK}}}}}]}}}}') returning id")

r = aplicar()
avisos = r.stderr
caso("frase 'Padrão MotorCX' antiga listada, a neutra não",
     F_PAD in ids_do_aviso(avisos, '"Padrão MotorCX" do Assistente') and F_PAD_OK not in ids_do_aviso(avisos, '"Padrão MotorCX" do Assistente'),
     avisos[-800:])
proprias = ids_do_aviso(avisos, "frase(s) próprias")
caso("frase própria de WhatsApp listada; voz e inativa não", F_PROP in proprias and F_VOZ not in proprias
     and F_INATIVA not in proprias, proprias)
tpls = ids_do_aviso(avisos, "template(s) da Mensageria")
caso("template da Mensageria listado, o neutro não", TPL in tpls and TPL_OK not in tpls, tpls)
caso("modelo de e-mail listado pela empresa", EA in ids_do_aviso(avisos, "modelo(s) de e-mail"))
ests = ids_do_aviso(avisos, "estratégia(s)")
caso("estratégia com texto próprio listada; a que só aponta frase (e tem segmento 'Acordo') não",
     EST in ests and EST_OK not in ests, ests)
caso("nada foi mudado", sv(f"select texto from public.frases where id = {F_PAD}") == ANTIGA
     and sv(f"select count(*) from public.frases where empresa_id = {EA}") == "5")
ok, _, _ = sql("select public.mensagem_revela_divida('x')", "anon")
caso("anon não chama mensagem_revela_divida", not ok)
ok, out, _ = sql("select public.mensagem_revela_divida('Seu saldo é {saldo}')", "authenticated")
caso("authenticated chama (o site pode usar)", ok and out == "t")

print(f"\nSQL 85: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
