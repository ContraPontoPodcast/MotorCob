# Prompt Horizons — 55: Console · Contratação por seção e Faturas (substitui partes dos prompts 27, 31 e 33)

Rode depois do SQL 37 e do prompt 49. Protótipo aprovado em 15/10/2026:
`docs/homologacao/faturas-contratacao-prototipo.html` (telas Contratação e Faturas).

```text
Console MotorCX (motorcob.online/console). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Contratação (componente ContratacaoEmpresa)
Sai o botão único "Salvar". A tela mostra três cartões com o que está valendo e um "Editar" em cada um, que abre o
PainelEdicao (prompt 49): "Motor e módulos" (salvar_frentes + empresa_modulos), "Ciclo e cobrança" (ciclo_empresa:
ciclo, pré/pós, formas, emissão, vencimento) e "Preços". Criar empresa continua no fluxo atual (tudo de uma vez).
- Preços: tabela Item · Tipo · Preço · Desde. Nomes: "Preço único" (flat), "Preço por faixa" (faixa/progressivo),
  "Mensalidade". Para o cliente e nesta tabela, valor unitário abaixo de R$ 0,10 aparece por mil.
  No painel, cada item alterado fica marcado; abaixo do mínimo, frase em vermelho e campo "Motivo" (pede a
  permissão preço abaixo do mínimo).
  Revisar: lista "Item · faixa" com o valor antigo riscado → novo, e "A partir de quando":
  · "Próximo ciclo · {proximo_ciclo_mes(empresa)}" (padrão): "A fatura atual continua com o preço atual."
  · "Neste ciclo · desde {início do ciclo}": "Recalcula a prévia; o cliente vê o valor mudar." + campo obrigatório
    "Motivo (o cliente não vê)", 5 a 200 caracteres.
  Salvar → para cada item: rpc salvar_preco_vigencia(empresa, item, modelo, preco, minimo, faixas,
  'proximo' | 'atual', motivo_abaixo_do_minimo, motivo_vigencia) → devolve preco_id e vale_desde. Mensagem: "Preço
  salvo. Vale a partir de {vale_desde} e ficou na Auditoria." Erro da rpc aparece como veio.
- Quem não pode: o cartão mostra a etiqueta com cadeado "Só Master altera módulos e ciclo" ou "Só Master e
  Administrativo alteram preços" (pode_equipe('editar_contratacao') / equipe_pode('editar_precos', empresa)).
  Nunca esconda a aba.
- O select "Emissão" sai da lista de faturas: emissão automática ou revisar fica no cartão "Ciclo e cobrança".

## 2. Faturas
Abas com contagem: Rascunhos · Em aberto · Vencidas (faturas_painel.situacao_atual = 'vencida') · Pagas.
Colunas: (seleção, só em Rascunhos) · Empresa · Situação · Mês de · Valor · e, por aba: "E-mail para" (quantos
contatos) / "Vence em" / "Dias de atraso · lembretes" (fatura_lembretes) / "Paga em".
- Vencidas: além dos dias de atraso, a pílula vermelha "Inadimplente" quando empresas.situacao = 'inadimplente',
  e "bloqueia em N dias" quando faltar até 3. Botão "Reenviar lembrete" (função cobranca não manda de novo o mesmo
  tipo; mostre "O lembrete automático sai no dia seguinte ao vencimento, depois de 5 e de 7 dias").
- Emitir (uma ou várias): rpc resumo_emissao(ids) → quantidade, total, contatos, sem_contato. Confirmação do
  prompt 49: "{quantidade} faturas serão emitidas, somando {total}. O e-mail com o demonstrativo, o boleto e a nota
  sai para {contatos} contatos. Depois de emitida, a fatura não volta a rascunho." Com sem_contato: "Sem e-mail
  de fatura: {empresas} — marque Recebe faturas antes." Botão "Emitir {quantidade} · {total}" →
  emitir_faturas(ids). Use o ProcessoLongo (envio em segundo plano) e o aviso no sino.
- Ajuste (desconto, crédito, cobrança extra) no PainelEdicao; "Remover ajuste" com confirmação.
- "Gerar rascunhos" e "Cancelar rascunho" com confirmação ("Cancelar o rascunho de {empresa}? Ele some da lista.").
- Celular: cada linha vira cartão com empresa, situação, mês e valor.

## 3. Empresa › situação e liberação pelo Master
Na lista de empresas e no topo da empresa, "Inadimplente" em vermelho com o motivo (empresas.situacao_motivo).
É automático: volta para ativa sozinho quando a fatura é paga. "Reativar" (mudar_situacao_empresa) não vale para
inadimplente. No lugar, só para o Master (admin_equipe), o botão "Liberar mesmo com fatura em aberto" (na
empresa e na aba Vencidas): confirmação com a fatura e o valor em aberto, campo "Motivo" (5+ caracteres) e "Até"
(7 dias · 15 dias · 30 dias; padrão 7) → rpc liberar_inadimplente(empresa, motivo, ate) → devolve a data. Texto:
"O acesso e os envios voltam até {data}; se não pagar até lá, bloqueia de novo." Botão "Liberar até {data}".
Os outros veem a etiqueta com cadeado "Só o Master libera empresa inadimplente". Liberada: pílula âmbar
"Liberada até {empresas.liberada_ate}" no lugar de "Inadimplente".

Confira em 1440 e 390 px, claro e escuro.
```
