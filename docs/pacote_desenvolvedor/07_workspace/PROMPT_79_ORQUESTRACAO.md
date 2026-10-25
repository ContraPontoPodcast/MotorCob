# Prompt Horizons — 79: Orquestração com as raias primeiro (e a Estratégia em subabas)

UX, 26/10/2026. Rode depois do 78. Protótipo: `orquestracao-prototipo.html`. Só organização da tela: as regras do bloco 3
(carteira no topo, aviso de estratégia compartilhada, cópia sempre independente, vistas, Salvar) continuam iguais.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Não mude consultas, rpcs, gravações, regras nem o editor das
raias por dentro. Mude só onde as coisas ficam na tela /orquestracao e as abas da Cobrança. Nada de CPF ou nome de
devedor.

## 1. Abas por grupo (abas-telas, componente que monta a fileira de abas)
1.1 Hoje a fileira junta as abas de todos os grupos (13 na Cobrança). Passe a desenhar UMA aba por grupo que tem
    rótulo: nome = rótulo do grupo, ícone = o da 1ª aba visível do grupo, ativa se qualquer aba do grupo estiver
    ativa (mesma regra de rota de hoje). Grupo sem rótulo: as abas dele aparecem como hoje. Grupo com uma aba só
    visível (depois das permissões): mostra essa aba direto, com o nome dela. Grupo sem aba visível: some.
1.2 Quando a aba de um grupo está ativa, logo abaixo da fileira aparece uma linha de subabas em pílula com as abas
    do grupo (ativa: fundo var(--destaque-suave), borda var(--destaque); as outras em contorno; rolam na horizontal
    no celular). As permissões e as rotas de cada subaba são as de hoje.
1.3 Vale para todas as áreas que usam esse componente (Cobrança, Jornada, Mensageria, Console).
Aceite (com o 78 aplicado): a Cobrança mostra Lista do dia · Clientes · Ações · Cargas · Estratégia · Painel (Painel
só com ver_painel); em /personas a aba
Estratégia fica marcada e a subaba Personas também; nenhuma rota mudou.

## 2. Barra da Orquestração (substitui o cabeçalho, o cartão CARTEIRA, a caixa azul de explicação e a barra das vistas)
2.1 Tire da tela /orquestracao: o cabeçalho grande (rótulo, título, subtítulo e a frase "Desenhe o que mandar…"),
    "Buscar cliente" e o seletor de carteira do cabeçalho, os botões "Reenquadrar agora" e "Ver todas as carteiras"
    soltos, o cartão "CARTEIRA" com pílulas, a caixa "Cada cliente da carga cai num segmento…" e a barra das vistas
    de hoje (eles vão para os lugares abaixo; nenhuma função some).
2.2 No lugar, UMA barra com duas linhas, fundo do cartão, borda embaixo; ≥ 1024 px: sticky com top 44 px (logo abaixo
    da faixa de contexto, que é h-11 z-30) e z-20. Sem carteira escolhida: só a linha 1 e o cartão "Escolha a carteira".
    Linha 1: título "Orquestração" (20 px, peso 650) · botão "?" (popover com o texto da caixa de explicação e "Tudo
    abaixo é desta carteira: segmentos, estratégia, etapas e travas.") · seletor "Carteira ▾" (as carteiras ativas,
    chama selectCredor, o mesmo de hoje; é o ÚNICO lugar onde se escolhe a carteira nesta tela) · à direita, o estado
    ("Tudo salvo" verde / "Alterações não salvas" âmbar) e o botão "Salvar" (o de hoje, com fundo var(--destaque), a
    mesma condição de aparecer e a mesma confirmação quando a estratégia vale em outra carteira). O "Salvar" flutuante
    (fixed, canto inferior direito) sai em ≥ 1024 px e fica só em < 1024 px.
    Linha 2: os segmentos em uso como pílulas (código, nome e nº de clientes, como hoje; selo "própria" como hoje;
    a escolhida com fundo var(--base-texto), texto var(--base-cartao) e, só nela, bolinha âmbar se a estratégia é
    compartilhada; "Demais clientes" no fim), os pausados desta carteira num menu "Pausados (n) ▾" (mesmos itens e
    clique de hoje; com um pausado escolhido, o botão mostra o nome dele), e "+ Novo" (abre o formulário de segmento de hoje) · botão
    "Detalhes do segmento" (abre o item 3) · à direita, as vistas em controle segmentado (Desenho da esteira · Etapas
    e fases · Travas · Visão geral) e o botão "⋯".
2.3 Menu "⋯" (popover em portal, z-[70]): Copiar de outra carteira · Começar do padrão MotorCX · Montar esteira
    pelas personas · (linha) · Ver segmentos em todas as carteiras (abre a janela de hoje do "Ver todas as
    carteiras") · Reenquadrar agora · Imprimir / PDF. O componente de reenquadrar de hoje continua MONTADO na barra
    (linha 1, compacto): ele mostra o andamento ("Na fila…", "Reenquadrando…") e é o que o aviso depois do Salvar
    chama; o item do "⋯" chama o mesmo pedir() dele. Nunca o desmonte ao fechar o menu.
2.4 < 1024 px: a barra não é sticky; as linhas quebram; as vistas viram um select; as pílulas rolam na horizontal.
Aceite: a carteira aparece uma vez só na tela; todas as ações de hoje continuam a um clique (Salvar) ou dois (no
"⋯" ou na gaveta); não sobra texto de explicação fixo.

## 3. Gaveta "Detalhes do segmento" (painel lateral à direita, 440 px; no celular, tela cheia)
Mova para ela, sem mudar a lógica, o cartão do segmento que hoje fica acima das raias. A gaveta é desenhada dentro do
mesmo componente da tela /orquestracao (mesmo estado e mesmas funções); não é rota nem componente separado:
- topo: nome do segmento + selo "Própria desta carteira" (verde) ou "Compartilhada" (âmbar) + fechar (×, Esc);
- "Quem entra" (as condições de hoje) + "Editar condições" (o formulário de hoje);
- "Carteiras que usam este segmento" (as caixas e as chaves "Em uso" de hoje) e "Ligado em todas" com a frase
  "Desliga o segmento para todas as carteiras";
- rodapé: "Tirar da carteira" (texto vermelho, com a confirmação de hoje) e "Fechar".
Aceite: com a gaveta fechada, nada do cartão do segmento aparece acima das raias.

## 4. Aviso de estratégia compartilhada (regra do bloco 3, fica)
Mesmo texto e mesmos botões ("Separar só para esta carteira" · "Editar para as duas"), numa faixa âmbar de uma linha
entre a barra e as raias, só quando a estratégia é compartilhada.

## 5. Raias logo abaixo
5.1 O editor (Desenho da esteira) começa logo depois da barra (ou do aviso), sem cartões entre eles.
5.2 A coluna da esquerda das raias já fica fixa ao rolar para o lado (sticky left-0): mantenha. A faixa interna do
    editor que hoje gruda em top-0 (Canais, Expandir tudo…) passa a grudar logo abaixo da barra da Orquestração
    (≥ 1024 px: top = 44 px + altura da barra; < 1024 px: top 44 px). O resto do editor não muda.
5.3 Cores: só os BOTÕES com fundo #0F4C5C desta tela passam a contorno neutro (borda var(--base-borda), texto
    var(--base-texto)); o "Salvar" fica em var(--destaque). Bordas e textos #0F4C5C de marcação do editor (célula,
    raia, persona ativa) não mudam.

## 6. Permissões (as de hoje)
Quem não edita a Orquestração (padrão: Operação e Gestão) vê a barra sem "Salvar", "+ Novo" e os itens de edição do
"⋯" (Copiar, Começar do padrão, Montar pelas personas, Ver em todas as carteiras), sem a faixa de "Separar / Editar
para as duas" e com a gaveta em leitura (sem "Editar condições", chaves "Em uso", "Ligado em todas" e "Tirar da
carteira"). Use a mesma condição que a tela usa hoje para cada um; não crie regra nova.
Aceite: em 1440 × 900, com carteira e segmento escolhidos, a primeira linha das raias aparece sem rolar a página;
em 390 px, a grade rola para o lado com a coluna da esquerda fixa.

Confira em 1440 e 390 px, claro e escuro, como Admin, Planejamento e Operação (leitura): trocar de carteira, trocar de segmento, abrir
e fechar os detalhes, editar uma célula, Salvar, Copiar de outra carteira, Separar só para esta carteira.
```
