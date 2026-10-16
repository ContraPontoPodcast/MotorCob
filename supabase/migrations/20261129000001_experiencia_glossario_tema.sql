-- SQL 32 · Bloco 5 da homologação (aprovado em 14/10/2026, inclusive a paleta): repaginada da experiência.
--
-- 1. Ajuda pelo tempo de casa de cada pessoa (perfis.criado_em): até 15 dias = explicações abertas
--    ("Primeiros dias"); de 16 a 30 dias = (i) discreto; depois de 30 dias = desligada. A pessoa escolhe outro
--    modo em Minha conta (perfis.ajuda) e o tema claro/escuro (perfis.tema). minha_ajuda() diz o modo de hoje.
-- 2. Glossário "O que significa" (tabela glossario): os 40 termos aprovados, cada um com endereço próprio
--    (slug) para o (i) levar direto ao termo; "antes" guarda os nomes antigos (a busca acha por eles).
--    Só a equipe MotorCob (Master) edita.
-- 3. Tema em variáveis (tabela tema_tokens): base Apple igual em todas as áreas + uma cor de destaque por área
--    (Cobrança dourado/ocre, Jornada do Cliente verde musgo, Mensageria vinho/bordô) e as cores fixas de estado.
--    Trocar uma cor depois é mudar uma linha. Lida também sem login (tela de login usa o halo da área).
-- Senha (12+ caracteres, letra e número) e arquivos aceitos (CSV, TXT e XLSX) ficam nas telas e no Supabase
-- Auth: a senha não passa por este banco, e o motor já lê os três formatos.
-- Pode ser rodado de novo sem erro.

-- ================================================================ 1. ajuda e tema por pessoa
alter table public.perfis add column if not exists ajuda text not null default 'automatica';
alter table public.perfis drop constraint if exists perfis_ajuda_check;
alter table public.perfis add constraint perfis_ajuda_check
    check (ajuda in ('automatica', 'aberta', 'discreta', 'desligada'));
alter table public.perfis add column if not exists tema text not null default 'claro';
alter table public.perfis drop constraint if exists perfis_tema_check;
alter table public.perfis add constraint perfis_tema_check check (tema in ('claro', 'escuro', 'sistema'));
comment on column public.perfis.ajuda is
    'automatica = pelo tempo de casa (até 15 dias aberta, 16 a 30 discreta, depois desligada); ou a escolha da pessoa.';
comment on column public.perfis.tema is 'Tema da pessoa: claro (padrão), escuro ou o do sistema.';

-- modo da ajuda num dia: o 1º dia de casa conta como dia 1
create or replace function public.modo_ajuda(entrou date, preferencia text, hoje date default current_date)
returns text language sql immutable set search_path = public as $$
    select case when coalesce(preferencia, 'automatica') <> 'automatica' then preferencia
                when entrou is null or hoje - entrou + 1 <= 15 then 'aberta'
                when hoje - entrou + 1 <= 30 then 'discreta'
                else 'desligada' end
$$;

create or replace function public.minha_ajuda()
returns table (modo text, dias_de_casa int, preferencia text, tema text)
language sql stable security definer set search_path = public as $$
    select public.modo_ajuda(p.criado_em::date, p.ajuda), (current_date - p.criado_em::date + 1)::int, p.ajuda, p.tema
    from public.perfis p where p.id = auth.uid() and p.ativo
$$;
revoke all on function public.minha_ajuda() from public, anon;
grant execute on function public.minha_ajuda() to authenticated;

create or replace function public.salvar_preferencias(p_ajuda text default null, p_tema text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
    if auth.uid() is null then
        raise exception 'sem sessão';
    end if;
    if p_ajuda is not null and p_ajuda not in ('automatica', 'aberta', 'discreta', 'desligada') then
        raise exception 'ajuda: use automatica, aberta, discreta ou desligada';
    end if;
    if p_tema is not null and p_tema not in ('claro', 'escuro', 'sistema') then
        raise exception 'tema: use claro, escuro ou sistema';
    end if;
    update public.perfis set ajuda = coalesce(p_ajuda, ajuda), tema = coalesce(p_tema, tema)
     where id = auth.uid() and ativo;
end $$;
revoke all on function public.salvar_preferencias(text, text) from public, anon;
grant execute on function public.salvar_preferencias(text, text) to authenticated;

-- ================================================================ 2. glossário "O que significa"
create table if not exists public.glossario (
    slug        text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*\Z'),
    grupo       text not null,
    termo       text not null unique check (length(trim(termo)) between 1 and 80),
    definicao   text not null check (length(trim(definicao)) between 1 and 600),
    exemplo     text not null default '',
    antes       text not null default '',
    ordem       int not null default 100,
    atualizado_em timestamptz not null default now()
);
comment on table public.glossario is
    'Glossário "O que significa": um nome por conceito. slug = endereço do termo (o (i) leva a /ajuda/o-que-significa#slug).';

insert into public.glossario (slug, grupo, termo, definicao, exemplo, antes, ordem) values
    ('cliente-novo', 'Fases da cobrança', 'Cliente novo', 'Chegou na carga e ainda não falamos com ele. A régua usa um telefone de cada vez até alguém atender.', 'Exemplo: 3º dia = terceiro dia desde que o cliente entrou.', 'Localização, LOC, L0–L8, Novo, Não localizado', 10),
    ('cpc', 'Fases da cobrança', 'CPC', 'Contato com a Pessoa Certa: falamos com o próprio cliente, não com terceiro nem caixa postal.', 'Uma resposta do cliente no WhatsApp conta como CPC.', '', 20),
    ('cpc-em-negociacao', 'Fases da cobrança', 'CPC · em negociação', 'O cliente acabou de dar CPC. O próximo contato é a proposta, no mesmo canal e no contato principal.', '', 'CPC A, CPA, Negociação', 30),
    ('cpc-sem-resposta', 'Fases da cobrança', 'CPC · sem resposta', 'Já deu CPC, mas não respondeu à proposta. O MotorCob tenta algumas vezes e depois troca de canal.', '1ª tentativa, 2ª tentativa… no mesmo canal.', 'CPC B, CPB, Tentativas, T1–T3', 40),
    ('nao-cpc', 'Fases da cobrança', 'Não CPC', 'Quem não foi localizado no prazo. Entra numa régua que se repete em ciclos.', 'Ciclo de 8 dias, repetido 3 vezes.', 'Giro, NCP, Não localizado', 50),
    ('ciclo', 'Fases da cobrança', 'Ciclo', 'Uma volta completa da régua do Não CPC. Depois do último ciclo o cliente para e espera um novo enriquecimento.', '2º ciclo = segunda volta.', 'G1, G2, G3', 60),
    ('parado-aguarda-enriquecimento', 'Fases da cobrança', 'Parado · aguarda enriquecimento', 'Terminou os ciclos sem contato. Volta quando o bureau devolver telefones ou e-mails novos.', '', 'RE', 70),
    ('acordo-antes-do-vencimento', 'Fases da cobrança', 'Acordo · antes do vencimento', 'Lembretes nos dias que antecedem a parcela do acordo.', 'D-3 = três dias antes do vencimento.', 'Preventivo, PRE', 80),
    ('acordo-em-dia', 'Fases da cobrança', 'Acordo em dia', 'Acordo ativo, sem parcela vencida. Não recebe cobrança.', '', 'Colchão, COL', 90),
    ('acordo-parcela-vencida', 'Fases da cobrança', 'Acordo · parcela vencida', 'A parcela venceu e não foi paga depois da carência. Se passar do prazo, o acordo é desfeito.', '', 'Quebra, QBR', 100),
    ('quitado', 'Fases da cobrança', 'Quitado', 'Pagou a dívida. Sai de todas as ações.', '', 'Liquidado, LIQ', 110),
    ('bloqueado', 'Fases da cobrança', 'Bloqueado', 'Nunca recebe ação: óbito, processo judicial, reclamação ou pedido para não ser contatado.', '', 'BLQ, Opt-out/óbito', 120),
    ('regua', 'Régua e estratégia', 'Régua', 'A sequência de dias e canais de uma fase: o que sai em cada dia.', '1º dia WhatsApp; 3º dia RCS, senão SMS.', '', 130),
    ('segmento', 'Régua e estratégia', 'Segmento', 'Grupo de clientes definido por regras (saldo, atraso, colunas da carga). Cada segmento tem a sua estratégia.', '', 'Cluster', 140),
    ('segmento-padrao', 'Régua e estratégia', 'Segmento padrão', 'Quando não há segmento seu, o MotorCob agrupa por faixa de valor (alto, médio, baixo) e de atraso (1, 2, 3).', 'A1 = valor alto, pouco atraso.', 'A1…B3', 150),
    ('estrategia', 'Régua e estratégia', 'Estratégia', 'O conjunto de régua, etapas, orçamento e travas usado por um segmento numa carteira.', '', '', 160),
    ('junto-senao-e-reserva', 'Régua e estratégia', 'Junto, senão e reserva', 'Junto: vai junto com o canal de cima. Senão: só se o de cima não puder ser usado. Reserva: só se o de cima não conseguir contato no dia.', '', '+ junto, → senão, / reserva', 170),
    ('persona-e-raia', 'Régua e estratégia', 'Persona e raia', 'Persona: grupo que responde melhor aos mesmos canais. Raia: régua própria de uma persona em certos dias.', '', '', 180),
    ('travas', 'Régua e estratégia', 'Travas', 'Limites que protegem o cliente: horário, intervalo entre ações, máximo por dia e Não Perturbe.', '', '', 190),
    ('orcamento-do-canal', 'Régua e estratégia', 'Orçamento do canal', 'Máximo de clientes ou telefones por dia num canal. Quem passa do limite recebe o canal de baixo ou concorre amanhã.', '', 'Fora do orçamento', 200),
    ('reenquadrar', 'Régua e estratégia', 'Reenquadrar', 'Recalcula agora segmento, persona e fase de cada cliente e refaz a Lista do dia, sem esperar a rotina.', '', '', 210),
    ('carteira', 'Operação', 'Carteira', 'O conjunto de dívidas de um credor. Cada carteira tem sua carga, estratégia e Lista do dia.', '', 'Credor', 220),
    ('carga', 'Operação', 'Carga', 'Arquivo (ou envio por API) com a carteira. A geral substitui a anterior; a incremental soma.', '', 'Base, base bruta', 230),
    ('rotina', 'Operação', 'Rotina', 'Processamento automático diário que lê as cargas e gera a Lista do dia.', 'Roda às 06:00.', '', 240),
    ('lista-do-dia', 'Operação', 'Lista do dia', 'Quem será acionado hoje, por canal, e por que quem ficou de fora ficou de fora.', '', 'Fila, Ações de hoje', 250),
    ('contato-principal', 'Operação', 'Contato principal', 'O telefone ou e-mail em que o cliente já atendeu ou que o credor indicou como preferido. Vai sempre primeiro.', '', 'Hot, HOT, telefone Hot', 260),
    ('enriquecimento', 'Operação', 'Enriquecimento', 'Busca de telefones e e-mails novos num bureau de dados.', '', 'Oxigenado, bureau', 270),
    ('safra', 'Operação', 'Safra', 'Mês em que o cliente entrou na carteira.', 'set/26', '', 280),
    ('lote', 'Mensageria', 'Lote', 'Mensagens de um canal disparadas num dia, pela Lista do dia ou por campanha.', '', 'Lotes de hoje', 290),
    ('disparado-enviado-e-entregue', 'Mensageria', 'Disparado, enviado e entregue', 'Disparado: saiu do MotorCob. Enviado: o fornecedor aceitou. Entregue: chegou ao destino — no SMS e no RCS, pela DLR; no WhatsApp, pelo status de entrega; no e-mail, quando o provedor aceita (se não chegar, volta como bounce).', '', '', 300),
    ('dlr-delivery-report', 'Mensageria', 'DLR (Delivery Report)', 'Relatório de entrega que a operadora devolve para cada SMS ou RCS: entregue, não entregue, expirado. Só existe em SMS e RCS; WhatsApp tem status de entrega e leitura, e e-mail tem bounce.', 'Ex.: DLR "não entregue" = número inexistente ou aparelho desligado por muito tempo.', '', 310),
    ('bounce', 'Mensageria', 'Bounce', 'Aviso de que o e-mail não chegou. Permanente: o endereço não existe (não tentamos de novo). Temporário: caixa cheia ou servidor fora (tentamos depois).', '', '', 320),
    ('fallback', 'Mensageria', 'Fallback', 'Canal alternativo usado quando o principal não entrega.', 'Ex.: SMS se o RCS não chegar.', '', 330),
    ('modelo-de-mensagem', 'Mensageria', 'Modelo de mensagem', 'Texto-padrão aprovado, com campos que o MotorCob preenche (ex.: {{nome}}).', '', 'Template, frase', 340),
    ('simulacao-e-envio-real', 'Mensageria', 'Simulação e envio real', 'Simulação não envia nem cobra; serve para testar. Envio real sai de verdade e entra na fatura.', '', '', 350),
    ('produto', 'Mensageria', 'Produto', 'O tipo de mensagem que você contrata e paga (ex.: SMS OTP, WhatsApp Utilidade). Cada produto tem a sua rota.', '', '', 360),
    ('ciclo-de-faturamento', 'Financeiro', 'Ciclo de faturamento', 'Período em que o uso é somado para virar uma fatura.', 'Mensal, fechando todo dia 1.', 'Ciclo de uso, competência', 370),
    ('pre-pago-e-recarga', 'Financeiro', 'Pré-pago e recarga', 'No pré-pago a empresa compra saldo (recarga) e cada envio desconta dele.', '', '', 380),
    ('mc-e-mc-margem-de-contribuicao', 'Financeiro', 'MC e %MC · margem de contribuição', 'Receita menos impostos e custo dos fornecedores. %MC é essa sobra em % da receita.', '%MC = (receita − impostos − custo) ÷ receita', '', 390),
    ('auditoria', 'Operação', 'Auditoria', 'Registro de quem mudou o quê e quando: preços, estratégias, usuários, faturas.', '', '', 400)
on conflict (slug) do update set grupo = excluded.grupo, termo = excluded.termo, definicao = excluded.definicao,
    exemplo = excluded.exemplo, antes = excluded.antes, ordem = excluded.ordem, atualizado_em = now();

alter table public.glossario enable row level security;
drop policy if exists glossario_ver on public.glossario;
create policy glossario_ver on public.glossario for select to authenticated using (true);
drop policy if exists glossario_editar on public.glossario;
create policy glossario_editar on public.glossario for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.glossario from anon;
grant select on public.glossario to authenticated;
grant insert, update, delete on public.glossario to authenticated;

-- busca: pelo termo, pela definição ou por um nome antigo (sem diferença de acento e maiúscula)
create or replace function public.buscar_glossario(texto text)
returns setof public.glossario language sql stable security invoker set search_path = public as $$
    select g.* from public.glossario g
    where coalesce(trim(texto), '') = ''
       or translate(lower(g.termo || ' ' || g.definicao || ' ' || g.antes || ' ' || g.exemplo),
                    'áàâãéêíóôõúüç', 'aaaaeeiooouuc')
          like '%' || translate(lower(trim(texto)), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') || '%'
    order by g.ordem
$$;
grant execute on function public.buscar_glossario(text) to authenticated;

-- ================================================================ 3. tema (cores em variáveis)
create table if not exists public.tema_tokens (
    chave       text primary key check (chave ~ '^[a-z0-9]+([._-][a-z0-9]+)*\Z'),
    claro       text not null check (claro ~ '^#[0-9A-Fa-f]{6}\Z'),
    escuro      text not null check (escuro ~ '^#[0-9A-Fa-f]{6}\Z'),
    uso         text not null default '',
    atualizado_em timestamptz not null default now()
);
comment on table public.tema_tokens is
    'Cores do MotorCX (claro e escuro). A cor da área só aparece no botão principal, item ativo do menu, etiqueta da área e filete do título.';

insert into public.tema_tokens (chave, claro, escuro, uso) values
    ('base.menu',              '#EEEFF1', '#1C1C1E', 'fundo do menu lateral'),
    ('base.menu_borda',        '#E3E4E8', '#38383A', 'borda do menu lateral'),
    ('base.menu_texto',        '#3A3A3C', '#D1D1D6', 'texto do menu'),
    ('base.conteudo',          '#F8F8F9', '#000000', 'fundo da área de trabalho (liso)'),
    ('base.cartao',            '#FFFFFF', '#1C1C1E', 'cartões e tabelas'),
    ('base.borda',             '#E3E4E8', '#38383A', 'bordas'),
    ('base.texto',             '#1D1D1F', '#F5F5F7', 'texto principal'),
    ('base.texto_2',           '#6E6E73', '#A1A1A6', 'texto secundário'),
    ('base.info',              '#8E8E93', '#8E8E93', 'ícone (i) discreto'),
    ('base.pilula',            '#F2F2F7', '#2C2C2E', 'etiquetas neutras'),
    ('estado.pronto',          '#1E7A36', '#30D158', 'verde = pronto'),
    ('estado.pronto_fundo',    '#E6F4EA', '#0F2E18', 'fundo do verde'),
    ('estado.atencao',         '#8A5A00', '#FFD60A', 'âmbar = atenção'),
    ('estado.atencao_fundo',   '#FFF4D6', '#332A00', 'fundo do âmbar'),
    ('estado.erro',            '#B3261E', '#FF6961', 'vermelho = erro'),
    ('estado.erro_fundo',      '#FDECEA', '#3A1210', 'fundo do vermelho'),
    ('area.cobranca',          '#8A6A2E', '#C9A35E', 'Cobrança: dourado/ocre'),
    ('area.cobranca.forte',    '#7A5C24', '#D8B574', 'Cobrança: botão pressionado'),
    ('area.cobranca.ativo',    '#F3ECDD', '#3A2F1A', 'Cobrança: fundo do item ativo do menu'),
    ('area.cobranca.ativo_texto', '#6B4F1C', '#E6CC97', 'Cobrança: texto do item ativo'),
    ('area.jornada',           '#4F6B3A', '#8FB06F', 'Jornada do Cliente: verde musgo'),
    ('area.jornada.forte',     '#445C32', '#A3C283', 'Jornada: botão pressionado'),
    ('area.jornada.ativo',     '#EAEFE3', '#26301D', 'Jornada: fundo do item ativo do menu'),
    ('area.jornada.ativo_texto', '#3D5330', '#BFD6A8', 'Jornada: texto do item ativo'),
    ('area.mensageria',        '#7A2E3B', '#D07A8A', 'Mensageria: vinho/bordô'),
    ('area.mensageria.forte',  '#6B2633', '#DD94A2', 'Mensageria: botão pressionado'),
    ('area.mensageria.ativo',  '#F5E6E8', '#3A1A20', 'Mensageria: fundo do item ativo do menu'),
    ('area.mensageria.ativo_texto', '#63222E', '#EDB8C2', 'Mensageria: texto do item ativo')
on conflict (chave) do nothing;      -- rodar de novo não desfaz uma cor trocada depois

alter table public.tema_tokens enable row level security;
drop policy if exists tema_ver on public.tema_tokens;
create policy tema_ver on public.tema_tokens for select to anon, authenticated using (true);
drop policy if exists tema_editar on public.tema_tokens;
create policy tema_editar on public.tema_tokens for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
grant select on public.tema_tokens to anon, authenticated;
grant insert, update, delete on public.tema_tokens to authenticated;

-- auditoria: quem mudou glossário e cores
do $$
declare t text;
begin
    foreach t in array array['glossario', 'tema_tokens'] loop
        execute format('drop trigger if exists auditar on public.%I', t);
        execute format('create trigger auditar after insert or update or delete on public.%I
                        for each row execute function public.auditar()', t);
    end loop;
end $$;
