-- SQL 87 · Contratação: Agente de voz e Speech Analytics viram módulos com chave na tela (pedido do dono, 08/11/2026:
-- "Agente de voz não está liberado na contratação, assim como o speech").
--
-- 1. empresa_modulos aceita 'speech_analytics' (o 'agente_voz' já valia desde o SQL 56). A Contratação (Console ›
--    Empresas e /empresa/contratacao, permissão editar_contratacao) ganha as duas chaves e grava as duas linhas, como
--    os outros módulos. Nada muda na regra de quem grava empresa_modulos.
-- 2. voz_config.speech_analytics (o que a VM de voz lê, SQL 62) segue o módulo, nos dois sentidos:
--    - módulo ligado/desligado (ou apagado) → voz_config.speech_analytics igual, se a empresa já tem voz_config.
--      Empresa sem voz_config não ganha uma aqui: a linha de voz_config é a configuração do agente (o canal agente_voz
--      e os lotes de voz olham se ela existe) e quem cria é a equipe (configurar_voz_equipe).
--    - voz_config nova (configurar_voz_equipe) → nasce com o valor do módulo, se o módulo já existe;
--    - voz_config.speech_analytics mudado à mão pelo Master (o jeito antigo, infra/asterisk/README.md) → o módulo
--      acompanha. Assim os dois nunca ficam diferentes.
--    Sem laço: cada lado só grava quando o valor do outro é diferente.
-- 3. Empresas que já têm voz_config.speech_analytics = true ganham o módulo speech_analytics ativo (backfill). Quem
--    não tem continua sem a área Speech Analytics; as Gravações seguem com a Cobrança.
-- 4. avisar_admin (SQL 55, "Avisar o Admin" da página "não faz parte do plano") aceita a área speech_analytics.
-- 5. O item da fatura ia_speech_analytics passa a ser do módulo speech_analytics (cobranca_itens.modulo: o módulo que
--    precisa estar ligado para uma mensalidade entrar na fatura). Preço nenhum muda.
-- numeros_areas() não muda: ele só dá números da Cobrança, Mensageria e Jornada (Speech e Agente Voz/CX não têm cartão
-- com número no Início).
-- Depende dos SQL 55, 56 e 62. Pode rodar de novo. O site novo precisa deste SQL para salvar a Contratação (sem ele, o
-- banco recusa a linha speech_analytics e o cartão "Motor e módulos" mostra o erro).

create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare d text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in d) > 0 then          -- já aplicado
        return;
    end if;
    if position(de in d) = 0 then
        raise exception 'trecho não encontrado em %: %', assinatura, de;
    end if;
    execute replace(d, de, para);
end $$;

-- ================================================================ 1. o módulo
alter table public.empresa_modulos drop constraint if exists empresa_modulos_modulo_check;
alter table public.empresa_modulos add constraint empresa_modulos_modulo_check
    check (modulo in ('orquestracao', 'jornada', 'mensageria', 'enriquecimento', 'api', 'agente_voz', 'speech_analytics'));
comment on column public.empresa_modulos.modulo is
    'orquestracao | jornada | mensageria | enriquecimento | api | agente_voz | speech_analytics (SQL 87: liga também voz_config.speech_analytics).';

-- ================================================================ 3. backfill (antes dos gatilhos; rodar de novo não muda nada)
insert into public.empresa_modulos (empresa_id, modulo, ativo, canais)
select c.empresa_id, 'speech_analytics', true, '{}'
  from public.voz_config c
 where c.speech_analytics
on conflict (empresa_id, modulo) do update set ativo = true where not public.empresa_modulos.ativo;

-- ================================================================ 2. voz_config.speech_analytics segue o módulo
create or replace function public.speech_do_modulo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    e bigint;
    v boolean;
begin
    if tg_op = 'DELETE' then
        if old.modulo <> 'speech_analytics' then
            return null;
        end if;
        e := old.empresa_id;
        v := false;
    else
        if new.modulo <> 'speech_analytics' then
            return null;
        end if;
        e := new.empresa_id;
        v := new.ativo;
    end if;
    update public.voz_config c set speech_analytics = v, atualizado_em = now()
     where c.empresa_id = e and c.speech_analytics is distinct from v;
    return null;
end $$;
revoke all on function public.speech_do_modulo() from public, anon, authenticated;
comment on function public.speech_do_modulo() is
    'Gatilho de empresa_modulos (SQL 87): o módulo speech_analytics liga/desliga voz_config.speech_analytics da empresa.';

drop trigger if exists speech_do_modulo on public.empresa_modulos;
create trigger speech_do_modulo after insert or update of ativo or delete on public.empresa_modulos
    for each row execute function public.speech_do_modulo();

create or replace function public.modulo_do_speech() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    m boolean;
begin
    select x.ativo into m from public.empresa_modulos x
     where x.empresa_id = new.empresa_id and x.modulo = 'speech_analytics';
    if tg_op = 'INSERT' and m is not null then
        -- voz_config nova: vale o que a Contratação já disse
        if m is distinct from new.speech_analytics then
            update public.voz_config c set speech_analytics = m where c.empresa_id = new.empresa_id;
        end if;
        return null;
    end if;
    -- mudança à mão em voz_config (ou voz_config nova sem módulo): o módulo acompanha
    if m is distinct from new.speech_analytics and (m is not null or new.speech_analytics) then
        insert into public.empresa_modulos (empresa_id, modulo, ativo, canais)
        values (new.empresa_id, 'speech_analytics', new.speech_analytics, '{}')
        on conflict (empresa_id, modulo) do update set ativo = excluded.ativo
         where public.empresa_modulos.ativo is distinct from excluded.ativo;
    end if;
    return null;
end $$;
revoke all on function public.modulo_do_speech() from public, anon, authenticated;
comment on function public.modulo_do_speech() is
    'Gatilho de voz_config (SQL 87): voz_config.speech_analytics e o módulo speech_analytics nunca ficam diferentes.';

drop trigger if exists modulo_do_speech on public.voz_config;
create trigger modulo_do_speech after insert or update of speech_analytics on public.voz_config
    for each row execute function public.modulo_do_speech();

-- o que ainda estiver diferente (voz_config com o módulo já existente): vale o módulo
update public.voz_config c set speech_analytics = m.ativo, atualizado_em = now()
  from public.empresa_modulos m
 where m.empresa_id = c.empresa_id and m.modulo = 'speech_analytics' and c.speech_analytics is distinct from m.ativo;

comment on column public.voz_config.speech_analytics is
    'Speech Analytics (SQL 62): a VM avalia e extrai códigos das ligações transcritas desta empresa (minuto analisado na fatura). '
    'Segue o módulo speech_analytics da Contratação (SQL 87). Padrão desligado.';

-- ================================================================ 4. "Avisar o Admin" para o Speech Analytics
select pg_temp.trocar('public.avisar_admin(text, text, text, text)',
    $t$if alvo not in ('cobranca', 'jornada', 'mensageria') then$t$,
    $t$if alvo not in ('cobranca', 'jornada', 'mensageria', 'speech_analytics') then$t$);
-- título do aviso: troca só o "case" (o resto do texto pode variar entre bancos); se não achar, segue sem mudar o
-- título (é só o texto do aviso; a área speech_analytics já é aceita pelo passo acima)
do $tit$
declare d text := pg_get_functiondef('public.avisar_admin(text, text, text, text)'::regprocedure);
        novo text;
begin
    if position('speech_analytics'' then' in d) > 0 then
        return;                                  -- já aplicado
    end if;
    novo := regexp_replace(d, $re$else\s+'Mensageria'(\s+end)$re$,
                           $r$when 'speech_analytics' then 'Speech Analytics' else 'Mensageria'\1$r$, 'g');
    if novo = d then
        raise notice 'SQL 87: título do "Avisar o Admin" mantido (formato diferente); o aviso do Speech Analytics sai com o título padrão';
    else
        execute novo;
    end if;
end $tit$;

-- ================================================================ 5. item da fatura do Speech Analytics
update public.cobranca_itens set modulo = 'speech_analytics'
 where codigo = 'ia_speech_analytics' and modulo is distinct from 'speech_analytics';

do $conta$
declare n int; d int;
begin
    select count(*) into n from public.empresa_modulos where modulo = 'speech_analytics' and ativo;
    select count(*) into d from public.voz_config c
     where c.speech_analytics is distinct from coalesce((select m.ativo from public.empresa_modulos m
                                                          where m.empresa_id = c.empresa_id
                                                            and m.modulo = 'speech_analytics'), false);
    raise notice 'SQL 87: % empresa(s) com o Speech Analytics ativo; % voz_config diferente(s) do módulo (esperado 0)', n, d;
end $conta$;
