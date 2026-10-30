-- SQL 50 · Glossário "O que significa": Propensão a pagamento, Abordagem, estágios e matriz
-- Os termos que entraram com as etapas 81–88 e ainda não tinham verbete: Propensão a pagamento, evidência
-- (Coletando · Prévia · Definida), pagamento × promessa, Abordagem, estágio de cobrança, matriz Propensão ×
-- Abordagem e os modelos "Prefere digital / Prefere analógico". Só inclui ou atualiza estes slugs; os outros
-- termos não mudam. "antes" guarda os nomes antigos para a busca achar o termo novo.
-- Pode rodar de novo sem erro.

insert into public.glossario (slug, grupo, termo, definicao, exemplo, antes, ordem) values
    ('propensao-a-pagamento', 'Persona e propensão', 'Propensão a pagamento',
     'Chance de o cliente pagar nos próximos 30 dias, calculada pela situação, pelo atraso e pelo saldo dele hoje. '
     'Vem em faixas de A (muito alta) a E (muito baixa); os cortes são refeitos toda semana com os pagamentos da '
     'própria carteira. Não usa idade, gênero, DDD nem a persona.',
     'Faixa A = o quinto da carteira com mais chance de pagar.', 'Score de pagamento, Propensão', 181),
    ('pagamento-e-promessa', 'Persona e propensão', 'Pagamento e promessa',
     'Pagamento é quitação ou 1ª parcela do acordo paga. Acordo fechado é promessa: aparece à parte e não conta '
     'como pagamento nos resultados nem na Propensão.', '', 'Acordo, Promessa de pagamento', 182),
    ('evidencia', 'Persona e propensão', 'Evidência: Coletando, Prévia e Definida',
     'Quanto o MotorCX já aprendeu com os dados. Na Propensão a pagamento conta pagamentos: Coletando com menos '
     'de 30 (ainda sem faixa), Prévia de 30 a 199, Definida com 200 ou mais. Na Abordagem conta clientes '
     'acionados da persona.', '', 'Maturidade', 183),
    ('abordagem', 'Persona e propensão', 'Abordagem',
     'O que o MotorCX aprende de cada persona: Contato (em qual número ou e-mail encontramos a pessoa), Canal '
     '(por onde ela responde) e Mensagem (o que faz ela pagar). Cada parte mostra a sua evidência.', '',
     '3C, Contato · Canal · Mensagem', 184),
    ('matriz-propensao-abordagem', 'Persona e propensão', 'Matriz Propensão × Abordagem',
     'Cruza a Propensão a pagamento (alta = faixas A a C; baixa = D e E) com a Abordagem (definida ou aprendendo). '
     'Acelerar: alta e definida. Descobrir rápido: alta e aprendendo. Manter barato: baixa e definida. '
     'Economizar: baixa e aprendendo. O MotorCX sugere a ação de cada quadrante; quem decide é a operação.', '',
     'Quadrantes', 185),
    ('prefere-digital-e-prefere-analogico', 'Persona e propensão', 'Prefere digital e Prefere analógico',
     'Modelos de persona prontos para começar. Prefere digital: responde a WhatsApp, SMS, RCS e e-mail. Prefere '
     'analógico: responde melhor à voz (ligação ou agente virtual). Usar um modelo não limita a régua.',
     'Sênior (60+) e Só telefone fixo são modelos de Prefere analógico.',
     'Propensão ao digital, Propensão ao analógico', 186),
    ('estagio-de-cobranca', 'Régua e estratégia', 'Estágio de cobrança',
     'Etapa que a sua empresa define para cada segmento, por atraso, entrada, vencimento, coluna da carga, situação '
     'ou propensão, com a régua dela e as saídas (CPC, acordo, pagamento, fim da janela). Cliente que não cabe em '
     'nenhum estágio não recebe ação, e o decisor é avisado na Lista do dia.',
     'Estágio "Até 30 dias": de 1 a 30 dias de atraso; no CPC, vai para "Negociação".', 'Momento, Etapa', 135)
on conflict (slug) do update set grupo = excluded.grupo, termo = excluded.termo, definicao = excluded.definicao,
    exemplo = excluded.exemplo, antes = excluded.antes, ordem = excluded.ordem, atualizado_em = now();
