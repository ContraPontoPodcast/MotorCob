-- SQL 52 · Formulário "Fale com a gente" do site estático (Netlify) grava direto no Supabase
-- O site saiu do Horizons: o formulário da home gravava na coleção contatos_site do PocketBase (backend do
-- Horizons) e o Console lia de lá pelo servidor. Agora o navegador grava em public.contatos_site com a chave
-- anon e o Console lê com a sessão de quem está logado. A tabela já existe desde o SQL 29
-- (20261029000001_site_comercial.sql); este arquivo só a deixa como o site precisa:
-- 1. Os limites de tamanho passam a ser os da coleção do PocketBase (nome 200, empresa 200, e-mail 320,
--    telefone 40, mensagem 5000), para nenhum envio que o site aceitava antes ser recusado agora. O telefone
--    é texto livre como era no formulário (só o tamanho). Origem continua com 60 e o e-mail com o formato.
-- 2. Acesso (o mesmo do SQL 29, repetido aqui para ficar num lugar só): RLS ligada; anon e authenticated só
--    INSEREM as colunas do formulário (com consentimento); id e criado_em são do banco (o gatilho
--    limitar_contatos_site ignora o que vier e limita 3 por e-mail e 200 por hora). Ninguém do site altera
--    nem apaga. Só o Master da equipe MotorCob lê (admin_equipe(), como no SQL 29): visitante, usuário de empresa
--    e as outras funções da equipe não leem.
-- Nenhum dado pessoal é gravado por este arquivo. Pode rodar de novo sem erro.

do $$
begin
    if to_regclass('public.contatos_site') is null then
        raise exception 'public.contatos_site não existe: rode antes o SQL 29 (20261029000001_site_comercial.sql)';
    end if;
end $$;

-- ================================================================ 1. tamanhos (iguais ao PocketBase)
alter table public.contatos_site drop constraint if exists contatos_site_nome_check;
alter table public.contatos_site drop constraint if exists contatos_site_empresa_check;
alter table public.contatos_site drop constraint if exists contatos_site_email_check;
alter table public.contatos_site drop constraint if exists contatos_site_telefone_check;
alter table public.contatos_site drop constraint if exists contatos_site_mensagem_check;
alter table public.contatos_site drop constraint if exists contatos_site_origem_check;

alter table public.contatos_site drop constraint if exists contatos_site_nome_tamanho;
alter table public.contatos_site add constraint contatos_site_nome_tamanho
    check (char_length(trim(nome)) between 1 and 200);
alter table public.contatos_site drop constraint if exists contatos_site_empresa_tamanho;
alter table public.contatos_site add constraint contatos_site_empresa_tamanho
    check (empresa is null or char_length(empresa) <= 200);
alter table public.contatos_site drop constraint if exists contatos_site_email_formato;
alter table public.contatos_site add constraint contatos_site_email_formato
    check (char_length(email) <= 320 and email ~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$');
alter table public.contatos_site drop constraint if exists contatos_site_telefone_tamanho;
alter table public.contatos_site add constraint contatos_site_telefone_tamanho
    check (telefone is null or char_length(telefone) <= 40);
alter table public.contatos_site drop constraint if exists contatos_site_mensagem_tamanho;
alter table public.contatos_site add constraint contatos_site_mensagem_tamanho
    check (mensagem is null or char_length(mensagem) <= 5000);
alter table public.contatos_site drop constraint if exists contatos_site_origem_tamanho;
alter table public.contatos_site add constraint contatos_site_origem_tamanho
    check (origem is null or char_length(origem) <= 60);

comment on table public.contatos_site is
    'Formulário "Fale com a gente" do site (motorcob.online). O visitante só insere; só o Master da equipe MotorCob lê.';

-- ================================================================ 2. acesso
alter table public.contatos_site enable row level security;
revoke all on public.contatos_site from public, anon, authenticated;
grant insert (nome, empresa, email, telefone, mensagem, consentimento, origem) on public.contatos_site to anon, authenticated;
grant select on public.contatos_site to authenticated;
grant all on public.contatos_site to service_role;

drop policy if exists contatos_site_enviar on public.contatos_site;
create policy contatos_site_enviar on public.contatos_site for insert to anon, authenticated
    with check (
        consentimento
        and char_length(trim(nome)) between 1 and 200
        and (empresa is null or char_length(empresa) <= 200)
        and char_length(email) <= 320
        and (telefone is null or char_length(telefone) <= 40)
        and (mensagem is null or char_length(mensagem) <= 5000)
        and (origem is null or char_length(origem) <= 60)
    );
drop policy if exists contatos_site_ler on public.contatos_site;
create policy contatos_site_ler on public.contatos_site for select to authenticated
    using (public.admin_equipe());
