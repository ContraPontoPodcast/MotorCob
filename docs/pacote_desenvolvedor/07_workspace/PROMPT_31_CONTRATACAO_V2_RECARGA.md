# Prompt Horizons — Workspace 31: Contratação v2 (módulos do motor, ciclo em dias, pré/pós-pago e recarga)

Rode depois do **SQL 22** (`01_banco/22_ciclo_pagamento.sql`) e do prompt 29. Ajusta a tela Contratação (prompt 27)
e cria o saldo e a recarga do pré-pago. Protótipo aprovado: https://claude.ai/artifact/9hMzuq91REmNbhBT7yVA5o

```text
AJUSTES na tela Contratação (componente ContratacaoEmpresa) e no Faturamento. Não mude tabelas nem políticas.
Textos e layout do protótipo. Quem edita: rpc('listar_equipe') da própria pessoa com editar_contratacao
(preços: editar_precos); Master sempre.

1. MÓDULOS: no topo da seção, a frase "Marque o que foi contratado. Orquestração e Jornada são módulos do motor:
   só ficam liberados se marcados." Duas linhas novas com chave (switch), antes da Mensageria:
   - Orquestração — "MotorCob: Lista do dia, réguas, personas e telefone Hot." (só aparece com MotorCob marcado)
   - Jornada — "MotorCli: Momentos da jornada e lista do dia." (só aparece com MotorCli marcado)
   Nada vem ligado sozinho. Salvar: upsert em empresa_modulos (empresa_id, modulo, ativo, canais) onConflict
   "empresa_id,modulo" para orquestracao, jornada, mensageria, api e enriquecimento. Motor marcado sem o seu
   módulo: não salve e mostre "Marque o módulo do motor contratado: Orquestração." (ou Jornada, ou as duas).
   O item de preço "contratos" só aparece com Orquestração ligada; "jornada_clientes" só com Jornada ligada.

2. PREÇO ABRE EMBAIXO DO ITEM: o editor de preço (flat, faixas, mensalidade, simular) abre LOGO ABAIXO da linha
   tocada, dentro da lista, e não no fim da seção. Um aberto por vez; tocar de novo fecha.

3. CICLO DE USO: controle segmentado Semanal · Quinzenal · Mensal · Outro.
   - Mensal: "Dia de corte" como hoje (1 a 28). Grava periodicidade 'mensal', dia_corte.
   - Semanal = 7 dias, Quinzenal = 15, Outro = campo "Duração do ciclo (dias)" (1 a 90). Mostra também
     "Início do primeiro ciclo" (data, padrão hoje). Grava periodicidade 'dias', ciclo_dias, inicio.
   Texto: "De quanto em quanto tempo o uso é fechado. O volume do escalonado e o mínimo valem por ciclo."
   O cartão "Ciclo atual" continua de rpc('ciclo_atual', { empresa }) (lista: use data?.[0]). Empresa nova:
   calcule na tela; em dias, o ciclo vai de inicio + k×N até + N−1 dias, e a competência é o 1º dia do ciclo.

4. COBRANÇA (seção nova depois do ciclo): dois cartões Pós-pago ("Usa no ciclo e paga a fatura depois.") e
   Pré-pago ("Recarrega um saldo e o uso desconta dele."). "Formas de pagamento aceitas": chips Boleto, Pix e
   Cartão de crédito (pelo menos um: "Escolha pelo menos uma forma de pagamento.").
   - Pós: "Prazo para pagar a fatura" (5, 10, 15 ou 30 dias após o fechamento; padrão 10).
   - Pré: "Recarga mínima (R$)" (obrigatória), "Avisar quando o saldo ficar abaixo de (R$)", "Quando o saldo
     acabar" (Pausar os envios da Mensageria até a próxima recarga / Continuar e descontar da próxima recarga)
     e a chave "Recarga automática no cartão" (só com Cartão marcado: "Recarga automática precisa do cartão de
     crédito nas formas aceitas.").
   Salvar tudo do ciclo e da cobrança num upsert em ciclo_empresa (onConflict empresa_id): periodicidade,
   dia_corte, ciclo_dias, inicio, prazo_dias (só pós; pré = null), modelo_pagamento ('pos'|'pre'), formas
   (['boleto','pix','cartao']), recarga_minima, aviso_saldo, ao_zerar ('pausar'|'continuar'),
   recarga_automatica. O Resumo ganha "Cobrança: Pré-pago · boleto, Pix".

5. ORDEM DO SALVAR: (criar empresa, se nova) → salvar_frentes → empresa_modulos → ciclo_empresa → salvar_preco
   de cada item alterado (vigente_desde = rpc('competencia_de', { empresa, dia: hoje })). Erros do banco na faixa
   vermelha, sem derrubar a tela.

6. EMPRESA › FATURAMENTO DO CLIENTE (e da equipe, na empresa aberta):
   - Pós-pago: como hoje (prévia do ciclo e faturas).
   - Pré-pago: cartão "Saldo" no topo com rpc('saldo_empresa', { empresa }) → linha {pre_pago, saldo,
     recargas_pagas, uso, aviso_saldo, abaixo_do_aviso, pausar_envios, recarga_minima}. Mostre "Saldo R$ x",
     "Recargas pagas R$ y · Uso R$ z". abaixo_do_aviso: faixa amarela "Saldo baixo. Recarregue para não parar
     os envios."; pausar_envios: faixa vermelha "Saldo esgotado: a Mensageria está pausada até a próxima
     recarga." Esconda a lista de faturas (pré-pago não tem fatura); a prévia do ciclo continua.
   - Botão "Recarregar": valor (mínimo = recarga_minima, já preenchido) e forma (só as aceitas) →
     rpc('solicitar_recarga', { empresa, valor, forma }). Depois: "Recarga pedida. O saldo entra quando o
     pagamento for confirmado." (o boleto/Pix/cartão ainda não é gerado aqui; a equipe confirma).
   - Lista "Recargas": from('recargas').select('*').eq('empresa_id', id).order('pedida_em', desc): data, valor,
     forma, situação (Pendente / Paga / Cancelada). Pendente pedida pela própria pessoa: "Cancelar" →
     rpc('cancelar_recarga', { recarga: id }).

7. CONSOLE › FATURAMENTO (equipe com emitir_faturas): aba "Recargas" com as pendentes de todas as empresas do
   alcance (Empresa, valor, forma, pedida em) e os botões "Marcar como paga" → rpc('confirmar_recarga',
   { recarga: id }) e "Cancelar" → rpc('cancelar_recarga', { recarga: id }). Confirme antes: "Confirmar o
   pagamento de R$ x da Alfa? O valor entra no saldo agora."

Confira em 1440 e 390px: crie a Beta só MotorCli com Jornada ligada, ciclo Semanal, Pré-pago com recarga mínima
500 e Pix; no cliente, peça uma recarga de 500; no Console, marque como paga; o saldo mostra R$ 500,00.
```
