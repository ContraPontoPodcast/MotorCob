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
7. `07_mensageria_envios.sql` (mesmo conteúdo de `supabase/migrations/20261104000001_mensageria_envios.sql`) —
   Mensageria: lotes do dia por canal (SMS e e-mail), mensagens SEM contato e sem texto (só ID do cliente, destino
   mascarado e hash), descadastros por hash, modelo de e-mail, aprovação de lote (`mudar_lote`), modo **simulado**
   (padrão: não fala com fornecedor e não cobra) e a permissão nova **`enviar_mensagens`** (Admin e Planejamento).
   Pode rodar mais de uma vez.
8. `08_api_tokens.sql` — tokens da API (ver pasta 08_api).
9. `09_faturas_revisao.sql` (mesmo conteúdo de `supabase/migrations/20261106000001_faturas_revisao.sql`) — a
   fatura nasce em **rascunho** (o cliente não vê), a equipe lança **ajustes** (desconto, crédito, cobrança extra,
   com motivo) e **emite**; `gerar_rascunhos(competencia)` faz o mês inteiro; a view **`faturas_painel`** mostra
   "vencida" sozinha. Pode rodar mais de uma vez.
10. `10_equipe_master.sql` (= `supabase/migrations/20261107000001_equipe_master.sql`) — Equipe MotorCob: **Master**
    (Console inteiro) e **Atendimento** (vê empresas e responde chamados); `definir_funcao_equipe` exige o código de
    duas etapas; nunca fica sem Master. Depois rode **`TORNAR_MASTER.sql`** com o seu e-mail (uma vez).
11. `11_saude_sistema.sql` (= `supabase/migrations/20261108000001_saude_sistema.sql`) — `saude_empresas()` para a
    aba Saúde do Console.

12. `12_precos_produtos.sql` (= `supabase/migrations/20261109000001_precos_produtos.sql`) — **preços por produto**,
    cada um cobrado isolado: catálogo **`cobranca_itens`** (Orquestração, SMS, E-mail, RCS Basic/Single/
    Conversacional, WhatsApp; produto novo = linha nova), **`precos_empresa`** com vigência por mês e modelo
    `flat`, `faixa` (o volume escolhe a faixa para tudo), `progressivo` (cada faixa no seu preço) ou `mensalidade`,
    mínimo mensal opcional, e **`salvar_preco(...)`** (só o Master). Resposta de SMS cobra pelo preço do SMS. As telas
    antigas (`planos_empresa`, `tarifas_mensageria`) continuam funcionando e viram preço do mês. **Orquestração
    opcional**: desligada, a rotina não roda, a Saúde não cobra e a mensalidade sai da fatura.
13. `13_rotas_margem.sql` (= `supabase/migrations/20261110000001_rotas_margem.sql`) — **planos de rota** com % do
    tráfego por fornecedor e, no SMS, **rota por operadora** (Vivo, Claro, TIM, Oi, Outras); plano padrão por canal e
    plano próprio por empresa; **custos** por fornecedor e item com vigência; **RCS** nos lotes (Basic ≤ 160, Single
    acima ou com card; agente conversacional abre sessão de 24 h sem custo extra); **respostas de SMS** cobradas;
    **margem** por empresa e canal (`margem_mensageria`) e simulação de outro plano (`simular_plano`). Custo e margem:
    só o Master. As rotas antigas viram planos (principal 100%, reservas 0%). Rode depois do 12.

14. `14_mensageria_produtos.sql` (= `supabase/migrations/20261111000001_mensageria_produtos.sql`) — Mensageria por
    produto: **campanhas** com lista em qualquer layout (o motor sugere, o cliente confirma o layout), **templates**
    de SMS (160 caracteres) e RCS (categoria Autenticação/Transacional/Marketing; mídia simples, botões, arquivo,
    rich card, carrossel; variáveis `{{nome}}`), **centros de custo** com orçamento e bloquear/continuar ao estourar,
    listas de **bloqueio** e **favoritos** (só hash e máscara), **fallback do RCS** (SMS ou WhatsApp) e o **funil**
    (carregados, higienizados, enviados, entregues, não entregues). Rode depois do 13.
15. `15_radar_atendimento_links.sql` (= `supabase/migrations/20261112000001_radar_atendimento_links.sql`) — **Radar
    MotorCob** (classificação das respostas: CPC Negócio, CPC, Alega pagamento, Baixo calão, Desconhece, Judicial),
    **atendimento** (conversas por número; responder pela plataforma; textos guardados 90 dias) e **links
    rastreados** (encurtador, cliques e funil). Depois publique a função `l` (`08_api/LEIA_ENCURTADOR_E_RADAR.md`).
16. `16_relatorios.sql` (= `supabase/migrations/20261113000001_relatorios.sql`) — 10 **relatórios padrão** e o
    **montador** de relatório personalizado (`rodar_relatorio`), sempre com as permissões de quem consulta.
17. `17_funil_assistente.sql` (= `supabase/migrations/20261114000001_funil_assistente.sql`) — **funil com
    Disparado** separado de Enviado (sem retorno final, bounces, aberturas, cliques e spam no e-mail; view
    `mensageria_funil_status` e base de relatório "Funil de envio (status)") e o **Assistente MotorCob** (perguntas
    guardadas 90 dias, avaliação 👍/👎, lista do que ficou sem resposta para a equipe). Depois publique a função
    `assistente` (`08_api/LEIA_ASSISTENTE.md`).
18. `18_motorcli.sql` (= `supabase/migrations/20261115000001_motorcli.sql`) — **MotorCX com duas frentes**:
    MotorCob (Cobrança) e **MotorCli** (Jornada do Cliente). Frentes contratadas por empresa (toda empresa que
    já existe fica com o MotorCob), frentes por usuário, a escolha do login (`escolher_frente`), carteira e
    estratégia por frente (uma estratégia padrão por frente) e o enquadramento diário da jornada
    (`jornada_cliente`, `jornada_resumo`). Nada muda para quem só usa o MotorCob.
19. `19_contratacao_ciclo.sql` (= `supabase/migrations/20261116000001_contratacao_ciclo.sql`) — **Contratação**:
    ciclo de uso por empresa (dia de corte e vencimento; sem corte = mês fechado, como antes), preço da
    **Jornada** (MotorCli) por cliente acionado no ciclo, prévia e fechamento da fatura pelo ciclo e
    `salvar_frentes` (motor da empresa). Rode junto com o prompt 27 (passo 44).
20. `20_suporte_nomes.sql` (= `supabase/migrations/20261117000001_suporte_nomes.sql`) — **Suporte**: corrige o
    erro ao abrir chamado e ao responder pelo Console (campo `autor_nome`), mostra quem assumiu o atendimento
    (`responsavel_nome`, ex.: "Ana S.") e aceita mensagem só com anexo. Depois cole o prompt 28 (passo 45).
21. `21_equipe_carteira.sql` (= `supabase/migrations/20261118000001_equipe_carteira.sql`) — **Equipe MotorCX**:
    papéis Master, Atendimento e **Comercial**, alcance (todas as empresas ou **só a carteira**: as empresas em
    que a pessoa é Vendedor ou Gerente da conta) e 12 permissões ajustáveis por pessoa. Empresa criada por um
    Comercial entra na carteira dele. Depois publique a função `admin-usuarios` nova e cole o prompt 30.
22. `22_ciclo_pagamento.sql` (= `supabase/migrations/20261119000001_ciclo_pagamento.sql`) — **Contratação v2**:
    Orquestração (MotorCob) e Jornada (MotorCli) viram módulos marcados na Contratação (quem já tem o MotorCli
    ganha a Jornada ligada), ciclo de uso **em dias** (semanal, quinzenal ou N dias) além do mensal, prazo de
    pagamento, **pós ou pré-pago**, formas aceitas (boleto, Pix, cartão), **recargas** e **saldo** do pré-pago.
    Depois cole o prompt 31.
23. `23_cobranca_stripe_nf.sql` (= `supabase/migrations/20261120000001_cobranca_stripe_nf.sql`) — **Cobrança pelo
    Stripe** (boleto, Pix e cartão com baixa automática da fatura e da recarga, cartão guardado para a recarga
    automática) e **nota fiscal** (NFS-e nacional pelo Focus NFe). Guia: `08_api/LEIA_INTEGRACOES.md`.
24. `24_retorno_fornecedores.sql` (= `supabase/migrations/20261121000001_retorno_fornecedores.sql`) — **retorno dos
    fornecedores reais** (entrega, falha, resposta, bounce, abertura), sem o contato do cliente. Guia:
    `08_api/LEIA_INTEGRACOES.md`.
25. `25_emissao_envio_faturas.sql` (= `supabase/migrations/20261122000001_emissao_envio_faturas.sql`) — **emissão
    das faturas** uma a uma, em lote (`emitir_faturas`) ou **automática** no fim do ciclo (por empresa), e a **fila
    de envio**: demonstrativo em PDF (bucket privado `faturas`), boleto em PDF separado e e-mail aos contatos
    financeiros. Depois cole os prompts 32 e 33.

26. `26_etapas_prospeccao.sql` (= `supabase/migrations/20261123000001_etapas_prospeccao.sql`) — **etapas da
    régua** criadas pela empresa (MotorCob e MotorCli), **orçamento por canal** e **Travas** (tudo dentro de
    `estrategias.definicao`, sem tabela nova) e o arquivo de **leads** da prospecção do MotorCli. Depois cole os
    prompts 34 e 35.

27. `27_ver_empresa_criada.sql` (= `supabase/migrations/20261124000001_ver_empresa_criada.sql`) — **correção**: criar
    empresa pelo Console dava "new row violates row-level security policy for table empresas" desde o SQL 21. Rode
    logo; não muda quem vê o quê.

28. `28_ciclo_padroes.sql` (= `supabase/migrations/20261125000001_ciclo_padroes.sql`) — **correção**: salvar o
    ciclo na Contratação dava "null value in column ao_zerar"; campo vazio agora mantém o valor gravado ou usa o
    padrão. Rode logo.

29. `29_ajustes_console.sql` (= `supabase/migrations/20261126000001_ajustes_console.sql`) — **ajustes da homologação**:
    suspender, encerrar e reativar empresa (com motivo; suspensa e encerrada param a rotina), excluir empresa de
    teste (só Master, com duas etapas, só sem histórico), aviso de atendimento (quem falou por último e o que não
    foi visto) e "Recebe faturas" em qualquer contato. Depois cole os prompts 36 e 37 e publique de novo a função
    `cobranca`.

30. `supabase/migrations/20261127000001_produtos_rotas_administrativo.sql` (SQL 30) — **bloco 2**: produtos da
    Mensageria (rota vendida, preço mínimo e de tabela), negociação com fornecedores (preço único ou por operadora,
    custo zero proibido), rota por produto (blocos por operadora + "Demais operadoras"), mistura de operadoras
    (Teleco, editável), contratação por produto, regra do canal por carteira, comitê por produto e o perfil
    **Administrativo** na equipe. Antes de rodar, confira a mistura de operadoras do Teleco do mês. Depois cole os
    prompts 38, 39 e 40.
31. `supabase/migrations/20261128000001_estrategia_carteira.sql` (SQL 31) — **bloco 3**: estratégia por carteira
    (separar ou copiar a estratégia compartilhada) e rótulos legíveis (1º ciclo, 1ª tentativa, Parado · aguarda
    enriquecimento). Depois cole os prompts 41 e 42.
32. `supabase/migrations/20261129000001_experiencia_glossario_tema.sql` (SQL 32) — **bloco 5**: ajuda pelo tempo de
    casa, glossário "O que significa" com os 40 termos e cores do tema. Depois ajuste a senha no painel
    (`02_supabase_painel`, item 4) e cole os prompts 43, 44 e 45.

33. `supabase/migrations/20261130000001_score_entrega_qualidade.sql` (SQL 33) — **bloco 6**: função **Técnico** na
    equipe, qualidade dos fornecedores (velocidade, DLR, sem DLR, alertas, detalhe técnico), **Score de Entrega**
    (filtro de inteligência por rota, fornecedores na análise, nomes devolvidos, grupo de controle), contratação do
    Score e **Economia do Score**. Depois cole os prompts 46, 47 e 48.

34. `supabase/migrations/20261201000001_padroes_comuns_avisos.sql` (SQL 34) — **padrões comuns** da revisão de UX:
    **sino de avisos** (só o motor grava; cada pessoa vê os seus, os da empresa, os da equipe ou os de qualidade),
    cores das faixas do Score no tema e `score_formacao` (histórico do Score em formação). Depois cole os prompts
    49 e 50 e atualize o motor na nuvem.

**Conferência:** `CONFERENCIA_GERAL.sql` mostra, item por item, o que está OK e o que falta (só lê).
