# Prompt de ajuste do site: ligar/desligar "Demais clientes"

Antes de colar, rode no Supabase `supabase/migrations/20261013000001_demais_ativo.sql` (ou o
`supabase/atualizar_producao_2026-10.sql`, que já inclui). Pode rodar mais de uma vez.

---

```text
O item "Demais clientes" da Orquestração (quem não cai em nenhum segmento em uso na carteira)
ganha o liga/desliga. NÃO crie, altere ou apague tabelas, views, buckets ou políticas.

## Dados
- credores.demais_ativo (boolean, padrão true): "Demais clientes" em uso nesta carteira.
  Admin e planejamento alteram (update em credores, como já é feito com estrategia_id).
- view enquadramento: clientes com estrategia = 'Demais clientes (desligado)' são os que ficaram
  sem ação por isso.

## 1. Orquestração da carteira, item "Demais clientes"
- No item da lista (onde hoje fica "Demais clientes"), o mesmo switch "Em uso nesta carteira"
  dos segmentos, gravando credores.demais_ativo da carteira do topo.
- Desligado: item cinza com o selo "Pausado" e o texto "Quem não cai em nenhum segmento fica
  sem ação (acordos continuam)". A esteira escolhida continua guardada e volta ao ligar.
- Ao desligar, confirmar: "Os clientes que não caem em nenhum segmento em uso deixam de receber
  ações a partir da próxima rotina. Continuar?"
- Contagem ao lado: soma de enquadramento.clientes desta carteira com na_carga = true e
  estrategia = 'Demais clientes (desligado)' (desligado) ou cujo cluster não é de nenhum
  segmento em uso (ligado). Antes da 1ª rotina: "—".
- Toast: "Vale a partir da próxima rotina (em até 1 minuto)".

## 2. Página "Segmentos" (matriz segmentos × carteiras)
Última linha fixa "Demais clientes": em cada carteira, "✓ Em uso" ou "⏸ Pausado" conforme
credores.demais_ativo; clicar alterna (com a mesma confirmação ao pausar). Sem a opção "—".

## 3. Aviso
Se a carteira tiver "Demais clientes" pausado E nenhum segmento em uso: selo vermelho no topo
da Orquestração "Nenhum cliente desta carteira recebe ação: ligue um segmento ou os Demais
clientes".
```
