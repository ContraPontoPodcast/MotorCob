"""SQL 64 · Importador das gravações do discador do cliente: o banco de verdade, nos dois acessos da VM.

Cobre: o site (Admin com importar_gravacoes cadastra fontes; gestão não; credencial só pela equipe Técnico; transcrição
só pela equipe; SFTP pausado sem credencial; host interno e URL sem TLS recusados; "Ler agora"; envio pelo site com a
política do bucket gravacoes-discador e o lote), o que a VM faz pelas RPCs (pendências da parte, iniciar, par com a
transferência pelo id e pela janela, ambíguo, sem par, avulsa, reimportação sem duplicar, registro por arquivo com a
quarentena, conclusão, lote concluído, bilhete do Storage, transcrição com os minutos no item voz_transcricao uma vez
só) e o que o Speech Analytics passa a enxergar (a gravação casada entra no contexto com o operador). Depois a rodada
inteira de voz/importador/rotina.py contra este banco: como o servidor (service_role) e como o papel motorcx_voz
(login de verdade pelo psql; com pg8000, também pelo voz/acesso.py). Recusas: authenticated e anon não chamam as RPCs
da VM, motorcx_voz não lê as tabelas, nada de CPF/telefone no que vai ao banco.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_importador.py
Só dados fictícios (empresa vzi-*, clientes CLI-xxxx, operador OP-7, CPF gerado só para provar a recusa).
"""
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))

from voz import acesso as A                       # noqa: E402
from voz.importador import fontes as F            # noqa: E402
from voz.importador import manifesto as M         # noqa: E402
from voz.importador import rotina as R            # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]


def sql(cmd, papel=None, uid=None, usuario="postgres"):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-U", usuario, "-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None, usuario="postgres"):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid, usuario)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 64: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def caso(nome, passou, detalhe=""):
    global ok_total, falhas
    ok_total += bool(passou)
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 64: " + nome + ("" if passou else f"  -> {str(detalhe)[:400]}"))


def sv(cmd):
    ok, out, err = sql(cmd)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def j(v) -> str:
    return "$j$" + json.dumps(v, ensure_ascii=False, default=str) + "$j$::jsonb"


def cpf_ficticio(base9="123456789"):
    d = base9
    for n in (9, 10):
        s = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        d += str((s * 10 % 11) % 10)
    return d


def wav(segundos=2.0) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * int(8000 * segundos))
    return b.getvalue()


# reaplica o SQL 64 (prova que roda de novo com dados) e dá ao papel da VM a senha do banco de teste (CI: scram)
r = subprocess.run(["psql", "-d", BANCO, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f",
                    str(RAIZ / "supabase" / "migrations" / "20261231000001_voz_importador.sql")], capture_output=True, text=True)
assert r.returncode == 0, r.stderr
if os.environ.get("PGPASSWORD"):
    sv("alter role motorcx_voz with password '" + os.environ["PGPASSWORD"].replace("'", "''") + "'")

# ------------------------------------------------------------------ dados fictícios
sv("delete from storage.objects where bucket_id = 'gravacoes-discador' and name like 'vzi-%'")
sv("delete from auth.users where email like 'vzi.%@exemplo.test'")
sv("delete from public.empresas where slug in ('vzi-alfa', 'vzi-beta')")
EA = sv("insert into public.empresas (slug, nome) values ('vzi-alfa', 'Importador Alfa (teste)') returning id")
EB = sv("insert into public.empresas (slug, nome) values ('vzi-beta', 'Importador Beta (teste)') returning id")
CA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'cartao-vzi', 'Cartão Exemplo') returning id")
CB = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EB}, 'carteira-vzi', 'Carteira B') returning id")
sv(f"insert into public.voz_config (empresa_id, bucket_gravacoes, transcrever, speech_analytics) values "
   f"({EA}, 'proj-motorcx-grav-e{EA}', true, true), ({EB}, null, true, false)")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("ges", "gestao", EA), ("pla", "planejamento", EA), ("admb", "admin", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('vzi.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
U["tec"] = sv("insert into auth.users (email) values ('vzi.tec@exemplo.test') returning id")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, equipe_alcance='todas', empresa_id=null "
   f"where id='{U['tec']}'")
U["ate"] = sv("insert into auth.users (email) values ('vzi.ate@exemplo.test') returning id")
sv(f"update public.perfis set equipe=true, papel='planejamento', equipe_alcance='todas', empresa_id=null where id='{U['ate']}'")
HOJE = sv("select (now() at time zone 'America/Sao_Paulo')::date")
ONTEM = sv("select (now() at time zone 'America/Sao_Paulo')::date - 1")


def quando(hhmmss):
    return f"(('{ONTEM}'::date + time '{hhmmss}') at time zone 'America/Sao_Paulo')"


def lit(v):
    return "null" if v is None else "'" + str(v) + "'"


def chamada(emp, idc, cli, transferida=None, credor=None, acao=None):
    t = quando(transferida) if transferida else "null"
    return sv(f"insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, id_acao, modo, ocorrido_em, "
              f"atendida_em, resultado, transferencia, transferida_em, destino) values ({emp}, {lit(credor)}, '{idc}', "
              f"'{cli}', {lit(acao)}, 'real', {quando('09:59:00')}, {quando('10:00:00')}, 'cpc', "
              f"{lit('atendida' if transferida else None)}, {t}, {lit('ia_humano' if transferida else None)}) returning id")


CH1 = chamada(EA, "vzi0a1b2c3d4e5f6a7b8c9d0e1f2a3b4", "CLI-0001", "10:01:00", CA, "A-1")   # par pelo id da transferência
CH2 = chamada(EA, "vzi0b1b2c3d4e5f6a7b8c9d0e1f2a3b4", "CLI-0002", "11:00:00", CA, "A-2")   # par pela janela (cliente)
CH3 = chamada(EA, "vzi0c1b2c3d4e5f6a7b8c9d0e1f2a3b4", "CLI-0003", "12:00:00", CA)          # duas na mesma janela...
CH4 = chamada(EA, "vzi0d1b2c3d4e5f6a7b8c9d0e1f2a3b4", "CLI-0004", "12:00:30", CA)          # ...= ambígua
CHB = chamada(EB, "vzi0e1b2c3d4e5f6a7b8c9d0e1f2a3b4", "CLI-0009", "10:01:00", CB)          # outra empresa

# ------------------------------------------------------------------ site: fontes
checar("catálogo: importar_gravacoes só do Admin por padrão", True,
       "select admin::text||planejamento::text||operacao::text||gestao::text from public.permissoes_catalogo "
       "where codigo='importar_gravacoes'", "authenticated", U["adm"], "truefalsefalsefalse")
checar("Admin cadastra a fonte HTTPS (domínio da URL entra na lista)", True,
       f"select public.salvar_fonte_gravacoes({EA}, null, {j({'nome': 'Discador HTTPS', 'forma': 'url', 'url_lista': 'https://api.discador.exemplo.com.br/gravacoes'})}) > 0",
       "authenticated", U["adm"], "t")
FURL = sv(f"select id from public.voz_import_config where empresa_id={EA} and nome='Discador HTTPS'")
checar("a lista de domínios ganhou o da URL e a leitura automática nasce desligada", True,
       f"select array_to_string(dominios_url, ',')||'|'||leitura_automatica||'|'||so_transferencias||'|'||janela_par_s "
       f"from public.voz_import_config where id={FURL}", None, None, "api.discador.exemplo.com.br|false|true|120")
checar("gestão não cadastra fonte", False,
       f"select public.salvar_fonte_gravacoes({EA}, null, {j({'nome': 'X', 'forma': 'url', 'url_lista': 'https://a.exemplo.com/x'})})",
       "authenticated", U["ges"], erro="só o Admin")
checar("Admin de outra empresa não mexe na fonte", False,
       f"select public.salvar_fonte_gravacoes({EA}, {FURL}, {j({'leitura_automatica': True})})", "authenticated", U["admb"])
checar("a credencial nunca vem pela fonte", False,
       f"select public.salvar_fonte_gravacoes({EA}, {FURL}, {j({'segredo_ref': 'voz/x'})})", "authenticated", U["adm"],
       erro="campo que a fonte não aceita")
checar("cliente não liga a transcrição (custo por minuto)", False,
       f"select public.salvar_fonte_gravacoes({EA}, {FURL}, {j({'transcrever': True})})", "authenticated", U["adm"],
       erro="equipe MotorCX")
checar("URL sem TLS é recusada", False,
       f"select public.salvar_fonte_gravacoes({EA}, null, {j({'nome': 'Sem TLS', 'forma': 'url', 'url_lista': 'http://a.exemplo.com/x'})})",
       "authenticated", U["adm"])
checar("nome com telefone é recusado", False,
       f"select public.salvar_fonte_gravacoes({EA}, null, {j({'nome': 'Fonte 11987654321', 'forma': 'url', 'url_lista': 'https://a.exemplo.com/x'})})",
       "authenticated", U["adm"])
SFTP = {"nome": "SFTP do discador", "forma": "sftp", "adaptador": "olos", "host": "sftp.discador.exemplo.com.br",
        "usuario": "motorcx", "chave_host": "ssh-ed25519 " + "A" * 68, "pasta": "/gravacoes", "ativo": True}
checar("SFTP sem credencial pedido como ativo é recusado", False,
       f"select public.salvar_fonte_gravacoes({EA}, null, {j(SFTP)})", "authenticated", U["adm"], erro="credencial no cofre")
checar("SFTP nasce pausado sem credencial", True,
       f"select public.salvar_fonte_gravacoes({EA}, null, {j({k: v for k, v in SFTP.items() if k != 'ativo'})}); "
       f"select ativo from public.voz_import_config where empresa_id = {EA} and nome = 'SFTP do discador'",
       "authenticated", U["adm"], "f")
FSFTP = sv(f"select id from public.voz_import_config where empresa_id={EA} and nome='SFTP do discador'")
checar("SFTP em rede interna é recusado", False,
       f"select public.salvar_fonte_gravacoes({EA}, {FSFTP}, {j({'host': '10.0.0.8'})})", "authenticated", U["adm"],
       erro="rede interna")
checar("cliente não grava a credencial", False, f"select public.trocar_credencial_fonte_gravacoes({FSFTP})",
       "authenticated", U["adm"], erro="só a equipe")
checar("equipe sem gerenciar_troncos_voz não grava a credencial", False,
       f"select public.trocar_credencial_fonte_gravacoes({FSFTP})", "authenticated", U["ate"])
checar("Técnico gera a referência do cofre (o valor vai direto ao Secret Manager)", True,
       f"select public.trocar_credencial_fonte_gravacoes({FSFTP}) ~ '^voz/importador/{EA}/{FSFTP}/[0-9]{{14}}$'",
       "authenticated", U["tec"], "t")
checar("com a credencial, o Admin ativa o SFTP", True,
       f"select public.salvar_fonte_gravacoes({EA}, {FSFTP}, {j({'ativo': True})}); "
       f"select ativo from public.voz_import_config where id = {FSFTP}", "authenticated", U["adm"], "t")
checar("trocar o servidor derruba a credencial e pausa", True,
       f"select public.salvar_fonte_gravacoes({EA}, {FSFTP}, {j({'host': 'sftp2.discador.exemplo.com.br'})}); "
       f"select (segredo_ref is null)::text||ativo from public.voz_import_config where id = {FSFTP}",
       "authenticated", U["adm"], "truefalse")
checar("Técnico liga a transcrição da fonte", True,
       f"select public.salvar_fonte_gravacoes({EA}, {FURL}, {j({'transcrever': True})}); "
       f"select transcrever from public.voz_import_config where id = {FURL}", "authenticated", U["tec"], "t")
checar("nome repetido na empresa é recusado", False,
       f"select public.salvar_fonte_gravacoes({EA}, null, {j({'nome': 'discador https', 'forma': 'url', 'url_lista': 'https://b.exemplo.com/x'})})",
       "authenticated", U["adm"], erro="já existe")
checar("a função antiga do SQL 56 (equipe) continua funcionando", True,
       f"select public.salvar_importacao_voz({EA}, 'aspect', 'url', null, null, '{{}}', false, false) > 0", "authenticated", U["tec"], "t")
checar("Admin pede a leitura agora", True, f"select public.pedir_leitura_gravacoes({FURL}) is not null", "authenticated",
       U["adm"], "t")
checar("gestão vê as fontes da empresa (sem credencial: só a referência)", True,
       f"select count(*) >= 2 from public.voz_import_config where empresa_id = {EA}", "authenticated", U["ges"], "t")
checar("outra empresa não vê as fontes", True, f"select count(*) from public.voz_import_config where empresa_id = {EA}",
       "authenticated", U["admb"], 0)

# ------------------------------------------------------------------ site: envio pelo site (bucket + lote)
LOTE_UUID = "0f8e2a1c-1b2c-4d3e-8f9a-0123456789ab"
PASTA = f"vzi-alfa/{LOTE_UUID}"
checar("política do bucket: quem envia arquivos sobe na pasta da empresa", True,
       f"with x as (insert into storage.objects (bucket_id, name) values ('gravacoes-discador', '{PASTA}/1.csv') returning 1) "
       "select count(*) from x", "authenticated", U["pla"], 1)
checar("política do bucket: pasta de outra empresa é recusada", False,
       f"insert into storage.objects (bucket_id, name) values ('gravacoes-discador', 'vzi-beta/{LOTE_UUID}/1.csv')",
       "authenticated", U["pla"])
checar("política do bucket: nome original no caminho é recusado", False,
       f"insert into storage.objects (bucket_id, name) values ('gravacoes-discador', '{PASTA}/gravacao_cliente.wav')",
       "authenticated", U["pla"])
checar("política do bucket: gestão (sem enviar_arquivos) não sobe", False,
       f"insert into storage.objects (bucket_id, name) values ('gravacoes-discador', '{PASTA}/9.wav')", "authenticated", U["ges"])
for n in (2, 3):
    sv(f"insert into storage.objects (bucket_id, name) values ('gravacoes-discador', '{PASTA}/{n}.wav')")
H = lambda nome: hashlib.sha256(nome.lower().encode()).hexdigest()   # noqa: E731
ARQS = [{"caminho": f"{PASTA}/1.csv", "nome_hash": H("manifesto.csv"), "tamanho": 300},
        {"caminho": f"{PASTA}/2.wav", "nome_hash": H("a.wav"), "tamanho": 32044},
        {"caminho": f"{PASTA}/3.wav", "nome_hash": H("b.wav"), "tamanho": 32044}]
checar("lote com arquivo fora do bucket é recusado", False,
       f"select public.registrar_envio_gravacoes({EA}, {j(ARQS + [{'caminho': f'{PASTA}/4.wav', 'nome_hash': H('c.wav'), 'tamanho': 1}])})",
       "authenticated", U["pla"], erro="não está no bucket")
checar("lote sem manifesto é recusado", False, f"select public.registrar_envio_gravacoes({EA}, {j(ARQS[1:])})",
       "authenticated", U["pla"], erro="manifesto")
checar("lote com campo a mais (ex.: o nome original) é recusado", False,
       f"select public.registrar_envio_gravacoes({EA}, {j([{**ARQS[0], 'nome': 'manifesto.csv'}])})", "authenticated", U["pla"])
checar("gestão não registra envio", False, f"select public.registrar_envio_gravacoes({EA}, {j(ARQS)})", "authenticated", U["ges"])
checar("quem envia arquivos registra o lote (a fonte 'Envio pelo site' nasce sozinha)", True,
       f"select public.registrar_envio_gravacoes({EA}, {j(ARQS)}) > 0", "authenticated", U["pla"], "t")
LOTE = sv(f"select id from public.voz_import_lotes where pasta = '{PASTA}'")
FENV = sv(f"select config_id from public.voz_import_lotes where id = {LOTE}")
checar("o mesmo lote não entra duas vezes", False, f"select public.registrar_envio_gravacoes({EA}, {j(ARQS)})",
       "authenticated", U["pla"], erro="já foi registrado")
checar("o lote guarda só o hash do nome", True,
       f"select count(*) from public.voz_import_lotes where id = {LOTE} and arquivos::text like '%manifesto%'", None, None, 0)

# ------------------------------------------------------------------ VM pelas RPCs (servidor): pendências, par e registro
def srv(nome, args):
    partes = ", ".join(f"{k} => {j(v) if isinstance(v, (dict, list)) else ('null' if v is None else repr(str(v)))}"
                       for k, v in args.items())
    ok, out, err = sql(f"select to_jsonb(public.{nome}({partes}))", "service_role")
    if not ok:
        raise RuntimeError(err[:300])
    return json.loads(out) if out else None


checar("site não chama as RPCs da VM", False, "select public.importacao_voz_pendente('1/1')", "authenticated", U["adm"])
checar("anon não chama as RPCs da VM", False, "select public.importacao_voz_pendente('1/1')", "anon")
P = srv("importacao_voz_pendente", {"parte": "1/1"})
mine = {f["fonte_id"]: f for f in P["fontes"] if f["empresa_id"] == int(EA)}
caso("pendências: o pedido da HTTPS e o lote do envio pelo site; o SFTP pausado não",
     set(mine) == {int(FURL), int(FENV)} and mine[int(FURL)]["motivo"] == "pedido"
     and [l["id"] for l in mine[int(FENV)]["lotes"]] == [int(LOTE)] and mine[int(FENV)]["motivo"] == "envio", mine)
caso("pendências trazem bucket, transcrição, carteiras e só a referência do segredo",
     mine[int(FURL)]["bucket"] == f"proj-motorcx-grav-e{EA}" and mine[int(FURL)]["transcrever"] is True
     and mine[int(FURL)]["carteiras"].get("cartao-vzi") == int(CA) and mine[int(FURL)]["segredo_ref"] is None,
     mine.get(int(FURL)))
outra = srv("importacao_voz_pendente", {"parte": f"{2 if int(EA) % 2 == 0 else 1}/2"})
caso("pendências respeitam a parte da VM (empresa par → VM 1)", all(f["empresa_id"] != int(EA) for f in outra["fontes"]))

E1 = srv("iniciar_importacao_voz", {"fonte": FENV, "origem": "envio", "lote": LOTE})
checar("o lote fica em processamento", True, f"select situacao from public.voz_import_lotes where id = {LOTE}", None, None,
       "processando")
caso("iniciar de novo o mesmo lote é recusado", not sql(f"select public.iniciar_importacao_voz({FENV}, 'envio', {LOTE})",
                                                        "service_role")[0])
# bilhete do Storage para a VM: baixar só enquanto o lote está pendente/processando, apagar só depois
checar("VM ganha bilhete para baixar o arquivo do lote", True,
       f"select length(voz_vm.bilhete_arquivo('baixar', 'gravacoes-discador', '{PASTA}/2.wav'))", usuario="motorcx_voz", valor=64)
checar("VM não ganha bilhete para arquivo fora do lote", False,
       f"select voz_vm.bilhete_arquivo('baixar', 'gravacoes-discador', '{PASTA}/9.wav')", usuario="motorcx_voz")
checar("VM não ganha bilhete para apagar antes de concluir", False,
       f"select voz_vm.bilhete_arquivo('apagar', 'gravacoes-discador', '{PASTA}/2.wav')", usuario="motorcx_voz")
checar("VM não ganha bilhete para enviar no bucket do site", False,
       f"select voz_vm.bilhete_arquivo('enviar', 'gravacoes-discador', '{PASTA}/2.wav')", usuario="motorcx_voz")

CH_ = {k: M.chave(int(EA), k) for k in ("d-1", "d-2", "d-3", "d-4", "d-5", "d-6")}
LIN = [{"chave": CH_["d-1"], "id_chamada_motorcx": "vzi0a1b2c3d4e5f6a7b8c9d0e1f2a3b4", "inicio": f"{ONTEM}T10:01:05-03:00"},
       {"chave": CH_["d-2"], "inicio": f"{ONTEM}T11:00:40-03:00", "id_cliente": "CLI-0002"},
       {"chave": CH_["d-3"], "inicio": f"{ONTEM}T12:00:10-03:00"},
       {"chave": CH_["d-4"], "inicio": f"{ONTEM}T15:00:00-03:00", "id_cliente": "CLI-0005"},
       {"chave": CH_["d-5"], "id_chamada_motorcx": "vzi0e1b2c3d4e5f6a7b8c9d0e1f2a3b4", "inicio": f"{ONTEM}T10:01:00-03:00"},
       {"chave": CH_["d-6"], "id_chamada_motorcx": "vzi0a1b2c3d4e5f6a7b8c9d0e1f2a3b4", "inicio": f"{ONTEM}T10:01:00-03:00",
        "id_cliente": "CLI-0099"}]
PR = {x["chave"]: x for x in srv("preparar_importacao_voz", {"execucao": E1, "linhas": LIN})}
caso("par pelo id da transferência (X-MotorCX-Id-Chamada): cliente, ação e carteira da chamada",
     PR[CH_["d-1"]].get("situacao") == "casada" and PR[CH_["d-1"]].get("chamada_id") == int(CH1)
     and PR[CH_["d-1"]].get("id_cliente") == "CLI-0001" and PR[CH_["d-1"]].get("id_acao") == "A-1"
     and PR[CH_["d-1"]].get("credor_id") == int(CA), PR[CH_["d-1"]])
caso("par pela janela de tempo com o cliente", PR[CH_["d-2"]].get("chamada_id") == int(CH2), PR[CH_["d-2"]])
caso("duas transferências na janela: ambígua, nunca no palpite", PR[CH_["d-3"]].get("motivo") == "par_ambiguo"
     and "chamada_id" not in PR[CH_["d-3"]], PR[CH_["d-3"]])
caso("sem transferência na janela, fonte só de transferências: sem_par", PR[CH_["d-4"]].get("motivo") == "sem_par"
     and PR[CH_["d-4"]].get("situacao") == "quarentena", PR[CH_["d-4"]])
caso("transferência de outra empresa não casa", PR[CH_["d-5"]].get("motivo") == "sem_par", PR[CH_["d-5"]])
caso("cliente do manifesto diferente do da chamada: par_conflitante", PR[CH_["d-6"]].get("motivo") == "par_conflitante",
     PR[CH_["d-6"]])

CAM = lambda k, ext="wav": f"discador/{ONTEM.replace('-', '/')}/{CH_[k]}.{ext}"   # noqa: E731
G = [{"chave": CH_["d-1"], "caminho": CAM("d-1"), "chamada_id": int(CH1), "credor_id": int(CA), "id_cliente": "CLI-0001",
      "id_acao": "A-1", "operador_ref": "OP-7", "duracao_s": 93, "gravada_em": f"{ONTEM}T10:01:05-03:00", "transcrever": True},
     {"chave": CH_["d-2"], "caminho": CAM("d-2"), "chamada_id": int(CH2), "credor_id": int(CA), "id_cliente": "CLI-0002",
      "operador_ref": None, "duracao_s": 40, "gravada_em": f"{ONTEM}T11:00:40-03:00", "transcrever": False}]
RG = {x["chave"]: x for x in srv("registrar_importacao_voz", {"execucao": E1, "gravacoes": G})}
caso("registra as gravações novas", all(x["nova"] for x in RG.values()) and len(RG) == 2, RG)
GID = RG[CH_["d-1"]]["gravacao_id"]
checar("voz_gravacoes: origem discador, operador, chamada da IA, transcrição pendente e validade de 90 dias", True,
       f"select origem||'|'||operador_ref||'|'||chamada_id||'|'||transcricao||'|'||(expira_em - gravada_em = interval '90 days') "
       f"from public.voz_gravacoes where id = {GID}", None, None, f"discador|OP-7|{CH1}|pendente|true")
checar("a chamada da IA fica marcada com gravação", True, f"select tem_gravacao from public.voz_chamadas where id = {CH1}",
       None, None, "t")
RG2 = srv("registrar_importacao_voz", {"execucao": E1, "gravacoes": G})
caso("reimportar não duplica", [x["nova"] for x in RG2] == [False, False]
     and sv(f"select count(*) from public.voz_gravacoes where empresa_id = {EA} and origem = 'discador'") == "2", RG2)
PR2 = srv("preparar_importacao_voz", {"execucao": E1, "linhas": LIN[:1]})[0]
caso("preparar avisa que já existe (a VM não baixa de novo)", PR2.get("existe") is True and PR2.get("gravacao_id") == GID, PR2)
caso("registrar com chamada de outra empresa é recusado", not sql(
    f"select public.registrar_importacao_voz({E1}, {j([{**G[0], 'chave': CH_['d-5'], 'caminho': CAM('d-5'), 'chamada_id': int(CHB)}])})",
    "service_role")[0])
caso("registrar com caminho que não é da chave é recusado", not sql(
    f"select public.registrar_importacao_voz({E1}, {j([{**G[0], 'chave': CH_['d-4'], 'caminho': 'discador/2026/11/01/11987654321.wav'}])})",
    "service_role")[0])
# o Speech Analytics passa a enxergar a gravação casada (ref = id da gravação), com o operador
CTX = srv("speech_contexto_voz", {"empresa": EA, "refs": [{"ref": str(GID), "caminho": ""}]})
c0 = (CTX.get("chamadas") or [{}])[0]
caso("Speech Analytics: a gravação importada entra no contexto (origem discador, operador, chamada da IA)",
     c0.get("gravacao_id") == GID and c0.get("origem") == "discador" and c0.get("operador_ref") == "OP-7"
     and c0.get("chamada_id") == int(CH1) and c0.get("transferida_s") is not None, CTX)

ARQ = {"nome": "envio 1 · manifesto 1", "assinatura": "a" * 64, "linhas": 6, "importadas": 2, "casadas": 2, "duplicadas": 0,
       "rejeitadas": 4, "sem_operador": 1, "minutos": 2.2, "motivos": {"par_ambiguo": 1, "sem_par": 2, "par_conflitante": 1},
       "quarentena": [{"ref": "d-3", "motivo": "par_ambiguo", "linha": 3, "detalhe": "mais de uma transferência"},
                      {"ref": "h-abcdefghij", "motivo": "sem_par", "linha": 4, "detalhe": ""}]}
AID = srv("registrar_arquivo_importacao_voz", {"execucao": E1, "arquivo": ARQ})
caso("registro por arquivo gravado", int(AID) > 0)
caso("quarentena com telefone na referência é recusada", not sql(
    f"select public.registrar_arquivo_importacao_voz({E1}, {j({**ARQ, 'quarentena': [{'ref': '11987654321', 'motivo': 'sem_par'}]})})",
    "service_role")[0])
caso("motivo fora da lista é recusado", not sql(
    f"select public.registrar_arquivo_importacao_voz({E1}, {j({**ARQ, 'quarentena': [{'ref': 'x-1', 'motivo': 'palpite'}]})})",
    "service_role")[0])
checar("nome de arquivo com telefone vira [nome descartado]", True,
       f"select public.registrar_arquivo_importacao_voz({E1}, {j({**ARQ, 'nome': 'gravacoes_11987654321.csv', 'quarentena': []})}); "
       f"select nome from public.voz_import_arquivos where execucao_id = {E1} order by id desc limit 1", "service_role", None,
       "[nome descartado]")
FIM = srv("concluir_importacao_voz", {"execucao": E1, "erro": None})
caso("concluir soma os arquivos na execução", FIM.get("arquivos") == 2 and FIM.get("importadas") == 4, FIM)
checar("execução fechada e o lote concluído", True,
       f"select e.origem||'|'||e.quarentena||'|'||(e.terminada_em is not null)||'|'||l.situacao from public.voz_import_execucoes e "
       f"join public.voz_import_lotes l on l.execucao_id = e.id where e.id = {E1}", None, None, "envio|8|true|concluido")
checar("o site lê o registro e a quarentena da empresa", True,
       f"select count(*) from public.voz_import_quarentena where execucao_id = {E1}", "authenticated", U["ges"], 2)
checar("outra empresa não lê o registro", True, f"select count(*) from public.voz_import_arquivos where execucao_id = {E1}",
       "authenticated", U["admb"], 0)
checar("site não grava no registro", False, f"delete from public.voz_import_arquivos where execucao_id = {E1}",
       "authenticated", U["adm"], erro="permission denied")
caso("execução concluída não recebe mais nada", not sql(f"select public.concluir_importacao_voz({E1})", "service_role")[0])
checar("VM ganha bilhete para apagar o arquivo do lote concluído", True,
       f"select length(voz_vm.bilhete_arquivo('apagar', 'gravacoes-discador', '{PASTA}/2.wav'))", usuario="motorcx_voz", valor=64)
checar("VM não baixa mais o lote concluído", False,
       f"select voz_vm.bilhete_arquivo('baixar', 'gravacoes-discador', '{PASTA}/2.wav')", usuario="motorcx_voz")
P2 = srv("importacao_voz_pendente", {"parte": "1/1"})
caso("o lote concluído aparece para apagar do Storage", any(a["lote"] == int(LOTE) for a in P2["apagar"]), P2["apagar"])
srv("marcar_envio_gravacoes_apagado", {"lote": LOTE})
checar("lote marcado como apagado", True, f"select apagado_em is not null from public.voz_import_lotes where id = {LOTE}",
       None, None, "t")

# transcrição: situação e minutos (item voz_transcricao) uma vez só
COMP = f"date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date"
ANTES = sv(f"select coalesce(sum(quantidade), 0) from public.consumo_ia where empresa_id = {EA} and item = 'voz_transcricao'")
T1 = srv("registrar_transcricao_voz", {"empresa": EA, "itens": [{"gravacao_id": GID, "situacao": "ok", "duracao_s": 93}]})
T2 = srv("registrar_transcricao_voz", {"empresa": EA, "itens": [{"gravacao_id": GID, "situacao": "ok", "duracao_s": 93}]})
caso("transcrição ok registra 1,55 min uma vez só", float(T1["minutos"]) == 1.55 and float(T2["minutos"]) == 0, (T1, T2))
checar("minutos no consumo de IA (margem) e na fatura (item voz_transcricao)", True,
       f"select (select sum(quantidade) from public.consumo_ia where empresa_id = {EA} and item = 'voz_transcricao' "
       f"and competencia = {COMP}) - {ANTES}||'|'||(select quantidade from public.consumo_mensageria where empresa_id = {EA} "
       f"and item = 'voz_transcricao' and competencia = {COMP})", None, None, "1.5500|2")
checar("voz_gravacoes.transcricao = ok com os minutos", True,
       f"select transcricao||'|'||minutos_transcritos from public.voz_gravacoes where id = {GID}", None, None, "ok|1.55")
caso("transcrição de gravação de outra empresa não muda nada",
     float(srv("registrar_transcricao_voz", {"empresa": EB, "itens": [{"gravacao_id": GID, "situacao": "erro"}]})["atualizadas"]) == 0)

# ------------------------------------------------------------------ papel motorcx_voz: só voz_vm
for t in ("voz_import_config", "voz_import_lotes", "voz_import_arquivos", "voz_gravacoes"):
    checar(f"motorcx_voz não lê public.{t}", False, f"select count(*) from public.{t}", usuario="motorcx_voz")
checar("motorcx_voz não chama a RPC do public direto", False, f"select public.registrar_importacao_voz({E1}, '[]')",
       usuario="motorcx_voz")
checar("motorcx_voz chama as funções de voz_vm", True,
       f"select jsonb_typeof(voz_vm.importacao_pendente('{{\"parte\": \"1/1\"}}'))", usuario="motorcx_voz", valor="object")
checar("motorcx_voz não inicia importação de empresa sem voz", False,
       "select voz_vm.iniciar_importacao('{\"fonte\": 999999999, \"origem\": \"pedido\"}')", usuario="motorcx_voz")


# ------------------------------------------------------------------ a rodada do voz/importador/rotina.py contra o banco
class Servidor:
    """Como o PostgREST com a chave do servidor (service_role). O conteúdo do Storage fica num dicionário (o stub do
    Supabase não guarda bytes)."""

    def __init__(self, conteudo):
        self.conteudo, self.chamadas = conteudo, []

    def rpc(self, nome, args=None):
        self.chamadas.append(json.dumps([nome, args], default=str, ensure_ascii=False))
        return srv(nome, args or {})

    def baixar(self, bucket, caminho):
        return self.conteudo[(bucket, caminho)]

    def apagar_arquivos(self, bucket, caminhos):
        for c in caminhos:
            self.conteudo.pop((bucket, c), None)
            sv(f"delete from storage.objects where bucket_id = '{bucket}' and name = '{c}'")


class VMPeloPsql(Servidor):
    """O papel motorcx_voz (login de verdade): as RPCs pelas funções de voz_vm (voz/acesso.py › RPC) e os arquivos pelo
    bilhete do SQL 57, trocado como a Edge Function voz-arquivos faz (consumir_bilhete_voz como service_role)."""

    def rpc(self, nome, args=None):
        self.chamadas.append(json.dumps([nome, args], default=str, ensure_ascii=False))
        if nome not in A.RPC:
            raise A.AcessoNegado(nome)
        ok, out, err = sql(f"select voz_vm.{A.RPC[nome]}({j(args or {})})", usuario="motorcx_voz")
        if not ok:
            raise RuntimeError(err[:300])
        return json.loads(out) if out else None

    def _bilhete(self, op, bucket, caminho):
        ok, b, err = sql(f"select voz_vm.bilhete_arquivo('{op}', '{bucket}', '{caminho}')", usuario="motorcx_voz")
        if not ok:
            raise A.ErroArquivo(err[:200])
        ok, uso, err = sql(f"select operacao||'|'||bucket||'|'||caminho from public.consumir_bilhete_voz("
                           f"'{hashlib.sha256(b.encode()).hexdigest()}')", "service_role")
        if not ok or uso != f"{op}|{bucket}|{caminho}":
            raise A.ErroArquivo("bilhete recusado")

    def baixar(self, bucket, caminho):
        self._bilhete("baixar", bucket, caminho)
        return super().baixar(bucket, caminho)

    def apagar_arquivos(self, bucket, caminhos):
        for c in caminhos:
            self._bilhete("apagar", bucket, c)
        super().apagar_arquivos(bucket, caminhos)


CPF = cpf_ficticio()


def lote_do_site(uuid_, linhas, audios):
    pasta = f"vzi-alfa/{uuid_}"
    conteudo = {}
    man = ("id_chamada;inicio;duracao_s;arquivo;operador_ref;id_cliente;carteira;id_chamada_motorcx\n" +
           "\n".join(linhas) + "\n").encode()
    arqs = [{"caminho": f"{pasta}/1.csv", "nome_hash": F.hash_nome("indice.csv"), "tamanho": len(man)}]
    conteudo[("gravacoes-discador", f"{pasta}/1.csv")] = man
    for i, (nome, dados) in enumerate(audios.items(), start=2):
        arqs.append({"caminho": f"{pasta}/{i}.wav", "nome_hash": F.hash_nome(nome), "tamanho": len(dados)})
        conteudo[("gravacoes-discador", f"{pasta}/{i}.wav")] = dados
    for a in arqs:
        sv(f"insert into storage.objects (bucket_id, name) values ('gravacoes-discador', '{a['caminho']}')")
    ok, lid, err = sql(f"select public.registrar_envio_gravacoes({EA}, {j(arqs)})", "authenticated", U["pla"])
    assert ok, err
    return lid, conteudo


def rodada(cliente, nome, uuid_, prefixo):
    ch5 = chamada(EA, f"{prefixo}5b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", "CLI-0105", "16:00:00", CA, "A-105")
    lid, conteudo = lote_do_site(uuid_, [
        f"{prefixo}-1;{ONTEM} 16:00:05;61;Op Sete.WAV;OP-7;;cartao-vzi;{prefixo}5b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        f"{prefixo}-2;{ONTEM} 17:00:00;30;b.wav;OP-8;CLI-0200;;",
        f"{prefixo}-3;{ONTEM} 17:05:00;30;c.wav;OP-8;{CPF};;",
        f"{prefixo}-4;{ONTEM} 17:06:00;30;nao-veio.wav;OP-8;CLI-0201;;mcx-que-nao-existe"],
        {"op sete.wav": wav(1), "b.wav": wav(1), "c.wav": wav(1)})
    cliente.conteudo.update(conteudo)
    with tempfile.TemporaryDirectory() as tmp:
        imp = R.Importador(cliente, R.BucketLocal(Path(tmp) / "gcs"), Path(tmp) / "importadas")
        out = imp.rodar("1/1")
        g = sv(f"select id||'|'||chamada_id||'|'||coalesce(operador_ref, '') from public.voz_gravacoes "
               f"where empresa_id = {EA} and chave_importacao = '{M.chave(int(EA), prefixo + '-1')}'")
        gid = g.split("|")[0] if g else ""
        caso(f"{nome}: a rodada importa a casada (a fonte só de transferências manda o resto para a quarentena)",
             out.get("importadas") == 1 and out.get("casadas") == 1 and out.get("rejeitadas") == 3
             and g == f"{gid}|{ch5}|OP-7", (out, g))
        caso(f"{nome}: o áudio fica para o Whisper com o id da gravação",
             gid != "" and (Path(tmp) / "importadas" / f"empresa_{EA}" / f"{gid}.wav").exists())
        caso(f"{nome}: o objeto no bucket da empresa é discador/<dia>/<chave>.wav",
             (Path(tmp) / "gcs" / f"proj-motorcx-grav-e{EA}" / "discador" / ONTEM.replace("-", "/") /
              f"{M.chave(int(EA), prefixo + '-1')}.wav").exists())
        motivos = json.loads(sv(f"select motivos from public.voz_import_arquivos a join public.voz_import_lotes l "
                                f"on l.execucao_id = a.execucao_id where l.id = {lid}"))
        caso(f"{nome}: motivos do arquivo no registro", motivos == {"sem_par": 2, "dado_pessoal": 1}, motivos)
        out2 = imp.rodar("1/1")
        caso(f"{nome}: a rodada seguinte apaga o lote do Storage", out2.get("lotes_apagados", 0) >= 1
             and sv(f"select count(*) from storage.objects where bucket_id = 'gravacoes-discador' and name like 'vzi-alfa/{uuid_}/%'") == "0",
             out2)
    caso(f"{nome}: nada de CPF no que foi ao banco", CPF not in "".join(cliente.chamadas))


# a fonte do envio pelo site guarda avulsas? não: só transferências (padrão). O pedido da HTTPS segue pendente e sem
# leitor de verdade aqui: tira o pedido para a rodada não tentar a rede
sv(f"update public.voz_import_config set pedido_em = null where id = {FURL}")
checar("Técnico liga a transcrição do envio pelo site", True,
       f"select public.salvar_fonte_gravacoes({EA}, {FENV}, {j({'transcrever': True})}); "
       f"select transcrever from public.voz_import_config where id = {FENV}", "authenticated", U["tec"], "t")
rodada(Servidor({}), "servidor (service_role)", "1a2b3c4d-1111-4d3e-8f9a-0123456789ab", "srv")
rodada(VMPeloPsql({}), "VM (motorcx_voz pelo psql)", "1a2b3c4d-2222-4d3e-8f9a-0123456789ab", "vmp")

try:
    import pg8000.native as PG
except ImportError:   # o CI não tem o driver; a VM tem (voz/requirements.txt)
    PG = None
    print("AVISO: pg8000 ausente, pulando a rodada pelo voz/acesso.py")
if PG is not None:
    SOCK = os.path.join(os.environ.get("PGHOST", "/tmp"), f".s.PGSQL.{os.environ.get('PGPORT', '5432')}")
    conteudo_pg: dict = {}

    class Resposta(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def edge_function(req, timeout=None):
        import urllib.error
        h = {k.lower(): v for k, v in req.header_items()}
        ok, uso, _ = sql("select operacao||'|'||bucket||'|'||caminho from public.consumir_bilhete_voz("
                         f"'{hashlib.sha256(h['x-voz-bilhete'].encode()).hexdigest()}')", "service_role")
        op, bucket, caminho = (uso.split("|") + ["", "", ""])[:3]
        if not ok or op != h["x-voz-operacao"]:
            raise urllib.error.HTTPError(req.full_url, 403, "bilhete", {}, None)
        if op == "baixar":
            return Resposta(conteudo_pg[(bucket, caminho)])
        conteudo_pg.pop((bucket, caminho), None)
        sv(f"delete from storage.objects where bucket_id = '{bucket}' and name = '{caminho}'")
        return Resposta(b"ok")

    class AcessoComRegistro(A.AcessoProprio):
        chamadas: list = []

        @property
        def conteudo(self):
            return conteudo_pg

        def rpc(self, funcao, args=None):
            self.chamadas.append(json.dumps([funcao, args], default=str, ensure_ascii=False))
            return super().rpc(funcao, args)

    vm = AcessoComRegistro(lambda: PG.Connection("motorcx_voz", unix_sock=SOCK, database=BANCO,
                                                 password=os.environ.get("PGPASSWORD") or None),
                           "https://exemplo-ref.supabase.co", abrir=edge_function)
    rodada(vm, "VM (voz/acesso.py com pg8000)", "1a2b3c4d-3333-4d3e-8f9a-0123456789ab", "pga")
    vm.fechar()

# ------------------------------------------------------------------ limpeza
sv("delete from storage.objects where bucket_id = 'gravacoes-discador' and name like 'vzi-%'")
sv(f"delete from public.consumo_mensageria where empresa_id in ({EA}, {EB})")
sv(f"delete from public.consumo_ia where empresa_id in ({EA}, {EB})")
sv("delete from auth.users where email like 'vzi.%@exemplo.test'")
sv(f"delete from public.empresas where id in ({EA}, {EB})")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
