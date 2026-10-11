-- WhatsApp e RCS passam a usar template (o nome do template aprovado no provedor); SMS e agente
-- virtual continuam com frase; discador e e-mail não levam mensagem (o motor ignora frase nesses canais).
-- O texto continua obrigatório: no template ele é a prévia do que o cliente recebe.
-- Sem regra rígida no banco para não quebrar o site enquanto ele não é atualizado. Pode rodar de novo.

alter table public.frases add column if not exists codigo_template text;

do $$ begin
    alter table public.frases add constraint frases_codigo_template_chk
        check (codigo_template is null or length(trim(codigo_template)) between 1 and 200);
exception when duplicate_object then null; end $$;

create index if not exists frases_templates on public.frases (empresa_id, canal, codigo_template)
    where ativo and codigo_template is not null;

comment on column public.frases.codigo_template is
    'WhatsApp/RCS: nome do template aprovado no provedor (vai no arquivo do canal). Vazio nos demais canais.';
