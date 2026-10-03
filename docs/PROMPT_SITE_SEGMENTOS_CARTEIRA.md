# Prompt de ajuste do site: quais carteiras usam cada segmento (e se está em uso)

Antes de colar, rode no Supabase `supabase/migrations/20261009000001_segmentos_carteira.sql` (ou o
`supabase/atualizar_producao_2026-10.sql`, que já inclui). Pode rodar mais de uma vez.

---

```text
Na Orquestração, o usuário precisa APONTAR quais carteiras usam cada segmento e se o segmento
está EM USO em cada uma. NÃO crie, altere ou apague tabelas, views, buckets ou políticas.

## Dados
- clusters (id, empresa_id, codigo, nome, ordem, condicoes, estrategia_id, ativo, credor_id).
  clusters.ativo = liga/desliga geral ("desligado em todas as carteiras").
- segmentos_carteira (empresa_id, cluster_id, credor_id, ativo): o segmento vale nas carteiras
  listadas e só onde ativo = true. Admin e planejamento inserem, alteram e apagam.
- view segmentos_em_uso (empresa_id, credor_id, cluster_id, codigo, nome, ordem, estrategia_id,
  vinculo 'escolhidas'|'uma'|'todas', vinculado, em_uso): já resolve, para cada segmento e cada
  carteira, se está vinculado e se está em uso. Use-a para LER; grave em segmentos_carteira.
- credores (id, nome, ativo) = carteiras.
Regra de gravação (sempre): segmento novo → clusters.credor_id = null e uma linha em
segmentos_carteira para cada carteira marcada. Ao editar um segmento antigo que ainda está com
vinculo 'uma' ou 'todas', converta: grave clusters.credor_id = null e crie as linhas de
segmentos_carteira conforme as carteiras marcadas na tela.

## 1. Página "Segmentos" (no menu, dentro de Orquestração, visão da empresa toda)
Matriz: linhas = segmentos (na ordem, com nome e esteira), colunas = carteiras ativas.
Cada célula: "✓ Em uso" (verde) · "⏸ Pausado" (cinza) · "—" (não usa). Clicar na célula
alterna: — → Em uso → Pausado → — (grava/atualiza/apaga a linha em segmentos_carteira).
Última coluna: switch "Ligado" (clusters.ativo); desligado deixa a linha toda cinza com
"desligado em todas". Botões "+ Segmento" e subir/descer (ordem).
Legenda: "O cliente cai no PRIMEIRO segmento em uso na carteira dele que combina com ele."

## 2. Editor do segmento
Logo abaixo do nome, o bloco "Carteiras que usam este segmento": uma linha por carteira
ativa com checkbox "Usa" e, quando marcada, o switch "Em uso" (ativo). Atalhos: "Marcar
todas" e "Desmarcar todas". Salvar grava segmentos_carteira (insere/atualiza as marcadas,
apaga as desmarcadas) e clusters.credor_id = null. Se nenhuma carteira estiver marcada,
avise: "Sem carteira, este segmento não vale em lugar nenhum".
Mais abaixo, o switch geral "Ligado" (clusters.ativo).

## 3. Orquestração dentro da carteira
A lista de segmentos da carteira vem de segmentos_em_uso com credor_id = esta carteira e
vinculado = true, em dois grupos: "Em uso" (em_uso) e "Pausados nesta carteira". Cada item
tem o switch "Em uso nesta carteira" (atualiza segmentos_carteira.ativo desta carteira) e o
selo "também em: {outras carteiras}" quando usado em outras. "+ Segmento" cria já vinculado
a esta carteira (em uso). "Usar um segmento existente": lista os segmentos da empresa ainda
não vinculados a esta carteira; escolher cria a linha em segmentos_carteira.

## 4. Avisos
- Toast ao mudar: "Vale a partir da próxima rotina".
- Segmento ligado (clusters.ativo) mas sem nenhuma carteira em uso: selo âmbar
  "Não está em uso em nenhuma carteira".
```
