-- SQL 85 · Mensagens escritas sem a dívida antes da identidade (SMS, WhatsApp, RCS e e-mail)
--
-- Decisão do dono (08/11/2026). O SMS padrão do Assistente de implantação dizia "seu débito de {saldo}" a quem estivesse
-- com o telefone, antes de qualquer confirmação de identidade (CDC art. 42; LGPD art. 6º, III). A trava B7 (SQL 83,
-- public.texto_revela_antes_identidade) cobre a voz; a mensagem escrita não tem "depois da confirmação": chega inteira a
-- quem pegar o telefone ou abrir a caixa de e-mail. Os padrões do MotorCX passam a ser neutros ("Olá, {primeiro_nome}.
-- Você tem uma mensagem da <empresa>. Acesse: {link}"); o detalhe fica atrás do link autenticado.
--
-- 1. public.mensagem_revela_divida(texto, empresa_nome) → boolean: cópia de motor/trava_identidade.py
--    (motivos_mensagem; os mesmos casos em tests/dados/mensagem_identidade_casos.json). Usa a trava B7 e, além dela,
--    os termos sensíveis da B7 em qualquer frase, as variáveis de chave simples ({saldo}, {valor_parcela},
--    {vencimento}, {credor}…) e as palavras que numa mensagem de cobrança dizem que há dívida (parcela, acordo,
--    negociar, quitar, regularizar, pagamento…). O nome da empresa que envia vira {empresa} antes de conferir
--    ("Alfa Cobrança" no nome não é a dívida).
-- 2. Nada é bloqueado nem reescrito: o texto salvo é do cliente. O site avisa no editor (sem impedir o Salvar) e este
--    SQL lista, só por id, os textos já salvos que revelam a dívida: frases do playbook dos canais escritos (as
--    "Padrão MotorCX · <etapa>" antigas à parte), templates da Mensageria, modelos de e-mail e estratégias com texto
--    próprio. Correção: o cliente edita o texto (Canais › Frases, Mensageria › Templates, Orquestração); no Assistente
--    de implantação, salvar o passo 4 de novo grava as frases padrão novas.
-- Independente dos SQL 79 a 84. Depende do SQL 83 (B7). Pode rodar de novo. Nenhuma tabela muda.

create or replace function public.mensagem_revela_divida(texto text, empresa_nome text default null) returns boolean
language plpgsql immutable parallel safe set search_path = public as $$
declare
    sensivel constant text := '\y(credor\w*|divida\w*|debito\w*|contrato\w*|saldo\w*|pendencia\w*|inadimpl\w*|atrasad\w*|em atraso|em aberto|fatura\w*|boleto\w*|cobranca\w*|valor (devido|da divida|do debito|em aberto|da parcela|total))\y|\{\{ *(credor|saldo|dias_atraso|vencimento|valor_minimo|parcelas_max|desconto_max|link_pagamento|oferta\.[a-z_]+) *\}\}';
    variavel_mensagem constant text := '\{\{? *(saldo\w*|credor\w*|valor\w*|vencimento\w*|dias_atraso|qtd_parcelas\w*|contrato\w*|id_contrato|parcelas_max|desconto\w*|link_pagamento|oferta\.[a-z_]+) *\}\}?';
    termo_mensagem constant text := '\y(parcela\w*|acordo\w*|negocia\w*|renegocia\w*|quita\w*|regulariz\w*|pagamento\w*|pague\w*|pagar|vencid\w*|devedor\w*|devendo|calote\w*)\y';
    t text;
    e text;
begin
    t := btrim(regexp_replace(translate(lower(coalesce(texto, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
                              '\s+', ' ', 'g'));
    e := btrim(regexp_replace(translate(lower(coalesce(empresa_nome, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
                              '\s+', ' ', 'g'));
    if length(e) >= 2 then
        t := replace(t, e, '{empresa}');
    end if;
    if t = '' then
        return false;
    end if;
    return public.texto_revela_antes_identidade(t) or t ~ sensivel or t ~ variavel_mensagem or t ~ termo_mensagem;
end $$;
revoke all on function public.mensagem_revela_divida(text, text) from public, anon;
grant execute on function public.mensagem_revela_divida(text, text) to authenticated, service_role;
comment on function public.mensagem_revela_divida(text, text) is
    'SQL 85: a mensagem escrita (SMS, WhatsApp, RCS, e-mail) conta a quem estiver com o telefone que há dívida, valor, '
    'parcela, credor ou contrato (cópia de motor/trava_identidade.py › motivos_mensagem). Só aviso: nada é bloqueado.';

-- Os textos (strings) de um jsonb, separados como frases (para os templates e as estratégias).
create or replace function public.textos_jsonb(j jsonb) returns text
language sql immutable parallel safe as $$
    select coalesce(string_agg(v #>> '{}', '. '), '')
      from jsonb_path_query(coalesce(j, 'null'::jsonb), 'strict $.** ? (@.type() == "string")') v
$$;
revoke all on function public.textos_jsonb(jsonb) from public, anon;
grant execute on function public.textos_jsonb(jsonb) to service_role;

-- ---------------------------------------------------------------- o que já está salvo: só listar (ids)
do $lista$
declare n integer; ids text;
begin
    select count(*), string_agg(f.id::text, ', ' order by f.id) into n, ids
      from public.frases f join public.empresas e on e.id = f.empresa_id
     where f.ativo and f.canal in ('sms', 'whatsapp', 'rcs', 'email') and f.nome like 'Padrão MotorCX · %'
       and public.mensagem_revela_divida(f.texto, e.nome);
    if n > 0 then
        raise notice 'SQL 85: % frase(s) "Padrão MotorCX" do Assistente de implantação com o texto antigo, que revela a dívida (ids: %). Nada foi mudado: a empresa pode ter editado o texto. Correção: Canais › Frases (a tela avisa) ou salvar de novo o passo 4 do Assistente de implantação, que grava o padrão neutro.', n, ids;
    else
        raise notice 'SQL 85: nenhuma frase "Padrão MotorCX" revela a dívida';
    end if;
    select count(*), string_agg(f.id::text, ', ' order by f.id) into n, ids
      from public.frases f join public.empresas e on e.id = f.empresa_id
     where f.ativo and f.canal in ('sms', 'whatsapp', 'rcs', 'email') and f.nome not like 'Padrão MotorCX · %'
       and public.mensagem_revela_divida(f.texto, e.nome);
    if n > 0 then
        raise notice 'SQL 85: % frase(s) próprias de canal escrito citam dívida, valor, parcela, credor ou contrato (ids: %). Nada foi mudado: o texto é do cliente. A tela Canais › Frases avisa ao editar.', n, ids;
    else
        raise notice 'SQL 85: nenhuma frase própria de canal escrito revela a dívida';
    end if;
    select count(*), string_agg(t.id::text, ', ' order by t.id) into n, ids
      from public.mensageria_templates t join public.empresas e on e.id = t.empresa_id
     where t.situacao <> 'arquivado' and public.mensagem_revela_divida(public.textos_jsonb(t.conteudo), e.nome);
    if n > 0 then
        raise notice 'SQL 85: % template(s) da Mensageria citam dívida, valor, parcela, credor ou contrato (ids: %). Nada foi mudado: o texto é do cliente. A tela Mensageria › Templates avisa ao editar.', n, ids;
    else
        raise notice 'SQL 85: nenhum template da Mensageria revela a dívida';
    end if;
    select count(*), string_agg(m.empresa_id::text, ', ' order by m.empresa_id) into n, ids
      from public.mensageria_modelos_email m join public.empresas e on e.id = m.empresa_id
     where public.mensagem_revela_divida(m.remetente_nome || '. ' || m.assunto || '. ' || m.corpo, e.nome);
    if n > 0 then
        raise notice 'SQL 85: % modelo(s) de e-mail (remetente, assunto ou texto) citam dívida, valor, parcela, credor ou contrato (empresas: %). Nada foi mudado: o texto é do cliente.', n, ids;
    else
        raise notice 'SQL 85: nenhum modelo de e-mail revela a dívida';
    end if;
    select count(*), string_agg(s.id::text, ', ' order by s.id) into n, ids
      from public.estrategias s join public.empresas e on e.id = s.empresa_id
     where public.mensagem_revela_divida(
               public.textos_jsonb(jsonb_path_query_array(s.definicao, 'lax $.**.mensagem'))
               || '. ' || public.textos_jsonb(jsonb_path_query_array(s.definicao, 'lax $.**.mensagens'))
               || '. ' || public.textos_jsonb(jsonb_path_query_array(s.definicao, 'lax $.**.mensagem_hot')), e.nome);
    if n > 0 then
        raise notice 'SQL 85: % estratégia(s) com texto próprio de mensagem que cita dívida, valor, parcela, credor ou contrato (ids: %). Nada foi mudado: o texto é do cliente. O editor de mensagem da Orquestração avisa ao editar.', n, ids;
    else
        raise notice 'SQL 85: nenhuma estratégia com texto próprio que revela a dívida';
    end if;
end $lista$;
