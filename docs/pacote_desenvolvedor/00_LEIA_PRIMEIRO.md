# MotorCob — pacote para o desenvolvedor (linha Apple)

Site: **motorcob.online** (Hostinger Horizons, React) · Banco/Auth/Storage: **Supabase** (projeto `jxwppkrkuckfwmphqjva`).
Motor e banco: github.com/ContraPontoPodcast/MotorCob (migrações em `supabase/migrations/`).

**Referência visual oficial:** `03_site_e_login/referencia/motorcob-prototipo.html`. Abra no navegador: é o
protótipo aprovado, navegável (site → "Entrar" → qualquer senha → qualquer código → sistema). Dados fictícios.
Ele substitui tudo o que foi enviado antes (tema preto e âmbar, site com vídeo): **descarte o pacote anterior.**

Faça **na ordem**; cada passo depende do anterior.

| # | Pasta | O que é | Onde | Quando |
|---|---|---|---|---|
| 1 | `02_supabase_painel` | **Segurança urgente**: fechar cadastro aberto, URLs de retorno, MFA | Painel Supabase | Hoje |
| 2 | `01_banco` | 26 SQLs: contato do site, Lista do dia agrupada, templates, workspace (fase 1), faturamento, fornecedor de e-mail, mensageria, tokens da API, revisão das faturas, equipe (Master), saúde do sistema, preços por produto, rotas e margem, mensageria por produto, Radar e links, relatórios, funil com Disparado e Assistente, frentes MotorCob e MotorCli, contratação e ciclo de uso, suporte com nomes, equipe com carteira, contratação v2 (pré/pós-pago e recargas), cobrança pelo Stripe e nota fiscal, retorno dos fornecedores, emissão e envio das faturas, etapas da régua e leads · conferência em CONFERENCIA_GERAL.sql | Supabase › SQL Editor | Hoje |
| 3 | `03_site_e_login` | Site público em "/", login novo, plataforma em "/inicio", fim do "/cadastro" | Site | 1º |
| 4 | `04_sistema_linha_apple` | Visual do sistema: menu escuro, telas brancas, Lista do dia nova | Site | 2º |
| 5 | `05_usuarios_permissoes_seguranca` | Menus por permissão, Permissões, Auditoria, páginas de senha, sessão | Site | 3º |
| 6 | `04_sistema_linha_apple/PROMPT_TEMPLATES.md` | WhatsApp/RCS com template (busca); discador, e-mail e bureau sem frase | Site | 4º |
| 7 | `03_site_e_login/PROMPT_SITE_V3_CARROSSEL.md` | Site v3: carrossel com as 6 funções e uma seção por função (Orquestração, Mensageria, Arquivo ou API, Workspace) | Site | 5º |
| 8 | `03_site_e_login/PROMPT_CARROSSEL_ESCURO.md` | Carrossel em bloco escuro | Site | 6º |
| 9 | `03_site_e_login/PROMPT_SITE_VIVO.md` | Carrossel passa sozinho; Lista do dia e personas com números em movimento (só no site) | Site | 7º |
| 10 | `07_workspace/PROMPT_1_INICIO_E_MENU.md` | Workspace: início, barra do topo, seletor de empresa, menu do usuário | Site | 8º |
| 11 | `07_workspace/PROMPT_2_EMPRESA.md` | Empresa: cadastro, contatos, membros, módulos, faturamento | Site | 9º |
| 12 | `07_workspace/PROMPT_3_MINHA_CONTA.md` | Minha conta (dados e foto, permissões, senha, duas etapas, sessões) e Documentação | Site | 10º |
| 13 | `07_workspace/PROMPT_4_SUPORTE_E_CREDORES.md` | Suporte do cliente (chamado, anexos, conversa) e Arquivo ou API nos credores | Site | 11º |
| 14 | `07_workspace/PROMPT_5_CONSOLE_EQUIPE.md` | Console MotorCob: empresas, atendimento, fechamento de faturas, fornecedores e rotas | Site | 12º |
| 15 | `05_usuarios_permissoes_seguranca/PROMPT_RESETAR_DUAS_ETAPAS.md` | Função admin-usuarios nova + botão "Resetar duas etapas" em Usuários | Supabase + Site | 13º |
| 16 | `07_workspace/PROMPT_6_MENSAGERIA.md` | Mensageria: lotes do dia (aprovar, pausar, retomar, cancelar), descadastros, modelo de e-mail, modo simulação | Site | 14º |
| 17 | `08_api/LEIA.md` | API das cargas: SQL 8, função `api` (Verify JWT desligado), tokens em Minha conta e /docs/api | Supabase + Site | 15º |
| 18 | `07_workspace/PROMPT_7_EQUIPE_E_SAUDE.md` | Console: abas Saúde e Equipe (Master e Atendimento) | Site | 16º |
| 19 | `07_workspace/PROMPT_8_PRECOS_E_MODULOS.md` | Preços por produto (único, por faixa, progressiva, mensalidade, mínimo) e Orquestração liga/desliga | Site | 17º |
| 20 | `07_workspace/PROMPT_9_ROTAS_E_MARGEM.md` | Console: planos de rota (% e operadora), custos e Margem (%MC) com simulação | Site | 18º |
| 21 | `07_workspace/PROMPT_10_MENSAGERIA_SMS_RCS.md` | Mensageria: RCS, respostas, operadora, agente RCS, limite de 160 | Site | 19º |
| 22 | `07_workspace/PROMPT_11_MENSAGERIA_PRODUTOS.md` | Mensageria por produto (mesmo UX da Orquestração), painel com funil, campanhas com layout livre | Site | 20º |
| 23 | `07_workspace/PROMPT_12_TEMPLATES_LISTAS_CUSTO.md` | Templates de SMS e RCS, listas de bloqueio e favoritos, centros de custo, fallback | Site | 21º |
| 24 | `08_api/LEIA_ENCURTADOR_E_RADAR.md` | Função `l` (encurtador), domínio curto e chave da IA do Radar | Supabase + Cloud | 22º |
| 25 | `07_workspace/PROMPT_13_RADAR_ATENDIMENTO.md` | Radar MotorCob e caixa de atendimento das respostas | Site | 23º |
| 26 | `07_workspace/PROMPT_14_LINKS_FUNIL.md` | Funil de cliques dos links rastreados | Site | 24º |
| 27 | `07_workspace/PROMPT_15_RELATORIOS.md` | Relatórios padrão e montador de relatórios | Site | 25º |
| 28 | `07_workspace/PROMPT_16_NAVEGACAO_UNICA.md` | Navegação única dentro dos produtos (Workspace continua na entrada, com barra no topo) | Site | 26º |
| 29 | `08_api/LEIA_ASSISTENTE.md` | Chave da IA nos Secrets do Supabase e função `assistente` (Verify JWT ligado) | Supabase | 27º |
| 30 | `07_workspace/PROMPT_17_BUSCA_E_ASSISTENTE.md` | Campo único "O que você quer fazer?" (busca e pergunta), avatar e gaveta do Assistente, Console › Assistente | Site | 28º |
| 31 | `07_workspace/PROMPT_18_MENU_RECOLHIVEL.md` | Menu lateral dos produtos recolhível (só ícones) | Site | 29º |
| 32 | `07_workspace/PROMPT_19_FUNIL_STATUS.md` | Painel da Mensageria: Disparado, Enviado, sem retorno, e-mail completo e botões "i" | Site | 30º |
| 33 | `07_workspace/PROMPT_20_CORRECAO_NAVEGACAO.md` | Correção: Mensageria e Console no menu lateral, com "Voltar ao Workspace" e seletor de produto | Site | 31º |
| 34 | `07_workspace/PROMPT_21_AVATAR_IMAGEM_E_FECHAR.md` | Correção: foto do avatar (bucket `publico`), botão de fechar e balão de 7 segundos | Site | 32º |
| 35 | `07_workspace/PROMPT_22_CORRECAO_BUGS.md` | Correção: Mensageria, pergunta, empresa, canais e menu | Site | 33º |
| 36 | `08_api/MotorCob_funcao_assistente.ts` | Função `assistente` atualizada (MotorCX, frentes e a Jornada do MotorCli): colar de novo no editor da função | Supabase | 34º, depois do SQL 18 |
| 37 | `07_workspace/PROMPT_23_MOTORCX_LOGIN_E_FRENTES.md` | MotorCX: login com escolha da frente, tema por frente, "Trocar para MotorCli" | Site | 35º |
| 38 | `07_workspace/PROMPT_24_MOTORCLI_JORNADA.md` | MotorCli: produto Jornada (Início, Lista do dia, Enviar arquivos, Carteiras, Momentos da jornada) | Site | 36º |
| 39 | `07_workspace/PROMPT_25_CONSOLE_FRENTES.md` | Console: ligar as frentes da empresa; Usuários: limitar por frente | Site | 37º |
| 41 | `07_workspace/PROMPT_26_LOGIN_FRENTE_PELO_LINK.md` | Login abre com a frente que veio no link (`?frente=motorcli`) | Site (motorcob.online) | 38º |
| 42 | `09_site_motorcli/` (LEIA, parte A e parte B) | Site motorcli.online: projeto NOVO no Horizons, só vitrine; Supabase só para o formulário | Site novo | 39º |
| 43 | `07_workspace/PROMPT_27_CONTRATACAO.md` | Console: Contratação num lugar só (motor, módulos, preço flat ou escalonado de cada item, ciclo de uso); depois do SQL 19 | Site (motorcob.online) | 40º |
| 44 | `07_workspace/PROMPT_28_SUPORTE_NOMES.md` | Suporte: "Em atendimento · com Ana S." e o nome em cada mensagem; depois do SQL 20 (que corrige o erro ao abrir e responder chamado) | Site (motorcob.online) | 41º |
| 45 | `07_workspace/PROMPT_29_CORRECAO_CONTRATACAO.md` | Correção: tela Contratação quebrava ("Ops! Ocorreu um erro inesperado"), itens de preço pela chave certa, WhatsApp, números e ciclo | Site (motorcob.online) | 42º |
| 46 | `01_banco/21_equipe_carteira.sql` + `05_usuarios_permissoes_seguranca/MotorCob_funcao_admin-usuarios.ts` | SQL 21 (equipe: papéis, alcance, carteira) e a função `admin-usuarios` nova (aceita Comercial): Edge Functions › admin-usuarios › Code › apague tudo › cole › Deploy | Supabase | 43º |
| 47 | `07_workspace/PROMPT_30_EQUIPE_CARTEIRA.md` | Console: Equipe (papel, alcance, permissões), Carteiras e login da equipe direto no Console | Site (motorcob.online) | 44º |
| 48 | `01_banco/22_ciclo_pagamento.sql` | SQL 22: Orquestração e Jornada como módulos, ciclo em dias, pré/pós-pago, recargas e saldo | Supabase | 45º |
| 49 | `07_workspace/PROMPT_31_CONTRATACAO_V2_RECARGA.md` | Contratação v2 (módulos, preço abre embaixo do item, ciclo em dias, cobrança) e recarga do pré-pago | Site (motorcob.online) | 46º |
| 50 | `08_api/LEIA_INTEGRACOES.md` | SQL 23 e 24, funções `cobranca`, `pagamentos-webhook` e `retorno-mensageria`, credenciais do Stripe, Focus NFe e fornecedores (cada uma no seu cofre) | Supabase + Google Cloud + painéis | 47º |
| 51 | `01_banco/25_emissao_envio_faturas.sql` + função `cobranca` nova (passo 50a) | SQL 25: emissão em lote/automática, demonstrativo e envio; publique de novo a função `cobranca` | Supabase | 48º |
| 52 | `07_workspace/PROMPT_32_PAGAR_FATURA_RECARGA.md` | Cliente: pagar fatura e recarga (boleto, Pix, cartão), demonstrativo, boleto e nota | Site (motorcob.online) | 49º |
| 53 | `07_workspace/PROMPT_33_CONSOLE_FATURAMENTO.md` | Console: emissão em lote e automática, envio, cobranças, notas e configuração fiscal | Site (motorcob.online) | 50º |
| 54 | `supabase/migrations/20261123000001_etapas_prospeccao.sql` (SQL 26) | Etapas da empresa e leads da prospecção (tipo de arquivo `leads` e nome da etapa no enquadramento) | Supabase | 51º |
| 55 | `07_workspace/PROMPT_34_ETAPAS_ORCAMENTO_TRAVAS.md` | Orquestração: etapas da régua (mesma esteira com raias e frases, ciclo), orçamento por canal com prioridade e Travas configuráveis | Site (motorcob.online) | 52º |
| 56 | `07_workspace/PROMPT_35_MOTORCLI_ETAPAS_PROSPECCAO.md` | MotorCli: etapas, prospecção (envio de leads, LGPD) e Travas; depois do prompt 24 | Site (motorcob.online) | 53º |
| 57 | `supabase/migrations/20261124000001_ver_empresa_criada.sql` (SQL 27) | Correção: Master e Comercial voltam a criar empresa pelo Console (erro de RLS em empresas) | Supabase | já |
| 58 | `supabase/migrations/20261125000001_ciclo_padroes.sql` (SQL 28) | Correção: salvar o ciclo na Contratação com campo vazio (erro "ao_zerar") | Supabase | já |
| 59 | `supabase/migrations/20261126000001_ajustes_console.sql` (SQL 29) | Situação da empresa, excluir teste, aviso de atendimento, "Recebe faturas" | Supabase | 54º |
| 60 | função `cobranca` (de novo) | E-mail da fatura para os contatos com "Recebe faturas" | Supabase | 55º |
| 61 | `07_workspace/PROMPT_36_CONSOLE_AJUSTES.md` | Console: chave liga/desliga única, situação da empresa, aviso de atendimento, plano de rota sem fornecedor | Site (motorcob.online) | 56º |
| 62 | `07_workspace/PROMPT_37_EMPRESA_FATURAS_SUPORTE.md` | Empresa: "Recebe faturas" nos contatos; Suporte com aviso de resposta | Site (motorcob.online) | 57º |
| 63 | `supabase/migrations/20261127000001_produtos_rotas_administrativo.sql` (SQL 30) | Bloco 2: produtos, negociação por operadora, rota por produto, preço mínimo, contratação por produto, canal por carteira, Administrativo (confira antes a mistura do Teleco) | Supabase | 58º |
| 64 | `07_workspace/PROMPT_38_CONSOLE_PRODUTOS_PRECOS.md` | Console: Produtos e preços; preço entre mínimo e tabela na Contratação | Site (motorcob.online) | 59º |
| 65 | `07_workspace/PROMPT_39_CONSOLE_FORNECEDORES_ROTAS.md` | Console: fornecedores, negociações, rota de cada produto e mistura de operadoras | Site (motorcob.online) | 60º |
| 66 | `07_workspace/PROMPT_40_ADMINISTRATIVO_PRODUTO_CANAL_CARTEIRA.md` | Administrativo na equipe, produto na campanha, canal por carteira, comitê por produto | Site (motorcob.online) | 61º |
| 67 | `supabase/migrations/20261128000001_estrategia_carteira.sql` (SQL 31) | Bloco 3: estratégia por carteira e rótulos legíveis | Supabase | 62º |
| 68 | `07_workspace/PROMPT_41_ORQUESTRACAO_POR_CARTEIRA.md` e `PROMPT_42_MAPA_DA_ESTEIRA.md` | Orquestração por carteira (barra única, separar/copiar, fases com orçamento e travas) e Mapa da Esteira em cartões | Site (motorcob.online) | 63º |
| 69 | `supabase/migrations/20261129000001_experiencia_glossario_tema.sql` (SQL 32) + senha no painel (`02_supabase_painel`, item 4) | Bloco 5: ajuda pelo tempo de casa, glossário e cores do tema | Supabase | 64º |
| 70 | `07_workspace/PROMPT_43_GLOSSARIO_E_AJUDA.md`, `PROMPT_44_TEMA_E_PALETA.md`, `PROMPT_45_MENUS_NOMES_TEXTOS.md` | "O que significa", (i), ajuda por tempo de casa, paleta por área, menus com subtítulo e um nome por conceito | Site (motorcob.online) | 65º |
| 71 | função `assistente` (de novo: `python3 scripts/juntar_funcao.py assistente`, cole o arquivo inteiro) + motor na nuvem (`systemctl start motorcob-atualizar` depois do merge) | Assistente com os nomes novos; motor com produto, rota por produto, custo por operadora e estratégia por carteira | Supabase + Google Cloud | 66º |
| 72 | `supabase/migrations/20261130000001_score_entrega_qualidade.sql` (SQL 33) | Bloco 6: função Técnico, qualidade dos fornecedores, Score de Entrega e Economia do Score | Supabase | 67º |
| 73 | `07_workspace/PROMPT_46_QUALIDADE_FORNECEDORES.md`, `PROMPT_47_FILTRO_INTELIGENCIA_CONTRATACAO.md`, `PROMPT_48_SCORE_CAMPANHA_ECONOMIA.md` | Console: qualidade, Técnico, filtro de inteligência e contratação do Score; cliente: campanha com faixas e Economia do Score | Site (motorcob.online) | 68º |
| 74 | função `assistente` (de novo) + motor na nuvem | Assistente com o Score; motor aplica o Score nas campanhas e guarda a DLR | Supabase + Google Cloud | 69º |
| 75 | `supabase/migrations/20261201000001_padroes_comuns_avisos.sql` (SQL 34) | Padrões comuns: sino de avisos, cores das faixas do Score no tema, histórico do Score em formação | Supabase | 70º |
| 76 | `07_workspace/PROMPT_49_PADROES_COMUNS.md` e `PROMPT_50_APLICAR_PADROES.md` | Sino, processo demorado, salvar com revisão, confirmação, somente leitura, tabela no celular, faixas do Score e nomes, aplicados nas telas | Site (motorcob.online) | 71º |
| 77 | motor na nuvem (`systemctl start motorcob-atualizar`) | Motor grava os avisos do sino (lista lida, prévia pronta, erro, envios pausados, alerta de qualidade) | Google Cloud | 72º |
| 78 | `supabase/migrations/20261202000001_primeiro_uso.sql` (SQL 35) | Primeiro uso: primeiros passos, pedido de envio real (Suporte em até 1 hora) e implantação no Console | Supabase | 73º |
| 79 | `02_supabase_painel/CONFIGURAR_SUPABASE.md` item 5b + função `admin-usuarios` de novo (`python3 scripts/juntar_funcao.py admin-usuarios`) | E-mail de convite com a empresa, o papel e quem convidou; link de 24 h | Supabase | 74º |
| 80 | `07_workspace/PROMPT_51_PRIMEIRO_USO_CLIENTE.md` e `PROMPT_52_CONSOLE_IMPLANTACAO.md` + motor na nuvem | Conta, primeiros passos, faixa da simulação e pedido de envio real, telas vazias; Console › Implantação | Site + Google Cloud | 75º |
| 81 | `supabase/migrations/20261203000001_atendimento_radar.sql` (SQL 36) | Atendimento: situações, tempos, notas, transferência, respostas rápidas, meta opcional, avisos e painel do Radar | Supabase | 76º |
| 82 | `07_workspace/PROMPT_53_CAIXA_ATENDIMENTO.md` e `PROMPT_54_RADAR_PAINEL_CONFIG.md` + função `assistente` de novo + motor na nuvem | Caixa única, resposta em grupo com custo, painel do Radar e configuração | Site + Supabase + Google Cloud | 77º |
| 83 | `supabase/migrations/20261204000001_faturas_contratacao.sql` (SQL 37) | Vigência do preço (próximo ciclo), lembretes e inadimplência, permissão Pagar faturas, extrato e estimativas | Supabase | 78º |
| 84 | funções `cobranca` e `api` de novo (`python3 scripts/juntar_funcao.py cobranca` / `api`) | Lembrete de fatura vencida por e-mail, permissão de pagar; API recusa empresa inadimplente | Supabase | 79º |
| 85 | `07_workspace/PROMPT_55_CONTRATACAO_FATURAS_CONSOLE.md` e `PROMPT_56_FATURAMENTO_CLIENTE.md` + motor na nuvem | Contratação por seção com vigência, faturas com resumo da emissão, faturamento do cliente e acesso bloqueado | Site + Google Cloud | 80º |
| 86 | `supabase/migrations/20261205000001_acordos_fatura.sql` (SQL 38) | Acordo de pagamento de fatura vencida: até 12 parcelas, desconto ou acréscimo com motivo, quebra com 10 dias | Supabase | 81º |
| 87 | funções `cobranca`, `pagamentos-webhook` e `assistente` de novo (`python3 scripts/juntar_funcao.py cobranca` / `pagamentos-webhook` / `assistente`) | Pagar parcela (Pix, boleto, cartão), e-mail do acordo, lembrete da parcela, nota fiscal da parcela paga; Assistente sabe do acordo | Supabase | 82º |
| 88 | `07_workspace/PROMPT_57_ACORDO_CONSOLE.md` e `PROMPT_58_ACORDO_CLIENTE.md` + motor na nuvem | Console: lançar e acompanhar acordos; cliente: faixa do acordo e parcelas em Faturamento | Site + Google Cloud | 83º |
| 89 | `supabase/migrations/20261206000001_relatorios_v2.sql` (SQL 39) | Relatórios por pergunta, taxas, Orquestração, foto diária da carteira, exportação até 1 milhão e envio por e-mail | Supabase | 84º |
| 90 | função nova `relatorios` (`python3 scripts/juntar_funcao.py relatorios`, Verify JWT desligado) + função `assistente` de novo | E-mail do relatório agendado (mesmos Secrets do e-mail das faturas; remetente opcional RELATORIO_EMAIL_DE) | Supabase | 85º |
| 91 | `07_workspace/PROMPT_59_RELATORIOS.md` e `PROMPT_60_MONTADOR_ORQUESTRACAO.md` + motor na nuvem | Relatórios no menu, perguntas, comparação, montador em 3 passos, exportação, envio por e-mail, Orquestração e Jornada | Site + Google Cloud | 86º |
| 92 | `supabase/migrations/20261207000001_jornada_v2.sql` (SQL 40) + função `assistente` de novo | Jornada: resultado de cada momento, movimento, mensagens por momento, estratégia por carteira, rótulos sem código | Supabase | 87º |
| 93 | `07_workspace/PROMPT_61_JORNADA_INICIO_LISTA.md` e `PROMPT_62_JORNADA_MOMENTOS_MENSAGENS.md` + motor na nuvem | Início com o mapa da jornada, Lista do dia sem códigos, momentos com prioridade, orçamento e mensagem | Site + Google Cloud | 88º |
| 40 | `03_site_e_login/PROMPT_SITE_V5_MOTORCX_A.md` e `_B.md` | Site público MotorCX (substitui o PROMPT_SITE_V4, que não deve ser colado) | Site | quando o domínio sair |
| ! | `03_site_e_login/PROMPT_DUAS_ETAPAS_COMPONENTE.md` | Duas etapas: componente pronto e testado (código em `site/duas-etapas/` do repositório), substitui as correções anteriores | Site | já |

Cada pasta do site tem `ESPECIFICACAO.md` (para quem programa à mão, com critérios de aceite) e `PROMPT_HORIZONS.md`
(o mesmo como prompt para colar no Horizons, com menos de 100 linhas). Use um ou outro.
`06_referencias`: guia do designer, **decisões do produto sobre o guia** (vencem o guia), segurança e nuvem.

## Regras que valem para tudo
- **Nada de dado pessoal na tela**: só o ID do cliente. Busca só por ID ou contrato (nunca CPF, nome ou telefone).
- **Nunca colocar a chave service_role no site.** Só a chave pública (anon/publishable). Ações de administrador
  passam pela Edge Function `admin-usuarios`, já publicada.
- Permissão é garantida no banco (RLS + `pode()`); o site só esconde o que a pessoa não pode usar.
- Erros em português, sem detalhe técnico. O login nunca diz se um e-mail existe.
- Não alterar tabelas, views, políticas ou funções sem falar com o MotorCob (versionadas e com 651 testes de acesso).

## Já pronto (não refazer)
Permissões por perfil e por usuário, auditoria, contatos do site, motivos agrupados da Lista do dia (após o SQL 2)
· Edge Function `admin-usuarios` · motor no Google Cloud (São Paulo) · Orquestração com frases · tela Usuários com convite.

## Checklist de aceite
- [ ] `/` abre o site; cabeçalho escuro; cada atalho (Plataforma, Orquestração, Mensageria, Personas, Workspace, Segurança, Contato) rola até a seção.
- [ ] Carrossel #plataforma: 6 slides, setas e pontos funcionam, ‹ desabilitado no 1º e › no último, passa sozinho a cada 6 s e para com mouse, foco ou botão de pausa.
- [ ] "Entrar" → login branco "Entre no MotorCob." → código (Admin) → `/inicio`.
- [ ] `/cadastro` redireciona para `/login` e o Supabase recusa cadastro novo.
- [ ] Contato grava em `contatos_site`; o visitante não lê a tabela.
- [ ] Sistema com menu escuro, telas brancas, fonte do sistema; champanhe só no símbolo; sem azul-petróleo nem âmbar.
- [ ] Lista do dia com os 4 grupos vindos de `motivos_hoje`; Orquestração com canais coloridos.
- [ ] WhatsApp e RCS escolhem template com busca; SMS e Agente virtual, frase; Discador, E-mail e Enriquecimento sem campo.
- [ ] Operação não vê menus de configuração; Admin vê Usuários, Permissões e Auditoria.
- [ ] Links de convite e "esqueci a senha" abrem a página de criar senha.
- [ ] Sem rolagem lateral em 1440, 1024 e 390 px, no Mac e no Windows.

Dúvidas de regra de negócio: Marcos Guerra (MotorCob).
