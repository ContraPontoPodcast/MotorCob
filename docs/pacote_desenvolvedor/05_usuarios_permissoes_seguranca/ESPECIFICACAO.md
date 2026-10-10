# Passo 4 — Menus por permissão, Permissões, Auditoria, senha e sessão

Já está no ar (não refazer): página **Usuários** com convite, trocar perfil, desativar, reativar, resetar senha e
painel de **Acessos** por usuário. O banco já tem tudo abaixo; aqui é só o site.

## 1. Menus e botões pelas permissões
Depois do login (e ao trocar de empresa): `supabase.rpc('minhas_permissoes')` → lista de códigos. Guardar num
contexto e usar no lugar de `papel === 'admin'` e afins em todo o site.

| Código | Mostra / habilita |
|---|---|
| `baixar_listas` | Downloads da Lista do dia (arquivos por canal) |
| `baixar_relatorios` | Downloads de fila completa, higienização, enriquecimento e demais saídas |
| `baixar_comite` | Página Comitê |
| `enviar_arquivos` | Página Enviar arquivos |
| `reenquadrar` | Botão "Reenquadrar agora" |
| `editar_orquestracao` | Edição em Segmentos, Orquestração, Personas e Sugestões |
| `editar_credores` | Edição em Credores, Mapeamento, Códigos de ocorrência e Regras de retorno |
| `editar_canais` | Edição em Canais e Frases (playbook) |
| `ver_acessos` | Página Acessos |
| `ver_auditoria` | Página Auditoria (nova) |
| `gerenciar_usuarios` | Página Usuários |
| `gerenciar_permissoes` | Página Permissões (nova) |

Sem permissão de edição, a página abre só para leitura (campos desabilitados, sem Salvar/Excluir/Importar).
Erro de permissão do banco (código `42501` ou mensagem de RLS) → "Seu perfil não tem permissão para esta ação.
Fale com o Admin da sua empresa."

## 2. Página Permissões (`/permissoes`) — `gerenciar_permissoes`
Grade: permissões nas linhas (agrupadas por `grupo`: Operação, Gestão, Configuração, Administração), perfis nas
colunas (Admin, Planejamento, Operação, Gestão).
- Dados: `from('permissoes_catalogo').select('*').order('ordem')` (codigo, grupo, nome, descricao e o padrão em
  `admin`, `planejamento`, `operacao`, `gestao`) + `from('permissoes_papel').select('*').eq('empresa_id', empresa)`.
- Célula = interruptor. Valor = ajuste da empresa, se houver; senão o padrão. Diferente do padrão → pontinho laranja (#FF9500)
  pequeno com tooltip "Padrão MotorCob: liberado/bloqueado".
- Mudar → `upsert` em `permissoes_papel` (`empresa_id, papel, permissao, permitido`; conflito
  `empresa_id,papel,permissao`). Igual ao padrão → `delete` da linha.
- Admin × Gerenciar usuários e Admin × Gerenciar permissões: travados ligados (cadeado; tooltip "O Admin sempre
  mantém este acesso").
- "Voltar ao padrão MotorCob" (com confirmação na própria tela): apaga os ajustes da empresa.

## 3. Página Auditoria (`/auditoria`) — `ver_auditoria`
`from('auditoria').select('*').order('quando', {ascending:false})`, paginação de 50; filtros por período, tabela e
usuário.
- Colunas: Quando (dd/mm/aaaa hh:mm) · Quem (nome do perfil pelo `usuario`; sem perfil → "usuário removido") ·
  O quê (rótulo da `tabela`: estrategias Estratégia · clusters Segmento · credores Credor · canais_empresa Canal ·
  frases Frase · perfis Usuário · permissoes_papel Permissão do perfil · permissoes_usuario Acesso de usuário ·
  mapeamento_arquivos Mapeamento · ocorrencia_codigos Código de ocorrência · canal_codigos Retorno de canal ·
  segmentos_carteira Segmento × carteira · personas_usuario Persona · sugestoes Sugestão · empresas Empresa) ·
  Ação (INSERT Criou · UPDATE Alterou · DELETE Excluiu) · Registro.
- Expandir a linha mostra `mudou` como tabela Campo · Antes · Depois (JSON grande recolhível).
- Somente leitura; "Exportar CSV" do filtro atual.

## 4. Criar senha: `/definir-senha` (convite) e `/redefinir-senha` (esqueci a senha)
A função `admin-usuarios` manda o convite para `/definir-senha`; o login manda o reset para `/redefinir-senha`.
Hoje só existe `/nova-senha`: crie as duas rotas usando o mesmo componente (e mantenha `/nova-senha` funcionando).
- Visual do login novo (tela branca, linha Apple, pasta 03). Título "Crie sua senha." (convite) ou "Nova senha." (reset).
- Campos Nova senha + Confirmar; regras visíveis: mínimo 12 caracteres, maiúscula, minúscula, número e símbolo;
  indicador de força. Salvar → `auth.updateUser({ password })`.
- Depois: se o perfil for Admin, segue para o cadastro do autenticador (MFA, pasta 03); senão, `/inicio`.
- Link vencido/inválido → "Este link expirou. Peça um novo ao Admin da sua empresa ou use Esqueci a senha."

## 5. Sessão e usuário desativado
- Sair após **30 min sem uso** (mouse/teclado/rolagem); aviso 1 min antes "Sua sessão vai expirar" com
  "Continuar conectado". Sair = `auth.signOut()` + ir para `/login`.
- `minhas_permissoes()` vazio, ou erro de permissão em toda chamada → tela "Seu acesso foi desativado. Fale com o
  Admin da sua empresa." e `signOut()`.
- "Minha conta": opção de ativar o autenticador para quem não é Admin (opcional).

## 6. Proteções gerais (pentest)
- Nunca `dangerouslySetInnerHTML` nem HTML montado com texto do banco (nomes de credor, frases, estratégias).
- Só a chave pública no código. Links externos com `rel="noopener noreferrer"`.
- Cabeçalhos de segurança no domínio (ver `06_referencias/SEGURANCA.md`, seção 3).

## Critérios de aceite
- Login como Operação: sem menus de Configuração/Administração; tentar abrir `/permissoes` pela URL mostra "sem
  permissão". Admin: vê Usuários, Permissões e Auditoria.
- Mudar uma permissão aparece na Auditoria com antes/depois.
- Convite recebido por e-mail abre `/definir-senha` e cria a senha.
- 30 min parado → sai sozinho.
