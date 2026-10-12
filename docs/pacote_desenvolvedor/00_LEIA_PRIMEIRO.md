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
| 2 | `01_banco` | 18 SQLs: contato do site, Lista do dia agrupada, templates, workspace (fase 1), faturamento, fornecedor de e-mail, mensageria, tokens da API, revisão das faturas, equipe (Master), saúde do sistema, preços por produto, rotas e margem, mensageria por produto, Radar e links, relatórios, funil com Disparado e Assistente, frentes MotorCob e MotorCli · conferência em CONFERENCIA_GERAL.sql | Supabase › SQL Editor | Hoje |
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
- Não alterar tabelas, views, políticas ou funções sem falar com o MotorCob (versionadas e com 622 testes de acesso).

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
