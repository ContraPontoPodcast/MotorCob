# Prompt Horizons — Correção: verificação em duas etapas (cadastro preso em "unverified")

Sintoma: depois de ativar o duplo fator, o login não passa. No banco, auth.mfa_factors mostra o fator com status
"unverified": o primeiro cadastro ficou pela metade e a tela tenta cadastrar outro com o mesmo nome, que o Supabase
recusa. Cole no Horizons e publique. Não precisa de SQL.

```text
Corrija só o fluxo de verificação em duas etapas do login (e o da página Minha conta, se existir). Não mude o
visual, outras telas, tabelas ou políticas. Use a API mfa do supabase-js v2 exatamente assim:

DEPOIS DE signInWithPassword (e em toda rota protegida, no guarda de rota)
1. const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
   const { data: fatores } = await supabase.auth.mfa.listFactors()
   verificados = fatores.totp (só os verificados) · pendentes = fatores.all.filter(f => f.factor_type === 'totp'
   && f.status === 'unverified')
2. nivel.currentLevel === 'aal2' → entrou: vá para /workspace (ou /inicio se o Workspace ainda não existir).
   Nunca mostre cadastro nem código para quem já está em aal2.
3. verificados.length > 0 → tela "Digite o código." com o fator verificados[0].
4. Nenhum verificado e o perfil é Admin → tela de cadastro (abaixo). Demais perfis sem fator → entram (aal1).

TELA DO CÓDIGO
- 6 campos (ou um campo com inputmode="numeric", autocomplete="one-time-code"); aceite colar "123 456"; tire
  espaços; envie sozinho ao completar 6 dígitos.
- await supabase.auth.mfa.challengeAndVerify({ factorId, code }). Sucesso → await supabase.auth.refreshSession(),
  confira de novo getAuthenticatorAssuranceLevel() === 'aal2' e só então navegue. Não volte para esta tela depois
  do sucesso (é isso que causava o vai-e-volta).
- Erro: limpe os campos, foco no primeiro e "Código inválido. Use o código que está na tela do aplicativo agora e
  confira se o relógio do celular está no automático."
- Link "Problemas com o código?" → texto: "Peça a outro Admin da sua empresa ou ao suporte MotorCob para resetar
  a sua verificação em duas etapas." + "Sair" (signOut).

TELA DE CADASTRO DO AUTENTICADOR
1. ANTES de cadastrar, apague os pendentes: para cada f de pendentes → await supabase.auth.mfa.unenroll({
   factorId: f.id }) (ignore erro de um que já sumiu).
2. const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName:
   `MotorCob ${new Date().toISOString().slice(0, 16)}` }) — nome sempre diferente.
   Se mesmo assim der erro de fator já existente, refaça listFactors, apague os pendentes e tente UMA vez mais.
   Persistindo: "Não conseguimos preparar o autenticador. Fale com o suporte MotorCob."
3. Mostre "Proteja sua conta." / "Leia o código com o aplicativo autenticador (Google Authenticator, Microsoft
   Authenticator ou 1Password)." + a imagem data.totp.qr_code (img src, 200px, fundo branco) + a chave
   data.totp.secret em grupos de 4 com botão "Copiar chave" + campo do código de 6 dígitos.
4. Confirmar → challengeAndVerify({ factorId: data.id, code }) → refreshSession → aal2 → navegue.
5. "Cancelar" ou sair da tela sem confirmar → unenroll({ factorId: data.id }) e signOut(), para não deixar
   cadastro pela metade de novo.
6. Guarde data.id só em memória (nunca em localStorage).

MINHA CONTA › SEGURANÇA (se já existir): o botão "Ligar" usa os mesmos passos 1 a 6; "Desligar" usa unenroll do
fator verificado (Admin não pode desligar).

Teste antes de publicar: (a) conta com fator pendente entra e cadastra de novo; (b) conta com fator verificado
pede o código uma vez e entra; (c) código errado mostra o erro e deixa tentar; (d) Cancelar no cadastro não deixa
fator pendente.
```
