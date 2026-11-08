-- SQL 83 · Agente Voz/CX: destinos perigosos (B4), aviso de gravação e teto de retenção (B6) e identidade antes da
-- dívida nos textos do Speech Analytics (B7)
--
-- Decisões do dono (08/11/2026; SPEC §6.1 e revisão do especialista C10, C13, C15, G16, G17, G24 e G36). O agente
-- de voz ainda não liga para clientes: nada aqui apaga dado de cliente.
--
-- 1. B4 · Destinos perigosos. O endereço do tronco (voz_troncos.host) e o host do destino da transferência
--    (voz_transferencias.destino_sip) não podem ser IP interno, reservado ou de loopback (10/8, 172.16/12,
--    192.168/16, 127/8, 169.254/16, 100.64/10, 0/8, 192.0.0/24, 198.18/15, multicast e 240/4), um IP do próprio
--    MotorCX (voz_enderecos_motorcx, a equipe cadastra) nem um nome de rede interna (localhost, *.internal, *.local,
--    metadata, nip.io/sslip.io…). Gatilho voz_destino_seguro: vale no cadastro e quando o endereço muda. O banco não
--    resolve DNS: a VM confere de novo DEPOIS de resolver o nome (voz/destinos.py, voz/configuracao.py e o gerador do
--    Asterisk) e deixa de fora sozinho o tronco ou a transferência recusada. As faixas de documentação (TEST-NET)
--    continuam aceitas: não são roteadas e são os endereços fictícios dos exemplos.
--    Plano de discagem só nacional (10/11 dígitos): é da VM (voz/asterisk/gerador.py e o orquestrador); nada no banco.
-- 2. B6 · Aviso de gravação e retenção.
--    a. voz_config.aviso_gravacao passa a vir LIGADO. Na primeira vez que este SQL roda, as empresas que estavam
--       com o padrão antigo (desligado) passam a ligado (raise notice com os ids; z_auditar registra). Rodar de novo
--       não mexe em quem desligou depois. A abertura (VM) diz "Esta ligação é gravada. Sou o assistente virtual da
--       {empresa}." (a frase do assistente virtual vale sempre, em todas as carteiras).
--    b. Retenção com teto: voz_config.retencao_dias passa a ser 90 (o mínimo já era 90; não há mais "sem teto").
--       voz_config.retencao_prova_dias (novo, 90 a 1.825 = 5 anos, padrão 90): só para gravação com promessa
--       (acordo proposto na ligação entra como promessa) ou contestação ("contesta", "não reconhece" ou "fraude"
--       no Speech Analytics). voz_gravacoes.prova (novo) diz qual; o gatilho calcula expira_em com o teto e acompanha
--       quando a chamada vira promessa ou a análise acha contestação. Empresa com retenção acima de 90: o check entra
--       sem validar (NOT VALID), a empresa é listada no raise notice e as gravações NOVAS já saem com o teto; as que
--       já existem não mudam (ver a correção no APLICAR).
-- 3. B7 · Identidade antes da dívida nos textos. public.texto_revela_antes_identidade(texto) é a cópia de
--    motor/trava_identidade.py (os mesmos casos em tests/dados/trava_identidade_casos.json). Recomendação nova ou
--    reescrita que sugira dizer credor, dívida, valor ou contrato antes de confirmar a identidade é recusada (gatilho
--    em recomendacoes); a antiga que já está no banco não vira rascunho (Aplicar recusa) e é listada no raise notice.
--    O item ck_ident do checklist padrão ("Se identificou (empresa e motivo da ligação)") pedia o motivo antes da
--    identidade: o padrão ganha uma versão nova com o texto corrigido (a versão antiga vale para os dias passados).
-- Depende dos SQL 56 (voz), 57 (voz_vm), 60/62 (recomendações e análise). Pode rodar de novo. Se o SQL 56 rodar de
-- novo, rode este depois (ele recria configurar_voz_empresa e validade_gravacao_voz). A limpeza (apagar_voz_expirada)
-- não muda: ela já usa voz_config.retencao_dias, que agora tem o teto de 90.

-- ================================================================ 1. B4 · destinos perigosos
create or replace function public.voz_faixas_reservadas() returns cidr[]
language sql immutable parallel safe as $$
    select array['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
                 '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4']::cidr[]
$$;
create or replace function public.voz_sufixos_proibidos() returns text[]
language sql immutable parallel safe as $$
    select array['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'localdomain', 'home.arpa',
                 'in-addr.arpa', 'ip6.arpa', 'invalid', 'metadata', 'nip.io', 'sslip.io', 'xip.io', 'localtest.me',
                 'lvh.me']::text[]
$$;
revoke all on function public.voz_faixas_reservadas(), public.voz_sufixos_proibidos() from public, anon;
grant execute on function public.voz_faixas_reservadas(), public.voz_sufixos_proibidos() to authenticated, service_role;
comment on function public.voz_faixas_reservadas() is
    'SQL 83 · B4: IPv4 que nunca é destino de tronco ou transferência (cópia de voz/destinos.py › FAIXAS_RESERVADAS).';

create table if not exists public.voz_enderecos_motorcx (
    faixa      cidr primary key,
    descricao  text not null check (char_length(trim(descricao)) between 2 and 120),
    criado_em  timestamptz not null default now()
);
comment on table public.voz_enderecos_motorcx is
    'SQL 83 · B4: IPs (ou faixas) do próprio MotorCX (VMs de voz, NAT, balanceadores). Nenhum tronco ou transferência '
    'aponta para eles. Só a equipe grava (SQL Editor); a VM lê por voz_vm.enderecos_motorcx.';
alter table public.voz_enderecos_motorcx enable row level security;
revoke all on public.voz_enderecos_motorcx from anon, authenticated;
grant all on public.voz_enderecos_motorcx to service_role;
drop trigger if exists z_auditar on public.voz_enderecos_motorcx;
create trigger z_auditar after insert or update or delete on public.voz_enderecos_motorcx
    for each row execute function public.auditar();

-- motivo (uma frase, sem o endereço) ou null. Cópia de voz/destinos.py › motivo_host sem o DNS.
create or replace function public.voz_host_motivo(host text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
    h text := regexp_replace(lower(btrim(coalesce(host, ''))), '\.$', '');
    ip inet;
begin
    if h = '' then
        return 'endereço vazio';
    end if;
    if h ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' then
        if h ~ '(^|\.)0[0-9]' or exists (select 1 from regexp_split_to_table(h, '\.') o where o::int > 255) then
            return 'IPv4 inválido';
        end if;
        ip := h::inet;
        if exists (select 1 from unnest(public.voz_faixas_reservadas()) f where ip <<= f) then
            return 'endereço em rede interna, reservada ou de loopback';
        end if;
        if exists (select 1 from public.voz_enderecos_motorcx m where ip <<= m.faixa) then
            return 'endereço do próprio MotorCX';
        end if;
        return null;
    end if;
    if position(':' in h) > 0 then
        return 'IPv6 direto não é aceito: use um nome';
    end if;
    if exists (select 1 from unnest(public.voz_sufixos_proibidos()) s where h = s or right(h, length(s) + 1) = '.' || s) then
        return 'nome de rede interna ou que aponta para um IP interno';
    end if;
    return null;
end $$;
revoke all on function public.voz_host_motivo(text) from public, anon;
grant execute on function public.voz_host_motivo(text) to authenticated, service_role;

create or replace function public.voz_host_transferencia(destino_sip text) returns text
language sql immutable parallel safe as $$
    select substring(destino_sip from '^sips?:[^@]+@([^:;]+)')
$$;

revoke all on function public.voz_host_transferencia(text) from public, anon;
grant execute on function public.voz_host_transferencia(text) to authenticated, service_role;

-- vale no cadastro e quando o endereço muda: um tronco antigo com endereço recusado ainda pode ser desativado
create or replace function public.voz_destino_seguro() returns trigger
language plpgsql security definer set search_path = public as $$
declare m text;
begin
    if tg_table_name = 'voz_troncos' then
        if tg_op = 'INSERT' or new.host is distinct from old.host then
            m := public.voz_host_motivo(new.host);
            if m is not null then
                raise exception 'endereço do tronco recusado: %', m;
            end if;
        end if;
    elsif tg_op = 'INSERT' or new.destino_sip is distinct from old.destino_sip then
        m := public.voz_host_motivo(public.voz_host_transferencia(new.destino_sip));
        if m is not null then
            raise exception 'destino da transferência recusado: %', m;
        end if;
    end if;
    return new;
end $$;
revoke all on function public.voz_destino_seguro() from public, anon, authenticated;
drop trigger if exists voz_destino_seguro on public.voz_troncos;
create trigger voz_destino_seguro before insert or update on public.voz_troncos
    for each row execute function public.voz_destino_seguro();
drop trigger if exists voz_destino_seguro on public.voz_transferencias;
create trigger voz_destino_seguro before insert or update on public.voz_transferencias
    for each row execute function public.voz_destino_seguro();
comment on column public.voz_troncos.host is
    'IPv4 público ou nome DNS. SQL 83: nunca interno, reservado, de loopback ou do MotorCX (gatilho voz_destino_seguro; '
    'a VM confere de novo depois de resolver o nome).';

-- o que já está no banco: só listado (nada é apagado nem desativado; a VM já deixa de fora)
do $b4$
declare n int; ids text;
begin
    select count(*), string_agg(t.id::text, ', ' order by t.id) into n, ids
      from public.voz_troncos t where public.voz_host_motivo(t.host) is not null;
    if n > 0 then
        raise notice 'SQL 83: % tronco(s) com endereço interno, reservado ou do MotorCX (ids: %). Nada foi apagado nem desativado: a VM deixa esses troncos de fora. Corrija o endereço no Console › Telefonia (cadastrar_tronco_voz com o host da operadora) ou desative o tronco.', n, ids;
    else
        raise notice 'SQL 83: nenhum tronco com endereço recusado';
    end if;
    select count(*), string_agg(x.id::text, ', ' order by x.id) into n, ids
      from public.voz_transferencias x where public.voz_host_motivo(public.voz_host_transferencia(x.destino_sip)) is not null;
    if n > 0 then
        raise notice 'SQL 83: % transferência(s) com destino interno, reservado ou do MotorCX (ids: %). Nada foi apagado nem desativado: a VM deixa essas transferências de fora. Corrija o destino no Console › Transferência (salvar_transferencia_voz) ou desative.', n, ids;
    else
        raise notice 'SQL 83: nenhuma transferência com destino recusado';
    end if;
end $b4$;

-- a VM lê as faixas do MotorCX (acesso próprio, SQL 57)
create or replace view voz_vm.enderecos_motorcx with (security_barrier = true) as
    select m.faixa::text as faixa from public.voz_enderecos_motorcx m;
revoke all on voz_vm.enderecos_motorcx from public, anon, authenticated, service_role;
grant select on voz_vm.enderecos_motorcx to motorcx_voz;

-- ================================================================ 2. B6 · aviso de gravação e retenção
-- a. aviso ligado: o padrão muda e, só na primeira vez (o padrão ainda era false), quem estava desligado liga
do $aviso$
declare primeira boolean; n int; ids text;
begin
    select coalesce(column_default, '') = 'false' into primeira from information_schema.columns
     where table_schema = 'public' and table_name = 'voz_config' and column_name = 'aviso_gravacao';
    alter table public.voz_config alter column aviso_gravacao set default true;
    if not primeira then
        raise notice 'SQL 83: aviso de gravação já vinha ligado por padrão (nenhuma empresa mudou agora)';
        return;
    end if;
    select count(*), string_agg(empresa_id::text, ', ' order by empresa_id) into n, ids
      from public.voz_config where not aviso_gravacao;
    if n > 0 then
        update public.voz_config set aviso_gravacao = true, atualizado_em = now() where not aviso_gravacao;
        raise notice 'SQL 83: aviso de gravação ligado em % empresa(s) que estavam no padrão antigo, desligado (empresas: %). O Admin pode desligar em Empresa › Privacidade e gravações.', n, ids;
    else
        raise notice 'SQL 83: nenhuma empresa estava com o aviso de gravação desligado';
    end if;
end $aviso$;
comment on column public.voz_config.aviso_gravacao is
    'A abertura diz "Esta ligação é gravada." (padrão: ligado, SQL 83). "Sou o assistente virtual da {empresa}." vale sempre.';

-- b. retenção: 90 dias (teto); até 5 anos só para gravação com promessa, acordo ou contestação
alter table public.voz_config add column if not exists retencao_prova_dias int not null default 90;
alter table public.voz_config drop constraint if exists voz_config_retencao_prova_dias_check;
alter table public.voz_config add constraint voz_config_retencao_prova_dias_check
    check (retencao_prova_dias between 90 and 1825);
comment on column public.voz_config.retencao_dias is
    'Gravação, transcrição e códigos por cliente: 90 dias (mínimo e teto, SQL 83). A exceção é retencao_prova_dias.';
comment on column public.voz_config.retencao_prova_dias is
    'SQL 83: gravação com promessa/acordo ou contestação (voz_gravacoes.prova): de 90 a 1.825 dias (5 anos), padrão 90. '
    'O prazo acima de 90 depende do jurídico.';
do $ret$
declare n int; ids text;
begin
    alter table public.voz_config drop constraint if exists voz_config_retencao_dias_check;
    select count(*), string_agg(empresa_id::text, ', ' order by empresa_id) into n, ids
      from public.voz_config where retencao_dias <> 90;
    if n > 0 then
        alter table public.voz_config add constraint voz_config_retencao_dias_check check (retencao_dias = 90) not valid;
        raise notice 'SQL 83: % empresa(s) com retenção diferente de 90 dias (empresas: %). Nada foi apagado: as gravações que já existem seguem com o prazo de hoje e as NOVAS já saem com o teto de 90. Correção: o Admin salva 90 em Empresa › Privacidade e gravações (até lá, mudanças na configuração de voz dessas empresas são recusadas) e a equipe roda criar_gcp.sh empresa <id> 90; depois, VERIFICAR_SQL83.', n, ids;
    else
        alter table public.voz_config add constraint voz_config_retencao_dias_check check (retencao_dias = 90);
        raise notice 'SQL 83: todas as empresas já estavam com 90 dias de retenção';
    end if;
end $ret$;

alter table public.voz_gravacoes add column if not exists prova text;
alter table public.voz_gravacoes drop constraint if exists voz_gravacoes_prova_check;
alter table public.voz_gravacoes add constraint voz_gravacoes_prova_check
    check (prova is null or prova in ('promessa', 'acordo', 'contestacao'));
comment on column public.voz_gravacoes.prova is
    'SQL 83: por que a gravação pode passar de 90 dias (até retencao_prova_dias): promessa (acordo proposto na ligação '
    'entra como promessa), acordo ou contestação. Nulo = 90 dias. Calculado pelo banco.';

-- promessa na chamada (IA, operador ou final) ou contestação na análise do Speech Analytics
create or replace function public.prova_gravacao_voz(chamada bigint) returns text
language sql stable security definer set search_path = public as $$
    select case
        when exists (select 1 from public.voz_chamadas c where c.id = chamada
                        and 'promessa' in (c.resultado, c.resultado_ia, c.resultado_operador)) then 'promessa'
        when exists (select 1 from public.voz_analise_chamadas a where a.chamada_id = chamada
                        and a.codigos ->> 'motivo' in ('contestacao', 'nao_reconhece', 'fraude_alegada')) then 'contestacao'
    end
$$;
revoke all on function public.prova_gravacao_voz(bigint) from public, anon, authenticated;

-- dias de retenção de uma gravação: 90 (teto), ou retencao_prova_dias (até 5 anos) se for prova
create or replace function public.dias_retencao_gravacao_voz(empresa bigint, prova text) returns int
language sql stable security definer set search_path = public as $$
    select case when prova is not null
                then least(greatest(coalesce((select c.retencao_prova_dias from public.voz_config c where c.empresa_id = empresa), 90), 90), 1825)
                else least(coalesce((select c.retencao_dias from public.voz_config c where c.empresa_id = empresa), 90), 90) end
$$;
revoke all on function public.dias_retencao_gravacao_voz(bigint, text) from public, anon, authenticated;

-- o gatilho do SQL 56 (mesmo nome) passa a pôr o teto e a prova; na atualização, só quando a prova muda
create or replace function public.validade_gravacao_voz() returns trigger
language plpgsql security definer set search_path = public as $$
declare limite timestamptz;
begin
    if tg_op = 'INSERT' then
        new.prova := coalesce(new.prova, public.prova_gravacao_voz(new.chamada_id));
    elsif new.prova is not distinct from old.prova then
        return new;
    end if;
    limite := new.gravada_em + make_interval(days => public.dias_retencao_gravacao_voz(new.empresa_id, new.prova));
    new.expira_em := case when tg_op = 'INSERT' then least(coalesce(new.expira_em, limite), limite) else limite end;
    return new;
end $$;
revoke all on function public.validade_gravacao_voz() from public, anon, authenticated;
drop trigger if exists validade_gravacao_voz on public.voz_gravacoes;
create trigger validade_gravacao_voz before insert or update on public.voz_gravacoes
    for each row execute function public.validade_gravacao_voz();

-- a chamada vira promessa ou a análise acha contestação: a gravação passa a ser prova (e o prazo acompanha)
create or replace function public.marcar_prova_gravacao_voz() returns trigger
language plpgsql security definer set search_path = public as $$
declare ch bigint;
begin
    if tg_table_name = 'voz_chamadas' then
        ch := new.id;
    else
        ch := new.chamada_id;
    end if;
    update public.voz_gravacoes g set prova = public.prova_gravacao_voz(ch)
     where g.chamada_id = ch and g.prova is distinct from public.prova_gravacao_voz(ch)
       and (g.prova is null or g.prova <> 'acordo');
    return null;
end $$;
revoke all on function public.marcar_prova_gravacao_voz() from public, anon, authenticated;
drop trigger if exists marcar_prova_gravacao_voz on public.voz_chamadas;
create trigger marcar_prova_gravacao_voz after update of resultado, resultado_ia, resultado_operador on public.voz_chamadas
    for each row execute function public.marcar_prova_gravacao_voz();
drop trigger if exists marcar_prova_gravacao_voz on public.voz_analise_chamadas;
create trigger marcar_prova_gravacao_voz after insert or update of codigos on public.voz_analise_chamadas
    for each row execute function public.marcar_prova_gravacao_voz();

-- o que já está no banco: só contado (as gravações que já existem não mudam de prazo aqui)
do $grav$
declare n int; ids text;
begin
    select count(*), string_agg(distinct g.empresa_id::text, ', ') into n, ids from public.voz_gravacoes g
     where not g.guarda and g.prova is null and g.expira_em > g.gravada_em + interval '90 days';
    if n > 0 then
        raise notice 'SQL 83: % gravação(ões) com prazo acima de 90 dias (empresas: %). Não mudam aqui: o prazo novo vale quando o Admin salvar a retenção em Empresa › Privacidade e gravações.', n, ids;
    else
        raise notice 'SQL 83: nenhuma gravação com prazo acima de 90 dias';
    end if;
end $grav$;

-- privacidade (Admin): o mesmo do SQL 56 + retencao_prova_dias; a retenção nova recalcula o prazo de cada gravação
-- com o teto (prova ou não)
create or replace function public.configurar_voz_empresa(empresa bigint, ajustes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
    k text;
    c public.voz_config;
begin
    if public.sou_equipe() or empresa not in (select public.minhas_empresas()) then
        raise exception 'empresa fora do seu acesso';
    end if;
    if jsonb_typeof(ajustes) is distinct from 'object' then
        raise exception 'ajustes inválidos';
    end if;
    for k in select jsonb_object_keys(ajustes) loop
        if k in ('alo_fake', 'alo_fake_max_s', 'alo_fake_audio_ref', 'abandono_max_pct', 'freio_ritmo_pct', 'variaveis') then
            if not public.pode('editar_canais') then
                raise exception 'sem permissão para editar canais';
            end if;
        elsif k in ('gravar', 'aviso_gravacao', 'retencao_dias', 'retencao_prova_dias', 'transcrever',
                    'transcrever_min_segundos') then
            if not public.tem_papel('admin') then
                raise exception 'só o Admin da empresa muda a privacidade das gravações';
            end if;
        else
            raise exception 'ajuste desconhecido ou da equipe MotorCX: %', k;
        end if;
    end loop;
    if ajustes ? 'retencao_dias' and (ajustes ->> 'retencao_dias')::int <> 90 then
        raise exception 'a retenção das gravações é de 90 dias (teto); só promessa, acordo ou contestação guardam por mais';
    end if;
    if ajustes ? 'retencao_prova_dias' and (ajustes ->> 'retencao_prova_dias')::int not between 90 and 1825 then
        raise exception 'a retenção de promessa, acordo ou contestação vai de 90 a 1.825 dias (5 anos)';
    end if;
    insert into public.voz_config (empresa_id) values (empresa) on conflict (empresa_id) do nothing;
    select * into c from public.voz_config where empresa_id = empresa;
    if coalesce((ajustes ->> 'alo_fake')::boolean, false) and not c.alo_fake_liberado then
        raise exception 'o Alô fake ainda não foi liberado pela equipe MotorCX';
    end if;
    update public.voz_config v set
        alo_fake = case when ajustes ? 'alo_fake' then (ajustes ->> 'alo_fake')::boolean else v.alo_fake end,
        alo_fake_max_s = case when ajustes ? 'alo_fake_max_s' then (ajustes ->> 'alo_fake_max_s')::int else v.alo_fake_max_s end,
        alo_fake_audio_ref = case when ajustes ? 'alo_fake_audio_ref' then ajustes ->> 'alo_fake_audio_ref'
                                  else v.alo_fake_audio_ref end,
        abandono_max_pct = case when ajustes ? 'abandono_max_pct' then (ajustes ->> 'abandono_max_pct')::numeric
                                else v.abandono_max_pct end,
        freio_ritmo_pct = case when ajustes ? 'freio_ritmo_pct' then (ajustes ->> 'freio_ritmo_pct')::int else v.freio_ritmo_pct end,
        variaveis = case when ajustes ? 'variaveis' then array(select jsonb_array_elements_text(ajustes -> 'variaveis'))
                         else v.variaveis end,
        gravar = case when ajustes ? 'gravar' then (ajustes ->> 'gravar')::boolean else v.gravar end,
        aviso_gravacao = case when ajustes ? 'aviso_gravacao' then (ajustes ->> 'aviso_gravacao')::boolean else v.aviso_gravacao end,
        retencao_dias = case when ajustes ? 'retencao_dias' then (ajustes ->> 'retencao_dias')::int else v.retencao_dias end,
        retencao_prova_dias = case when ajustes ? 'retencao_prova_dias' then (ajustes ->> 'retencao_prova_dias')::int
                                   else v.retencao_prova_dias end,
        transcrever = case when ajustes ? 'transcrever' then (ajustes ->> 'transcrever')::boolean else v.transcrever end,
        transcrever_min_segundos = case when ajustes ? 'transcrever_min_segundos'
                                        then (ajustes ->> 'transcrever_min_segundos')::int else v.transcrever_min_segundos end,
        atualizado_em = now(), atualizado_por = auth.uid()
     where v.empresa_id = empresa;
    if ajustes ? 'retencao_dias' or ajustes ? 'retencao_prova_dias' then   -- vale para o que já está guardado
        update public.voz_gravacoes g
           set expira_em = g.gravada_em + make_interval(days => public.dias_retencao_gravacao_voz(empresa, g.prova))
         where g.empresa_id = empresa;
    end if;
end $$;
revoke all on function public.configurar_voz_empresa(bigint, jsonb) from public, anon;
grant execute on function public.configurar_voz_empresa(bigint, jsonb) to authenticated;

-- ================================================================ 3. B7 · identidade antes da dívida nos textos
-- Cópia de motor/trava_identidade.py (mesmos padrões; \b do Python = \y aqui). true = o texto sugere dizer credor,
-- dívida, valor ou contrato antes de a pessoa confirmar a identidade.
create or replace function public.texto_revela_antes_identidade(texto text) returns boolean
language plpgsql immutable parallel safe as $$
declare
    sensivel constant text := '\y(credor\w*|divida\w*|debito\w*|contrato\w*|saldo\w*|pendencia\w*|inadimpl\w*|atrasad\w*|em atraso|em aberto|fatura\w*|boleto\w*|cobranca\w*|valor (devido|da divida|do debito|em aberto|da parcela|total))\y|\{\{ *(credor|saldo|dias_atraso|vencimento|valor_minimo|parcelas_max|desconto_max|link_pagamento|oferta\.[a-z_]+) *\}\}';
    abertura constant text := '\y(abr(ir|a|e|indo)( a| o)? (conversa|ligacao|chamada|contato)|abertura|na saudacao|no cumprimento|no inicio|logo de (cara|inicio)|logo no (inicio|comeco)|no comeco|primeira (fala|frase)|comec(ar|e|o|a|ando) (a conversa|a ligacao|a chamada|com|dizendo|falando)|ao atender|assim que (atender|atende)|antes de (confirmar|conferir|validar|checar|verificar|identificar)|antes da (confirmacao|identificacao|validacao|verificacao)|sem (confirmar|conferir|validar|verificar) (a )?identidade)\y';
    depois constant text := '\y(depois|apos|so quando|somente quando)\y[^.]*\y(confirm|identific|valid|verific)';
    nega constant text := '\y(nunca|jamais|evite|evitar|proibido)\y|\y(nao|sem) (\w+ ){0,2}(diga|dizer|fale|falar|mencione|mencionar|cite|citar|revele|revelar|informe|informar|abra|abrir|comece|comecar|use|usar)\y';
    cumprimento constant text := '^(ola|oi|bom dia|boa tarde|boa noite|alo)\y|\y(aqui e|falo com|estou falando com)\y';
    t text;
    fs text[];
    f text;
begin
    t := btrim(regexp_replace(translate(lower(coalesce(texto, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
                              '\s+', ' ', 'g'));
    select coalesce(array_agg(btrim(x) order by n), '{}') into fs
      from regexp_split_to_table(t, '[.!?;\n]+') with ordinality s(x, n) where btrim(x) <> '';
    if cardinality(fs) = 0 then
        return false;
    end if;
    foreach f in array fs loop
        if f ~ sensivel and f ~ abertura and f !~ depois and f !~ nega then
            return true;
        end if;
    end loop;
    if fs[1] ~ cumprimento then
        foreach f in array fs loop
            if f ~ sensivel then
                return true;
            end if;
        end loop;
    end if;
    return false;
end $$;
revoke all on function public.texto_revela_antes_identidade(text) from public, anon;
grant execute on function public.texto_revela_antes_identidade(text) to authenticated, service_role;
comment on function public.texto_revela_antes_identidade(text) is
    'SQL 83 · B7: o texto sugere dizer credor, dívida, valor ou contrato antes de confirmar a identidade (cópia de motor/trava_identidade.py).';

create or replace function public.recomendacao_revela_antes_identidade(titulo text, texto text, proposta jsonb)
returns boolean
language sql immutable parallel safe as $$
    select public.texto_revela_antes_identidade(titulo) or public.texto_revela_antes_identidade(texto)
        or public.texto_revela_antes_identidade(coalesce(proposta ->> 'texto', ''))
$$;
revoke all on function public.recomendacao_revela_antes_identidade(text, text, jsonb) from public, anon;
grant execute on function public.recomendacao_revela_antes_identidade(text, text, jsonb) to authenticated, service_role;

-- recomendação nova ou reescrita (motor) e a que vira rascunho (Aplicar) passam pela trava; dispensar segue livre
create or replace function public.trava_identidade_recomendacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if (tg_op = 'INSERT' or new.titulo is distinct from old.titulo or new.texto is distinct from old.texto
        or new.proposta is distinct from old.proposta
        or (new.situacao in ('rascunho', 'aplicada') and old.situacao = 'nova'))
       and public.recomendacao_revela_antes_identidade(new.titulo, new.texto, new.proposta) then
        raise exception 'recomendação recusada: sugere falar de credor, dívida ou valor antes de confirmar a identidade (a mesma trava do fluxo)';
    end if;
    return new;
end $$;
revoke all on function public.trava_identidade_recomendacao() from public, anon, authenticated;
drop trigger if exists trava_identidade_recomendacao on public.recomendacoes;
create trigger trava_identidade_recomendacao before insert or update on public.recomendacoes
    for each row execute function public.trava_identidade_recomendacao();

do $b7$
declare n int; ids text;
begin
    select count(*), string_agg(r.id::text, ', ' order by r.id) into n, ids from public.recomendacoes r
     where r.situacao in ('nova', 'rascunho') and public.recomendacao_revela_antes_identidade(r.titulo, r.texto, r.proposta);
    if n > 0 then
        raise notice 'SQL 83: % recomendação(ões) do Speech Analytics sugerem falar de credor ou dívida antes da identidade (ids: %). Nada foi apagado: elas não viram mais rascunho (Aplicar recusa). Correção: dispensar na tela Speech Analytics › Recomendações; a próxima rodada do motor reescreve com o texto novo.', n, ids;
    else
        raise notice 'SQL 83: nenhuma recomendação fere a trava de identidade';
    end if;
end $b7$;

-- roteiros salvos com o prompt padrão antigo ("Você é o agente virtual da {{assessoria}}, em nome de {{credor}}…"): o
-- texto é do cliente e NÃO muda aqui. Hoje a VM não usa o roteiro (sem fluxo, a Montagem usa o prompt fixo da VM) e a
-- trava de identidade da Montagem corta o credor antes da confirmação; a tela do roteiro avisa quem abrir.
do $rot$
declare n int; ids text;
begin
    select count(*), string_agg(r.id::text, ', ' order by r.id) into n, ids from public.voz_roteiros r
     where r.prompt ~* 'em nome d[eoa]s? \{\{ *credor *\}\}'
       and not r.prompt ~* '(titular|confirm).*em nome d[eoa]s? \{\{ *credor *\}\}';
    if n > 0 then
        raise notice 'SQL 83: % roteiro(s) com "em nome de {{credor}}" antes de confirmar o titular (ids: %). Nada foi mudado: o texto é do cliente e a VM não usa o roteiro hoje. Correção: editar o roteiro em Agente Voz/CX › Roteiro (a tela avisa) e aprovar a versão nova.', n, ids;
    else
        raise notice 'SQL 83: nenhum roteiro com o credor antes da identidade';
    end if;
end $rot$;

-- checklist padrão: ck_ident pedia "empresa e motivo da ligação" no começo (o motivo é a dívida). Versão nova do
-- padrão com o texto corrigido, vigente a partir de hoje; a antiga continua valendo para as ligações de antes.
do $ck$
declare
    cid bigint;
    v public.checklist_versoes;
    novo jsonb;
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    n int;
    ids text;
begin
    select id into cid from public.checklists_qualidade where empresa_id is null;
    select * into v from public.checklist_versoes where checklist_id = cid and situacao = 'em_uso';
    if v.id is null or not exists (select 1 from jsonb_array_elements(v.itens) i
                                    where i ->> 'id' = 'ck_ident' and i ->> 'texto' ilike '%motivo da liga%') then
        raise notice 'SQL 83: checklist padrão já sem "motivo da ligação" antes da identidade';
    else
        select jsonb_agg(case when x.i ->> 'id' = 'ck_ident'
                              then x.i || jsonb_build_object(
                                  'texto', 'Se identificou pela empresa e só disse o motivo depois de confirmar o titular',
                                  'criterio', 'Diz o nome da empresa (assessoria) e confirma com quem fala. O credor, a dívida e o motivo da ligação só depois de a pessoa confirmar ser o titular (CDC art. 42; LGPD art. 6º, III).')
                              else x.i end order by x.ord)
          into novo from jsonb_array_elements(v.itens) with ordinality x(i, ord);
        update public.checklist_versoes set situacao = 'arquivada', vigente_ate = greatest(hoje - 1, vigente_de)
         where id = v.id;
        insert into public.checklist_versoes (checklist_id, versao, situacao, itens, publicada_em, vigente_de)
        values (cid, v.versao + 1, 'em_uso', novo, now(), greatest(hoje, v.vigente_de + 1));
        raise notice 'SQL 83: checklist padrão v% publicado com o item de identificação corrigido (vale a partir de hoje)', v.versao + 1;
    end if;
    select count(distinct c.empresa_id), string_agg(distinct c.empresa_id::text, ', ') into n, ids
      from public.checklist_versoes x join public.checklists_qualidade c on c.id = x.checklist_id
     where c.empresa_id is not null and x.situacao in ('em_uso', 'rascunho')
       and exists (select 1 from jsonb_array_elements(x.itens) i where i ->> 'texto' ilike '%motivo da liga%');
    if n > 0 then
        raise notice 'SQL 83: % empresa(s) com checklist próprio que ainda pede "motivo da ligação" na identificação (empresas: %). O checklist é delas: a correção é editar o item em Speech Analytics › Checklist.', n, ids;
    end if;
end $ck$;
