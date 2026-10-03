# Prompt de ajuste do site: personas criadas pelo usuário

Antes de colar, rode no Supabase `supabase/migrations/20261007000001_personas_usuario.sql` (ou o
`supabase/atualizar_producao_2026-10.sql`, que já inclui). Pode rodar mais de uma vez.

---

```text
Crie as PERSONAS DO USUÁRIO: o perfil do devedor (público) que a empresa define por
características, em cada carteira, e que aparece na orquestração. NÃO crie, altere ou apague
tabelas, views, buckets ou políticas. Tudo filtrado por empresa e pela carteira (credor_id).

## Dados
- personas_usuario (id, empresa_id, credor_id, nome, descricao, ordem, condicoes jsonb
  [{campo, op, valor}], cor, ativo, atualizado_em). Admin e planejamento criam, editam e apagam.
- empresas.colunas_base.colunas: [{nome, tipo}] — as colunas da carga (para escolher o campo).
- estado_cliente.persona_usuario (nome da persona do cliente) e a view enquadramento
  (…, persona_usuario, clientes, saldo) — preenchidas pela rotina.
- personas (as da inteligência MotorCob, já existentes) com credor_id.

## Aba "Personas" na página da carteira (depois de "Orquestração")
Dois blocos:
### 1. "Suas personas"
Texto: "Descreva os perfis de devedor desta carteira. Cada cliente fica na PRIMEIRA persona
que combina com ele (a ordem importa). Use as personas na esteira para mandar uma ação só
para um público."
Lista em ordem (setas subir/descer gravam ordem = 10, 20, 30…), cada cartão com: bolinha da
cor, nome, a frase das características (ex.: "UF = SP · tem WhatsApp = sim · saldo ≤ R$ 2.000"),
quantos clientes caíram nela na última rotina (soma de enquadramento.clientes com
persona_usuario = nome; antes da 1ª rotina: "—"), switch Ativa, Editar, Apagar (confirmar:
"As ações da esteira que usam esta persona passam a valer para todos").
Linha final fixa, cinza: "Sem persona — clientes que não combinam com nenhuma" com a contagem.
Botão "+ Persona".
### Editor da persona (modal)
- Nome (até 60), descrição (opcional), cor (6 opções).
- "Características": linhas "campo · condição · valor", botão "+ característica"; todas
  precisam ser verdade (E). Campo (select agrupado):
  "Da carga": as colunas de empresas.colunas_base.colunas;
  "Calculadas pelo MotorCob": saldo (R$), dias_atraso, qtd_contratos, ddd,
  tem_whatsapp (sim/não), tem_rcs (sim/não).
  Condição → op: "é igual a" (=), "é diferente de" (!=), "maior que" (>), "maior ou igual" (>=),
  "menor que" (<), "menor ou igual" (<=), "é um destes" (em; valores separados por ;),
  "não é nenhum destes" (nao_em), "contém" (contem), "está vazio" (vazio), "está preenchido"
  (preenchido; sem valor). Para tem_whatsapp/tem_rcs o valor é um select sim/não. Para > >=
  < <= o valor precisa ser número.
- Embaixo, a frase legível montada em tempo real.
- Salvar: insert/update em personas_usuario (credor_id = esta carteira; ordem = última + 10
  ao criar). Nome repetido na carteira: "Já existe uma persona com esse nome nesta carteira".
  Toast: "Persona salva · vale a partir da próxima rotina".
### 2. "Personas da inteligência MotorCob"
O que já existe hoje (tabela personas, filtrada por credor_id), com o texto "Aprendidas
automaticamente com as ocorrências. Usadas pelas fichas ★ e ☆ da esteira."

## Desenho da Esteira (Orquestração da carteira)
- Cada chip de canal colocado num dia ganha um botão pequeno "Público" (ícone de pessoas).
  Abre um menu com "Todos" (padrão) e as personas ativas desta carteira (checkbox, com a cor).
  Grava na ação: "personas": [ids] (sem a chave quando for Todos).
  No chip, abaixo do nome do canal: "só {nome}" (ou "só 2 personas") com a cor da persona.
- Dica sob a barra de canais: "Use o Público para mandar um canal só para uma persona e ponha
  logo abaixo um 'senão' para os demais. Ex.: D+1 WhatsApp só Digitais SP; senão SMS."
- "Como vai funcionar" cita as personas: "D+1: WhatsApp para Digitais SP; senão SMS".
- Ação que aponta para persona apagada ou inativa: chip com aviso vermelho "persona
  removida"; ao salvar, tira o id da lista.
- As fichas "★ Melhor canal da persona" e "☆ 2º melhor da persona" continuam (inteligência).

## Segmentos (Orquestração)
No editor de condições do segmento, o campo "persona" aparece em "Calculadas pelo MotorCob",
com os nomes das personas desta carteira como valores (e "Sem persona").

## Aba Clientes e página Cliente
Coluna e filtro "Persona (sua)" = persona_usuario; a coluna atual vira "Persona (inteligência)".
```
