# Prompt Horizons — Workspace 15: Relatórios (padrões de mercado e personalizados)

> **Substituído pelos prompts 59 e 60 (SQL 39).** Não cole este se já tiver rodado o SQL 39.

Rode depois do SQL 16 (`16_relatorios.sql`). Página nova /relatorios, com atalho em cada produto da Mensageria.

```text
Crie /relatorios no Workspace (item "Relatórios" no menu; dentro da Mensageria, aba Relatórios abre a mesma página
já filtrada pelo canal). Não mude tabelas, views ou políticas. Empresa = empresa ativa. Toda consulta é
supabase.rpc('rodar_relatorio', {base, colunas, filtros, agrupar, metricas, ordem, limite}) e o banco já aplica as
permissões: se vier vazio, mostre "Sem dados no período (ou sem permissão para esta base)".
Filtros sempre levam {empresa: empresaAtiva, de: 'AAAA-MM-DD', ate: 'AAAA-MM-DD', campos: [...]}.

1. ABAS: Padrão · Personalizados · Novo relatório.

2. PADRÃO: from('relatorios_modelos').select('*').is('empresa_id', null).order('categoria').order('nome').
   Cards agrupados por categoria (Entrega, Higienização, Respostas, Links, Descadastros, Custo, Analítico) com nome
   e descrição. Ao abrir: barra de filtros (Período: Hoje, 7 dias, 30 dias, Mês atual, Mês anterior,
   Personalizado; Canal: Todos/SMS/RCS/E-mail/WhatsApp → campos [{campo:'canal', op:'igual', valor}]; Origem/
   campanha quando a base tiver 'origem') e rode com os campos do modelo (base, colunas, agrupar, metricas, ordem),
   limite 1000 na tela.
   Resultado: tabela (cabeçalhos com o rótulo de relatorio_campos, números com separador de milhar, datas no
   formato brasileiro, booleano "Sim/Não"; classes do Radar com os rótulos e cores da tela Respostas) e, quando o
   agrupamento tiver 'data' ou 'hora', um gráfico de linhas (uma linha por métrica); com outro agrupamento, barras
   horizontais da primeira métrica. Totais no rodapé para métricas somáveis.
   Botões: "Exportar CSV" (roda de novo com limite 50000; separador ;, UTF-8 com BOM) e "Salvar como
   personalizado" (copia o modelo para a empresa com outro nome).

3. PERSONALIZADOS: from('relatorios_modelos').select('*').eq('empresa_id', empresa).order('nome'). Abrir (igual
   ao padrão), Editar (abre o montador), Duplicar, Excluir (com confirmação).

4. NOVO RELATÓRIO (montador em passos, com prévia ao vivo de 200 linhas):
   a) Base: cards de from('relatorio_bases').select('*').order('ordem') (nome e descrição).
   b) Formato: "Linha a linha" (escolher colunas, arrastar para ordenar) ou "Resumo" (escolher os campos para
      agrupar — só os com agrupavel — e as métricas: Contar linhas · Contar distintos de {campo} · Somar /
      Média / Mínimo / Máximo de {campo numérico}, cada uma com um nome). Campos de
      from('relatorio_campos').select('*').eq('base', base).order('ordem').
   c) Filtros: período + linhas "campo · operador · valor" (só campos com filtravel). Operadores por tipo:
      texto (igual, diferente, contém, está em, vazio, preenchido), número e data (igual, maior, menor),
      booleano (Sim/Não). → {campo, op: 'igual'|'diferente'|'contem'|'em'|'maior'|'menor'|'vazio'|'preenchido',
      valor}.
   d) Ordem: campo ou métrica + crescente/decrescente → ordem 'campo asc|desc'.
   e) Salvar: Nome*, Descrição, Categoria (texto livre, padrão "Personalizado") → insert em relatorios_modelos
      {empresa_id, nome, descricao, categoria, base, colunas, agrupar, metricas, filtros: {campos}, ordem}
      (o período não é salvo: escolhe-se ao abrir). Erros do banco em texto.

5. Rodapé da página: "Os relatórios não mostram telefone, e-mail, nome nem CPF: só o ID do cliente e o destino
   mascarado. Textos de respostas ficam 90 dias; as classificações ficam nos relatórios."

Sem rolagem lateral em 1440, 1024 e 390px (tabelas largas rolam dentro do próprio quadro). Foco visível.
```
