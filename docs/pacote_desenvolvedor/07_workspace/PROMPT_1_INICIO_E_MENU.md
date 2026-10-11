# Prompt Horizons — Workspace 1/5: início, barra do topo e menu do usuário

Rode depois dos SQL 4, 5 e 6. Referência visual: protótipo do Workspace (início, menu do usuário).

```text
Crie o WORKSPACE: a porta de entrada da plataforma, antes da Orquestração. Não mude as telas da Orquestração
(/inicio, Lista do dia etc.), tabelas, views ou políticas. Linha Apple de sempre (tokens --mc-*, fonte do sistema,
botão principal pílula #1D1D1F, cards brancos raio 16 com sombra 0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)).

ROTAS
- /workspace = início do Workspace. Depois do login (e do código de duas etapas) vá para /workspace, não /inicio.
- No menu lateral escuro da Orquestração, acima de "Operação", item "Workspace" (ícone LayoutGrid) → /workspace.

BARRA DO TOPO DO WORKSPACE (todas as telas /workspace, /empresa, /conta, /suporte, /console, /docs)
Fixa, 56px, fundo #161617, texto #F5F5F7. Esquerda: símbolo Rotor 24px (mesmo SVG do menu) + "MotorCob" 15px 600;
depois o seletor de empresa: pílula rgba(255,255,255,.08) com ícone Building2 + nome fantasia + ChevronDown.
- Cliente: o seletor mostra só a própria empresa (sem lista).
- Equipe MotorCob (perfis.equipe = true): lista com busca de todas as empresas (from('empresas')
  .select('id,nome,razao_social,situacao').order('nome')); escolher troca a "empresa ativa" (contexto global já usado
  pelas outras telas) e recarrega minhas_permissoes.
Links 14px rgba(245,245,247,.8), ativo branco 600 com fundo rgba(255,255,255,.1) raio 8: Início, Empresa,
Mensageria (só se o módulo mensageria estiver ativo), Suporte e, só para a equipe, "Console MotorCob" em #C9A35A.
Direita: avatar 32px (foto do perfil ou iniciais em #3A3A3C). Abaixo de 820px os links vão para uma 2ª linha com
rolagem lateral só nela.

MENU DO USUÁRIO (clique no avatar; popover branco 280px, raio 14, sombra)
Topo: avatar 40px, nome + sobrenome 15px 600, e-mail 13px #6E6E73, selo do perfil (Admin, Planejamento, Operação,
Gestão; equipe: "Equipe MotorCob"). Itens com ícone: Minha conta (/conta) · Documentação (/docs) · Sobre o MotorCob
(abre modal: símbolo 56px, "MotorCob", "Versão 3.0 · outubro de 2026", "Da carga à ação, com inteligência.",
links Termos e Privacidade) · divisória · Sair (signOut, volta a /login). Esc fecha; foco volta ao avatar.

INÍCIO (/workspace), coluna central de até 960px
1. Saudação centralizada: "Bom dia, {nome}." / "Boa tarde" / "Boa noite" (hora de São Paulo), 34px 700. Abaixo,
   campo grande "O que você quer fazer?" (480px, 48px, raio 14, ícone Search, ⌘K/Ctrl+K abre de qualquer tela do
   Workspace). Digitar filtra uma lista fixa de atalhos, com ↑ ↓ Enter: Abrir a Lista do dia (a rota atual da Lista do dia),
   Abrir chamado (/suporte/novo), Meus chamados (/suporte), Convidar membro (página Usuários), Contatos da empresa
   (/empresa/contatos), Faturas (/empresa/faturamento, só com ver_faturamento), Minha conta (/conta), Verificação em
   duas etapas (/conta/seguranca), Documentação (/docs). Nada encontrado: "Tente “chamado”, “faturas” ou “membros”."
2. "Para hoje" (card, título 17px 600). Linhas clicáveis com ponto 8px, texto 15px, legenda 13px cinza e "›":
   - verde #34C759: "{n} clientes entram em ação hoje" → Lista do dia (n = soma de clientes em motivos_hoje com
     categoria 'com_acao' da empresa ativa; não mostrar se 0);
   - laranja #FF9500: para cada chamado da empresa com situacao 'aguardando_cliente': "O suporte respondeu o
     chamado {protocolo}" → /suporte/{id};
   - cinza #AEAEB2: com ver_faturamento, a fatura com situacao 'aberta' mais antiga: "Fatura de {mês} vence em
     {dia de mês}" → /empresa/faturamento; vencida (situacao 'vencida'): ponto vermelho #FF3B30 "Fatura de {mês}
     venceu em {data}".
   Sem nenhuma linha: o card vira uma linha só, ponto verde, "Tudo em dia por aqui."
3. "Seus produtos": grade auto-fit minmax(220px,1fr) de cards por módulo (from('empresa_modulos').select('*')
   .eq('empresa_id', empresa)). Orquestração (ícone Workflow) "Lista do dia, réguas e personas" → /inicio ·
   Mensageria (MessageSquare) "SMS, e-mail e RCS" → /mensageria · Enriquecimento (Search) "Contatos novos para quem
   está sem canal" · API (Code) "Cargas e Lista do dia pelo seu sistema". Ativo: card branco clicável, selo verde
   "Ativo". Não contratado: card #F5F5F7, texto #6E6E73, botão secundário "Quero conhecer" → abre /suporte/novo com
   motivo 'sugestao' e assunto "Interesse em {módulo}".
4. "Dicas" (card #F5F5F7, uma por vez, botões "Próxima" e "Esconder"; guardar escondido em localStorage):
   "Arraste um canal para o dia na Orquestração." · "Use ⌘K para ir direto ao que precisa." · "Ligue a verificação
   em duas etapas em Minha conta." · "Abra chamado com o arquivo anexado: resolvemos mais rápido."

Datas por extenso em português. Sem rolagem lateral em 1440, 1024 e 390px. Foco visível em tudo.
```
