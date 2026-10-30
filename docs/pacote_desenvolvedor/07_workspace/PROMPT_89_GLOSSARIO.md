# Prompt Horizons — 89: "O que significa" (glossário) e o (i) que leva ao termo

UX, 30/10/2026. RODE DEPOIS DO SQL 50 (PR 127, branch claude/glossario-propensao,
20261217000001_glossario_propensao.sql), que traz o grupo "Persona e propensão". Refaz para o site de hoje os
itens 1 e 2 do prompt 43, que não entraram. Protótipo aprovado: docs/homologacao/bloco5-repaginada-prototipo.html
(aba Glossário). Conferido no bundle (manifest-776e2ed6): não há rota /ajuda/o-que-significa; nada lê a tabela
glossario nem o rpc buscar_glossario; o "?" da barra do topo (app-shell e workspace-shell, só em lg) vai para
/docs; o menu do usuário tem "Minha conta" e "Documentação"; existe o InfoButton (info-button, dicionário local
da Mensageria) e o FaixaBadge/texto da Propensão (faixa-badge, propensao).

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Leia a tabela glossario (slug, grupo, termo, definicao,
exemplo, antes, ordem) e o rpc buscar_glossario(texto). Gravar só pela edição do item 3, que a RLS já limita a
admin da equipe (admin_equipe()). Nada de CPF ou nome de devedor.

## 1. Página /ajuda/o-que-significa (no layout do workspace, como /docs)
- Título "O que significa"; subtítulo "Um nome para cada coisa. Procure pelo nome de hoje ou por um nome
  antigo."
- Busca "Buscar um termo ou um nome antigo" → rpc buscar_glossario(texto) (300 ms de espera ao digitar).
  Texto vazio = todos (o rpc já devolve tudo, ordenado por ordem).
- Filtros em pílulas: "Todos" + um por grupo, LIDOS DOS DADOS (grupos distintos, na ordem do menor "ordem"
  de cada grupo). Nada fixo no código: o grupo "Persona e propensão" do SQL 50 aparece sozinho.
- Cada termo é um cartão com id = slug (âncora): termo em negrito, etiqueta do grupo, definição, exemplo em
  var(--base-texto-2) (se houver) e "Antes: <nomes antigos riscados>" (se houver). "antes" é texto simples
  separado por ", ": divida só por ", ", nunca por "·" (ex.: "3C, Contato · Canal · Mensagem" = 2 nomes).
  Com #slug na URL, role até o cartão e destaque-o (borda var(--destaque)) por 2 s.
- Vazio: "Nenhum termo encontrado. Tente outra palavra ou fale com o suporte." (link para /suporte/novo).
- 390 px: pílulas rolam na horizontal; cartões na largura toda.

## 2. Como chegar
- "?" da barra do topo (app-shell e workspace-shell): passa a abrir /ajuda/o-que-significa; aria-label muda
  de "Ajuda" para "O que significa".
- abas-telas tem dois menus com "Documentação": o menu suspenso do usuário e a gaveta do celular. Nos dois,
  acrescente "O que significa" logo acima de "Documentação" (que continua indo para /docs).

## 3. Edição (no próprio cartão da /ajuda)
Só para admin da equipe (equipe com papel admin; a RLS do glossario usa admin_equipe()). Botão "Editar" no
cartão: termo (até 80), grupo (lista dos grupos existentes ou novo), definição (até 600), exemplo, antes,
ordem; Salvar faz update em glossario pelo slug (o slug não muda). "Novo termo" no topo: slug no formato
a-z0-9 com hífens. Termo e slug são únicos: no erro 23505, "Já existe um termo com esse nome ou endereço."
Erro de RLS: "Só o admin da equipe edita o glossário."

## 4. Componente Info(slug) — o (i) que leva ao termo
- Use o visual do InfoButton de hoje (círculo 18 px com "i", balão ao clicar ou focar). Conteúdo: termo e
  definição do glossario (cortada em 140 caracteres, com "…") e o link "Ver no glossário" →
  /ajuda/o-que-significa#slug. Carregue o glossario uma vez por sessão (cache no contexto) e não mostre o
  (i) se o slug não existir.
- O InfoButton da Mensageria (info-button) mantém o texto dele e acrescenta "Ver no glossário", com o slug
  mapeado DENTRO do componente pela chave que ele já usa: fallback → fallback; bounce_permanente e
  bounce_temporario → bounce; score_entrega → score-de-entrega; disparados_*, enviados e entregues_* →
  disparado-enviado-e-entregue; entregues_sms também ganha um 2º link "DLR" → dlr-delivery-report. Chave sem
  mapa: sem link.

## 5. Onde pôr o (i) (só em telas que existem hoje)
- Orquestração: título "Estágios de …" → estagio-de-cobranca; Travas → travas; aba "Orçamento e prioridade"
  (id 'orcamento') → orcamento-do-canal; legenda dos conectores → junto-senao-e-reserva; seletor de
  segmento → segmento.
- Personas: "Abordagem" → abordagem; selos Coletando / Prévia / Definida → evidencia; títulos "Prefere
  digital" e "Prefere analógico" (Modelos) → prefere-digital-e-prefere-analogico.
- Propensão: o popover "?" que já existe é UM componente compartilhado (faixa-badge, export n; hoje recebe
  só {className}), usado ao lado de "Matriz de propensão" (Personas) e de "Com ação hoje, por propensão"
  (Lista do dia). NÃO ganha 2º ícone: dentro dele entram os links "Ver no glossário" →
  propensao-a-pagamento e, junto de "acordo é promessa", → pagamento-e-promessa. Acrescente a prop opcional
  matriz (padrão false) que liga o link "O que é a Matriz" → matriz-propensao-abordagem; passe matriz só
  em Personas.
  Onde não há esse popover, o (i) propensao-a-pagamento entra: cabeçalho da coluna Propensão em Clientes e
  condição "Propensão a pagamento (fato)" no estágio (Orquestração).
- Lista do dia: título → lista-do-dia. Mensageria: Simulação → simulacao-e-envio-real. Console › Margem: %MC
  → mc-e-mc-margem-de-contribuicao. Empresa › Auditoria: título → auditoria.
Os modos de ajuda pelo tempo de casa (item 3 do prompt 43) ficam fora: o (i) aparece sempre.

Aceite: /ajuda/o-que-significa lista os termos do banco com as pílulas tiradas dos dados (inclui "Persona e
propensão" depois do SQL 50); buscar "3C", "Momento" ou "Score de pagamento" acha o termo novo pelo "antes";
/ajuda/o-que-significa#propensao-a-pagamento rola até o cartão; o "?" e o menu levam à página; cada (i) do item
5 mostra a definição e "Ver no glossário"; só o admin da equipe vê "Editar". 1440 e 390 px, claro e escuro.
```
