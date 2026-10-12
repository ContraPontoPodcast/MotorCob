# Prompt Horizons — Workspace 29: correção da tela Contratação ("Ops! Ocorreu um erro inesperado")

Conferido no site publicado (arquivo `contratacao-empresa`): a tela quebra ao abrir porque chama `useNavigate()`
sem importar. Depois disso viriam outros quatro erros: os itens de preço usam `id` (a tabela `cobranca_itens`
não tem `id`, a chave é `codigo`), o WhatsApp usa um item que não existe, o `ciclo_atual` volta como lista e o
número "0.35" vira 35. O banco está certo (SQL 18 e 19 conferidos); só a tela muda.

```text
CORREÇÃO da tela Contratação (componente ContratacaoEmpresa, arquivo contratacao-empresa). Não mude tabelas,
políticas nem o visual; só estes pontos:

1. QUEBRA AO ABRIR: há uma chamada solta `useNavigate();` sem import. Apague essa linha (o componente não
   navega). Confira que todo hook e ícone usado está importado.

2. ITENS DE PREÇO PELA CHAVE CERTA: cobranca_itens NÃO tem coluna id; a chave é `codigo`. Troque em todo o
   componente `String(t.id)` / `item.id` por `codigo`: na lista de itens visíveis, no estado de edição (chave
   do objeto de preços), na busca do preço vigente (precos_empresa.item === codigo), no item aberto, no rótulo
   da unidade e no `item` enviado ao rpc('salvar_preco'). A consulta continua
   from('cobranca_itens').select('*').is('preco_de', null).eq('ativo', true).order('ordem').

3. WHATSAPP: não existe item "whatsapp". Com o canal WhatsApp ligado, mostre os três itens:
   whatsapp_marketing, whatsapp_utilidade e whatsapp_servico (unidade "conversa"). Use a ordem e o nome que vêm
   de cobranca_itens (campo nome) em vez de nomes fixos.

4. NÚMEROS: a função que lê preço apaga o primeiro ponto ("0.35" vira 35). Use esta regra: tire espaços; se
   tiver vírgula, apague os pontos e troque a vírgula por ponto ("1.234,56" → 1234.56, "0,35" → 0.35); se não
   tiver vírgula, use como está ("0.35" → 0.35). Vazio ou inválido = 0. Preço aceita até 5 casas decimais.

5. CICLO ATUAL: rpc('ciclo_atual') devolve uma LISTA com uma linha {competencia, inicio, fim, fecha_em,
   vence_em}. Use data?.[0] e leia inicio/fim (não uso_inicio/uso_fim). No cálculo local (empresa nova), siga a
   mesma regra do banco: corte 1 = do dia 1 ao último dia do mês; corte N>1 = do dia N do mês até o dia N-1 do
   mês seguinte; a COMPETÊNCIA é o mês em que o ciclo TERMINA; "Fatura fecha" = dia seguinte ao fim; "Vence" =
   o primeiro dia de vencimento depois do fim.

6. ERROS SEM DERRUBAR A TELA: envolva o carregamento e o salvar em try/catch; qualquer erro do Supabase aparece
   na faixa vermelha da própria tela com error.message (ex.: "Falha ao salvar o preço do SMS: ..."), sem
   "Ops! Ocorreu um erro inesperado.". Listas vazias ou nulas viram [] e valores padrão (corte 1, vencimento 10).

Confira: Console › Empresas › Nova empresa abre; marque MotorCob + MotorCli, Mensageria com SMS e WhatsApp,
SMS escalonado em 2 faixas (0,075 e 0,068), Orquestração flat 0,35 com mínimo 1000, Jornada flat 0,50, os três
WhatsApp flat, corte 21 e vencimento 5; crie a empresa; abra a aba Contratação dela e veja os mesmos valores.
```
