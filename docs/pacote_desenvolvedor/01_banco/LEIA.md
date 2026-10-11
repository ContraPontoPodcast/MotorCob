# Passo 2 — SQL (Supabase › SQL Editor › New query › cole o arquivo inteiro › Run)

Rode os dois, nesta ordem. Os dois podem ser rodados mais de uma vez. Resultado esperado: "Success. No rows returned".

1. `01_site_comercial.sql` — bucket público **`site`** (só leitura pública) e tabela **`contatos_site`** do formulário:
   - o visitante só **insere**, nas colunas `nome, empresa, email, telefone, mensagem, consentimento, origem`;
   - `consentimento` precisa ser `true`; limite de 3 envios por e-mail por hora e 200 por hora no total;
   - só a equipe MotorCob lê.
   Uso no site: `supabase.from('contatos_site').insert({...})` **sem `.select()`**.
2. `02_motivo_categoria.sql` — Lista do dia agrupada. A rotina passa a gravar o grupo de cada cliente e a view
   **`motivos_hoje`** ganha as colunas `categoria` (`com_acao` · `regra_esteira` · `sem_contato` · `encerrado`) e
   `titulo` (texto curto, sem o "sem ação: "). Colunas: `empresa_id, credor_id, motivo, categoria, titulo, clientes`.
   Antes da próxima rotina rodar, `categoria` pode vir vazia (o site trata como `regra_esteira`, exceto o texto
   "com ação hoje", que já vem `com_acao`).

Atenção ao copiar: copie do arquivo aberto num editor de texto. A prévia do chat corta o texto em 100 linhas.
3. `03_templates_canais.sql` — WhatsApp e RCS passam a usar **template**: a tabela `frases` ganha a coluna
   `codigo_template` (nome do template aprovado no provedor, até 200 caracteres). Rode antes do prompt de templates.
4. `04_workspace.sql` (mesmo conteúdo de `supabase/migrations/20261101000001_workspace.sql`) — Workspace fase 1:
   cadastro da empresa (razão social, CNPJ validado, inscrições, endereço, segmento, vendedor, gerente, situação),
   **`empresa_contatos`**, **`empresa_modulos`** (produtos habilitados; toda empresa nova já nasce com Orquestração),
   perfil com sobrenome, telefone, setor e foto (`atualizar_meu_perfil`), buckets privados **`fotos`** (2 MB) e
   **`chamados`** (10 MB), **`chamados`** e **`chamado_mensagens`** com protocolo `MC-AAAA-000000`, nota interna só
   para a equipe, reabertura quando o cliente responde e `resolver_chamado(id)`, e **`credores.entrada_carga`**
   (`arquivo` ou `api`, padrão `arquivo`). Pode rodar mais de uma vez. Não muda nada que já está no ar.
5. `05_faturamento.sql` (mesmo conteúdo de `supabase/migrations/20261102000001_faturamento.sql`) — faturamento:
   - **`planos_empresa`**: o modelo da Orquestração de cada empresa, definido na negociação: `por_contrato` (preço por
     contrato distinto no mês, com mínimo mensal opcional) ou `mensalidade` (valor fixo). Só a equipe grava.
   - **`tarifas_mensageria`**: preço por mensagem de cada tipo (SMS, e-mail, RCS Basic/Single/Conversacional,
     WhatsApp). A mensageria é sempre por consumo.
   - **`contratos_mes`** (a rotina grava) e **`consumo_mensageria`**: medição do mês; view **`consumo_mes`** junta tudo.
   - **`previa_fatura(empresa, competencia)`**: a conta do mês item a item; **`fechar_fatura(...)`** congela em
     **`faturas`** e **`fatura_itens`** (só o Admin da equipe). Boleto e nota ficam na ferramenta de cobrança.
   - **`mensageria_fornecedores`** (Ótima, Zenvia, Infobip, Sinch) e **`mensageria_rotas`** (principal e reserva).
     Credencial de fornecedor NUNCA no banco: só o nome do segredo.
   - Permissão nova **`ver_faturamento`** (padrão: Admin e Gestão). Pode rodar mais de uma vez.
6. `06_fornecedor_email.sql` (mesmo conteúdo de `supabase/migrations/20261103000001_fornecedor_email.sql`) —
   cadastra a **Locaweb** como fornecedor de e-mail e cria a rota padrão de e-mail por ela. Rode depois do SQL 5.
