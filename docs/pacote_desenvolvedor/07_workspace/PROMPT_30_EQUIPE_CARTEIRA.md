# Prompt Horizons — Workspace 30: Equipe MotorCX (papéis, alcance, permissões e carteiras)

Rode depois do **SQL 21** (`01_banco/21_equipe_carteira.sql`) e da função **admin-usuarios** atualizada (aceita a
função "comercial"). A segurança está no banco: quem tem alcance "Só a carteira" não recebe as outras empresas em
nenhuma consulta. A tela só organiza. Protótipo aprovado: https://claude.ai/artifact/F4tq9R8mNV8WS46nGoUgeX

```text
Console MotorCX › EQUIPE e CARTEIRAS, e o login da equipe. Não mude tabelas nem políticas; use só as funções
abaixo. Layout, cores e textos do protótipo (Equipe MotorCX). Pessoas da equipe = perfis.equipe = true.

1. LOGIN DA EQUIPE: depois do e-mail, senha e código (duas etapas continuam obrigatórias), quem é da equipe vai
   DIRETO para /console, sem a tela "Escolha a frente." (ela continua só para clientes com as duas frentes).
   No Console, a frente de cada empresa aparece no selo dela (COB #C9A35A / CLI #8E8E93, sigla em maiúsculo).
   Ao entrar na Mensageria ou no workspace de uma empresa, a frente vem da empresa (empresa_frentes), não de
   uma escolha da pessoa.

2. MENU DO CONSOLE POR PERMISSÃO: perms = linha da própria pessoa em rpc('listar_equipe') (campo permissoes,
   um objeto {permissao: true|false}). Esconda o que ela não pode: Faturamento (ver_faturamento), Margem
   (ver_margem), Equipe (gerenciar_equipe), botões Nova empresa (criar_empresa), Pausar (pausar_empresa), aba
   Contratação (editar_contratacao; editar_precos libera só os preços), Emitir/Ajustar fatura (emitir_faturas),
   Responder chamado (responder_chamados), Entrar na Mensageria (acessar_mensageria). Master vê tudo. No topo do
   Console, ao lado do nome: o papel (Master, Atendimento ou Comercial) e, se o alcance for carteira,
   "Só a carteira · N empresas" (N = campo carteira).

3. ABA EQUIPE (quem tem gerenciar_equipe): tabela com Nome, E-mail, Papel (selo), Alcance ("Todas" ou
   "Carteira · N"), Duas etapas (ok/pendente), Último acesso, Situação. Fonte: rpc('listar_equipe').
   - Botão "Convidar": nome, e-mail e papel (Master, Atendimento, Comercial) → função admin-usuarios com
     { acao: 'convidar_equipe', email, nome, funcao: 'master'|'atendimento'|'comercial' }. Comercial nasce com
     alcance "Só a carteira".
   - Tocar numa pessoa abre o painel à direita (embaixo no celular):
     a) Papel: controle segmentado Master · Atendimento · Comercial → rpc('definir_funcao_equipe',
        { usuario, funcao }). Aviso ao trocar: "As permissões voltam ao padrão do novo papel."
     b) Alcance (não aparece para Master): dois cartões "Todas as empresas — Vê o Console inteiro dentro das
        permissões." e "Só a carteira — Só as empresas em que é Vendedor ou Gerente."
     c) Permissões: as 12 chaves agrupadas (Empresas, Contratação, Financeiro, Atendimento, Equipe), nome de
        cada uma vindo de permissoes_equipe_catalogo (select permissao, grupo, nome, master, atendimento,
        comercial). Chave diferente do padrão do papel ganha a etiqueta "diferente do padrão do papel".
        Para Master: tudo ligado e travado, com a frase "Master tem tudo e vê todas as empresas. Sempre existe
        pelo menos um Master."
     d) Botões "Voltar ao padrão do papel" (manda todas as chaves como null) e "Salvar" →
        rpc('configurar_equipe', { usuario, alcance, permissoes: { chave: true|false|null } }), mandando só as
        chaves alteradas; null = volta ao padrão.
   - Desativar/Reativar e Resetar duas etapas continuam como hoje (admin-usuarios).
   - Ninguém edita a si mesmo: no próprio nome, o painel fica só leitura com "Peça a outro Master."

4. ABA CARTEIRAS (quem tem gerenciar_equipe ou é Master): tabela Empresa · Frentes (selos COB/CLI) · Vendedor ·
   Gerente da conta, com selects de pessoas da equipe (listar_equipe) e a opção "Sem responsável".
   Trocar → rpc('definir_responsaveis', { empresa, vendedor, gerente }) (uuid ou null). Filtro no topo:
   Todas · Sem responsável · por pessoa. Empresa criada por um Comercial já entra na carteira dele como
   Vendedor (o banco faz isso; a tela só mostra).

5. COMERCIAL COM "SÓ A CARTEIRA": nada a filtrar na tela — Empresas, Saúde, Faturamento e Atendimento já vêm
   só com as empresas dele. Lista vazia: "Nenhuma empresa na sua carteira ainda. Peça ao Master para te
   colocar como Vendedor ou Gerente de uma conta."

6. ERROS: mensagens do banco aparecem na faixa vermelha da própria tela (ex.: "a equipe precisa de pelo menos
   um Master ativo", "entre com o seu código de duas etapas para mudar a equipe"), sem derrubar a página.

Confira em 1440 e 390px: convide um Comercial; dê a ele a empresa Alfa em Carteiras; entre com ele: vai direto
ao Console, vê só a Alfa, não vê Margem nem Equipe; ligue "Editar preços" para ele e veja a aba Contratação
abrir só com os preços.
```
