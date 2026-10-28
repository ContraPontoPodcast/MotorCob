# Prompt Horizons — 78: correções do teste de 25/10 (Relatórios nas abas, canal da Mensageria, chave, Assistente, ícones e Início)

Teste do dono depois dos prompts 75a, 76 e 75b, conferido no código publicado (bundle de 25/10). Rode depois do 75b.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Mude só o que está abaixo.

## 1. Relatórios só na lateral
Na configuração das abas por área (arquivo das abas, objeto com cobranca/jornada/mensageria/console), apague as abas
"Relatórios" que levam para /relatorios (as marcadas externo, em Cobrança › Resultados, Jornada › Resultados e
Mensageria › Resultados). Relatórios continua só como ícone na lateral e atalho no Início.
Aceite: nenhuma aba "Relatórios" dentro de Cobrança, Jornada ou Mensageria.

## 2. Mensageria: o canal aparece e troca
Na moldura da Mensageria (rotas /mensageria/*), logo acima das abas e abaixo do cabeçalho, mostre uma linha "Canal" com
uma pílula por canal contratado, na ordem SMS · RCS · WhatsApp · E-mail (nomes por extenso). Canais contratados =
empresa_modulos.canais da linha modulo = 'mensageria' com ativo = true (equipe: os da empresa da pílula).
- Pílula ativa = canal da rota (/mensageria/{c}/…), fundo escuro e texto claro; as outras em contorno.
- Clicar troca o {c} da rota e fica na mesma aba (ex.: /mensageria/sms/lotes → /mensageria/rcs/lotes); se a aba não
  existir no canal (Lotes no WhatsApp), vai para /mensageria/{c}/campanhas. Guarde o último canal usado.
- Rotas sem canal (/mensageria/atendimento, /mensageria/radar, /mensageria/config/atendimento) mostram a mesma linha;
  clicar leva para /mensageria/{c}/campanhas.
- Um canal só: mostre a pílula sozinha (sem clique), para a pessoa saber em qual está.
Aceite: em qualquer tela da Mensageria dá para ver e trocar SMS, RCS, WhatsApp e E-mail (os contratados).

## 3. Chave liga/desliga desalinhada
No componente da chave (o botão role="switch" com a bolinha branca, usado em Fornecedores, Canais, Segmentos,
Carteiras, Pessoas, Empresas, Jornada, Campanha e Atendimento): a bolinha é absolute mas não tem left, por isso foge
para fora do trilho. Acrescente left-0 na bolinha (fica "absolute left-0 top-[2px] …") e mantenha o translateX de
hoje (2px desligada, 20px ligada). Se alguma tela desenha a própria chave em vez de usar o componente, troque pelo
componente.
Aceite: em Console › Fornecedores e rotas, a bolinha fica dentro do trilho verde, à direita, em todas as linhas.

## 4. Console › Assistente › Para resolver: tratar uma pergunta só
Cada linha vem da rpc assistente_fila e NÃO tem campo id: tem ids (lista de ids das perguntas agrupadas). Hoje a tela
compara e.id (sempre vazio) e por isso "Ignorar" abre o motivo em todas as linhas e manda ids:[undefined].
- Use como chave da linha ids.join(",") (no key do React e no estado de "qual linha está com o motivo aberto").
- Ignorar: rpc resolver_perguntas_assistente({ ids: linha.ids, resolucao: 'ignorada', motivo }).
- Responder na base / base completada: { ids: linha.ids, resolucao: 'base_completada' } (não use filaId).
- Abrir o motivo de outra linha fecha o da anterior e limpa o texto.
Aceite: clicar "Ignorar" numa pergunta abre o motivo só nela; ao confirmar, só ela sai de "Novas".

## 5. Um ícone por área em TODO o site (hoje o Início ainda usa os antigos)
Crie UM mapa de ícones (lucide) e use-o em todos os lugares: lateral, atalhos do Início, cartões "Suas áreas" do
Início, gaveta do celular, busca ⌘K, abas de Relatórios e páginas "não faz parte do plano":
Início House · Cobrança CircleDollarSign · Jornada do Cliente Route · Mensageria MessagesSquare · Relatórios
FileChartColumn · Empresa Building (prédio único, não Building2) · Suporte Headset · Console ShieldCheck.
No Início, os cartões "Suas áreas" hoje usam Wallet (Cobrança), MessageSquare (Mensageria) e Compass (Jornada): troque
pelo mapa. Mantenha a cor de fundo de cada cartão.
Aceite: buscar Wallet, Compass, MessageSquare e Building2 nas telas de área não acha nenhum uso como ícone de área.

## 6. Início sem repetição (/inicio)
Ordem da tela, de cima para baixo: saudação · "Para hoje" · atalhos. Apague o cartão "Suas áreas" inteiro.
- "Para hoje" no topo, largura total (rpc para_hoje, como hoje). Sem itens: uma linha só, "✓ Tudo em dia por aqui",
  sem cartão alto vazio.
- Atalhos: um bloco só, os mesmos ícones do item 5, na ordem Cobrança · Jornada do Cliente · Mensageria · Relatórios ·
  Empresa · Suporte · Console (só equipe). Cada cartão inteiro é clicável (sem "Abrir ›").
- Os números que estavam em "Suas áreas" passam para dentro do cartão da área (rpc numeros_areas: numero + detalhe):
  Cobrança "1.138 na Lista do dia de ontem · 2 carteiras"; Mensageria "Nenhum envio ontem · SMS, RCS, WhatsApp e
  E-mail" (canais com nome por extenso, nessa ordem, separados por vírgula e "e"); Jornada "N clientes na jornada".
  Sem número: a descrição curta de hoje. Relatórios, Empresa, Suporte e Console: só nome e descrição.
- Área não contratada aparece UMA vez, no próprio atalho, esmaecida, com "Não contratada · Quero conhecer" (abre o
  card de interesse que já existe).
Aceite: no Início cada área aparece uma vez só; não existe mais o título "Suas áreas".
```

## Também do teste de 25/10 (sem prompt)
- **Contatos do site com 404:** a rota `/console/contatos-site` existe no site publicado e responde normalmente (conferido
  em 25/10). O 404 aconteceu porque o site foi republicado com a aba aberta: atualize com Ctrl+Shift+R (no Mac,
  Cmd+Shift+R). Se continuar, mande o print com o endereço.
