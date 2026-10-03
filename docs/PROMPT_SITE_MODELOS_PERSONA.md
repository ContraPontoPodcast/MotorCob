# Prompt de ajuste do site: modelos de persona (digital × analógico)

Antes de colar, rode no Supabase `supabase/migrations/20261011000001_personas_modelo.sql` (ou o
`supabase/atualizar_producao_2026-10.sql`, que já inclui). Pode rodar mais de uma vez.

---

```text
Na página Personas, ofereça os MODELOS DE PERSONA do MotorCob para o usuário copiar para a
carteira. NÃO crie, altere ou apague tabelas, views, buckets ou políticas.

## Dados
- personas_modelo (id, propensao 'digital'|'analogico', nome, descricao, canais_sugeridos text[],
  condicoes jsonb [{campo, op, valor}], campos_necessarios text[], ordem, cor): só leitura.
- personas_usuario (credor_id, nome, descricao, ordem, condicoes, cor, ativo): as personas da
  carteira. Admin e planejamento inserem.
- empresas.colunas_base.colunas [{nome, tipo}]: colunas da carga.
Se o bloco "Suas personas" ainda não existir na página, crie-o: lista das personas_usuario do
credor do topo (nome, frase das características, switch Ativa, Editar, Apagar, + Persona).

## Bloco "Modelos MotorCob" (abaixo de "Suas personas")
Texto: "Pontos de partida com base no mercado de cobrança. Copie para a carteira e ajuste. A
inteligência do MotorCob confirma ou corrige com os resultados."
Duas colunas (no celular, uma embaixo da outra):
- "Propensão ao DIGITAL" (ícone de celular, verde) — modelos com propensao = 'digital';
- "Propensão ao ANALÓGICO" (ícone de telefone, âmbar) — propensao = 'analogico'.
Cartão de cada modelo (ordem por ordem): bolinha da cor, nome, descrição, a frase das
características (ex.: "idade ≤ 35 · tem WhatsApp = sim"), "Canais sugeridos" como chips na
ordem (WhatsApp, RCS, SMS, E-mail, Agente virtual, Discador, com as cores dos canais).
Se campos_necessarios tiver "idade": selo "Precisa da data de nascimento (ou IDADE) na carga";
se a carga da empresa (colunas_base) não tiver coluna de nascimento nem IDADE, o selo fica
âmbar "Sua carga não tem idade: este modelo não vai pegar ninguém".
Botão "Usar nesta carteira" (admin e planejamento; precisa do credor do topo): insert em
personas_usuario com credor_id = credor do topo, nome = modelo.nome, descricao = descricao +
" · Canais sugeridos: " + canais em texto, condicoes = modelo.condicoes, cor = modelo.cor,
ordem = modelo.ordem. Se já existir persona com esse nome na carteira: "Já está na carteira".
No topo do bloco, dois atalhos: "Usar todos os digitais" e "Usar todos os analógicos", e
"Usar todos" (insere os que faltam, na ordem dos modelos).
Toast: "Persona adicionada à carteira · vale a partir da próxima rotina".

## Campos calculados no editor de persona e de segmento
No select de campo, em "Calculadas pelo MotorCob", acrescente: idade (anos), tem_email
(sim/não), tem_celular (sim/não), so_fixo (sim/não), qtd_telefones.

## Esteira (dica)
No editor da esteira, quando a carteira tiver personas vindas dos modelos, mostre a dica:
"Use o botão Público para dar a cada persona os canais sugeridos (ex.: D+1 WhatsApp só para
Digital nativo e Conectado; senão Discador para Sênior e Só telefone fixo)."
```
