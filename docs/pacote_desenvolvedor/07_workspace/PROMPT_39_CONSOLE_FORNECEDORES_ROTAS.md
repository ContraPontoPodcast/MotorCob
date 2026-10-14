# Prompt Horizons — Console 39: Fornecedores e rotas (bloco 2)

Rode depois do SQL 30 e do prompt 38. Protótipo aprovado: `docs/homologacao/bloco2-produtos-prototipo.html`.

```text
Console MotorCX › Mensageria › Fornecedores e rotas. NÃO crie, altere ou apague tabelas, views ou políticas.
Só com a permissão gerenciar_fornecedores (Master e Administrativo; ver prompt 30).

## Aba Fornecedores
Lista de mensageria_fornecedores: Nome, Canais (selos), Integração ("Real" se segredo_ref preenchido, senão
"Simulado" com o (i): "Sem integração o envio é simulado e a reserva assume"), Ativo (chave).
"Novo fornecedor" e "Editar" abrem a MESMA gaveta: Código (travado ao editar), Nome, Canais (SMS, WhatsApp, RCS,
E-mail), "Faz consulta de operadora" (só SMS), "Nome do segredo da credencial" (segredo_ref) com o aviso fixo:
"Só o NOME do segredo. A senha/chave fica no cofre (Supabase Secrets ou Google Secret Manager), nunca aqui."

## Aba Negociações
Escolha fornecedor e produto. Dois modos (botões): "Preço único (flat)" ou "Por operadora".
- Por operadora (só SMS): marque Vivo, Claro, TIM, Outras e informe o custo de cada uma.
- "Vale a partir de" (hoje por padrão; data passada é recusada).
- Custo zero ou vazio: campo vermelho "Custo precisa ser maior que zero" e Salvar desabilitado.
Salvar: rpc salvar_negociacao(fornecedor, item, modo, valores, vigente_desde) com valores
{"flat": 0.031} ou {"vivo": 0.030, "claro": 0.028, ...}. "Encerrar negociação": modo 'encerrar' (se o
fornecedor estiver na rota, mostre a frase do banco traduzida: "Tire o fornecedor da rota antes").
Lista do que vale hoje: view negociacoes_vigentes.

## Aba Rotas (uma por produto)
Escolha o produto (vem pré-selecionado quando chega do botão "Montar a rota"). Tipo: "Flat" ou "Por operadora".
- Flat: linhas Fornecedor + % do tráfego + ordem de reserva; soma 100%.
- Por operadora: um bloco por operadora marcada (Vivo, Claro, TIM, Outras) + bloco opcional "Demais operadoras".
  Cada bloco soma 100% (contador verde 100% / âmbar ≠ 100%). Operadora sem bloco e sem "Demais" usa a rota do
  canal (texto explicando abaixo dos blocos).
- Em cada linha, o custo do fornecedor naquela operadora aparece ao lado; se não houver, campo "Custo" para
  digitar ali mesmo (grava com salvar_negociacao e a linha se atualiza). Fornecedor sem custo não salva.
- "+ Novo fornecedor" dentro do select abre a gaveta da aba Fornecedores sem sair da rota.
Salvar: rpc salvar_rota_produto(item_produto, tipo, itens) com itens
[{"fornecedor":"sinch","operadora":"claro","percentual":100,"ordem_reserva":1}, ...] (operadora vazia = demais/flat).
Abaixo: "Custo previsto" (rpc custo_previsto(item_produto)) e os problemas de rpc problemas_rota(item_produto).
Rota incompleta não pode ser contratada (selo âmbar).

## Mistura de operadoras (no fim da aba Rotas)
Tabela mensageria_mistura_operadoras: Vivo, Claro, TIM, Outras (%), com a fonte. Editar: soma 100%.
Salvar: rpc salvar_mistura_operadoras(valores, fonte). Texto: "Usada no custo previsto das rotas por operadora".

Confira em 1440 e 390 px.
```
