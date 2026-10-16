# Prompt Horizons — 57: Console · Acordo de pagamento de fatura vencida (complementa o prompt 55)

Rode depois do SQL 38, da função `cobranca` nova e do prompt 55. Protótipo aprovado em 15/10/2026:
`docs/homologacao/acordo-fatura-prototipo.html` (telas "Lançar acordo" e "Acompanhar acordos").

```text
Console MotorCX (motorcob.online/console). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Lançar acordo (Master e Administrativo: equipe_pode('emitir_faturas', empresa))
Botão "Lançar acordo" na aba Vencidas de Faturas (na linha e com várias da mesma empresa selecionadas) e no topo
da empresa quando houver fatura vencida. Abre o PainelEdicao (prompt 49) "Lançar acordo · {empresa}":
- "Faturas que entram no acordo": caixas de seleção com as faturas da empresa em faturas_painel com situacao_atual
  'aberta' ou 'vencida' (acordo_id vazio): "{Mês} · {valor}" e embaixo "Venceu em {dd/mm} · N dias de atraso".
  Nota: "Só faturas em aberto ou vencidas. Fatura em acordo sai de Vencidas e não gera lembrete nem bloqueio."
- "Condições": campo "Desconto (R$)" com a chave "Desconto / Acréscimo" (desconto manda ajuste negativo);
  "Parcelas" em botões 1 · 2 · 3 · 4 · 6 · 12; "1ª parcela" (data, de hoje até 30 dias; padrão hoje + 5);
  "Motivo do desconto (o cliente não vê)" — obrigatório quando há desconto ou acréscimo, 5 a 200 caracteres;
  "Formas aceitas" Pix · Boleto · Cartão (padrão Pix e Boleto; ao menos uma).
- "Resumo", recalculado a cada mudança: "{soma} em aberto · {total} no acordo" e a tabela Parcela · Vencimento ·
  Valor. Conta igual à do banco: total em centavos dividido pelas parcelas, o resto na 1ª; vencimentos mês a mês
  a partir da 1ª. Parcela abaixo de R$ 5,00: frase em vermelho e botão desligado.
- Caixa marcada por padrão: "Informar o cliente agora: e-mail para quem recebe faturas e aviso no sino".
- Botão "Lançar acordo" → confirmação do prompt 49: "Lançar o acordo de {total} em {n} parcelas para a {empresa}?
  As faturas de {meses} ficam "Em acordo", a empresa é liberada enquanto as parcelas estiverem em dia{ e o e-mail
  com as parcelas sai para quem recebe faturas}." Botão "Lançar acordo de {total}" →
  rpc lancar_acordo(empresa, faturas[], parcelas, primeira, formas[], ajuste, motivo, informar) → id do acordo.
  Com informar: chame em seguida a função cobranca { acao: 'informar_acordo', acordo: id } (se falhar, mostre
  "O e-mail não saiu agora: {erro}. O sistema tenta de novo sozinho."). Mensagem final: "Acordo lançado. Cliente
  informado por e-mail e no sino; ficou na Auditoria." Erro da rpc aparece como veio.
- Quem não pode: o botão vira a etiqueta com cadeado "Só Master e Administrativo lançam acordo". Nunca esconda.

## 2. Aba "Acordos" em Faturas (com contagem dos em andamento)
rpc acordos() (equipe vê todas as empresas; acordos(empresa) na tela da empresa). Colunas: Empresa · Situação ·
Parcelas ("{pagas} de {parcelas} pagas") · Valor (valor_total) · Próxima.
- Situação (pílulas): em_dia "Em dia" (verde) · parcela_vencida "Parcela vencida há {dias_atraso} dias" (âmbar;
  vermelha com até 3 dias para quebrar) · quebrado "Quebrado" (vermelha) · quitado "Quitado" (cinza) · cancelado
  "Cancelado" (cinza).
- Próxima: "{proxima_vencimento dd/mm} · {proxima_valor}"; em parcela_vencida, "quebra em {quebra_em − hoje}
  dias"; quebrado com saldo aberto: "saldo de {valor_restante} em cobrança"; quitado/cancelado: "—".
- "Ver" abre o painel do acordo: faturas (competencias), valor das faturas, desconto ou acréscimo com o motivo
  (ajuste_motivo; só a equipe recebe), formas, informado em (informado_em ou "não informado" + botão "Enviar
  e-mail agora" → informar_acordo) e a tabela das parcelas (acordo_parcelas: numero, tipo, vencimento, valor,
  situacao, paga_em, link_nota_fiscal). Parcela tipo 'saldo' aparece como "Saldo do acordo".
- "Cancelar acordo" (só em_dia/parcela_vencida, sem parcela paga; Master e Administrativo): confirmação "As faturas
  voltam a vencidas e a régua de lembretes e bloqueio volta a contar." + campo "Motivo" (5+) → rpc
  cancelar_acordo(acordo, motivo). Com parcela paga, o botão fica desligado com a frase "Acordo com parcela paga
  não é cancelado: segue até quitar ou quebrar."
- Na aba Vencidas, fatura em acordo some (situacao_atual = 'em_acordo'); em Pagas, a fatura quitada pelo acordo
  mostra "Paga (via acordo nº {acordo_id})".
- Celular: cada acordo vira cartão com empresa, situação, parcelas e próxima.

Confira em 1440 e 390 px, claro e escuro.
```
