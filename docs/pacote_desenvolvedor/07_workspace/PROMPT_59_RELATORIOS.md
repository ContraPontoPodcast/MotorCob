# Prompt Horizons — 59: Relatórios por pergunta, montador em 3 passos, exportação e envio por e-mail (substitui o prompt 15)

Rode depois do SQL 39, da função `relatorios` e do prompt 49 (sino, ProcessoLongo, PainelEdicao). Protótipo
aprovado em 15/10/2026: `docs/homologacao/relatorios-prototipo.html`.

```text
Plataforma do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas. Empresa = empresa
ativa. Toda consulta: rpc rodar_relatorio(base, colunas, filtros, agrupar, metricas, ordem, limite); filtros =
{empresa, de, ate, campos:[{campo, op, valor}]}. Erro da rpc aparece em texto, como veio.

## 1. Navegação
"Relatórios" vira item do menu principal (sai de dentro da Mensageria; a antiga aba da Mensageria leva a
/relatorios?produto=mensageria). Abas por produto: Mensageria · Orquestração (MotorCob) · Jornada (MotorCli), só as
contratadas (empresa_modulos ativo) e só bases com relatorio_bases.visivel.

## 2. Lista (/relatorios)
- Prontos: relatorios_modelos com empresa_id nulo e a base do produto da aba (relatorio_bases.produto), em cartões
  agrupados por categoria; nome em forma de pergunta + descrição; destaque = "Mais usado". requer = 'score' sem o
  Score contratado (empresa_score.ativo): cadeado e "Disponível com o Score de Entrega" (vitrine aprovada).
- Busca no topo pelo nome e pela descrição. Botão "Montar relatório".
- "Da empresa": relatorios_modelos da empresa (o banco já esconde os "Só para mim" dos outros). Abas Todos · Meus.
  Colunas Nome · Sobre (nome da base + separações) · Criado por (nome; "Você") · Envio por e-mail (relatorio_envios:
  "Toda segunda, 8h", "Dia 1, 8h", "Todo dia, 8h" ou "Não"). Ações: Abrir; Editar e Apagar só para quem criou e o
  Admin (os outros veem "Duplicar"). Apagar pede confirmação ("O envio por e-mail também para.").
- Rodapé: "Os relatórios não mostram telefone, e-mail, nome nem CPF: só o ID do cliente e o destino mascarado."

## 3. Relatório aberto
- Filtros: Período (Hoje · Últimos 7 dias · Últimos 30 dias · Este mês · Mês passado · Escolher datas; padrão 7 dias).
  Base com foto_do_dia: sem período, texto "Como está hoje". "Comparar com": "{N} dias anteriores" (mesmo tamanho,
  logo antes) · "Não comparar". Filtros em botões por campo filtrável (Canal, Campanha, Produto…): os valores vêm de
  rodar_relatorio(base, null, filtros, array[campo], '[{"funcao":"contar","nome":"n"}]', 'n desc', 200), com busca.
  Nunca mostre campanha_id: campanha é "origem".
- Números do topo: rodar_relatorio sem agrupar com as métricas do relatório (1 linha = total do período), de novo
  no período anterior. Até 5 cartões: valor grande; abaixo "{variação} que o período anterior". Taxa (funcao 'taxa'):
  variação em pontos ("+1,6 ponto"); o resto em % ("+12%"). Verde quando a variação é boa pelo "sentido" da métrica
  (maior_melhor / menor_melhor), vermelho quando ruim, cinza sem sentido. Botão "i" mostra a conta
  ("Taxa de entrega = entregues ÷ enviadas").
- Relatório da base funil com Canal = só E-mail: os números do topo trocam para E-mails enviados, Entregues, Bounce
  permanente e Bounce temporário (cada um com a taxa sobre os enviados) e Taxa de abertura (sobre os entregues), com a
  nota "Bounce permanente: endereço não existe ou foi recusado de vez; temporário: caixa cheia ou servidor fora do ar."
- Gráfico: separação por data, semana ou mês → linha da primeira quantidade e, comparando, linha tracejada do
  período anterior (posição a posição). Outra separação → barras horizontais da primeira métrica.
- Tabela: rótulos de relatorio_campos e de metricas[].rotulo; milhar com ponto, taxa com 1 casa e %, R$ com 2
  casas, datas dd/mm/aaaa, booleano Sim/Não. Clique no título ordena (rode de novo com ordem). Rodapé "Total do
  período" = a linha sem agrupar (taxa recalculada). Até 1.000 linhas na tela.
- Sem linhas: "Nada no período. Tente outro período ou tire um filtro." + botão "Últimos 30 dias".
- Botões: Exportar · Enviar por e-mail · Ajustar (abre o montador com o relatório) · Salvar (prontos: "Salvar como
  meu relatório").

## 4. Exportar (painel)
Formato Excel (.xlsx) ou CSV. rpc contar_relatorio(base, colunas, filtros, agrupar, metricas): até 50.000 linhas →
rodar_relatorio com limite 50000 e o arquivo sai no navegador (CSV com ; e UTF-8 com BOM). Acima → rpc
pedir_exportacao(nome, base, colunas, filtros, agrupar, metricas, ordem, formato) → ProcessoLongo lendo
relatorio_exportacoes (linhas_feitas de linhas_total) + "Pode sair desta tela. Quando terminar, o aviso chega no
sino." Acima de 1 milhão o banco recusa com a frase pronta. /relatorios?exportacao={id} abre "Meus arquivos"
(relatorio_exportacoes: nome, linhas, situação, Baixar pelo link até expira_em; expirada: "Vencido em {data}").

## 5. Enviar por e-mail (PainelEdicao)
Só para relatório salvo (pronto: "Salve o relatório para agendar"). Quando: Todo dia · Toda semana (dia) · Todo mês
(dia 1 a 28) + Hora (6h a 20h). Período do e-mail: ontem, a semana passada (segunda a domingo) ou o mês passado.
Para: usuários ativos da empresa (perfis, sem a equipe), até 20; "Só para mim" só envia para quem criou. Prévia do
e-mail: assunto "{nome} · {período}", os números do topo com a variação e "Abrir o relatório na plataforma".
Nota: "O e-mail leva só os números do topo e o link; o arquivo não vai anexado. Quem sai da empresa deixa de
receber." Salvar → rpc salvar_envio_relatorio(modelo, frequencia, destinatarios, dia_semana, dia_mes, hora) →
"Próximo envio: {data e hora}". "Parar envio" → apagar_envio_relatorio(modelo). Último erro (ultimo_erro) aparece
em âmbar na lista.

Confira em 1440 e 390 px, claro e escuro.
```
