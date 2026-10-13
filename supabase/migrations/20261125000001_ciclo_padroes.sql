-- SQL 28 · Correção: salvar o ciclo na Contratação dava
-- "null value in column ao_zerar of relation ciclo_empresa violates not-null constraint".
-- A tela manda vazio (null) nos campos que não valem para a empresa (ex.: "ao zerar o saldo" no pós-pago).
-- Correção: campo obrigatório que chega vazio mantém o valor já gravado (ao editar) ou recebe o padrão
-- (ao criar), em vez de recusar o salvamento.
-- Nada muda para quem já manda o valor. Pode rodar mais de uma vez.

create or replace function public.ciclo_empresa_padroes() returns trigger
language plpgsql set search_path = public as $$
begin
    if tg_op = 'UPDATE' then
        new.dia_corte := coalesce(new.dia_corte, old.dia_corte);
        new.vencimento_dia := coalesce(new.vencimento_dia, old.vencimento_dia);
        new.periodicidade := coalesce(new.periodicidade, old.periodicidade);
        new.modelo_pagamento := coalesce(new.modelo_pagamento, old.modelo_pagamento);
        new.formas := coalesce(new.formas, old.formas);
        new.ao_zerar := coalesce(new.ao_zerar, old.ao_zerar);
        new.recarga_automatica := coalesce(new.recarga_automatica, old.recarga_automatica);
        new.emissao := coalesce(new.emissao, old.emissao);
    end if;
    new.dia_corte := coalesce(new.dia_corte, 1);
    new.vencimento_dia := coalesce(new.vencimento_dia, 10);
    new.periodicidade := coalesce(new.periodicidade, 'mensal');
    new.modelo_pagamento := coalesce(new.modelo_pagamento, 'pos');
    new.formas := coalesce(new.formas, array['boleto', 'pix']);
    new.ao_zerar := coalesce(new.ao_zerar, 'pausar');
    new.recarga_automatica := coalesce(new.recarga_automatica, false);
    new.emissao := coalesce(new.emissao, 'revisar');
    new.atualizado_em := coalesce(new.atualizado_em, now());
    return new;
end $$;

drop trigger if exists ciclo_empresa_padroes on public.ciclo_empresa;
create trigger ciclo_empresa_padroes before insert or update on public.ciclo_empresa
    for each row execute function public.ciclo_empresa_padroes();
