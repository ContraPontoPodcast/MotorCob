# Prompt Horizons — Resetar a verificação em duas etapas de outra pessoa

Antes: publique a versão nova da função `admin-usuarios` (Supabase › Edge Functions › admin-usuarios › Code ›
apague tudo › cole `MotorCob_funcao_admin-usuarios.ts` desta pasta › Deploy; "Verify JWT" continua ligado).
Depois cole no Horizons e publique:

```text
Na página Usuários, adicione a ação "Resetar duas etapas". Não mude outras telas, tabelas ou políticas.

ONDE: no menu de ações de cada usuário (o mesmo de "Resetar senha"), só para quem tem gerenciar_usuarios. Não
aparece na linha da própria pessoa. Usuário Admin: só aparece para quem também é Admin.

CONFIRMAÇÃO (modal): título "Resetar a verificação em duas etapas de {nome}?" / texto "Use quando a pessoa trocou
de celular, apagou o aplicativo ou ficou presa no código. No próximo login ela cadastra o autenticador de novo
(Admin é obrigado a cadastrar)." Botões "Cancelar" e "Resetar" (vermelho #FF3B30, texto branco).

AÇÃO: supabase.functions.invoke('admin-usuarios', { body: { acao: 'resetar_2fa', usuario_id } }).
- Sucesso: aviso "Verificação em duas etapas resetada. Avise {nome} para entrar de novo e cadastrar o
  autenticador." (data.removidos = 0 → "{nome} não tinha autenticador cadastrado.").
- Erro: mostre data.erro / error.context (a função responde { erro: "texto" }). Casos já em português: "entre
  com o seu código de duas etapas para resetar o de outra pessoa" (quem pede entrou sem o código; mostre também o
  botão "Sair e entrar de novo"), "só um Admin cria ou altera outro Admin", "usuário de outra empresa".

NA TELA DO CÓDIGO DO LOGIN: o link "Problemas com o código?" passa a dizer "Peça a outro Admin da sua empresa para
resetar a sua verificação em Usuários (menu do seu nome › Resetar duas etapas), ou fale com o suporte MotorCob."

Tudo fica na Auditoria como "Usuário · Alterou · duas_etapas: resetada".
```
