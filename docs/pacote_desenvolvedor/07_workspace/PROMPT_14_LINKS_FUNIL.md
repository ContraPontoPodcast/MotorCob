# Prompt Horizons — Workspace 14: links rastreados e funil de cliques

Rode depois do SQL 15 e da função `l` publicada (ver `08_api/LEIA_ENCURTADOR.md`). Acrescenta ao Painel de cada
produto e ao detalhe da campanha.

```text
Acréscimos no Painel (/mensageria/{canal}) e no detalhe da campanha. Não mude tabelas, views ou políticas.

1. FUNIL DE ENGAJAMENTO (abaixo do funil de entrega): from('mensageria_funil_links').select('*')
   .eq('empresa_id', empresa).eq('canal', canal).gte('data', ini).lte('data', fim) (no detalhe da campanha,
   .eq('campanha_id', id)). Some as linhas do período. Etapas em barras horizontais da cor do canal, com o número
   e o % sobre a etapa anterior: Enviados · Entregues · Clicaram (pessoas, sem robôs) · Responderam · CPC Negócio.
   Ao lado: "Cliques no total {cliques}" e "Links gerados {links}". Sem links no período: "Ligue “Rastrear links”
   no template ou na campanha para medir os cliques."

2. TABELA POR ORIGEM (Lista do dia e cada campanha): Origem · Enviados · Entregues · Clicaram · CTR (clicaram ÷
   entregues) · Responderam · CPC Negócio · Conversão (CPC Negócio ÷ entregues). Ordenável. Exportar CSV.

3. CLIQUES POR HORA E POR APARELHO (no detalhe da campanha): from('mensageria_cliques').select('clicado_em,
   dispositivo, mensageria_links!inner(campanha_id)').eq('mensageria_links.campanha_id', id). Gráfico de barras
   por hora do dia (0–23, hora de São Paulo) e rosca por dispositivo: celular "Celular", computador "Computador",
   outro "Outro". Robôs (prévias de link do WhatsApp e antivírus) aparecem só como texto: "{n} aberturas
   automáticas ignoradas".

4. QUEM CLICOU (detalhe da campanha, com enviar_mensagens): tabela de from('mensageria_links').select('id_cliente,
   codigo, mensageria_cliques(clicado_em, dispositivo)').eq('campanha_id', id), só links com clique de pessoa:
   ID do cliente · Primeiro clique · Cliques · Aparelho. Exportar CSV (só ID do cliente, nunca contato).

5. NO TEMPLATE E NA CAMPANHA: perto do interruptor "Rastrear links", mostre o exemplo do endereço curto:
   "https://{domínio do MotorCob}/Ab12Cd34" e o aviso "No SMS o link curto ocupa cerca de 30 caracteres dos 160."

Sem rolagem lateral em 1440, 1024 e 390px.
```
