"""Contrato entre o código da VM de voz (voz/) e o banco (SQL 56), num Postgres local com as migrações aplicadas.

1. Cada coluna que voz/ lê ou escreve (voz/banco.py COLUNAS e CONFLITO, e o que publicacao.py, registro.py e o
   plantão usam de empresas, credores e envios) existe no banco; o que a VM escreve em voz_chamadas tem tipo
   compatível com o valor que o código produz.
2. Caminho do modo chave de verdade: um PostgREST imitado aqui com o MESMO SQL que ele gera (INSERT ... SELECT FROM
   json_populate_recordset ... ON CONFLICT (on_conflict) DO UPDATE, como service_role) recebe o que
   RegistroBanco manda; o gatilho tarifar_chamada_voz tarifa a chamada; reenvio não duplica nem quebra a tarifação;
   a transferência fica nas colunas reais; consumo_voz sai do que o banco tarifou.
3. A configuração (voz/configuracao.py) lida do banco, com transferência cadastrada pelo padrão do banco, passa em
   voz/banco.py; o limite de cada empresa vem de voz_divisao_concorrencia; voz_config.variaveis (text[]) é lida.
4. Listas fechadas iguais nos dois lados: variaveis_voz() = VARIAVEIS_VOZ (voz/banco.py e motor/voz.py) e os
   códigos dos provedores da VM (voz/provedores) passam nos checks de voz_config.provedor e voz_chamadas.provedor.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_contrato.py
Só dados fictícios.
"""
import json
import os
import subprocess
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))

from motor import voz as MV                                  # noqa: E402
from voz import banco as B                                   # noqa: E402
from voz import configuracao as CF                           # noqa: E402
from voz import provedores as PV                             # noqa: E402
from voz.provedores.montagem import Montagem                 # noqa: E402
from voz.orquestrador.eventos import EventoChamada, para_voz_chamadas   # noqa: E402
from voz.registro import RegistroBanco                       # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]


def sql(cmd, papel=None):
    r = subprocess.run(BASE, input=(f"set role {papel};\n" if papel else "") + cmd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[:400])
    return r.stdout.strip()


ok_total = falhas = 0


def caso(nome, passou, detalhe=""):
    global ok_total, falhas
    ok_total += bool(passou)
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + nome + ("" if passou else f"  -> {str(detalhe)[:300]}"))


def lit(txt: str) -> str:
    """Texto como literal do Postgres (aspas dobradas)."""
    return "'" + str(txt).replace("'", "''") + "'"


# ------------------------------------------------------------------ PostgREST imitado (o SQL que ele gera)
class PostgrestLocal:
    """O pedaço de nuvem/supabase_api.Supabase que a voz usa, gerando o SQL do PostgREST (papel service_role)."""

    def __init__(self):
        self.enviados: list[tuple] = []

    def _filtro(self, col, expr):
        op, _, val = expr.partition(".")
        ops = {"eq": "=", "gte": ">=", "lt": "<", "gt": ">", "lte": "<="}
        return f"{json.dumps(col)} {ops[op]} {lit(val)}"

    def selecionar(self, tabela, filtros=None, ordem=None, limite=None):
        conds, off = [], 0
        for k, v in (filtros or {}).items():
            if k == "offset":
                off = int(v)
            elif k == "and":
                for p in v.strip("()").split(","):
                    c, _, e = p.partition(".")
                    conds.append(self._filtro(c, e))
            else:
                conds.append(self._filtro(k, v))
        q = f"select * from public.{tabela}" + (" where " + " and ".join(conds) if conds else "")
        if ordem:
            c, _, d = ordem.partition(".")
            q += f" order by {json.dumps(c)} {d or 'asc'}"
        q += (f" limit {int(limite)}" if limite else "") + (f" offset {off}" if off else "")
        return json.loads(sql(f"select coalesce(json_agg(t), '[]') from ({q}) t", "service_role"))

    def inserir(self, tabela, linhas, conflito=None, retornar=False, lote=1000):
        linhas = linhas if isinstance(linhas, list) else [linhas]
        cols = list(linhas[0])                     # o PostgREST usa as chaves do primeiro objeto
        self.enviados.append((tabela, conflito, linhas))
        lista = ", ".join(json.dumps(c) for c in cols)
        q = (f"insert into public.{tabela} ({lista}) select {lista} from "
             f"json_populate_recordset(null::public.{tabela}, {lit(json.dumps(linhas, default=str))})")
        if conflito:
            q += (f" on conflict ({conflito}) do update set "
                  + ", ".join(f"{json.dumps(c)} = excluded.{json.dumps(c)}" for c in cols))
        sql(q, "service_role")
        return []


# ------------------------------------------------------------------ 1. colunas
def colunas(tabela):
    out = sql(f"select coalesce(json_object_agg(column_name, data_type), '{{}}') from information_schema.columns "
              f"where table_schema = 'public' and table_name = {lit(tabela)}")
    return json.loads(out)


for tabela, mapa in B.COLUNAS.items():
    existentes = colunas(tabela)
    faltam = sorted(set(mapa.values()) - set(existentes))
    caso(f"contrato: colunas de {tabela} em voz/banco.py existem no banco", existentes and not faltam, faltam)
for tabela, chave in B.CONFLITO.items():
    alvo = ",".join(B.COLUNAS[tabela][k] for k in chave)
    idx = sql("select count(*) from pg_index i join pg_class c on c.oid = i.indrelid "
              f"where c.relname = {lit(tabela)} and i.indisunique and "
              "(select string_agg(a.attname, ',' order by k.n) from unnest(i.indkey) with ordinality k(attnum, n) "
              f" join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = {lit(alvo)}")
    caso(f"contrato: o upsert de {tabela} ({alvo}) tem índice único igual no banco", idx != "0", idx)
USADAS = {  # fora de COLUNAS: o que publicacao.py, o plantão (FonteListas) e o registro usam
    "empresas": ("id", "slug"), "credores": ("id", "empresa_id", "codigo", "ativo"),
    "envios": ("empresa_id", "credor_id", "tipo", "caminho", "nome_original", "enviado_por", "status"),
    "voz_contrato": ("concorrencia_contratada",),
}
for tabela, cols in USADAS.items():
    faltam = sorted(set(cols) - set(colunas(tabela)))
    caso(f"contrato: colunas de {tabela} usadas pela VM existem no banco", not faltam, faltam)

# listas (text[]) que a VM lê como lista
for tabela, col in (("voz_transferencias", "cabecalhos"), ("voz_config", "variaveis")):
    caso(f"contrato: {tabela}.{col} é text[] no banco (a VM lê lista)", colunas(tabela).get(col) == "ARRAY",
         colunas(tabela).get(col))
vv = sql("select array_to_json(public.variaveis_voz())")
caso("contrato: variaveis_voz() do banco = VARIAVEIS_VOZ de voz/banco.py e de motor/voz.py",
     json.loads(vv) == list(B.VARIAVEIS_VOZ) == list(MV.VARIAVEIS_VOZ), vv)

# tipo: um evento com todos os campos preenchidos, do jeito que o orquestrador monta
EV_CHEIO = EventoChamada(
    empresa_id=1, id_cliente="C1", numero_discado="11988887770", data=date(2026, 11, 5), hora=time(10, 0),
    id_chamada="ct-tipos", resultado="promessa", billsec=31, toque=8, causa_sip=200, causa_q850=16,
    dialstatus="ANSWER", amd="HUMAN", transferencia="atendida", destino="ia_humano", identidade_confirmada=True,
    data_promessa=date(2026, 11, 20), valor_promessa=150.5, retorno_em=datetime(2026, 11, 6, 9, 0), credor_id=1,
    canal="discador", id_acao="A1", tronco_id=1, tech_prefix="4321", no_pico=True, gravacao="gs://b/x.wav",
    provedor="elevenlabs", desfecho="promessa", origem_desfecho="ia", modo="real",
    atendida_em=datetime(2026, 11, 5, 10, 0, 8), encerrada_em=datetime(2026, 11, 5, 10, 0, 39),
    transferida_em=datetime(2026, 11, 5, 10, 0, 30))
TIPOS = {bool: ("boolean",), int: ("integer", "bigint", "smallint", "numeric"), float: ("numeric",),
         str: ("text",), datetime: ("timestamp with time zone",), date: ("date",), Decimal: ("numeric",)}
cv = colunas("voz_chamadas")
linha = B.para_colunas("voz_chamadas", para_voz_chamadas(EV_CHEIO))
ruins = {k: (type(v).__name__, cv.get(k)) for k, v in linha.items()
         if v is not None and cv.get(k) not in TIPOS[type(v)]}
caso("contrato: cada valor que a VM manda a voz_chamadas tem tipo compatível com a coluna", not ruins, ruins)
caso("contrato: a VM não manda colunas de tarifação (são do gatilho)",
     not set(B.SO_DO_BANCO["voz_chamadas"]) & set(linha), set(B.SO_DO_BANCO["voz_chamadas"]) & set(linha))
caso("contrato: a VM manda canal, modo, encerrada_em e a transferência nas colunas reais",
     {"canal", "modo", "encerrada_em", "transferencia", "transferida_em"} <= set(linha), sorted(linha))

# ------------------------------------------------------------------ dados (como postgres)
sql("delete from public.empresas where slug = 'vzc-alfa'")
EA = int(sql("insert into public.empresas (slug, nome) values ('vzc-alfa', 'Voz Contrato Alfa') returning id"))
CA = int(sql(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'vzc-cart', 'Carteira') returning id"))
sql(f"insert into public.voz_config (empresa_id, provedor, modo) values ({EA}, 'elevenlabs', 'real')")
TA = int(sql(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, "
             f"canais) values ({EA}, 'vzc-sp', 'Operadora Exemplo', '203.0.113.30', 'ip', '11', '1130030000', 6) returning id"))
sql(f"insert into public.voz_rotas (empresa_id, tronco_id, prioridade, tech_prefix, tipo, cadencia_inicial_s, "
    f"cadencia_incremento_s, preco_minuto, vigente_desde) values ({EA}, {TA}, 1, '4321', 'movel_vc1', 30, 6, 0.09, '2026-01-01')")
# transferência cadastrada só com o obrigatório: cabecalhos fica com o padrão do banco (text[])
sql(f"insert into public.voz_transferencias (empresa_id, credor_id, nome, destino_sip) "
    f"values ({EA}, {CA}, 'Discador', 'sip:fila@203.0.113.31')")
contrato_antes = sql("select concorrencia_contratada from public.voz_contrato")
sql("update public.voz_contrato set concorrencia_contratada = 1000")
sb = PostgrestLocal()

# ------------------------------------------------------------------ 3. configuração lida do banco
try:
    dados = CF.buscar(sb)
    cfg = B.carregar(dados)
    tf = next(t for t in cfg.transferencias if t.empresa_id == EA)
    caso("configuração: transferência cadastrada pelo padrão do banco é lida (cabecalhos text[])",
         tf.cabecalhos == B.CABECALHOS_TRANSFERENCIA and tf.credor_id == CA, tf)
    lim = cfg.config(EA).limite_simultaneas
    esperado = int(sql(f"select limite from public.voz_divisao_concorrencia where empresa_id = {EA}", "service_role"))
    caso("configuração: o limite da empresa vem da divisão do banco", lim == esperado and lim is not None, (lim, esperado))
    caso("configuração: voz_config.variaveis (padrão do banco) é lida", cfg.config(EA).variaveis == B.VARIAVEIS_PADRAO,
         cfg.config(EA).variaveis)
except Exception as ex:   # noqa: BLE001
    caso("configuração: lida do banco e validada por voz/banco.py", False, repr(ex))

# ------------------------------------------------------------------ 2. registro pelo caminho do modo chave
def evento(id_chamada, canal="agente_voz", billsec=31, transferencia="atendida"):
    e = EventoChamada(
        empresa_id=EA, id_cliente="C1", numero_discado="11988887770", data=date(2026, 11, 5), hora=time(10, 0),
        id_chamada=id_chamada, resultado="promessa", billsec=billsec, causa_sip=200, causa_q850=16,
        dialstatus="ANSWER", amd="HUMAN", transferencia=transferencia,
        destino="ia_humano" if transferencia == "atendida" else "ia", credor_id=CA, canal=canal, id_acao="A1",
        tronco_id=TA, tech_prefix="4321", rota_id=999, segundos_tarifados=1, preco_minuto=9.0, custo_operadora=9.0,
        provedor=Montagem.codigo, modo="real", atendida_em=datetime(2026, 11, 5, 10, 0, 8),
        encerrada_em=datetime(2026, 11, 5, 10, 0, 39),
        transferida_em=datetime(2026, 11, 5, 10, 0, 30) if transferencia else None,
        data_promessa=date(2026, 11, 20), valor_promessa=150.0)
    e.desfecho, e.origem_desfecho = "promessa", "ia"
    return e


reg = RegistroBanco(sb)
reg.registrar(evento("vzc-0001"))
reg.registrar(evento("vzc-0001", canal="discador"))          # mesmo id, outro canal: outra linha (chave do banco)
reg.registrar(evento("vzc-0002", transferencia="sem_operador"))
n = reg.descarregar()
caso("registro: o insert do modo chave (PostgREST) grava voz_chamadas", n == 3 and reg.erros == 0, (n, reg.erros))
caso("registro: on_conflict é a chave única do banco", sb.enviados[0][1] == "empresa_id,id_chamada,canal", sb.enviados[0][1])
t = json.loads(sql("select json_agg(t order by canal) from (select canal, modo, rota_id, segundos_tarifados, "
                   "custo_operadora::text custo, tarifada_em is not null tarifada, transferencia, transferida_em, "
                   f"destino, encerrada_em from public.voz_chamadas where empresa_id = {EA} and id_chamada = 'vzc-0001') t"))
caso("registro: o gatilho tarifou (rota do banco, 36 s de 30+6, R$ 0,054), não o que a VM calculou",
     [(x["segundos_tarifados"], x["custo"], x["tarifada"]) for x in t] == [(36, "0.05400", True)] * 2
     and all(x["rota_id"] != 999 for x in t), t)
caso("registro: canal e modo gravados", [(x["canal"], x["modo"]) for x in t] == [("agente_voz", "real"),
                                                                                 ("discador", "real")], t)
caso("registro: a transferência fica nas colunas reais (transferencia, transferida_em, destino)",
     all(x["transferencia"] == "atendida" and x["transferida_em"] and x["destino"] == "ia_humano" for x in t), t)
caso("registro: horários com fuso de Brasília",
     sql(f"select encerrada_em = '2026-11-05 10:00:39-03' from public.voz_chamadas where id_chamada = 'vzc-0001' "
         f"and canal = 'agente_voz' and empresa_id = {EA}") == "t")
reg.registrar(evento("vzc-0001"))                            # reenvio: upsert sem mexer na tarifação congelada
caso("registro: reenvio não duplica nem quebra a tarifação congelada", reg.descarregar() == 1 and reg.erros == 0
     and sql(f"select count(*) from public.voz_chamadas where empresa_id = {EA}") == "3", reg.erros)
caso("registro: sem_operador grava a transferência e o horário dela",
     sql(f"select transferencia || '|' || (transferida_em is not null) from public.voz_chamadas "
         f"where empresa_id = {EA} and id_chamada = 'vzc-0002'") == "sem_operador|true")
ruins = []
for codigo in PV.CODIGOS:      # o código de cada provedor da VM é aceito pelos checks do banco
    try:
        sql(f"begin; update public.voz_config set provedor = {lit(codigo)}, modo = case when {lit(codigo)} = "
            f"'simulador' then 'simulado' else modo end where empresa_id = {EA}; "   # simulador só no modo simulado
            f"update public.voz_chamadas set provedor = {lit(codigo)} where empresa_id = {EA}; rollback;")
    except RuntimeError as ex:
        ruins.append((codigo, str(ex)[:120]))
caso("contrato: os códigos dos provedores da VM valem em voz_config.provedor e voz_chamadas.provedor",
     not ruins and sql(f"select count(*) from public.voz_chamadas where empresa_id = {EA} and provedor = "
                       f"{lit(Montagem.codigo)}") == "3", ruins)
cons = reg.atualizar_consumo()
c = json.loads(sql(f"select json_agg(t) from (select tech_prefix, chamadas, segundos_tarifados, custo_estimado::float "
                   f"custo, rota_id is not null rota from public.consumo_voz where empresa_id = {EA}) t"))
caso("registro: consumo_voz sai do que o banco tarifou", cons == 1 and reg.erros == 0
     and c == [{"tech_prefix": "4321", "chamadas": 3, "segundos_tarifados": 108, "custo": 0.162, "rota": True}], (cons, c))

# ------------------------------------------------------------------ limpeza
sql(f"update public.voz_contrato set concorrencia_contratada = {int(contrato_antes or 0)}")
sql(f"delete from public.voz_chamadas where empresa_id = {EA}; delete from public.consumo_voz where empresa_id = {EA}; "
    f"delete from public.empresas where id = {EA}")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
