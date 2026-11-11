-- SQL 99 · Roleplay: editor de cenário, "Atribuir treino", "Treinos atribuídos" e a página do operador pelo link (PR 4
-- do Roleplay, SPEC §2, §3.2 e §10). As telas usam as RPCs do SQL 90; aqui só o que faltava no banco:
--
-- 1. voz_operadores_ver (policy de leitura de voz_operadores, SQL 60) passa a aceitar também quem treina operadores
--    (cliente_pode(empresa_id, 'treinar_operadores')): o Cadastro para treino, o "Atribuir treino" e "Treinos
--    atribuídos" leem o apelido e a equipe de cada pessoa. Antes, a Qualidade sem "Ver operadores" (o Admin pode
--    tirar) via o treino sem os nomes. Continua: ver_operadores ou o próprio operador com login (usuario_id).
--    treinar_operadores está em permissoes_speech() (SQL 90), então vale na empresa do Speech para a Qualidade (SQL 89).
--    Só leitura: a escrita continua só por salvar_operador_voz / salvar_operador_treino.
-- 2. treino_estado_link(token): o que a página /treino/:token mostra quando o link não abre ("venceu em 14/11",
--    "foi trocado por um link novo", "treinos indisponíveis"). anon chama; recebe o token (64 hex), confere só o
--    sha-256 e devolve o estado e a data, nunca o operador, a empresa, o apelido ou outro treino. Não registra acesso
--    (o acesso de verdade continua em treino_meus). Token fora do formato ou desconhecido = "invalido".
-- Pode rodar de novo (policy com drop if exists, função recriada inteira). Depende dos SQL 60, 89 e 90.

-- ================================================================ 1. quem treina lê o cadastro (voz_operadores)
drop policy if exists voz_operadores_ver on public.voz_operadores;
create policy voz_operadores_ver on public.voz_operadores for select to authenticated
    using (public.cliente_pode(empresa_id, 'ver_operadores') or public.cliente_pode(empresa_id, 'treinar_operadores')
           or usuario_id = auth.uid());

-- ================================================================ 2. estado do link de treino (página do operador)
create or replace function public.treino_estado_link(token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    l public.treino_links;
    ativo_op boolean;
begin
    if token is null or token !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('estado', 'invalido');
    end if;
    select x.* into l from public.treino_links x where x.token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex');
    if l.id is null then
        return jsonb_build_object('estado', 'invalido');
    end if;
    select o.ativo into ativo_op from public.voz_operadores o where o.id = l.operador_id;
    if l.revogado_em is not null or not coalesce(ativo_op, false) then
        return jsonb_build_object('estado', 'revogado');
    end if;
    if l.valido_ate <= now() then
        return jsonb_build_object('estado', 'expirado', 'ate', l.valido_ate);
    end if;
    if not public.treino_liberado(l.empresa_id) then
        return jsonb_build_object('estado', 'indisponivel');
    end if;
    return jsonb_build_object('estado', 'ativo', 'ate', l.valido_ate);
end $$;
comment on function public.treino_estado_link(text) is
    'Estado do link de treino para a página do operador (ativo, expirado, revogado, indisponivel, invalido). Só o '
    'estado e a validade: nunca operador, empresa ou treino. Não registra acesso. SQL 99.';
revoke all on function public.treino_estado_link(text) from public;
grant execute on function public.treino_estado_link(text) to anon, authenticated;
