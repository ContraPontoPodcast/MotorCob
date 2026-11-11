-- SQL 122 · Roleplay: cenário gerado a partir dos padrões das ligações (PR 9 do Roleplay, SPEC §2.2, §5.4 e §7).
-- A Qualidade abre "Novo a partir dos padrões das ligações", escolhe um motivo, uma objeção ou um item do checklist que
-- apareceu nas ligações avaliadas, e a Edge Function `treino` (acao gerar_cenario) pede ao LLM da VM um cliente
-- simulado FICTÍCIO só com códigos e porcentagens (nenhum trecho, transcrição, nome, CPF, telefone ou valor de cliente
-- real). O cenário entra em RASCUNHO, com o selo "Cenário gerado de padrões agregados"; só uma pessoa publica.
--
-- 1. padroes_insights_treino(empresa, dias): os padrões do período (padrão 30 dias; 7 a 90), só de grupos com 30 ou
--    mais ligações: base (ligações analisadas), motivos e objeções (voz_conversao_dia, com a taxa de acordo) e os itens
--    do checklist com menos "sim" (voz_qualidade_dia, 30+ avaliações no item). Quem edita cenários (editar_cenarios_treino)
--    na empresa, com o módulo. Base abaixo de 30: suficiente = false e nada vai para a geração.
-- 2. treino_cenarios_insights (gatilho): cenário de origem 'insights' só nasce em rascunho, com os insights (só códigos e
--    porcentagens, base >= 30: insights_treino_ok do SQL 90), e no máximo 20 por empresa por dia. Publicar continua
--    sendo pelo editor, por uma pessoa (salvar_cenario_treino com o login dela).
-- Só lê voz_conversao_dia e voz_qualidade_dia (nunca grava). Pode rodar de novo (funções recriadas inteiras, gatilho com
-- drop if exists). Depende dos SQL 60, 62, 89 e 90.

-- ================================================================ 1. padrões das ligações (só grupos com 30+)
create or replace function public.padroes_insights_treino(empresa bigint, dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
declare
    d date := public.hoje_treino();
    ini date := public.hoje_treino() - greatest(7, least(coalesce(dias, 30), 90));
    base int;
begin
    perform public.conferir_treino(empresa, 'editar_cenarios_treino');
    select coalesce(sum(c.conversas), 0)::int into base
      from public.voz_conversao_dia c
     where c.empresa_id = empresa and c.dimensao = 'total' and c.data >= ini and c.data < d;
    return jsonb_build_object(
        'de', ini, 'ate', d - 1, 'base', base, 'minimo', 30, 'suficiente', base >= 30,
        'motivos', case when base >= 30 then coalesce((
            select jsonb_agg(jsonb_build_object('codigo', x.valor, 'conversas', x.n, 'pct', round(x.n::numeric / base, 3),
                                                'acordo_pct', round(x.a::numeric / x.n, 3)) order by x.n desc, x.valor)
              from (select c.valor, sum(c.conversas)::int n, sum(c.com_acordo)::int a from public.voz_conversao_dia c
                     where c.empresa_id = empresa and c.dimensao = 'motivo' and c.data >= ini and c.data < d
                     group by c.valor having sum(c.conversas) >= 30) x), '[]'::jsonb) else '[]'::jsonb end,
        'objecoes', case when base >= 30 then coalesce((
            select jsonb_agg(jsonb_build_object('codigo', x.valor, 'conversas', x.n, 'pct', round(x.n::numeric / base, 3),
                                                'acordo_pct', round(x.a::numeric / x.n, 3)) order by x.n desc, x.valor)
              from (select c.valor, sum(c.conversas)::int n, sum(c.com_acordo)::int a from public.voz_conversao_dia c
                     where c.empresa_id = empresa and c.dimensao = 'objecao' and c.data >= ini and c.data < d
                     group by c.valor having sum(c.conversas) >= 30) x), '[]'::jsonb) else '[]'::jsonb end,
        'itens', coalesce((
            select jsonb_agg(jsonb_build_object('item', x.item, 'avaliadas', x.n, 'sim_pct', round(x.s::numeric / x.n, 3))
                             order by x.s::numeric / x.n, x.item)
              from (select q.item, sum(q.avaliadas - q.na)::int n, sum(q.aprovadas)::int s from public.voz_qualidade_dia q
                     where q.empresa_id = empresa and q.item <> '_ligacao' and q.data >= ini and q.data < d
                     group by q.item having sum(q.avaliadas - q.na) >= 30
                     order by sum(q.aprovadas)::numeric / sum(q.avaliadas - q.na), q.item limit 8) x), '[]'::jsonb));
end $$;
comment on function public.padroes_insights_treino(bigint, int) is
    'Padrões das ligações para gerar cenário de treino: base, motivos, objeções e itens com menos "sim", só grupos com 30+ '
    'ligações (códigos e porcentagens; nada de cliente). Quem edita cenários. SQL 122.';
revoke all on function public.padroes_insights_treino(bigint, int) from public, anon;
grant execute on function public.padroes_insights_treino(bigint, int) to authenticated;

-- ================================================================ 2. guarda do cenário gerado
create or replace function public.treino_cenarios_insights() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.origem <> 'insights' then
        return new;
    end if;
    if tg_op = 'INSERT' then
        if new.situacao <> 'rascunho' then
            raise exception 'cenário gerado de padrões agregados começa em rascunho: revise e publique pelo editor';
        end if;
        if new.insights is null then
            raise exception 'cenário gerado de padrões agregados precisa dos padrões (só códigos e porcentagens)';
        end if;
        if (select count(*) from public.treino_cenarios c where c.empresa_id = new.empresa_id and c.origem = 'insights'
               and c.criado_em >= (public.hoje_treino()::timestamp at time zone 'America/Sao_Paulo')) >= 20 then
            raise exception 'limite de 20 cenários gerados por dia nesta empresa: tente amanhã ou crie do zero';
        end if;
    elsif new.situacao = 'publicado' and old.situacao <> 'publicado' and auth.uid() is null then
        raise exception 'cenário gerado de padrões agregados só é publicado por uma pessoa, depois de revisar';
    end if;
    return new;
end $$;
revoke all on function public.treino_cenarios_insights() from public, anon, authenticated;
drop trigger if exists a_insights on public.treino_cenarios;
create trigger a_insights before insert or update on public.treino_cenarios
    for each row execute function public.treino_cenarios_insights();
