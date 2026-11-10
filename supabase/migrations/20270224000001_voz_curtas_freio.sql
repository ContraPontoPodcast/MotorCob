-- SQL 109 · Agente de voz: freios de chamadas curtas no ritmo (Power e Preditivo, V6; PREDITIVO.md 3.7, P12).
-- Regra da Anatel (Despacho Decisório 100/2026 e MP 1.396/2026, vigência 12/11/2026): linha com mais de 1.000 ligações
-- ou empresa com mais de 10.000 no dia e 85 % ou mais curtas = TODAS as linhas do CNPJ bloqueadas por 15 dias. A VM
-- mede em tempo real (voz/orquestrador/curtas.py) e freia bem antes: a razão cai de 70 % a 80 %; em 80 % com 800
-- ligações a linha para no dia; em 80 % com 8.000 a empresa para no dia. Este SQL dá à VM e ao Admin o que falta:
--
-- 1. curtas_hoje_voz(empresa): as curtas do dia por linha (tronco) e no total, somadas das amostras que a VM já gravou
--    (voz_ritmo_amostras, SQL 106), e se o Admin liberou hoje. A VM lê a cada 5 min: reiniciada, não começa do zero.
--    Só o servidor ou a VM (voz_vm.curtas_hoje). Só contagens.
-- 2. voz_curtas_liberacoes + liberar_curtas_voz(empresa, motivo): "Liberar até 950/linha e 9.500/total hoje (assumo o
--    risco)". Só o Admin da empresa (ou o Admin da equipe MotorCX), com motivo (10 a 300 caracteres, sem CPF, telefone
--    ou e-mail), uma vez por dia; vale só no dia (America/Sao_Paulo). Auditada (z_auditar). Não desliga freio nenhum:
--    os volumes de parada sobem para 950 e 9.500 e a redução da razão continua. Leitura: quem é da empresa e a equipe
--    que cuida da voz. Nunca troca a bina nem desvia para outra linha.
-- Depende dos SQL 106 (amostras) e 93 (hoje_sp). Pode rodar de novo.

-- ================================================================ 1. curtas de hoje (VM)
create or replace function public.curtas_hoje_voz(empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    hoje date := public.hoje_sp();
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    return jsonb_build_object(
        'dia', hoje,
        'total', (select coalesce(sum(a.discadas), 0) from public.voz_ritmo_amostras a
                   where a.empresa_id = curtas_hoje_voz.empresa and a.dia = hoje),
        'curtas', (select coalesce(sum(a.curtas), 0) from public.voz_ritmo_amostras a
                    where a.empresa_id = curtas_hoje_voz.empresa and a.dia = hoje),
        'troncos', coalesce((select jsonb_agg(jsonb_build_object('tronco_id', t.tronco_id, 'total', t.total,
                                                                  'curtas', t.curtas) order by t.tronco_id)
                               from (select (x ->> 'tronco_id')::bigint as tronco_id,
                                            sum((x ->> 'discadas')::int) as total, sum((x ->> 'curtas')::int) as curtas
                                       from public.voz_ritmo_amostras a, jsonb_array_elements(a.por_tronco) x
                                      where a.empresa_id = curtas_hoje_voz.empresa and a.dia = hoje
                                      group by 1) t), '[]'::jsonb),
        'liberado', exists (select 1 from public.voz_curtas_liberacoes l
                             where l.empresa_id = curtas_hoje_voz.empresa and l.dia = hoje));
end $$;

-- ================================================================ 2. liberação manual do Admin (só no dia)
create table if not exists public.voz_curtas_liberacoes (
    id         bigint generated always as identity primary key,
    empresa_id bigint not null references public.empresas (id) on delete cascade,
    dia        date not null default public.hoje_sp(),
    motivo     text not null check (char_length(btrim(motivo)) between 10 and 300),
    criado_por uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em  timestamptz not null default now(),
    constraint voz_curtas_liberacoes_dia unique (empresa_id, dia)
);
comment on table public.voz_curtas_liberacoes is
    'Liberação do Admin: linha para em 950 (não 800) e empresa em 9.500 (não 8.000) ligações com 80 % de curtas, só '
    'no dia. Só liberar_curtas_voz grava; auditada. SQL 109.';
alter table public.voz_curtas_liberacoes enable row level security;
drop policy if exists voz_curtas_liberacoes_ver on public.voz_curtas_liberacoes;
create policy voz_curtas_liberacoes_ver on public.voz_curtas_liberacoes for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) or public.cuida_voz(empresa_id));
revoke all on public.voz_curtas_liberacoes from public, anon, authenticated;
grant select on public.voz_curtas_liberacoes to authenticated, service_role;
drop trigger if exists z_auditar on public.voz_curtas_liberacoes;
create trigger z_auditar after insert or update or delete on public.voz_curtas_liberacoes
    for each row execute function public.auditar();

create or replace function public.liberar_curtas_voz(empresa bigint, motivo text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    novo bigint;
begin
    if not exists (select 1 from public.perfis p
                    where p.id = auth.uid() and p.ativo and p.papel = 'admin'
                      and (p.equipe or p.empresa_id = liberar_curtas_voz.empresa))
       or liberar_curtas_voz.empresa not in (select public.minhas_empresas()) then
        raise exception 'só o Admin da empresa libera';
    end if;
    if not exists (select 1 from public.voz_config c where c.empresa_id = liberar_curtas_voz.empresa) then
        raise exception 'empresa sem voz configurada';
    end if;
    if motivo is null or char_length(btrim(motivo)) not between 10 and 300
       or not public.texto_sem_dado_pessoal(motivo) then
        raise exception 'motivo: de 10 a 300 caracteres, sem CPF, telefone ou e-mail';
    end if;
    insert into public.voz_curtas_liberacoes (empresa_id, motivo)
    values (liberar_curtas_voz.empresa, btrim(motivo))
    on conflict on constraint voz_curtas_liberacoes_dia do nothing
    returning id into novo;
    if novo is null then
        raise exception 'já liberado hoje';
    end if;
    return novo;
end $$;

revoke all on function public.curtas_hoje_voz(bigint) from public, anon, authenticated;
grant execute on function public.curtas_hoje_voz(bigint) to service_role;
revoke all on function public.liberar_curtas_voz(bigint, text) from public, anon;
grant execute on function public.liberar_curtas_voz(bigint, text) to authenticated;

create or replace function voz_vm.curtas_hoje(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.curtas_hoje_voz((args ->> 'empresa')::bigint)
$$;
revoke all on function voz_vm.curtas_hoje(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.curtas_hoje(jsonb) to motorcx_voz;
