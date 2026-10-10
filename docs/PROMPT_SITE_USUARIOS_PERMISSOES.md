# Prompt do site — Usuários, Permissões, Auditoria e login seguro

Antes: rode no Supabase o SQL `20261024000001_permissoes_auditoria.sql` e publique a função `admin-usuarios`
(passo a passo no fim). Cole no Hostinger Horizons e publique:

---

O MotorCob passa a ter **permissões por perfil** configuráveis pelo Admin da empresa, **gestão de usuários** completa
(convidar, desativar, reativar, resetar senha, trocar perfil), **auditoria** e **login com verificação em duas
etapas para o Admin**. O banco já bloqueia o que o perfil não pode; o site só precisa esconder e mostrar.

## 1. Menus e botões pelas permissões do usuário

Logo após o login (e ao trocar de empresa), carregue `select * from minhas_permissoes()` (lista de códigos) e
guarde num contexto. Use em todo o site **no lugar do papel fixo** (`papel === 'admin'` etc.):

| Código | Mostra / habilita |
|---|---|
| `baixar_listas` | Lista do dia: download dos arquivos por canal |
| `baixar_relatorios` | Downloads de fila completa, higienização, enriquecimento e demais saídas |
| `baixar_comite` | Página Comitê |
| `enviar_arquivos` | Página Enviar arquivos |
| `reenquadrar` | Botão "Reenquadrar agora" |
| `editar_orquestracao` | Edição em Segmentos, Estratégias (Orquestração), Personas e Sugestões |
| `editar_credores` | Edição em Credores, Mapeamento, Códigos de ocorrência e Regras de retorno |
| `editar_canais` | Edição em Canais e Frases (playbook) |
| `ver_acessos` | Página Acessos |
| `ver_auditoria` | Página Auditoria |
| `gerenciar_usuarios` | Página Usuários |
| `gerenciar_permissoes` | Página Permissões |

Sem a permissão de edição, a página continua visível só para leitura (campos desabilitados, sem botões
Salvar/Excluir/Importar). Se o banco recusar algo (erro de permissão), mostre "Seu perfil não tem permissão para
esta ação. Fale com o Admin da sua empresa." — nunca a mensagem técnica.

## 2. Página Usuários (/usuarios) — permissão `gerenciar_usuarios`

Toda ação passa pela função do servidor (nunca pelo update direto):
`supabase.functions.invoke('admin-usuarios', { body: {...} })`. A resposta de erro vem em `{ erro: "texto" }` —
mostre esse texto num aviso.

- **Lista**: `body: { acao: 'listar' }` (equipe MotorCob manda também `empresa_id` da empresa selecionada no topo).
  Colunas: Nome, E-mail, Perfil (Admin · Planejamento · Operação · Gestão), Status (Ativo/Desativado, selo),
  Último acesso (dd/mm/aaaa hh:mm ou "nunca entrou"), Ações. Busca por nome/e-mail e filtro por perfil e status.
- **+ Convidar usuário**: modal com E-mail, Nome (opcional) e Perfil →
  `{ acao: 'convidar', email, nome, papel }`. Sucesso: "Convite enviado para <e-mail>. O link vale por 24 h."
  A opção "Admin" no seletor só aparece se o usuário logado for Admin.
- **Trocar perfil**: select na linha → confirmação "Trocar o perfil de <nome> de X para Y?" →
  `{ acao: 'alterar_papel', usuario_id, papel }`.
- **Desativar** / **Reativar**: botão na linha com confirmação ("<nome> perde o acesso na hora.") →
  `{ acao: 'desativar' | 'reativar', usuario_id }`.
- **Resetar senha**: botão na linha → `{ acao: 'resetar_senha', usuario_id }`. Sucesso: "Enviamos para o e-mail
  de <nome> um link para criar uma senha nova."
- Na linha do próprio usuário logado, desabilite Trocar perfil e Desativar (tooltip "Você não pode alterar o seu
  próprio acesso"). Linhas de Admin ficam só leitura para quem não é Admin.
- Equipe MotorCob (admin da equipe) continua vendo a coluna Empresa como antes.
- Remova o texto antigo "Para convidar alguém: Supabase › Authentication…" — agora o convite é pela tela.

## 3. Página Permissões (/permissoes) — permissão `gerenciar_permissoes`

Grade com **permissões nas linhas** (agrupadas pelo campo `grupo`: Operação, Gestão, Configuração, Administração)
e **perfis nas colunas** (Admin, Planejamento, Operação, Gestão).
- Fonte: `select * from permissoes_catalogo` (codigo, grupo, nome, descricao e o padrão de cada perfil nas colunas
  `admin`, `planejamento`, `operacao`, `gestao`) + `select * from permissoes_papel where empresa_id = <empresa>`
  (ajustes da empresa).
- Cada célula: interruptor. Valor = ajuste da empresa, se houver; senão o padrão. Célula diferente do padrão
  ganha um ponto âmbar com tooltip "Padrão MotorCob: liberado/bloqueado".
- Ao mudar: `upsert` em `permissoes_papel` (`empresa_id, papel, permissao, permitido`, conflito em
  `empresa_id,papel,permissao`). Se o novo valor for igual ao padrão, apague a linha do ajuste (volta ao padrão).
- Admin × "Gerenciar usuários" e Admin × "Gerenciar permissões": travados ligados (cadeado, tooltip "O Admin
  sempre mantém este acesso, para a empresa nunca ficar sem quem administre").
- Botão **Voltar ao padrão MotorCob** (confirmação): apaga todos os ajustes da empresa.
- Nome e descrição de cada permissão visíveis (descrição em texto menor). Ao salvar: "Permissões atualizadas —
  valem no próximo carregamento de página de cada usuário."

## 4. Página Auditoria (/auditoria) — permissão `ver_auditoria`

`select * from auditoria order by quando desc` (paginação de 50; filtros por período, tabela e usuário).
- Colunas: Quando (dd/mm/aaaa hh:mm), Quem (nome do perfil pelo `usuario`; se não achar, "usuário removido"), O quê
  (rótulo da `tabela`: estrategias → Estratégia, clusters → Segmento, credores → Credor, canais_empresa → Canal,
  frases → Frase, perfis → Usuário, permissoes_papel → Permissão, mapeamento_arquivos → Mapeamento,
  ocorrencia_codigos → Código de ocorrência, canal_codigos → Retorno de canal, segmentos_carteira → Segmento ×
  carteira, personas_usuario → Persona, sugestoes → Sugestão, empresas → Empresa), Ação (INSERT → Criou,
  UPDATE → Alterou, DELETE → Excluiu), Registro.
- Expandir a linha mostra `mudou` como tabela Campo · Antes · Depois (JSON grande, como `definicao`, em bloco
  recolhível com diferenças destacadas).
- Somente leitura; botão "Exportar CSV" do filtro atual.

## 5. Login, senha e verificação em duas etapas

- Tela de login: erro sempre genérico "E-mail ou senha incorretos" (nunca diga se o e-mail existe). "Esqueci a
  senha" sempre responde "Se o e-mail estiver cadastrado, enviaremos um link."
- Páginas **/definir-senha** (link do convite) e **/redefinir-senha** (link de reset): campo Nova senha + Confirmar
  → `supabase.auth.updateUser({ password })`. Regras na tela: mínimo 12 caracteres, com maiúscula, minúscula,
  número e símbolo, com indicador de força. Depois de salvar, vá para o início.
- **Verificação em duas etapas (MFA) obrigatória para Admin** (e opcional para os outros em "Minha conta"):
  - Depois do login, se o perfil for Admin, chame `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`.
    Sem fator cadastrado → tela "Proteja sua conta": `supabase.auth.mfa.enroll({ factorType: 'totp' })`, mostre o
    QR code e o código para digitar no app (Google Authenticator, Microsoft Authenticator…), peça o código de 6
    dígitos → `mfa.challenge` + `mfa.verify`.
    Com fator cadastrado e nível `aal1` → tela "Digite o código do seu app" → `mfa.challenge` + `mfa.verify`.
  - Só libere o site depois de `currentLevel === 'aal2'`.
- **Sessão**: sair após 30 min sem uso (aviso 1 min antes: "Sua sessão vai expirar") com `supabase.auth.signOut()`.
  Botão Sair sempre visível.
- Usuário desativado que ainda esteja com o site aberto: qualquer erro de permissão + `minhas_permissoes()` vazio →
  tela "Seu acesso foi desativado. Fale com o Admin da sua empresa." e `signOut()`.

## 6. Proteções gerais

- Nunca use `dangerouslySetInnerHTML` nem monte HTML com texto do banco (nomes de credor, frases, estratégias).
- Nunca coloque no código outra chave além da **anon**.
- Links externos com `rel="noopener noreferrer"`.

---

## Publicar a função `admin-usuarios` (uma vez)

Supabase › **Edge Functions** › **Deploy a new function** › **Via Editor** › nome `admin-usuarios` › apague o
exemplo e cole o arquivo `MotorCob_funcao_admin-usuarios.ts` › **Deploy** (deixe "Verify JWT" ligado).
Depois, em **Edge Functions › Secrets**, crie `SITE_URL = https://motorcob.online` e
`ORIGENS_PERMITIDAS = https://motorcob.online`. (A chave service_role a função já recebe do próprio Supabase —
não cole em lugar nenhum.)
