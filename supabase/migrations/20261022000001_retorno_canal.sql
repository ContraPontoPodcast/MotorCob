-- Retorno de canal: os arquivos dos fornecedores (DLR do SMS, entrega/leitura/clique do RCS e
-- WhatsApp, hard/soft bounce do e-mail, discagem da voz) — só o contato e o status — oxigenam a base:
-- número morto, em pausa ou bloqueado sai do canal e o próximo contato do cliente assume.
--
-- * envios: tipos canal_sms, canal_rcs, canal_whatsapp, canal_email, canal_voz (Enviar arquivos)
-- * mapeamento_arquivos: o cliente aponta, por canal, a coluna do contato, a do status e a da data
--   (tipo canal_<canal>; colunas = {contato, status, data?})
-- * canal_codigos: cada status do fornecedor e a marca do cliente
--   (inexistente · temporario · entregue · lido · clique · bloqueio); o motor sugere
-- * canais_empresa.regras_retorno: regras de renitência do canal (página Canais)
--   {temporarios_pausa, dias_pausa, inexistente: bloquear|retestar|ignorar, dias_rever, limite_lote}
-- Pode ser rodado de novo sem erro.

alter table public.envios drop constraint if exists envios_tipo_check;
alter table public.envios add constraint envios_tipo_check
    check (tipo in ('base', 'incremental', 'retirada', 'acordo', 'baixa', 'ocorrencia', 'enriquecimento',
                    'clientes', 'contatos', 'parcelas', 'retorno', 'portal',
                    'canal_sms', 'canal_rcs', 'canal_whatsapp', 'canal_email', 'canal_voz'));

do $$
declare c text;
begin
    for c in select conname from pg_constraint
             where conrelid = 'public.mapeamento_arquivos'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) like '%tipo%' loop
        execute format('alter table public.mapeamento_arquivos drop constraint %I', c);
    end loop;
    alter table public.mapeamento_arquivos add constraint mapeamento_arquivos_tipo_check
        check (tipo in ('ocorrencia', 'acordo', 'baixa',
                        'canal_sms', 'canal_rcs', 'canal_whatsapp', 'canal_email', 'canal_voz'));
end $$;

create table if not exists public.canal_codigos (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint,
    canal           text not null check (canal in ('sms', 'rcs', 'whatsapp', 'email', 'voz')),
    codigo          text not null check (length(codigo) <= 200),
    marca           text check (marca in ('inexistente', 'temporario', 'entregue', 'lido', 'clique', 'bloqueio')),
    mapeado         boolean not null default false,
    sugerido        text,
    qtd             int not null default 0,
    primeira_vez    date,
    ultima_vez      date,
    visto_em        timestamptz,
    atualizado_em   timestamptz,
    atualizado_por  uuid default auth.uid() references auth.users (id),
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade,
    unique nulls not distinct (empresa_id, credor_id, canal, codigo)
);
create index if not exists canal_codigos_novos on public.canal_codigos (empresa_id, credor_id)
    where not mapeado;

drop trigger if exists a_empresa_do_credor on public.canal_codigos;
create trigger a_empresa_do_credor before insert or update on public.canal_codigos
    for each row execute function public.empresa_do_credor();
alter table public.canal_codigos enable row level security;
drop policy if exists canal_codigos_ver on public.canal_codigos;
create policy canal_codigos_ver on public.canal_codigos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists canal_codigos_criar on public.canal_codigos;
create policy canal_codigos_criar on public.canal_codigos for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()));
drop policy if exists canal_codigos_editar on public.canal_codigos;
create policy canal_codigos_editar on public.canal_codigos for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()))
    with check (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()));
drop policy if exists canal_codigos_apagar on public.canal_codigos;
create policy canal_codigos_apagar on public.canal_codigos for delete to authenticated
    using (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()));
revoke all on public.canal_codigos from anon;

alter table public.canais_empresa add column if not exists regras_retorno jsonb
    check (regras_retorno is null or jsonb_typeof(regras_retorno) = 'object');
comment on column public.canais_empresa.regras_retorno is
    'Regras de renitência do retorno de canal: {temporarios_pausa, dias_pausa, inexistente: bloquear|retestar|ignorar, dias_rever, limite_lote}. Vazio = padrão do MotorCob.';
