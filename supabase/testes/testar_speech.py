"""SQL 60 · Speech Analytics: regras de acesso (RLS), LGPD e fluxos, num Postgres local com as migrações aplicadas.

Cobre: leitura por empresa e por permissão (ver_alertas, ver_operadores, ver_transcricoes, curadoria_voz,
enviar_relatorio_credor, editar_checklist), grupo com menos de 30 escondido nos painéis, busca que recusa CPF,
telefone e e-mail (e fica registrada), link do relatório ao credor por token (sem login, com registro de cada acesso,
só o hash no banco), checklist com trava legal e vigência só para a frente, recomendações com piso e rascunho que nunca
publica, curadoria e conjunto de referência sem ID de cliente, e retenção (a análise vai embora com a gravação).

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_speech.py
Só dados fictícios (IDs CLI-xxxxx, operadores OP-xx com apelido, trechos já mascarados).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor))
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 60: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:200]}"))


def sv(cmd):
    ok, out, err = sql(cmd)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def j(obj) -> str:
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'"


# ---------------------------------------------------------------- empresas, carteiras e pessoas (fictícias)
EA = sv("insert into public.empresas (slug,nome) values ('sa-aurora','Aurora Cobranças (teste)') returning id")
EB = sv("insert into public.empresas (slug,nome) values ('sa-boreal','Boreal Cobranças (teste)') returning id")
CA = sv(f"insert into public.credores (empresa_id,codigo,nome) values ({EA},'cartao-h','Cartão Horizonte') returning id")
CA2 = sv(f"insert into public.credores (empresa_id,codigo,nome) values ({EA},'emprestimo-s','Empréstimo Sol') returning id")
CB = sv(f"insert into public.credores (empresa_id,codigo,nome) values ({EB},'principal-b','Carteira B') returning id")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("ges", "gestao", EA), ("ope", "operacao", EA), ("pla", "planejamento", EA),
                      ("admb", "admin", EB), ("opfone", "operacao", EA)):
    U[p] = sv(f"insert into auth.users (email) values ('sa.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
U["eq"] = sv("insert into auth.users (email) values ('sa.equipe@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['eq']}'")
# planejamento com curadoria_voz liberada só para ele (permissão por pessoa)
sv(f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{U['pla']}', 'curadoria_voz', true)")

A, G, O, P, AB, EQ = U["adm"], U["ges"], U["ope"], U["pla"], U["admb"], U["eq"]
au = "authenticated"

# ---------------------------------------------------------------- permissões novas
checar("Admin tem as 5 permissões novas", True,
       "select count(*) from public.minhas_permissoes() p where p in ('editar_checklist','ver_operadores','ver_alertas','curadoria_voz','enviar_relatorio_credor')",
       au, A, 5)
checar("Gestão (supervisor) vê operadores e alertas por padrão", True,
       "select public.pode('ver_operadores') and public.pode('ver_alertas') and not public.pode('curadoria_voz')", au, G, "t")
checar("Operação não vê operadores nem alertas", True, "select public.pode('ver_operadores') or public.pode('ver_alertas')", au, O, "f")

# ---------------------------------------------------------------- agregados e o piso de 30
for t in ("voz_conversao_dia", "voz_audio_dia", "voz_qualidade_dia", "voz_temas_semana", "voz_trechos", "voz_busca_resultados"):
    checar(f"site não lê {t} direto (só pelas funções)", False, f"select count(*) from public.{t}", au, A)
    checar(f"anon não lê {t}", False, f"select count(*) from public.{t}", "anon")


def qual(data, origem, av, ap, nota, credor=CA, op="", persona=""):
    return (f"insert into public.voz_qualidade_dia (empresa_id,credor_id,data,origem,persona,operador_ref,item,avaliadas,aprovadas,nota_soma) "
            f"values ({EA},{credor},'{data}','{origem}','{persona}','{op}','_ligacao',{av},{ap},{av * nota})")


sv("set role service_role; " + qual("2026-10-10", "ia", 20, 19, 90))
checar("recorte com 20 ligações esconde tudo (n nulo)", True,
       f"select coalesce((public.painel_speech({EA}, null, '2026-10-01', '2026-10-31') ->> 'n'), 'nulo')", au, O, "nulo")
checar("recorte pequeno avisa que é pequeno", True,
       f"select public.painel_speech({EA}, null, '2026-10-01', '2026-10-31') ->> 'pequeno'", au, O, "true")
sv("set role service_role; " + qual("2026-10-11", "ia", 25, 24, 92) + "; " + qual("2026-10-11", "discador", 12, 9, 78))
checar("com 57 ligações o painel mostra o total", True,
       f"select public.painel_speech({EA}, null, '2026-10-01', '2026-10-31') ->> 'n'", au, O, 57)
checar("origem com menos de 30 fica nula dentro do painel", True,
       f"select coalesce(public.painel_speech({EA}, null, '2026-10-01', '2026-10-31') -> 'por_origem' ->> 'discador', 'nulo')", au, O, "nulo")
checar("conformidade = % sem bloqueante reprovado", True,
       f"select public.painel_speech({EA}, null, '2026-10-01', '2026-10-31') ->> 'conformidade'", au, O, "91.2")
sv("set role service_role; insert into public.voz_conversao_dia (empresa_id,credor_id,data,origem,dimensao,valor,conversas,com_acordo) values "
   f"({EA},{CA},'2026-10-11','ia','motivo','esquecimento',120,40),({EA},{CA},'2026-10-11','ia','motivo','desemprego',12,1),"
   f"({EA},{CA2},'2026-10-11','ia','motivo','esquecimento',45,9),({EA},{CA},'2026-10-11','ia','total','todas',177,50)")
checar("célula do mapa com menos de 30 vira nula", True,
       f"select count(*) from jsonb_array_elements(public.painel_speech({EA}, null, '2026-10-01', '2026-10-31') -> 'mapa') x where x->>'motivo'='desemprego' and x->'conversao' = 'null'::jsonb and x->'n' = 'null'::jsonb", au, O, 1)
checar("célula com 120 mostra a conversão", True,
       f"select x->>'conversao' from jsonb_array_elements(public.painel_speech({EA}, null, '2026-10-01', '2026-10-31') -> 'mapa') x where x->>'motivo'='esquecimento' and (x->>'credor_id')::bigint={CA}", au, O, "33.3")
checar("empresa B não lê o painel da A", False, f"select public.painel_speech({EA}, null, '2026-10-01', '2026-10-31')", au, AB)
checar("anon não chama o painel", False, f"select public.painel_speech({EA}, null, '2026-10-01', '2026-10-31')", "anon")

# ---------------------------------------------------------------- gravações, chamadas, trechos e busca
def cham(idc, cli, credor=CA, emp=EA):
    return sv(f"set role service_role; insert into public.voz_chamadas (empresa_id,credor_id,id_chamada,id_cliente,modo,ocorrido_em) values "
              f"({emp},{credor},'{idc}','{cli}','real',now() - interval '2 days') returning id")


def grav(ch, cli, origem="ia", emp=EA, op=None):
    opv = "null" if op is None else f"'{op}'"
    return sv(f"set role service_role; insert into public.voz_gravacoes (empresa_id,credor_id,chamada_id,id_cliente,origem,caminho,operador_ref) values "
              f"({emp},{CA if emp == EA else CB},{ch},'{cli}','{origem}','sa/{idc_safe(ch)}.mp3',{opv}) returning id")


def idc_safe(ch):
    return f"lg-{ch}"


CH1 = cham("LG-88119", "CLI-52266")
G1 = grav(CH1, "CLI-52266")
CH2 = cham("LG-87655", "CLI-30418", CA2)
G2 = grav(CH2, "CLI-30418", "discador", op="OP-14")
CHB = cham("LG-90001", "CLI-77001", CB, EB)
GB = grav(CHB, "CLI-77001", emp=EB)


def trecho(g, ini, fal, txt, origem="ia", credor=CA):
    return (f"set role service_role; insert into public.voz_trechos (empresa_id,credor_id,gravacao_id,origem,inicio_s,fim_s,falante,texto_redigido) "
            f"values ({EA},{credor},{g},'{origem}',{ini},{ini + 20},'{fal}',{j(txt)}) returning id")


T1 = sv(trecho(G1, 10, "cliente", 'Cliente: "Recebi um boleto pelo WhatsApp com o logo de vocês, paguei e agora dizem que não caiu."'))
T2 = sv(trecho(G2, 30, "cliente", 'Cliente: "Meu salário só cai no dia 15, se vencer dia 5 eu não consigo."', "discador", CA2))
sv(f"set role service_role; insert into public.voz_trechos (empresa_id,credor_id,gravacao_id,origem,inicio_s,fim_s,falante,texto_redigido) values ({EB},{CB},{GB},'ia',5,20,'cliente','Cliente: \"o boleto chegou errado\"')")
checar("trecho herda a validade da gravação", True, f"select t.expira_em = g.expira_em from public.voz_trechos t join public.voz_gravacoes g on g.id=t.gravacao_id where t.id={T1}", "service_role", None, "t")
checar("trecho com CPF é recusado", False, trecho(G1, 50, "cliente", "meu cpf é 123.456.789-09"))
checar("trecho com telefone é recusado", False, trecho(G1, 60, "cliente", "liga no (11) 98765-4321"))
checar("trecho com e-mail é recusado", False, trecho(G1, 70, "cliente", "manda pra fulano@exemplo.com"))
checar("trecho com sequência longa de dígitos é recusado", False, trecho(G1, 80, "cliente", "o número é 11987654321"))
for termo in ("123.456.789-09", "12345678909", "(11) 98765-4321", "11 9 8765 4321", "fulano@exemplo.com"):
    checar(f"busca recusa {termo!r}", False, f"select public.buscar_trechos_voz({EA}, {j(termo)}, 'termo')", au, A)
checar("busca recusada não fica registrada", True, f"select count(*) from public.voz_buscas where empresa_id={EA}", "service_role", None, 0)
checar("Operação (sem ver_transcricoes) não busca", False, f"select public.buscar_trechos_voz({EA}, 'boleto', 'termo')", au, O)
checar("equipe MotorCX não busca nas transcrições do cliente", False, f"select public.buscar_trechos_voz({EA}, 'boleto', 'termo')", au, EQ)
checar("B não busca na A", False, f"select public.buscar_trechos_voz({EA}, 'boleto', 'termo')", au, AB)
checar("busca por termo acha só na própria empresa", True,
       f"select jsonb_array_length(public.buscar_trechos_voz({EA}, 'boleto', 'termo') -> 'resultados')", au, G, 1)
checar("resultado leva gravação e ID do cliente, nunca CPF", True,
       f"select (r->>'gravacao_id')::bigint = {G1} and r->>'id_cliente' = 'CLI-52266' and not (r ? 'cpf') from jsonb_array_elements(public.buscar_trechos_voz({EA}, 'boleto pelo WhatsApp', 'termo') -> 'resultados') r", au, G, "t")
checar("cada busca fica registrada com quem, termo e modo", True,
       f"select count(*) from public.voz_buscas where empresa_id={EA} and usuario='{G}' and modo='termo'", "service_role", None, 2)
checar("busca aparece na Auditoria", True, f"select count(*) from public.auditoria where tabela='voz_buscas' and empresa_id={EA}", "service_role", None, 2)
checar("Admin lê o registro de buscas", True, f"select count(*) from public.buscas_recentes_voz({EA})", au, A, 2)
checar("Gestão não lê o registro de buscas", False, f"select count(*) from public.buscas_recentes_voz({EA})", au, G)
checar("Gestão não lê voz_buscas direto", True, "select count(*) from public.voz_buscas", au, G, 0)
checar("filtro de carteira na busca", True,
       f"select jsonb_array_length(public.buscar_trechos_voz({EA}, 'salário', 'termo', credor => {CA}) -> 'resultados')", au, G, 0)
checar("termo de 1 letra é recusado", False, f"select public.buscar_trechos_voz({EA}, 'a', 'termo')", au, G)
tem_vetor = sv("select count(*) from information_schema.columns where table_name='voz_trechos' and column_name='embedding'") == "1"
if tem_vetor:
    vet = "[" + ",".join(["0.1"] * 1536) + "]"
    sv(f"set role service_role; update public.voz_trechos set embedding = '{vet}' where id in ({T1},{T2})")
    BS = sql(f"select (public.buscar_trechos_voz({EA}, 'golpe de boleto falso', 'semantica')) ->> 'busca_id'", au, G)[1]
    checar("busca semântica fica pendente até a VM mandar o embedding", True, f"select public.resultado_busca_voz({BS}) ->> 'situacao'", au, G, "pendente")
    checar("site não responde a busca semântica", False, f"select public.responder_busca_voz({BS}, '{vet}')", au, G)
    checar("VM lista a busca pendente", True, "select count(*) from public.buscas_voz_pendentes()", "service_role", None, 1)
    checar("VM responde com o embedding (2 trechos da A)", True, f"select public.responder_busca_voz({BS}, '{vet}')", "service_role", None, 2)
    checar("resultado semântico traz a similaridade", True,
           f"select (public.resultado_busca_voz({BS}) -> 'resultados' -> 0 ->> 'similaridade')::numeric > 0.9", au, G, "t")
    checar("outra pessoa não lê o resultado da busca", False, f"select public.resultado_busca_voz({BS})", au, A)
else:
    checar("sem pgvector a busca semântica avisa", False, f"select public.buscar_trechos_voz({EA}, 'golpe', 'semantica')", au, G)

# ---------------------------------------------------------------- checklist (trava legal, vigência)
PAD = json.loads(sv("select itens from public.checklist_versoes v join public.checklists_qualidade c on c.id=v.checklist_id where c.empresa_id is null and v.situacao='em_uso'"))
itens_cli = PAD + [{"id": "cl_protocolo", "texto": "Informou o número do protocolo do acordo", "gravidade": "importante",
                    "aplica": "ambos", "peso": 2, "origem": "cliente", "trava": False, "on": True}]
checar("Gestão (sem editar_checklist) não edita", False, f"select public.salvar_rascunho_checklist({EA}, {j(itens_cli)})", au, G)
sem_trava = [i for i in itens_cli if i["id"] != "ck_ameaca"]
checar("tirar item de lei é recusado", False, f"select public.salvar_rascunho_checklist({EA}, {j(sem_trava)})", au, A)
desligado = [dict(i, on=False) if i["id"] == "ck_cpc" else i for i in itens_cli]
checar("desligar item de lei é recusado", False, f"select public.salvar_rascunho_checklist({EA}, {j(desligado)})", au, A)
leve = [dict(i, gravidade="importante") if i["id"] == "ck_terceiro" else i for i in itens_cli]
checar("rebaixar item de lei é recusado", False, f"select public.salvar_rascunho_checklist({EA}, {j(leve)})", au, A)
falsa = [dict(i, trava=True, gravidade="bloqueante") if i["id"] == "cl_protocolo" else i for i in itens_cli]
checar("item do cliente não ganha trava", False, f"select public.salvar_rascunho_checklist({EA}, {j(falsa)})", au, A)
ajustado = [dict(i, peso=3, origem="ajustado") if i["id"] == "ck_oferta" else dict(i, on=False) if i["id"] == "ck_resumo" else i for i in itens_cli]
V1 = sql(f"select public.salvar_rascunho_checklist({EA}, {j(ajustado)})", au, A)[1]
checar("Admin salva rascunho (ajusta peso, desliga o que não é lei, cria item)", True, f"select situacao from public.checklist_versoes where id={V1}", "service_role", None, "rascunho")
checar("salvar de novo atualiza o mesmo rascunho", True, f"select public.salvar_rascunho_checklist({EA}, {j(ajustado)}) = {V1}", au, A, "t")
checar("publicar vale só a partir de amanhã", True, f"select public.publicar_checklist({V1}) = (now() at time zone 'America/Sao_Paulo')::date + 1", au, A, "t")
checar("hoje ainda vale o padrão (a nota não muda para trás)", True,
       f"select c.empresa_id is null from public.checklist_versoes v join public.checklists_qualidade c on c.id=v.checklist_id where v.id = public.checklist_vigente({EA}, (now() at time zone 'America/Sao_Paulo')::date)", "service_role", None, "t")
checar("amanhã vale a versão nova", True, f"select public.checklist_vigente({EA}, (now() at time zone 'America/Sao_Paulo')::date + 1) = {V1}", "service_role", None, "t")
checar("versão publicada não muda", False, f"update public.checklist_versoes set itens = itens where id={V1} and false; update public.checklist_versoes set itens='[]' where id={V1}", "service_role")
V2 = sql(f"select public.salvar_rascunho_checklist({EA}, {j(itens_cli)})", au, A)[1]
checar("publicar a seguinte arquiva a anterior até hoje", True,
       f"select public.publicar_checklist({V2}); select situacao || '|' || (vigente_ate = (now() at time zone 'America/Sao_Paulo')::date) from public.checklist_versoes where id={V1}", au, A, "arquivada|true")
checar("B não lê o checklist da A", True, f"select count(*) from public.checklist_versoes v join public.checklists_qualidade c on c.id=v.checklist_id where c.empresa_id={EA}", au, AB, 0)
checar("todos leem o padrão MotorCX", True, "select count(*) from public.checklists_qualidade where empresa_id is null", au, AB, 1)

# ---------------------------------------------------------------- avaliações, reprovadas e contestação
TR_REP = j('Operador: "Bom dia, é o [NOME]? O débito está em R$ 2.380,00…"')
AV = sv(f"set role service_role; insert into public.voz_avaliacoes (empresa_id,credor_id,chamada_id,gravacao_id,versao_id,origem,operador_ref,nota,itens,evidencia,reprovada,item_reprovado,trecho_redigido) values "
        f"({EA},{CA2},{CH2},{G2},{V1},'discador','OP-14',62,'{{\"ck_cpc\": \"nao\", \"ck_oferta\": \"sim\"}}','{{\"ck_cpc\": [12.0, 18.5]}}',true,'ck_cpc',{TR_REP}) returning id")
checar("avaliação com valor fora de sim/nao/na é recusada", False,
       f"insert into public.voz_avaliacoes (empresa_id,chamada_id,versao_id,origem,nota,itens) values ({EA},{CH1},{V1},'ia',90,'{{\"ck_cpc\": \"talvez\"}}')", "service_role")
checar("Operação não vê a lista de reprovadas", False, f"select count(*) from public.reprovadas_voz({EA}, null, current_date - 7, current_date)", au, O)
checar("Gestão vê a reprovada com trecho e operador", True,
       f"select operador || '|' || item from public.reprovadas_voz({EA}, null, current_date - 7, current_date)", au, G, "OP-14|ck_cpc")
sv(f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{U['opfone']}', 'ver_transcricoes', true)")
checar("quem lê transcrição mas não tem ver_operadores não vê o operador", True,
       f"select coalesce(operador, 'oculto') from public.reprovadas_voz({EA}, null, current_date - 7, current_date)", au, U["opfone"], "oculto")
CU = sql(f"select public.contestar_nota_voz({AV})", au, G)[1]
checar("discordar da nota manda o caso para a Curadoria", True, f"select tipo || '|' || situacao from public.voz_curadoria_itens where id={CU}", "service_role", None, "nota|aberto")

# ---------------------------------------------------------------- operadores
checar("apelido com sequência de dígitos é recusado", False, f"select public.salvar_operador_voz({EA}, 'olos', 'OP-15', 'Bruno 123456')", au, A)
checar("ID de operador com CPF é recusado", False, f"select public.salvar_operador_voz({EA}, 'olos', '12345678909', 'Bruno')", au, A)
checar("Gestão cadastra operador por ID e apelido", True, f"select public.salvar_operador_voz({EA}, 'olos', 'OP-14', 'Nando') is not null", au, G, "t")
checar("Operação não cadastra operador", False, f"select public.salvar_operador_voz({EA}, 'olos', 'OP-16', 'Cris')", au, O)
sv("set role service_role; " + qual("2026-10-12", "discador", 29, 20, 70, op="OP-14") + "; " + qual("2026-10-12", "discador", 40, 35, 88, op="OP-20"))
checar("operador com 29 ligações fica sem nota", True,
       f"select coalesce(x->>'nota','sem nota') from jsonb_array_elements(public.operadores_voz({EA}, null, '2026-10-01', '2026-10-31') -> 'operadores') x where x->>'ref'='OP-14'", au, G, "sem nota")
checar("operador com 40 ligações tem nota", True,
       f"select x->>'nota' from jsonb_array_elements(public.operadores_voz({EA}, null, '2026-10-01', '2026-10-31') -> 'operadores') x where x->>'ref'='OP-20'", au, G, "88.0")
checar("Operação não vê a nota dos operadores", False, f"select public.operadores_voz({EA}, null, '2026-10-01', '2026-10-31')", au, O)
sv(f"update public.voz_operadores set usuario_id='{O}' where empresa_id={EA} and operador_ref='OP-14'")
checar("o operador com login vê só a própria linha", True,
       f"select jsonb_array_length(public.operadores_voz({EA}, null, '2026-10-01', '2026-10-31') -> 'operadores')", au, O, 1)
checar("o operador não abre a página de outro", False, f"select public.operador_voz({EA}, 'OP-20', '2026-10-01', '2026-10-31')", au, O)
checar("discador sem ID: gravação sem operador conta", True,
       "set role service_role; select count(*) from public.voz_gravacoes where operador_ref is null and caminho like 'sa/%'", None, None, 2)
checar("B não lê os operadores da A", True, "select count(*) from public.voz_operadores", au, AB, 0)

# ---------------------------------------------------------------- alertas
def alerta(tipo, extra_cols="", extra_vals="", ch=CH1, g=G1):
    return (f"set role service_role; insert into public.voz_alertas (empresa_id,credor_id,chamada_id,gravacao_id,id_cliente,tipo{extra_cols}) "
            f"values ({EA},{CA},{ch},{g},'CLI-52266','{tipo}'{extra_vals}) returning id")


AL1 = sv(alerta("procon", ",falante,trecho_redigido", ",'cliente','Cliente: \"Vou abrir reclamação no Procon hoje.\"'"))
AL2 = sv(alerta("vulnerabilidade", ",sinal", ",'saude'"))
checar("vulnerabilidade com trecho é recusada", False, alerta("vulnerabilidade", ",sinal,trecho_redigido", ",'luto','Cliente: \"perdi minha mãe\"'"))
checar("vulnerabilidade sem sinal é recusada", False, alerta("vulnerabilidade"))
checar("Operação (sem ver_alertas) não vê alertas", True, "select count(*) from public.voz_alertas", au, O, 0)
checar("Operação não chama a fila de alertas", False, f"select count(*) from public.alertas_voz({EA})", au, O)
checar("Gestão vê a fila", True, f"select count(*) from public.alertas_voz({EA})", au, G, 2)
sv(f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{U['opfone']}', 'ver_alertas', true), ('{G}', 'ver_transcricoes', false)")
checar("sem ver_transcricoes o trecho do alerta não aparece", True,
       f"select coalesce(trecho, 'oculto') from public.alertas_voz({EA}, filtro_tipo => 'procon')", au, G, "oculto")
checar("com ver_transcricoes o trecho aparece", True,
       f"select trecho like 'Cliente:%' from public.alertas_voz({EA}, filtro_tipo => 'procon')", au, U["opfone"], "t")
sv(f"delete from public.permissoes_usuario where usuario_id='{G}' and permissao='ver_transcricoes'")
checar("observação com telefone é recusada", False, f"select public.revisar_alerta_voz({AL1}, 'tratado', 'ligou do (11) 98765-4321')", au, G)
checar("desfecho de outro tipo é recusado", False, f"select public.revisar_alerta_voz({AL1}, 'regua_ajustada')", au, G)
checar("revisar grava quem e quando", True,
       f"select public.revisar_alerta_voz({AL1}, 'tratado', 'Reclamação respondida pelo SAC'); select (revisado_por = '{G}')::text || '|' || situacao from public.voz_alertas where id={AL1}", au, G, "true|revisado")
checar("revisar não muda nada fora do alerta (chamada intacta)", True, f"select count(*) from public.voz_chamadas where id={CH1} and codigos is null", "service_role", None, 1)
checar("alerta revisado não volta a ser revisado", False, f"select public.revisar_alerta_voz({AL1}, 'sem_acao')", au, G)
checar("site não grava alerta direto", False, f"update public.voz_alertas set situacao='novo' where id={AL2}", au, A)
checar("sino avisa quem tem ver_alertas (Admin, Gestão e a pessoa liberada)", True, "select public.avisar_alertas_voz()", "service_role", None, 3)
checar("sino agrupa por hora (rodar de novo não repete)", True, "select public.avisar_alertas_voz()", "service_role", None, 0)

# ---------------------------------------------------------------- recomendações
EV = {"n_a": 3880, "n_b": 2140, "pct_a": 41, "pct_b": 23, "rotulo_a": "17h–20h", "rotulo_b": "9h–12h", "unidade": "% acordo"}


def rec(chave, destino, ev=EV, proposta=None):
    return (f"select public.registrar_recomendacao_voz({EA}, {CA}, '{destino}', 'regra_teste', '{chave}', "
            f"'Ligar para a persona Tradicional entre 17h e 20h', 'Teste fictício.', {j(ev)}, {j(proposta or {})})")


checar("n abaixo de 200 é recusado", False, rec("r:pouco", "regua", dict(EV, n_b=150)), "service_role")
checar("diferença abaixo de 5 p.p. é recusada", False, rec("r:igual", "regua", dict(EV, pct_b=38)), "service_role")
checar("site não registra recomendação", False, rec("r:site", "regua"), au, A)
R1 = sql(rec("r:horario", "regua", proposta={"definicao": {"travas": {"horario": {"ligado": True, "de": "17:00", "ate": "20:00"}}}}), "service_role")[1]
R2 = sql(rec("r:frase", "frases", proposta={"texto": "Entendo que o momento está difícil. Vamos achar um valor que caiba?", "canal": "agente_voz"}), "service_role")[1]
R3 = sql(rec("r:propensao", "propensao"), "service_role")[1]
R4 = sql(rec("r:dispensa", "renitencia", proposta={"definicao": {"travas": {"ligacoes": {"ligado": True, "intervalo_ocupado": 45}}}}), "service_role")[1]
checar("Operação não aplica (sem editar_orquestracao)", False, f"select public.aplicar_recomendacao({R1})", au, O)
sv(f"insert into public.estrategias (empresa_id,nome,definicao,padrao) values ({EA},'Padrão Aurora','{{\"travas\": {{\"horario\": {{\"ligado\": true, \"de\": \"08:00\", \"ate\": \"20:00\"}}, \"ligacoes\": {{\"ligado\": true, \"por_dia\": 3}}}}}}',true)")
checar("Aplicar cria estratégia NOVA em rascunho", True, f"select public.aplicar_recomendacao({R1}) ->> 'tipo'", au, P, "estrategia")
RID = sv(f"select rascunho_id from public.recomendacoes where id={R1}")
checar("o rascunho não é padrão nem está ligado a nada", True,
       f"select not e.padrao and not exists (select 1 from public.credores c where c.estrategia_id=e.id) and not exists (select 1 from public.clusters c where c.estrategia_id=e.id) from public.estrategias e where e.id={RID}", "service_role", None, "t")
checar("o rascunho mescla a mudança e guarda o resto", True,
       f"select definicao #>> '{{travas,horario,de}}' || '|' || (definicao #>> '{{travas,ligacoes,por_dia}}') from public.estrategias where id={RID}", "service_role", None, "17:00|3")
checar("a estratégia padrão da empresa não mudou", True,
       f"select definicao #>> '{{travas,horario,de}}' from public.estrategias where empresa_id={EA} and padrao", "service_role", None, "08:00")
checar("aplicar de novo é recusado", False, f"select public.aplicar_recomendacao({R1})", au, P)
checar("frase vira rascunho desligado", True,
       f"select public.aplicar_recomendacao({R2}); select ativo::text from public.frases where id=(select rascunho_id from public.recomendacoes where id={R2})", au, A, "false")
checar("propensão é só observação", False, f"select public.aplicar_recomendacao({R3})", au, A)
checar("motor confere: rascunho ainda não está em uso", True, "select public.conferir_rascunhos_recomendacoes()", "service_role", None, 0)
sv(f"update public.credores set estrategia_id={RID} where id={CA}")
checar("ligado à carteira, vira aplicada", True, f"select public.conferir_rascunhos_recomendacoes(); select situacao from public.recomendacoes where id={R1}", "service_role", None, "aplicada")
checar("dispensar some por 90 dias", True,
       f"select public.dispensar_recomendacao({R4}); select (volta_em - now()) > interval '89 days' from public.recomendacoes where id={R4}", au, P, "t")
checar("dispensada não volta antes de 90 dias", True, f"select coalesce(({rec('r:dispensa', 'renitencia')})::text, 'nulo')", "service_role", None, "nulo")
checar("desfazer a dispensa", True, f"select public.dispensar_recomendacao({R4}, true); select situacao from public.recomendacoes where id={R4}", au, P, "nova")
checar("B não lê as recomendações da A", True, "select count(*) from public.recomendacoes", au, AB, 0)
checar("B não aplica recomendação da A", False, f"select public.aplicar_recomendacao({R4})", au, AB)

# ---------------------------------------------------------------- relatório ao credor
REL_OK = {"resumo": {"conversas": {"n": 1240}, "acordo_pct": 14.6},
          "secoes": [{"id": "motivos", "itens": [{"rotulo": "Esqueceu", "n": 320, "pct": 25.8}]}],
          "recomendacoes": [{"id": "p1", "titulo": "Parcela mínima de R$ 50 também no Cartão", "n": 380,
                             "estimativa": {"centro": 12, "min": 6, "max": 18}}]}
checar("grupo com menos de 30 no relatório é recusado", False,
       f"select public.gravar_relatorio_credor({EA}, {CA}, '2026-10-01', {j(dict(REL_OK, secoes=[{'id': 'x', 'itens': [{'rotulo': 'Luto', 'n': 4}]}]))})", "service_role")
checar("relatório com ID de cliente é recusado", False,
       f"select public.gravar_relatorio_credor({EA}, {CA}, '2026-10-01', {j(dict(REL_OK, secoes=[{'id': 'x', 'itens': [{'id_cliente': 'CLI-1', 'n': 40}]}]))})", "service_role")
checar("relatório com trecho de conversa é recusado", False,
       f"select public.gravar_relatorio_credor({EA}, {CA}, '2026-10-01', {j(dict(REL_OK, exemplo={'trecho': 'oi'}))})", "service_role")
REL = sql(f"select public.gravar_relatorio_credor({EA}, {CA}, '2026-10-01', {j(REL_OK)})", "service_role")[1]
checar("motor grava o rascunho do mês", True, f"select situacao from public.relatorios_credor where id={REL}", "service_role", None, "rascunho")
checar("Operação não vê o relatório", True, "select count(*) from public.relatorios_credor", au, O, 0)
checar("Gestão vê o relatório", True, "select count(*) from public.relatorios_credor", au, G, 1)
checar("enviar sem revisar é recusado", False, f"select public.mudar_relatorio_credor({REL}, 'enviar')", au, G)
checar("comentário com CPF é recusado", False, f"select public.mudar_relatorio_credor({REL}, 'comentar', 'cliente 123.456.789-09')", au, G)
checar("comentário salvo", True, f"select public.mudar_relatorio_credor({REL}, 'comentar', 'Sugerimos piloto de 30 dias no Cartão.') ->> 'situacao'", au, G, "rascunho")
checar("mandar para revisão", True, f"select public.mudar_relatorio_credor({REL}, 'revisar') ->> 'situacao'", au, G, "revisao")
TOK = sql(f"select public.mudar_relatorio_credor({REL}, 'enviar') ->> 'token'", au, G)[1]
checar("enviar devolve o token uma vez (64 hex)", True, f"select '{TOK}' ~ '^[0-9a-f]{{64}}$'", None, None, "t")
checar("o banco guarda só o hash do token", True,
       f"select link_token_hash = encode(sha256(convert_to('{TOK}', 'UTF8')), 'hex') and link_token_hash <> '{TOK}' from public.relatorios_credor where id={REL}", "service_role", None, "t")
checar("o link vale 30 dias", True, f"select (expira_em - enviado_em) between interval '29 days 23 hours' and interval '30 days 1 hour' from public.relatorios_credor where id={REL}", "service_role", None, "t")
checar("nem quem vê o relatório lê o hash", False, "select link_token_hash from public.relatorios_credor", au, G)
checar("credor lê pelo link sem login", True, f"select public.relatorio_credor_publico('{TOK}') ->> 'credor'", "anon", None, "Cartão Horizonte")
checar("a leitura fica registrada", True, f"select count(*) from public.relatorio_credor_acessos where relatorio_id={REL} and acao='leitura'", "service_role", None, 1)
checar("token errado não abre", False, f"select public.relatorio_credor_publico('{'0' * 64}')", "anon")
checar("token fora do formato não abre", False, "select public.relatorio_credor_publico('abc')", "anon")
checar("anon não lê a tabela do relatório", False, "select count(*) from public.relatorios_credor", "anon")
checar("credor responde 'vamos testar' pelo link", True, f"select public.responder_relatorio_credor('{TOK}', 'p1', 'testar')", "anon")
checar("a resposta fica gravada", True, f"select resposta from public.relatorio_credor_respostas where relatorio_id={REL}", "service_role", None, "testar")
checar("responder registra o acesso e marca respondido", True,
       f"select situacao || '|' || (select count(*) from public.relatorio_credor_acessos where relatorio_id={REL}) from public.relatorios_credor where id={REL}", "service_role", None, "respondido|2")
checar("resposta a recomendação que não está no relatório é recusada", False, f"select public.responder_relatorio_credor('{TOK}', 'p9', 'nao')", "anon")
checar("relatório enviado não muda pelo motor", True,
       f"select coalesce(public.gravar_relatorio_credor({EA}, {CA}, '2026-10-01', {j(REL_OK)})::text, 'nulo')", "service_role", None, "nulo")
TOK2 = sql(f"select public.mudar_relatorio_credor({REL}, 'novo_link') ->> 'token'", au, G)[1]
checar("novo link invalida o anterior", False, f"select public.relatorio_credor_publico('{TOK}')", "anon")
checar("o novo link abre", True, f"select (public.relatorio_credor_publico('{TOK2}') -> 'respostas' ->> 'p1')", "anon", None, "testar")
sv(f"update public.relatorios_credor set expira_em = now() - interval '1 minute' where id={REL}")
checar("link vencido não abre", False, f"select public.relatorio_credor_publico('{TOK2}')", "anon")
checar("B não mexe no relatório da A", False, f"select public.mudar_relatorio_credor({REL}, 'novo_link')", au, AB)

# ---------------------------------------------------------------- curadoria e conjunto de referência
TEMA = sv(f"set role service_role; insert into public.voz_temas (empresa_id) values ({EA}) returning id")
CI = sv(f"set role service_role; insert into public.voz_curadoria_itens (empresa_id,tipo,chamada_id,gravacao_id,trecho_redigido,decisao_ia,opcoes,confianca) values "
        f"({EA},'intencao',{CH1},{G1},'Cliente: \"Dá pra jogar pra quando o meu pagamento cair?\"','{{\"valor\": \"sem_dinheiro\"}}','[\"sem_dinheiro\", \"data_salario\", \"nao_entendido\"]',0.41) returning id")
CT = sv(f"set role service_role; insert into public.voz_curadoria_itens (empresa_id,tipo,tema_id,decisao_ia) values ({EA},'tema',{TEMA},'{{\"valor\": \"\"}}') returning id")
checar("Gestão (sem curadoria_voz) não vê a fila", True, "select count(*) from public.voz_curadoria_itens", au, G, 0)
checar("Gestão não cura", False, f"select public.curar_item_voz({CI}, 'confirmar')", au, G)
checar("Planejamento com curadoria_voz vê a fila", True, "select count(*) from public.voz_curadoria_itens", au, P, 3)
checar("corrigir para valor fora das opções é recusado", False, f"select public.curar_item_voz({CI}, 'corrigir', 'outra_coisa')", au, P)
checar("corrigir entra no conjunto de referência", True,
       f"select public.curar_item_voz({CI}, 'corrigir', 'data_salario'); select resposta_certa from public.voz_golden_set where origem_item={CI}", au, P, "data_salario")
checar("conjunto de referência não tem ID de cliente nem chamada", True,
       "select count(*) from information_schema.columns where table_name='voz_golden_set' and column_name in ('id_cliente','chamada_id','gravacao_id')", "service_role", None, 0)
checar("contexto com chamada_id é recusado", False,
       f"insert into public.voz_golden_set (empresa_id,tipo,trecho_redigido,contexto,resposta_certa) values ({EA},'intencao','x','{{\"chamada_id\": 1}}','y')", "service_role")
checar("desfazer tira do conjunto", True,
       f"select public.curar_item_voz({CI}, 'desfazer'); select count(*) from public.voz_golden_set where origem_item={CI}", au, P, 0)
checar("virar caso de teste fica para quando o Fluxo do agente existir", False, f"select public.curar_item_voz({CI}, 'caso_teste')", au, P)
checar("virar exemplo vai para o conjunto e para o backlog", True,
       f"select public.curar_item_voz({CI}, 'exemplo'); select count(*) from public.voz_melhorias where origem_item={CI}", au, P, 1)
checar("tema sem nome não é promovido", False, f"select public.curar_item_voz({CT}, 'confirmar')", au, P)
checar("tema novo ganha nome pela curadoria", True,
       f"select public.curar_item_voz({CT}, 'corrigir', 'Pix parcelado'); select nome || '|' || situacao from public.voz_temas where id={TEMA}", au, P, "Pix parcelado|promovido")
checar("ação da curadoria fica na auditoria", True,
       f"select count(*) >= 2 from public.auditoria where tabela='voz_curadoria_itens' and usuario='{P}'", "service_role", None, "t")
checar("melhoria com telefone no título é recusada", False,
       f"select public.salvar_melhoria_voz({EA}, null, 'fluxo', 'Ligar para 11987654321', 'Marina L.', 'aberta')", au, P)
checar("melhoria criada no backlog", True,
       f"select public.salvar_melhoria_voz({EA}, null, 'base', 'Resposta para quem pergunta do Serasa', 'Marina L.', 'aberta') is not null", au, P, "t")
checar("B não vê a curadoria da A", True, "select count(*) from public.voz_curadoria_itens", au, AB, 0)

# ---------------------------------------------------------------- política da carteira
checar("política com chave estranha é recusada", False, f"select public.salvar_politica_credor({CA}, '{{\"cpf\": 1}}')", au, A)
checar("política salva", True,
       f"select public.salvar_politica_credor({CA}, '{{\"parcela_minima\": 50, \"entrada_pct\": 0, \"canais_pagamento\": [\"pix\", \"boleto\"]}}'); select politica->>'parcela_minima' from public.credores where id={CA}", au, A, 50)
checar("Operação não muda a política", False, f"select public.salvar_politica_credor({CA}, '{{\"parcela_minima\": 60}}')", au, O)

# ---------------------------------------------------------------- retenção: a análise vai embora com a gravação
EX = sv(f"set role service_role; insert into public.voz_treino_exemplos (empresa_id,gravacao_id,operador_ref,tag,nota,trecho_redigido) values ({EA},{G2},'OP-14','Confirmação sem atrito',97,'Operador: \"Antes de falar da conta, preciso confirmar...\"') returning id")
sv(f"set role service_role; delete from public.voz_gravacoes where id in ({G1},{G2})")
checar("trechos apagados com a gravação", True, f"select count(*) from public.voz_trechos where gravacao_id in ({G1},{G2})", "service_role", None, 0)
checar("avaliação apagada com a gravação", True, f"select count(*) from public.voz_avaliacoes where id={AV}", "service_role", None, 0)
checar("alerta fica só como contagem (sem trecho, cliente e chamada)", True,
       f"select count(*) from public.voz_alertas where empresa_id={EA} and trecho_redigido is null and id_cliente is null and chamada_id is null", "service_role", None, 2)
checar("item aberto da curadoria vai embora", True, f"select count(*) from public.voz_curadoria_itens where id={CU}", "service_role", None, 0)
checar("item tratado fica sem trecho nem chamada", True, f"select count(*) from public.voz_curadoria_itens where id={CI} and trecho_redigido is null and chamada_id is null", "service_role", None, 1)
checar("conjunto de referência fica (decisão 6)", True, f"select count(*) from public.voz_golden_set where origem_item={CI}", "service_role", None, 1)
checar("exemplo de treino perde o trecho", True, f"select coalesce(trecho_redigido, 'apagado') from public.voz_treino_exemplos where id={EX}", "service_role", None, "apagado")
checar("só o servidor roda a limpeza da análise", False, "select public.apagar_analise_voz_expirada()", au, A)
checar("limpeza da análise roda no servidor", True, "select (public.apagar_analise_voz_expirada() ? 'alertas')::text", "service_role", None, "true")

# ---------------------------------------------------------------- uso de IA: custo para a margem, quantidade para a fatura
sv("set role service_role; insert into public.custos_ia_voz (componente,por_mil_entrada,por_mil_saida,por_minuto,vigente_desde) "
   "values ('avaliador',0.002,0.008,0,'2026-01-01'),('embeddings',0.0001,0,0,'2026-01-01')")
checar("só o servidor registra uso de IA", False, f"select public.registrar_uso_ia_voz({EA}, '2026-10-20', 'avaliador', 10, 42.5, 42.5, 100000, 20000)", au, A)
checar("uso de IA grava o custo real pelo custo unitário (100 mil × 0,002 + 20 mil × 0,008)", True,
       f"select public.registrar_uso_ia_voz({EA}, '2026-10-20', 'avaliador', 10, 42.5, 42.5, 100000, 20000)", "service_role", None, "0.36000")
checar("embeddings somam custo sem somar minuto cobrado", True,
       f"select public.registrar_uso_ia_voz({EA}, '2026-10-20', 'embeddings', 10, 42.5, 0, 50000, 0)", "service_role", None, "0.00500")
checar("a fatura recebe só a quantidade (minuto analisado, arredondado para cima)", True,
       f"select quantidade from public.consumo_mensageria where empresa_id={EA} and competencia='2026-10-01' and item='ia_speech_analytics'", "service_role", None, 43)
checar("o custo nunca vira item da fatura", True,
       f"select count(*) from public.consumo_mensageria where empresa_id={EA} and item <> 'ia_speech_analytics' and competencia='2026-10-01'", "service_role", None, 0)
checar("componente sem custo cadastrado fica marcado (nunca custo inventado)", True,
       f"select public.registrar_uso_ia_voz({EA}, '2026-10-21', 'alertas', 3, 5, 0, 1000, 100); select sem_custo::text from public.voz_analise_consumo where empresa_id={EA} and componente='alertas'", "service_role", None, "true")
checar("cliente não vê o custo da IA", True, "select count(*) from public.voz_analise_consumo", au, A, 0)
checar("cliente não vê o custo unitário", True, "select count(*) from public.custos_ia_voz", au, A, 0)
checar("cliente não vê a margem", False, "select * from public.margem_speech_analytics('2026-10-01')", au, A)
# SQL 61 (margem da IA): item de IA só recebe preço de empresa com custo cadastrado em custos_ia (o Master cadastra
# em Console › Margem › IA); R$ 0,004 por minuto deixa R$ 0,05 acima do mínimo da IA
sv("insert into public.custos_ia (item, custo_unitario, vigente_desde, premissa) "
   "values ('ia_speech_analytics', 0.004, '2026-01-01', 'teste') on conflict (item, vigente_desde) do nothing")
sv(f"insert into public.precos_empresa (empresa_id,item,modelo,preco,vigente_desde) values ({EA},'ia_speech_analytics','flat',0.05,'2026-10-01')")
checar("Master vê receita pelo preço da empresa (43 × 0,05) e custo real", True,
       f"select receita || '|' || custo from public.margem_speech_analytics('2026-10-01') where empresa_id={EA}", au, EQ, "2.15|0.37")
checar("%MC desconta impostos (parametros_margem) e o custo real", True,
       f"select m.mc_pct = round(100 * (2.15 * (1 - p.impostos_pct / 100) - 0.365) / 2.15, 1) from public.margem_speech_analytics('2026-10-01') m, public.parametros_margem p where m.empresa_id={EA} and p.id=1", au, EQ, "t")

# ---------------------------------------------------------------- endurecimento
NOVAS = ("voz_conversao_dia", "voz_audio_dia", "voz_qualidade_dia", "voz_temas", "voz_temas_semana", "checklists_qualidade",
         "checklist_versoes", "voz_avaliacoes", "voz_operadores", "voz_treino_exemplos", "voz_alertas", "voz_trechos",
         "voz_buscas", "voz_busca_resultados", "recomendacoes", "recomendacao_impacto", "relatorios_credor",
         "relatorio_credor_respostas", "relatorio_credor_acessos", "voz_curadoria_itens", "voz_golden_set",
         "voz_golden_medicoes", "voz_melhorias", "voz_analise_consumo", "custos_ia_voz")
lista = ",".join(f"'{t}'" for t in NOVAS)
checar("todas as tabelas novas com RLS", True, f"select count(*) from pg_tables where schemaname='public' and tablename in ({lista}) and rowsecurity", "service_role", None, len(NOVAS))
for t in NOVAS:
    checar(f"anon não lê {t}", False, f"select * from public.{t} limit 1", "anon")
checar("nenhuma coluna nova guarda CPF, nome do cliente ou telefone", True,
       f"select count(*) from information_schema.columns where table_schema='public' and table_name in ({lista}) and column_name ~ '(cpf|nome_cliente|telefone|^numero$|email)'", "service_role", None, 0)
checar("funções novas com search_path fixo", True,
       "select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and not coalesce(array_to_string(proconfig, ',') like '%search_path%', false)", "service_role", None, 0)
checar("anon só chama as duas funções do link do credor", True,
       "select string_agg(proname, ',' order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ("
       "'relatorio_credor_publico','responder_relatorio_credor','painel_speech','buscar_trechos_voz','curar_item_voz','aplicar_recomendacao',"
       "'mudar_relatorio_credor','gravar_relatorio_credor','pode_usuario','registrar_recomendacao_voz','alertas_voz','operadores_voz') "
       "and has_function_privilege('anon', oid, 'execute')", "service_role", None, "relatorio_credor_publico,responder_relatorio_credor")

# ---------------------------------------------------------------- contrato com o código da VM (voz/analise)
from voz.analise import contrato as K   # noqa: E402

for tabela, cols in K.COLUNAS.items():
    lista_c = ",".join(f"'{c}'" for c in cols)
    checar(f"colunas que a VM usa em {tabela} existem", True,
           f"select count(*) from information_schema.columns where table_schema='public' and table_name='{tabela}' and column_name in ({lista_c})",
           "service_role", None, len(cols))
for funcao in K.RPCS:
    checar(f"a VM chama {funcao}", True, f"select count(*) > 0 from pg_proc where proname='{funcao}' and has_function_privilege('service_role', oid, 'execute')",
           "service_role", None, "t")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
