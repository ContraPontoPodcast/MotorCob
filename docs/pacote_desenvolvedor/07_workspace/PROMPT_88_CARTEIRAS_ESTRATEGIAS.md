# Prompt Horizons — 88: Carteiras com a estratégia padrão, estratégias da empresa e "Prefere digital"

UX, 30/10/2026; revisado pelo CX. Rode depois do 87 e só depois do merge do PR do motor que separa o padrão por frente. Conferido no bundle publicado (manifest-145e4614) e no main (9401c8c):
/credores já tem a coluna e o seletor "Estratégia padrão" (credores.estrategia_id), mas o seletor lista as
estratégias de todas as frentes; /estrategias já redireciona; não há tela para renomear, excluir ou trocar
o padrão da empresa. RLS: estrategias insert/update/delete = pode('editar_orquestracao') (admin e
planejamento); credores = pode('editar_credores'). Padrão: um por empresa e frente (índice
estrategias_uma_padrao_frente); o da Cobrança é o motorcob com padrao = true.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Leia e grave só em credores.estrategia_id e em
estrategias (nome, padrao, delete), com as permissões de hoje. Nunca mostre, renomeie, exclua nem marque
como padrão uma estratégia com frente = 'motorcli' (são da Jornada). Nada de CPF ou nome de devedor.

## 1. Modelos de persona: "Prefere digital" / "Prefere analógico" (só texto)
Em /personas (seção "Modelos MotorCX") e onde mais aparecer: título "Propensão ao DIGITAL" → "Prefere
digital"; "Propensão ao ANALÓGICO" → "Prefere analógico"; botões "Usar todos os digitais" e "Usar todos os
analógicos" ficam. O campo personas_modelo.propensao ('digital'/'analogico') e os filtros não mudam. A palavra
"Propensão" na tela fica só para a Propensão a pagamento.

## 2. Estratégia padrão da carteira (Configurações › Carteiras)
- /credores (formulário de criar/editar carteira) e /credores/:codigo/configuracoes (cartão do topo, perto
  do nome): campo "Estratégia padrão da carteira" (credores.estrategia_id). Opções: "Padrão da empresa"
  (grava null) + as estratégias da empresa com a mesma frente da carteira (credores.frente; na Cobrança,
  frente = 'motorcob'), por nome. Corrija o seletor de hoje, que lista todas as frentes.
- Texto de uma linha, no lugar de "Usada no item “Demais clientes” da Orquestração desta carteira.": "Vale
  para os segmentos desta carteira sem estratégia própria e para Demais clientes. Sem ela, vale o padrão da
  empresa."
- Na coluna "Estratégia padrão" da lista: nome da estratégia ou "Padrão da empresa (<nome>)".
- Grava com update em credores (como hoje). Só quem tem editar_credores altera; os outros veem o texto.

## 3. Bloco "Estratégias e modelos da empresa" (em /credores, abaixo da lista de carteiras)
Só para quem tem editar_orquestracao (os outros não veem o bloco). Lista as estratégias da empresa com
frente = 'motorcob', por nome, com:
- Nome · selo "Padrão da empresa" se padrao = true.
- "Onde é usada", uma linha por lugar: "carteira <nome> · segmento <nome>" para cada
  segmentos_carteira.estrategia_id = id; "segmento <nome> (todas as carteiras sem estratégia própria)" para
  cada clusters.estrategia_id = id; "padrão da carteira <nome>" para cada credores.estrategia_id = id.
  Sem uso: "Sem uso (aparece como modelo da empresa na Orquestração)".
- "Em uso em N lugares": N = número dessas linhas + 1 se for o padrão da empresa (não use
  segmentos_em_uso para contar: ela repete as mesmas linhas).
Ações por linha:
- "Renomear": campo inline, até 80 caracteres, nome único na empresa (constraint unique empresa_id + nome;
  no erro, "Já existe uma estratégia com esse nome."). Update só do nome. Dica abaixo do campo: "Clientes e
  Mapa mostram o nome novo a partir da próxima lista."
- "Excluir": só sem uso (N = 0). Com uso, botão desabilitado com a dica "Em uso em N lugares: troque nesses
  lugares antes." Confirmação: "Excluir a estratégia <nome>? Ela não está em uso. Isto não pode ser
  desfeito." Antes de apagar, refaça as três consultas de uso; se alguma voltar linha, não apaga e avisa
  "Ela passou a ser usada; atualize a lista." (o banco não impede: apagar esvazia esses lugares sem aviso).
- "Tornar padrão da empresa" (nas que não são o padrão): ver item 4.
- Link "Abrir na Orquestração" em cada linha de carteira + segmento, no formato que /credores já usa:
  /orquestracao?carteira=<credor_id>&segmento=<cluster_id>&passo=estagios.

## 4. Padrão da empresa (Cobrança)
- No topo do bloco: "Padrão da empresa na Cobrança: <nome>" ou "Nenhuma (segmento sem estratégia segue o
  playbook do motor)".
- Trocar só entre as estratégias com frente = 'motorcob'. Confirmação: "A nova padrão passa a valer para os
  segmentos sem estratégia própria nas carteiras sem estratégia padrão. Vale a partir da próxima lista."
- Gravação em duas etapas, nesta ordem, por causa do índice de um padrão por empresa e frente: (1) update
  padrao = false na padrão atual da Cobrança; (2) update padrao = true na escolhida. Se (2) falhar, volte a
  (1). Nunca toque no padrão da Jornada (frente = 'motorcli').
- Excluir a padrão é sempre desabilitado (conta como uso).

## 5. Frases
Sem mudança: a subaba Frases continua como atalho para a parte de frases de /canais.

Aceite: os modelos de persona mostram "Prefere digital" e "Prefere analógico" e a palavra "Propensão" só
aparece na Propensão a pagamento; o seletor da carteira só traz estratégias da mesma frente e grava
credores.estrategia_id (null = padrão da empresa); o bloco lista só estratégias da Cobrança, com onde são
usadas; renomear respeita nome único; excluir só funciona sem uso e pede confirmação; trocar o padrão deixa
exatamente uma padrão na Cobrança e não mexe na Jornada; Operação não vê ações de gravar. Confira em 1440 e
390 px, claro e escuro, como Admin, Planejamento e Operação.
```
