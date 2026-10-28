# Prompt Horizons — 82: nada padrão escondido (carteira vazia, 3 caminhos e modelos opcionais)

UX, 28/10/2026. Rode depois do 81. Decisão do dono: nada é aplicado sem o cliente ver; modelo é opcional,
visível antes de usar e vira cópia do cliente. Protótipo: cenário "Carteira nova".

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Use só o que já existe: tabela estrategias (definicao
jsonb, frente), view segmentos_em_uso, tabela segmentos_carteira e a rpc separar_estrategia(segmento,
carteira, definicao). Nada de CPF ou nome de devedor.

## 1. Definição vazia (a regra mais importante deste prompt)
"Estratégia vazia" é SEMPRE esta definição, mais as etapas que o cliente criar:
{"localizacao":{"ativo":false},"cpc":{"ativo":false},"giro":{"ativo":false},
 "preventivo":{"ativo":false},"quebra":{"ativo":false}}
NUNCA grave definicao = {} (para o motor, {} é o padrão MotorCX inteiro). Ao chamar separar_estrategia
passe SEMPRE o 3º argumento (definição), porque sem ele a rpc copia a atual ou grava {}.
Nunca regrave uma estratégia que já existe com as fases desligadas sem o cliente pedir na tela.

## 2. Botões do editor de fases de hoje (vista "Etapas e fases" da Orquestração, onde aparecem "Seguindo o
padrão MotorCX" e "Personalizar esta fase")
- "Começar do playbook" sai (vira "Começar de um modelo", item 4).
- "Limpar todas as fases" hoje grava {} (padrão inteiro): passe a gravar a definição vazia do item 1 e
  troque o texto para "Desligar todos os estágios", com confirmação: "Quem não cair em outro estágio fica
  sem ação. Continuar?".

## 3. Três caminhos, lado a lado, nenhum marcado como recomendado
Aparecem (a) na Orquestração quando nenhum segmento está em uso nesta carteira (segmentos_em_uso com
em_uso = true; atenção: segmento da empresa sem vínculo escolhido vale em TODAS as carteiras, inclusive a nova)
e (b) no passo Estágios quando o segmento não tem estratégia própria nesta carteira (segmentos_em_uso.
estrategia_propria = false). Em (b), mostre antes o aviso honesto: com segmentos_em_uso.estrategia_id
preenchido, "Este segmento segue hoje a estratégia do segmento" (+ "compartilhada com …" se houver); com
estrategia_id nulo, "Sem estratégia, este segmento segue a estratégia padrão da carteira/empresa ou, sem ela,
a régua padrão do motor."
- "Criar do zero": (a) abre o formulário de segmento (prompt 83); (b) separar_estrategia(segmento, carteira,
  definição vazia) e abre o passo Estágios vazio.
- "Copiar de outra carteira": lista as carteiras da empresa que usam este segmento (ou, em (a), as que têm
  segmentos); escolher uma copia a definição INTEIRA dela (inclusive etapas, ordem_etapas e rotulos_fases)
  com separar_estrategia(segmento, carteira, definicao da origem). Texto: "Vira cópia desta carteira: mudar aqui não muda a origem."
- "Começar de um modelo (opcional)": item 4.

## 4. Modelos (opcionais)
Lista em duas seções:
- "Modelos de partida":
  · "Estágios clássicos": {"localizacao":{"ativo":true},"cpc":{"ativo":true},"giro":{"ativo":true},
    "preventivo":{"ativo":true},"quebra":{"ativo":true}} (as 5 fases ligadas, com as réguas do motor).
  · "Só digital": as mesmas 5 fases ligadas, com os passos que o editor mostra hoje para cada fase SEM as
    ações de agente_voz e discador (dia que ficar vazio sai) e cpc.ordem só com canais digitais.
- "Da sua empresa": estratégias da empresa com frente = 'motorcob' que não estão em uso por nenhum
  segmento/carteira (id fora de segmentos_em_uso.estrategia_id, segmentos_em_uso.estrategia_segmento e
  credores.estrategia_id) e com padrao = false, por nome.
Ao escolher um modelo, mostre ANTES "O que vem dentro": cada estágio ligado (nome, quem entra, canais por
dia, usando o resumo que o editor já calcula) e as etapas do modelo. Botão "Usar e editar":
separar_estrategia(segmento, carteira, definicao do modelo) e abre o passo Estágios. Toast: "Virou cópia
sua: tudo editável e desligável." Nenhum selo "MotorCX" nos estágios depois de copiados.

Aceite: em nenhum fluxo da tela a definição gravada fica {}; "Desligar todos os estágios" grava as 5 fases
com ativo false; carteira nova mostra os 3 caminhos sem recomendação; escolher um modelo mostra o conteúdo
antes de aplicar e cria uma estratégia nova (cópia) só deste segmento nesta carteira; a lista "Da sua
empresa" só traz estratégias da Cobrança sem uso. Confira em 1440 e 390 px, claro e escuro, como Admin
(edita) e Operação (só vê, sem botões de gravar).
```
