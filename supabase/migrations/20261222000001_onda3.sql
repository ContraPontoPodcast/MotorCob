-- SQL 55 · Onda 3 da navegação: histórico de 90 dias do cliente da Jornada e "Avisar o Admin" (sino e e-mail)
-- Protótipo aprovado pelo dono (Onda 3: Jornada com Clientes e Painel, Avisar o Admin, Minha conta no celular).
-- Decisões do dono: o histórico do cliente mostra 90 dias; o "Avisar o Admin" avisa pelo sino e por e-mail.
-- 1. J1 · jornada_cliente_dia: um registro por cliente e dia em que algo aconteceu na Jornada (entrou numa fase, teve
--    ação num canal ou fechou um resultado). Só o ID do cliente, nada de contato ou CPF. Quem grava é o motor
--    (nuvem/sincronizar.py, chave do servidor), que também apaga o que passou de 90 dias. A RLS é a de
--    minhas_empresas(), como em jornada_cliente. historico_cliente_jornada(credor, id_cliente) devolve os últimos
--    90 dias para a gaveta de Jornada › Clientes (security invoker: a RLS filtra a empresa).
-- 2. A1 · avisar_admin(tipo, alvo, nota, tela): quem não pode abrir uma tela ('permissao', alvo = a permissão), quem
--    quer uma área fora do plano ('area', alvo = cobranca, jornada ou mensageria) ou quem precisa que alguém pague
--    uma fatura ('fatura', alvo = o id da fatura) avisa os Admins ativos da empresa. Cada Admin recebe um aviso no
--    sino (para = 'usuario', tipo = 'atencao') com o nome e o perfil de quem pediu e a nota (até 200 caracteres); o
--    assunto novo "Pedidos ao Admin" vem com o e-mail ligado, então o mesmo aviso sai por e-mail pela fila que já
--    existe (avisos_para_email, SQL 42, e a função emails). O Admin pode desligar o e-mail ou o sino em
--    Minha conta › Notificações. A chave pedido:{uid}:{alvo}:{data}:{admin} faz o pedido sair no máximo uma vez por
--    dia. Devolve quantos Admins foram avisados (0 = a empresa está sem Admin ativo) e o horário do pedido.
--    A equipe MotorCX não chama.
-- 3. A2 · pedido_admin_hoje(alvo): o horário do pedido de hoje, ou null (quem pediu não lê os avisos dos Admins).
-- Painel e Visão geral da Jornada não precisam de SQL: usam mapa_jornada, resultado_jornada e resultado_frases
-- (SQL 40). Depende dos SQL 34, 40 e 42. Pode rodar de novo sem erro.
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'jornada_cliente_dia') as tabela_j1,
--          (select relrowsecurity from pg_class where oid = 'public.jornada_cliente_dia'::regclass) as rls_j1,
--          (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
--             and proname in ('historico_cliente_jornada', 'avisar_admin', 'pedido_admin_hoje')) as funcoes,   -- 3
--          (select email_padrao from public.notificacao_assuntos where codigo = 'pedidos_admin') as email_ligado, -- true
--          has_function_privilege('anon', 'public.avisar_admin(text, text, text, text)', 'execute') as anon_chama; -- false

-- ================================================================ 1. J1: histórico de 90 dias do cliente
create table if not exists public.jornada_cliente_dia (
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    credor_id        bigint not null,
    id_cliente       text not null check (length(id_cliente) between 1 and 60),
    data             date not null,
    fase             text not null default '' check (length(fase) <= 40),       -- '' = fora da jornada; cobranca = em atraso
    entrou           boolean not null default false,                             -- a fase mudou neste dia (ou o cliente chegou)
    passo            text not null default '' check (length(passo) <= 10),
    canal            text not null default '' check (length(canal) <= 20),       -- '' = sem ação neste dia
    desfecho         text not null default '' check (desfecho in ('', 'sucesso', 'nao', 'cobranca')),
    desfecho_momento text not null default '' check (length(desfecho_momento) <= 40),
    primary key (empresa_id, credor_id, id_cliente, data),
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade
);
comment on table public.jornada_cliente_dia is
    'MotorCli: o que aconteceu com cada cliente em cada dia (fase, passo, canal e resultado), só o ID. 90 dias; o motor grava e apaga.';
create index if not exists jornada_cliente_dia_data on public.jornada_cliente_dia (empresa_id, credor_id, data);
alter table public.jornada_cliente_dia enable row level security;
drop policy if exists jornada_cliente_dia_ver on public.jornada_cliente_dia;
create policy jornada_cliente_dia_ver on public.jornada_cliente_dia for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.jornada_cliente_dia from anon;
revoke insert, update, delete on public.jornada_cliente_dia from authenticated;
grant select on public.jornada_cliente_dia to authenticated;
grant all on public.jornada_cliente_dia to service_role;

create or replace function public.historico_cliente_jornada(credor bigint, id_cliente text)
returns table (data date, fase text, entrou boolean, passo text, passo_texto text, canal text, desfecho text,
               desfecho_momento text)
language sql stable security invoker set search_path = public as $$
    select d.data, d.fase, d.entrou, d.passo, public.rotulo_passo_jornada(d.fase, d.passo), d.canal, d.desfecho,
           d.desfecho_momento
      from public.jornada_cliente_dia d
     where d.credor_id = historico_cliente_jornada.credor
       and d.id_cliente = historico_cliente_jornada.id_cliente
       and d.data >= (now() at time zone 'America/Sao_Paulo')::date - 90
     order by d.data desc
     limit 120
$$;
revoke all on function public.historico_cliente_jornada(bigint, text) from public, anon;
grant execute on function public.historico_cliente_jornada(bigint, text) to authenticated, service_role;

-- ================================================================ 2. A1: avisar o Admin (sino e e-mail)
-- assunto do sino e do e-mail: só os Admins (quem gerencia usuários) veem a preferência; e-mail ligado de saída
insert into public.notificacao_assuntos (codigo, nome, descricao, sino_obrigatorio, email_obrigatorio, email_padrao,
                                         remetente, requer, ordem)
values ('pedidos_admin', 'Pedidos ao Admin', 'Acesso a uma tela, área fora do plano ou fatura a pagar', false, false, true,
        'avisos', 'gerenciar_usuarios', 35)
on conflict (codigo) do update set nome = excluded.nome, descricao = excluded.descricao,
    sino_obrigatorio = excluded.sino_obrigatorio, email_obrigatorio = excluded.email_obrigatorio,
    email_padrao = excluded.email_padrao, remetente = excluded.remetente, requer = excluded.requer, ordem = excluded.ordem;

drop function if exists public.avisar_admin(text, text, text);
create or replace function public.avisar_admin(tipo text, alvo text, nota text default null, tela text default null)
returns table (avisados int, avisado_em timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
    eu public.perfis;
    hoje text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
    n text := nullif(left(trim(regexp_replace(coalesce(nota, ''), '[[:cntrl:]\s]+', ' ', 'g')), 200), '');
    t text := nullif(left(trim(regexp_replace(coalesce(tela, ''), '[[:cntrl:]\s]+', ' ', 'g')), 60), '');
    quem text;
    papel_nome text;
    titulo text;
    texto text;
    link text;
    f public.faturas;
    meses text[] := array['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro',
                          'outubro', 'novembro', 'dezembro'];
    prefixo text;
    total int;
    primeiro timestamptz;
begin
    if auth.uid() is null then
        raise exception 'faça login';
    end if;
    select * into eu from public.perfis p where p.id = auth.uid() and p.ativo;
    if eu.id is null or eu.equipe or eu.empresa_id is null then
        raise exception 'só quem é de uma empresa cliente avisa o Admin';
    end if;
    alvo := lower(trim(coalesce(alvo, '')));
    quem := coalesce(nullif(trim(concat_ws(' ', eu.nome, eu.sobrenome)), ''), 'Uma pessoa da empresa');
    papel_nome := case eu.papel::text when 'admin' then 'Admin' when 'planejamento' then 'Planejamento'
                                      when 'operacao' then 'Operação' when 'gestao' then 'Gestão' else eu.papel::text end;
    if tipo = 'permissao' then
        select coalesce(t, c.nome) into t from public.permissoes_catalogo c where c.codigo = alvo;
        if not found then
            raise exception 'permissão desconhecida';
        end if;
        titulo := quem || ' pediu acesso: ' || t;
        texto := 'Perfil ' || papel_nome || '.' || coalesce(' "' || n || '"', '') ||
                 ' Quem libera é você, em Pessoas e perfis.';
        link := '/empresa/pessoas?pessoa=' || eu.id;
    elsif tipo = 'area' then
        if alvo not in ('cobranca', 'jornada', 'mensageria') then
            raise exception 'área desconhecida';
        end if;
        titulo := quem || ' quer conhecer a ' ||
                  case alvo when 'cobranca' then 'Cobrança' when 'jornada' then 'Jornada do Cliente' else 'Mensageria' end;
        texto := 'Perfil ' || papel_nome || '. A área não faz parte do plano.' || coalesce(' "' || n || '"', '') ||
                 ' Se fizer sentido, fale com o time comercial em Suporte.';
        link := '/suporte/novo?assunto=conhecer-' || alvo;
    elsif tipo = 'fatura' then
        if alvo !~ '^[0-9]{1,15}$' then
            raise exception 'fatura desconhecida';
        end if;
        select * into f from public.faturas x where x.id = alvo::bigint and x.empresa_id = eu.empresa_id
                                                and x.situacao in ('aberta', 'vencida');
        if f.id is null then
            raise exception 'fatura desconhecida ou já paga';
        end if;
        titulo := quem || ' avisou sobre a fatura de ' || meses[extract(month from f.competencia)::int];
        texto := 'Vencimento em ' || to_char(f.vencimento, 'DD/MM') || '.' || coalesce(' "' || n || '"', '') ||
                 ' Pague em Empresa › Faturas.';
        link := '/empresa/faturamento?fatura=' || f.id;
    else
        raise exception 'tipo de aviso desconhecido';
    end if;

    prefixo := 'pedido:' || eu.id || ':' || alvo || ':' || hoje || ':';
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, chave, assunto)
    select 'usuario', eu.empresa_id, p.id, 'atencao', left(titulo, 140), left(texto, 400), link, prefixo || p.id,
           'pedidos_admin'
      from public.perfis p
     where p.empresa_id = eu.empresa_id and p.ativo and not p.equipe and p.papel = 'admin' and p.id <> eu.id
    on conflict (chave) where chave is not null do nothing;

    select count(*)::int, min(a.criado_em) into total, primeiro
      from public.avisos a
     where a.para = 'usuario' and a.empresa_id = eu.empresa_id and starts_with(a.chave, prefixo);
    return query select total, primeiro;
end $$;
revoke all on function public.avisar_admin(text, text, text, text) from public, anon;
grant execute on function public.avisar_admin(text, text, text, text) to authenticated;
comment on function public.avisar_admin(text, text, text, text) is
    'Avisa os Admins da empresa (sino e e-mail): permissao, area ou fatura. No máximo uma vez por dia por alvo.';

-- ================================================================ 3. A2: o pedido de hoje
create or replace function public.pedido_admin_hoje(alvo text) returns timestamptz
language sql stable security definer set search_path = public as $$
    select min(a.criado_em)
      from public.avisos a
     where auth.uid() is not null and a.para = 'usuario'
       and a.criado_em >= ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo'
       and starts_with(a.chave, 'pedido:' || auth.uid() || ':' || lower(trim(coalesce(alvo, ''))) || ':' ||
                                to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') || ':')
$$;
revoke all on function public.pedido_admin_hoje(text) from public, anon;
grant execute on function public.pedido_admin_hoje(text) to authenticated;
