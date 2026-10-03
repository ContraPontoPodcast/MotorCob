# Prompt de ajuste do site: excluir segmento

Antes de colar, rode no Supabase `supabase/migrations/20261016000001_exclusao_dispara_rotina.sql`
(ou o `supabase/atualizar_producao_2026-10.sql`, que já inclui). Pode rodar mais de uma vez.
Com ele, excluir segmento, desvincular segmento de uma carteira ou apagar persona dispara o
reenquadramento automático (até 1 minuto).

---

```text
Na Orquestração, permita EXCLUIR um segmento. NÃO crie, altere ou apague tabelas, views,
buckets ou políticas; use as permissões que já existem (admin e planejamento apagam em clusters
e em segmentos_carteira; os vínculos em segmentos_carteira saem junto com o segmento).

## Dados
- clusters (id, codigo, nome, estrategia_id, credor_id): o segmento.
- segmentos_carteira (cluster_id, credor_id, ativo): em quais carteiras ele vale.
- view segmentos_em_uso (credor_id, cluster_id, vinculo, vinculado, em_uso).
- view enquadramento (credor_id, cluster, clientes, na_carga): quantos clientes estão nele.
- credores (id, nome).

## 1. Onde fica o botão (admin e planejamento)
- No editor do segmento (modal): botão vermelho discreto "Excluir segmento" no rodapé, à
  esquerda (Salvar e Cancelar continuam à direita).
- Na lista de segmentos da Orquestração da carteira: menu "⋯" em cada item com "Editar",
  "Tirar desta carteira" e "Excluir segmento".
- Na página/matriz "Segmentos": menu "⋯" na linha com "Excluir segmento".

## 2. Confirmação (modal)
Título: "Excluir o segmento {codigo} · {nome}?"
Mostre:
- "Usado em: {carteiras}" (de segmentos_em_uso com vinculado = true) ou "Não está em nenhuma
  carteira";
- "{N} clientes estão nele hoje" (soma de enquadramento.clientes com cluster = codigo e
  na_carga = true, em todas as carteiras);
- "Esses clientes vão para o próximo segmento em uso que combinar com eles, ou para Demais
  clientes. A esteira '{nome da esteira}' NÃO é apagada (continua em Estratégias)."
Botões: "Cancelar" e "Excluir segmento" (vermelho). Para N > 0, o botão só habilita depois
de marcar "Entendi que os clientes serão reenquadrados".
Ao confirmar: delete em clusters where id = segmento. Toast: "Segmento excluído · os clientes
são reenquadrados em até 1 minuto". Feche o editor, recarregue a lista e o enquadramento.

## 3. "Tirar desta carteira" (sem excluir)
Confirmação curta: "Tirar o segmento {nome} da carteira {carteira}? Ele continua nas outras
carteiras." → delete em segmentos_carteira where cluster_id = segmento and credor_id =
carteira. Se o segmento for do tipo antigo, só desta carteira (segmentos_em_uso.vinculo =
'uma'), ofereça "Excluir segmento" no lugar (é a única carteira dele).

## 4. Erros
Se o delete falhar por permissão, mostre "Só administração e planejamento podem excluir
segmentos". Outro erro: a mensagem padrão de erro do site.
```
