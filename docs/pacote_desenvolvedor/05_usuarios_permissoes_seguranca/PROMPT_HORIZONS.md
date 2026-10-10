# Prompt Horizons — Menus por permissão, Permissões, Auditoria, senha e sessão

Rode depois do prompt da pasta 03. Cole no Horizons e publique:

---

```text
Cinco ajustes. A página Usuários (convite, acessos) já existe: não refaça. Não mude tabelas, views ou políticas.

1. MENUS PELAS PERMISSÕES
Depois do login e ao trocar de empresa, chame supabase.rpc('minhas_permissoes') (lista de códigos) e guarde num
contexto. Use em todo o site NO LUGAR do papel fixo (papel === 'admin' etc.):
baixar_listas → downloads da Lista do dia · baixar_relatorios → downloads de fila completa e demais saídas ·
baixar_comite → página Comitê · enviar_arquivos → Enviar arquivos · reenquadrar → botão Reenquadrar agora ·
editar_orquestracao → edição em Segmentos, Orquestração, Personas, Sugestões · editar_credores → edição em
Credores, Mapeamento, Códigos de ocorrência, Regras de retorno · editar_canais → edição em Canais e Frases ·
ver_acessos → Acessos · ver_auditoria → Auditoria · gerenciar_usuarios → Usuários · gerenciar_permissoes →
Permissões. Sem permissão de edição a página abre só para leitura. Erro de permissão do banco → "Seu perfil não
tem permissão para esta ação. Fale com o Admin da sua empresa."

2. PÁGINA PERMISSÕES (/permissoes, só com gerenciar_permissoes)
Grade: permissões nas linhas, agrupadas por "grupo"; perfis nas colunas (Admin, Planejamento, Operação, Gestão).
Dados: from('permissoes_catalogo').select('*').order('ordem') e from('permissoes_papel').select('*')
.eq('empresa_id', empresa). Cada célula é um interruptor: valor do ajuste da empresa se houver, senão o padrão
(colunas admin/planejamento/operacao/gestao do catálogo). Diferente do padrão → pontinho âmbar com tooltip
"Padrão MotorCob: liberado/bloqueado". Mudar → upsert em permissoes_papel (empresa_id, papel, permissao,
permitido; onConflict 'empresa_id,papel,permissao'); igual ao padrão → delete da linha. Admin × gerenciar_usuarios
e Admin × gerenciar_permissoes travados ligados (cadeado). Botão "Voltar ao padrão MotorCob" com confirmação na
própria tela (apaga os ajustes da empresa).

3. PÁGINA AUDITORIA (/auditoria, só com ver_auditoria)
from('auditoria').select('*').order('quando', {ascending:false}), 50 por página, filtros período/tabela/usuário.
Colunas: Quando (dd/mm/aaaa hh:mm), Quem (nome do perfil pelo campo usuario; sem perfil → "usuário removido"),
O quê (estrategias Estratégia, clusters Segmento, credores Credor, canais_empresa Canal, frases Frase, perfis
Usuário, permissoes_papel Permissão do perfil, permissoes_usuario Acesso de usuário, mapeamento_arquivos
Mapeamento, ocorrencia_codigos Código de ocorrência, canal_codigos Retorno de canal, segmentos_carteira Segmento ×
carteira, personas_usuario Persona, sugestoes Sugestão, empresas Empresa), Ação (INSERT Criou, UPDATE Alterou,
DELETE Excluiu), Registro. Expandir mostra o campo "mudou" como tabela Campo · Antes · Depois. Exportar CSV.

4. CRIAR SENHA: /definir-senha (convite) e /redefinir-senha (esqueci a senha)
Crie as duas rotas com o mesmo componente da atual /nova-senha (que continua funcionando), no visual preto do login:
"Crie sua senha." ou "Nova senha.", campos Nova senha e Confirmar, regras visíveis (mínimo 12, maiúscula,
minúscula, número, símbolo) com indicador de força → auth.updateUser({ password }). Depois: Admin vai para o
cadastro do autenticador (MFA); demais vão para /inicio. Link vencido → "Este link expirou. Peça um novo ao Admin
da sua empresa ou use Esqueci a senha."

5. SESSÃO E SEGURANÇA
- Sair após 30 minutos sem uso (aviso 1 minuto antes "Sua sessão vai expirar" com "Continuar conectado"):
  auth.signOut() e ir para /login.
- minhas_permissoes() vazio ou erro de permissão em tudo → tela "Seu acesso foi desativado. Fale com o Admin da
  sua empresa." e signOut().
- Nunca use dangerouslySetInnerHTML nem monte HTML com texto do banco. Só a chave pública no código.
```
