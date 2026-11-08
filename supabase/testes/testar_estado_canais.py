"""SQL 84 · Estado dos canais: estado_canais(empresa) com os sinais que já existem no banco.

Cobre: a migração roda duas vezes; dias_uteis_entre; os 5 estados (funcionando, atenção, com problema, não configurado,
pausado) e os limiares aprovados (entrega 24 h < 80% ou 15 pontos abaixo da média de 7 dias; orçamento > 90% com
"bloquear"; retorno sem chegar há mais de 1 dia útil; código sem mapear; rota de voz pausada; tronco com erro de
configuração); quem envia (MotorCX, lista, Voz MotorCX); o mais grave vale; resumo; só agregados (nenhum id de cliente,
destino ou máscara na resposta); permissões (editar_canais da própria empresa, equipe; operação sem editar_canais, outra
empresa e anon não).

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_estado_canais.py
Só dados fictícios (empresas e84-*, e-mails @exemplo.test, ids de cliente C84-*).
"""
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL84 = RAIZ / "supabase" / "migrations" / "20270120000001_estado_canais.sql"


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 84: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def afirmar(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 84: " + nome + ("" if cond else f"  -> {detalhe}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL84)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

# ------------------------------------------------------------------ dias úteis
checar("dias úteis: sexta → segunda = 1", True, "select public.dias_uteis_entre('2026-11-06', '2026-11-09')", valor=1)
checar("dias úteis: quinta → segunda = 2", True, "select public.dias_uteis_entre('2026-11-05', '2026-11-09')", valor=2)
checar("dias úteis: mesmo dia = 0", True, "select public.dias_uteis_entre('2026-11-09', '2026-11-09')", valor=0)
checar("dias úteis: nulo = 0", True, "select public.dias_uteis_entre(null, '2026-11-09')", valor=0)

# O testar_rls.py reaplica migrações antigas antes deste teste; uma delas (SQL da Mensageria, out/2026) volta o check do
# canal do lote para só sms/email. Aqui ele fica como nas migrações vigentes (20261111: sms, email, rcs e whatsapp).
sv("alter table public.mensageria_lotes drop constraint if exists mensageria_lotes_canal_check; "
   "alter table public.mensageria_lotes add constraint mensageria_lotes_canal_check "
   "check (canal in ('sms', 'email', 'rcs', 'whatsapp'))")
T = uuid.uuid4().hex[:6]
HOJE = "(now() at time zone 'America/Sao_Paulo')::date"
EA = sv(f"insert into public.empresas (slug, nome) values ('e84-a-{T}', 'E84 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e84-b-{T}', 'E84 B {T}') returning id")
EC = sv(f"insert into public.empresas (slug, nome) values ('e84-c-{T}', 'E84 C {T}') returning id")
CRA = sv(f"select id from public.credores where empresa_id = {EA} order by id limit 1")
U = {}
for p in ("plan", "oper", "planb", "master", "planc"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}84-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='planejamento', empresa_id={EA} where id='{U['plan']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['oper']}'")
sv(f"update public.perfis set papel='planejamento', empresa_id={EB} where id='{U['planb']}'")
sv(f"update public.perfis set papel='planejamento', empresa_id={EC} where id='{U['planc']}'")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['master']}'")
P = ("authenticated", U["plan"])
O = ("authenticated", U["oper"])
B = ("authenticated", U["planb"])
C = ("authenticated", U["planc"])
M = ("authenticated", U["master"])


def estado(emp, quem=P):
    return json.loads(sv(f"select public.estado_canais({emp})", *quem))


def canal(r, c):
    return next(x for x in r["canais"] if x["canal"] == c)


# ------------------------------------------------------------------ empresa A: mensagens (MotorCX e lista) e voz em lista
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo, canais) values ({EA}, 'mensageria', true, "
   "'{whatsapp,sms}')")
sv(f"insert into public.mensageria_config (empresa_id, modo) values ({EA}, 'real')")
# rcs: MotorCX marcado, mas o canal não está liberado na Mensageria; e-mail pausado
sv(f"insert into public.canais_empresa (empresa_id, canal, ativo, quem_envia) values ({EA}, 'rcs', true, 'motorcx'), "
   f"({EA}, 'email', false, 'lista')")

_n = [0]


def lote(emp, c, dias_atras, situacao="concluido"):
    return sv(f"insert into public.mensageria_lotes (empresa_id, data, canal, modo, situacao) values "
              f"({emp}, {HOJE} - {dias_atras}, '{c}', 'real', '{situacao}') returning id")


def mensagens(emp, lote_id, n, situacao, horas_atras):
    _n[0] += 1
    sv(f"insert into public.mensageria_mensagens (lote_id, empresa_id, id_cliente, destino_mascara, destino_hash, situacao, "
       f"enviado_em) select {lote_id}, {emp}, 'C84-' || {_n[0]} || '-' || g, '(11) 9••••-••17', "
       f"encode(sha256(convert_to('x84{T}' || {_n[0]} || '-' || g, 'UTF8')), 'hex'), '{situacao}', "
       f"now() - interval '{horas_atras} hours' from generate_series(1, {n}) g")


# whatsapp: 100 em 24 h, 96 entregues → funcionando
lw = lote(EA, "whatsapp", 0)
mensagens(EA, lw, 96, "entregue", 3)
mensagens(EA, lw, 4, "falhou", 3)
# sms: 24 h com 70% (abaixo de 80%); 7 dias antes com 93%
ls_ant = lote(EA, "sms", 3)
mensagens(EA, ls_ant, 186, "entregue", 72)
mensagens(EA, ls_ant, 14, "falhou", 72)
ls = lote(EA, "sms", 0)
mensagens(EA, ls, 70, "entregue", 2)
mensagens(EA, ls, 30, "falhou", 2)
# voz em lista (sem o módulo agente_voz): o discador recebeu lista e o retorno parou há 10 dias; 2 códigos sem mapear
for dias in (0, 9):
    sv(f"insert into public.fila_dia (empresa_id, credor_id, data, canal, id_cliente, reserva, regua, passo, tag) "
       f"select {EA}, {CRA}, {HOJE} - {dias}, 'discador', 'C84-D' || g, false, 'cpc', 'T1', 'S260101-A1-CPA-DC-T1' "
       f"from generate_series(1, 40) g")
sv(f"insert into public.mapeamento_arquivos (empresa_id, credor_id, tipo, colunas, confirmado, visto_em) values "
   f"({EA}, null, 'canal_voz', '{{}}', true, now() - interval '10 days')")
sv(f"insert into public.canal_codigos (empresa_id, credor_id, canal, codigo, mapeado) values "
   f"({EA}, null, 'voz', 'TRANSF_URA', false), ({EA}, null, 'voz', 'CAIXA_POSTAL', false), ({EA}, null, 'voz', 'OK', true)")
# curtas medidas na rodada (75% → atenção)
RES = json.dumps({"discagem": {"chamadas_curtas": {"medido": [
    {"data": "2026-11-01", "chamadas": 600, "curtas": 450, "fracao": 0.75},
    {"data": "2026-11-02", "chamadas": 400, "curtas": 300, "fracao": 0.75}]}}})
sv(f"insert into public.execucoes (data_ref, empresa_id, credor_id, status, terminada_em, resumo) values "
   f"({HOJE}, {EA}, {CRA}, 'ok', now(), '{RES}')")

r = estado(EA)
afirmar("A: 6 canais na ordem whatsapp, sms, rcs, email, agente_voz, discador",
        [x["canal"] for x in r["canais"]] == ["whatsapp", "sms", "rcs", "email", "agente_voz", "discador"], r["canais"])
w = canal(r, "whatsapp")
afirmar("whatsapp: MotorCX envia e está funcionando", w["quem"] == "motorcx" and w["estado"] == "funcionando", w)
afirmar("whatsapp: ação principal = ver envios, sem problema", w["acao"] == "ver_envios" and w["problema"] is None, w)
ent = {s["chave"]: s for s in w["sinais"]}
afirmar("whatsapp: 100 enviadas e 96% entregues em 24 h", ent["enviadas_24h"]["valor"] == 100
        and float(ent["entregues_24h"]["valor"]) == 96.0, ent)
afirmar("whatsapp: última atividade preenchida", w["ultima_atividade"] is not None, w)
afirmar("whatsapp: 2 a 4 números", 2 <= len(w["sinais"]) <= 4, w["sinais"])
s = canal(r, "sms")
afirmar("sms: entrega 70% em 24 h → com problema (entrega_baixa)", s["estado"] == "com_problema"
        and s["motivo"] == "entrega_baixa" and s["acao"] == "score_entrega", s)
afirmar("sms: a frase cita 70% e a média de 93%", "70%" in s["problema"] and "93%" in s["problema"], s["problema"])
afirmar("sms: o número ruim vem marcado", {x["chave"]: x for x in s["sinais"]}["entregues_24h"]["ruim"] is True, s["sinais"])
rc = canal(r, "rcs")
afirmar("rcs: não liberado na Mensageria → não configurado (agente RCS)", rc["estado"] == "nao_configurado"
        and rc["motivo"] == "canal_nao_liberado" and "RCS" in rc["problema"], rc)
e = canal(r, "email")
afirmar("email: ativo = false → pausado, ação retomar", e["estado"] == "pausado" and e["acao"] == "retomar", e)
d = canal(r, "discador")
afirmar("discador sem Voz MotorCX: lista", d["quem"] == "lista" and d["grupo"] == "voz", d)
afirmar("discador: retorno atrasado → com problema", d["estado"] == "com_problema" and d["motivo"] == "retorno_atrasado", d)
mot = [p["motivo"] for p in d["problemas"]]
afirmar("discador: também lista os códigos sem mapear e as chamadas curtas",
        "codigos_sem_mapear" in mot and "chamadas_curtas" in mot, mot)
dsin = {x["chave"]: x for x in d["sinais"]}
afirmar("discador: 2 códigos sem mapear e 75% de curtas", dsin["codigos_sem_mapear"]["valor"] == 2
        and float(dsin["chamadas_curtas"]["valor"]) == 75.0, dsin)
afirmar("discador: última lista com 40 números", "40" in (dsin["ultima_lista"]["detalhe"] or ""), dsin["ultima_lista"])
av = canal(r, "agente_voz")
afirmar("agente_voz em lista sem cliente em 10 dias: atenção (códigos de voz também pesam: com problema)",
        av["estado"] == "com_problema" and "sem_lista" in [p["motivo"] for p in av["problemas"]], av)
afirmar("resumo soma 6 e bate com os estados", sum(r["resumo"].values()) == 6
        and r["resumo"].get("pausado") == 1 and r["resumo"].get("nao_configurado") == 1
        and r["resumo"].get("funcionando") == 1, r["resumo"])
txt = json.dumps(r, ensure_ascii=False)
afirmar("só agregados: nenhum id de cliente, máscara ou hash de destino na resposta",
        "C84-" not in txt and "9••••" not in txt and "x84" not in txt and "destino" not in txt, txt[:300])

# média de 7 dias: 24 h em 82% (acima de 80) mas 15+ pontos abaixo de 98% → com problema
sv(f"delete from public.mensageria_mensagens where lote_id in ({ls}, {ls_ant})")
mensagens(EA, ls_ant, 196, "entregue", 72)
mensagens(EA, ls_ant, 4, "falhou", 72)
mensagens(EA, ls, 82, "entregue", 2)
mensagens(EA, ls, 18, "falhou", 2)
s = canal(estado(EA), "sms")
afirmar("sms: 82% em 24 h × 98% na média → com problema (15 pontos abaixo)", s["estado"] == "com_problema"
        and s["motivo"] == "entrega_baixa", s)
# 85% × 90%: só 5 pontos abaixo e acima de 80% → funcionando
sv(f"delete from public.mensageria_mensagens where lote_id in ({ls}, {ls_ant})")
mensagens(EA, ls_ant, 180, "entregue", 72)
mensagens(EA, ls_ant, 20, "falhou", 72)
mensagens(EA, ls, 85, "entregue", 2)
mensagens(EA, ls, 15, "falhou", 2)
s = canal(estado(EA), "sms")
afirmar("sms: 85% × 90% → funcionando", s["estado"] == "funcionando", s)
# poucas mensagens não julgam
sv(f"delete from public.mensageria_mensagens where lote_id = {ls}")
mensagens(EA, ls, 5, "falhou", 2)
s = canal(estado(EA), "sms")
afirmar("sms: 5 falhas em 24 h (menos de 30) não viram problema", s["estado"] == "funcionando"
        and {x["chave"]: x for x in s["sinais"]}["entregues_24h"]["valor"] is None, s)

# lote de hoje esperando aprovação → atenção
sv(f"update public.mensageria_lotes set situacao = 'aguardando_aprovacao' where id = {lw}")
w = canal(estado(EA), "whatsapp")
afirmar("whatsapp: lote de hoje esperando aprovação → atenção", w["estado"] == "atencao" and w["acao"] == "lotes", w)
sv(f"update public.mensageria_lotes set situacao = 'concluido' where id = {lw}")

# simulação → atenção
sv(f"update public.mensageria_config set modo = 'simulado' where empresa_id = {EA}")
w = canal(estado(EA), "whatsapp")
afirmar("whatsapp: Mensageria em simulação → atenção", w["estado"] == "atencao" and w["motivo"] == "simulado", w)
sv(f"update public.mensageria_config set modo = 'real' where empresa_id = {EA}")

# orçamento: centro da Lista do dia com R$ 1 e "bloquear" (o consumo passa de 90%) → com problema
CC = sv(f"insert into public.mensageria_centros_custo (empresa_id, nome, orcamento_mensal, ao_estourar, alerta_pct) "
        f"values ({EA}, 'Centro 84', 1, 'bloquear', 80) returning id")
sv(f"insert into public.mensageria_consumo_centro (centro_id, competencia, item, quantidade) values "
   f"({CC}, date_trunc('month', {HOJE})::date, 'sms', 100000)")
sv(f"insert into public.precos_empresa (empresa_id, item, modelo, preco, vigente_desde) values "
   f"({EA}, 'sms', 'flat', 0.08, date_trunc('month', {HOJE})::date - 31)")
sv(f"update public.mensageria_config set centro_custo_id = {CC} where empresa_id = {EA}")
gasto = sv(f"select gasto from public.orcamento_centro_motor({CC}, {HOJE})")
w = canal(estado(EA), "whatsapp")
if float(gasto or 0) > 0.9:
    afirmar("whatsapp: orçamento > 90% com bloquear → com problema", w["estado"] == "com_problema"
            and w["motivo"] == "orcamento_bloqueia" and w["acao"] == "orcamento", w)
    sv(f"update public.mensageria_centros_custo set ao_estourar = 'continuar' where id = {CC}")
    w = canal(estado(EA), "whatsapp")
    afirmar("whatsapp: o mesmo orçamento com continuar → só atenção", w["estado"] == "atencao"
            and w["motivo"] == "orcamento_alerta", w)
else:
    afirmar("orçamento: o banco de teste tem preço de SMS para medir o gasto", False, f"gasto={gasto}")
sv(f"update public.mensageria_config set centro_custo_id = null where empresa_id = {EA}")

# canal lista com retorno em dia → funcionando
sv(f"update public.mapeamento_arquivos set visto_em = now() where empresa_id = {EA} and tipo = 'canal_voz'")
sv(f"update public.canal_codigos set mapeado = true where empresa_id = {EA}")
sv(f"update public.execucoes set resumo = '{{}}' where empresa_id = {EA}")
d = canal(estado(EA), "discador")
afirmar("discador: retorno de hoje, códigos mapeados e sem curtas → funcionando, ação baixar a lista",
        d["estado"] == "funcionando" and d["acao"] == "baixar_lista", d)

# ------------------------------------------------------------------ empresa B: Voz MotorCX
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({EB}, 'agente_voz', true)")
sv(f"insert into public.voz_config (empresa_id, provedor, modo) values ({EB}, 'montagem_motorcx', 'real')")
TR1 = sv(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, canais) values "
         f"({EB}, 'sp-fixo', 'Operadora Alfa', 'sip.operadora-alfa.example', 'ip', '11', '1135550100', 20) returning id")
TR2 = sv(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, canais) values "
         f"({EB}, 'sp-movel', 'Operadora Beta', 'sip.operadora-beta.example', 'ip', '11', '1135550180', 10) returning id")
sv(f"insert into public.voz_rotas (empresa_id, tronco_id, prioridade, tech_prefix, tipo, cadencia_inicial_s, "
   f"cadencia_incremento_s, preco_minuto, vigente_desde) values ({EB}, {TR1}, 1, '1021', 'fixo_local', 30, 6, 0.05, "
   f"{HOJE} - 30)")
sv(f"insert into public.voz_chamadas (empresa_id, id_chamada, canal, id_cliente, ocorrido_em, atendida_em, destino_hash) "
   f"select {EB}, 'c84-{T}-' || g, 'agente_voz', 'C84-V' || g, now() - interval '2 hours', "
   f"case when g <= 20 then now() - interval '2 hours' end, encode(sha256(convert_to('v84' || g, 'UTF8')), 'hex') "
   f"from generate_series(1, 50) g")
r = estado(EB, B)
av = canal(r, "agente_voz")
afirmar("B agente_voz: Voz MotorCX, sem pausa → funcionando", av["quem"] == "voz_motorcx" and av["estado"] == "funcionando"
        and av["acao"] == "agente_voz", av)
vs = {x["chave"]: x for x in av["sinais"]}
afirmar("B agente_voz: 50 ligações em 24 h, 40% atendidas", vs["ligacoes_24h"]["valor"] == 50
        and float(vs["atendidas_24h"]["valor"]) == 40.0, vs)
# rota pausada (bloqueio da operadora) → com problema nos dois canais de voz
sv(f"insert into public.voz_troncos_pausas (empresa_id, tronco_id, motivo, causa_sip) values ({EB}, {TR2}, "
   f"'bloqueio_originacao', 403)")
r = estado(EB, B)
d = canal(r, "discador")
afirmar("B discador: rota pausada → com problema, ação telefonia", d["estado"] == "com_problema"
        and d["motivo"] == "rota_pausada" and d["acao"] == "telefonia", d)
afirmar("B discador: a frase diz que as ligações saem pelas outras rotas", "outras rotas" in d["problema"]
        and "bloqueio" in d["problema"], d["problema"])
afirmar("B agente_voz: a rota pausada também pesa", canal(r, "agente_voz")["estado"] == "com_problema",
        canal(r, "agente_voz"))
sv(f"update public.voz_troncos_pausas set retomado_em = now(), nota = 'Operadora liberou' where tronco_id = {TR2}")
# tronco com erro de configuração (SQL 80 / PR 194)
sv(f"insert into public.fornecedor_saude (empresa_id, tronco_id, item, referencia, ok, detalhe) values "
   f"({EB}, {TR2}, 'configuracao_invalida', 'tronco.{TR2}', false, 'porta fora do intervalo')")
d = canal(estado(EB, B), "discador")
afirmar("B discador: tronco com erro de configuração → com problema", d["estado"] == "com_problema"
        and d["motivo"] == "tronco_invalido", d)
sv(f"update public.fornecedor_saude set ok = true where empresa_id = {EB}")
# só números de teste → atenção
sv(f"update public.voz_config set modo = 'teste' where empresa_id = {EB}")
d = canal(estado(EB, B), "discador")
afirmar("B discador: só números de teste → atenção", d["estado"] == "atencao" and d["motivo"] == "voz_teste", d)
sv(f"update public.voz_config set modo = 'real' where empresa_id = {EB}")
# lote de hoje freado por abandono → atenção
sv(f"insert into public.voz_lotes (empresa_id, data, modo, situacao, total, encerradas, freado_em) values "
   f"({EB}, {HOJE}, 'real', 'ligando', 200, 50, now())")
av = canal(estado(EB, B), "agente_voz")
afirmar("B agente_voz: lote freado → atenção; lote de hoje em 25%", av["estado"] == "atencao"
        and av["motivo"] == "freio_abandono"
        and float({x["chave"]: x for x in av["sinais"]}["lote_hoje"]["valor"]) == 25.0, av)
# os canais de mensagem sem Mensageria: lista
w = canal(estado(EB, B), "whatsapp")
afirmar("B whatsapp sem Mensageria: lista para baixar", w["quem"] == "lista", w)

# ------------------------------------------------------------------ empresa C: Voz MotorCX sem tronco
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({EC}, 'agente_voz', true)")
d = canal(estado(EC, C), "discador")
afirmar("C: módulo sem voz_config → não configurado", d["estado"] == "nao_configurado" and d["motivo"] == "voz_sem_config", d)
sv(f"insert into public.voz_config (empresa_id, provedor, modo) values ({EC}, 'montagem_motorcx', 'real')")
d = canal(estado(EC, C), "discador")
afirmar("C: sem tronco ativo → não configurado (sem_tronco)", d["estado"] == "nao_configurado" and d["motivo"] == "sem_tronco", d)

# ------------------------------------------------------------------ permissões
checar("Planejamento da empresa (editar_canais) lê", True, f"select jsonb_typeof(public.estado_canais({EA}))", *P,
       valor="object")
checar("Operação (sem editar_canais) não lê", False, f"select public.estado_canais({EA})", *O, erro="sem permissão")
sv(f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{U['oper']}', 'editar_canais', true)")
checar("Operação com editar_canais dado pelo Admin lê", True, f"select jsonb_typeof(public.estado_canais({EA}))", *O,
       valor="object")
sv(f"update public.permissoes_usuario set permitido = false where usuario_id = '{U['oper']}'")
sv(f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{U['plan']}', 'editar_canais', false)")
checar("Planejamento com editar_canais tirado não lê", False, f"select public.estado_canais({EA})", *P, erro="sem permissão")
checar("outra empresa não lê", False, f"select public.estado_canais({EA})", *B, erro="sem permissão")
checar("equipe que vê a empresa lê", True, f"select jsonb_typeof(public.estado_canais({EA}))", *M, valor="object")
checar("anon não executa", False, f"select public.estado_canais({EA})", "anon")
checar("empresa nula é recusada", False, "select public.estado_canais(null)", *M, erro="sem permissão")
checar("security definer com search_path", True,
       "select prosecdef and proconfig is not null from pg_proc where oid = 'public.estado_canais(bigint)'::regprocedure",
       valor="t")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
