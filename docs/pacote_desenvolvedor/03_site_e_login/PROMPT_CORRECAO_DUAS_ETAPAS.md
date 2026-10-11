# Prompt Horizons — Correção: verificação em duas etapas (refazer do zero)

Sintoma: "Não foi possível verificar o segundo fator". Diagnóstico no banco (auth.mfa_factors × auth.mfa_challenges):
o fator ficava "unverified" e NENHUM desafio era criado — o site mandava o código sem pedir o desafio antes, e o
Supabase recusava qualquer código. A primeira correção não pegou porque o Horizons manteve o código antigo; esta
manda apagar e refazer. Cole no Horizons e publique. Não precisa de SQL.

```text
Apague todo o código atual de verificação em duas etapas (MFA) do login e recrie do zero, exatamente assim.
Não mude outras telas.

Depois de signInWithPassword:
1. const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
   const { data: fatores } = await supabase.auth.mfa.listFactors()
2. nivel.currentLevel === 'aal2' → vá para a página inicial.
3. fatores.totp.length > 0 → tela "Digite o código." com fatores.totp[0].id.
4. Nenhum fator verificado e perfil Admin → tela de cadastro:
   a) para cada f em fatores.all com f.status === 'unverified': await supabase.auth.mfa.unenroll({ factorId: f.id })
   b) const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp',
      friendlyName: 'MotorCob ' + Date.now() })
   c) mostre <img src={data.totp.qr_code}> e o texto data.totp.secret para copiar
   d) ao digitar 6 dígitos: await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code })
   e) "Cancelar" → unenroll({ factorId: data.id }) e signOut()
5. Demais perfis sem fator → página inicial.

Tela do código: await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\D/g, '') }).
Nunca chame mfa.verify sem um challenge criado antes. Sucesso → await supabase.auth.refreshSession() e navegue;
não volte para a tela do código depois do sucesso.

ERROS: em QUALQUER falha (enroll, challengeAndVerify, listFactors), mostre na tela
"Não foi possível verificar o segundo fator." e, numa segunda linha em cinza 12px, "Detalhe: " + error.message
(a mensagem em inglês do Supabase). Faça também console.error('MFA', etapa, error).
Link "Problemas com o código?" → "Peça a outro Admin da sua empresa para resetar a sua verificação em Usuários,
ou fale com o suporte MotorCob." + "Sair" (signOut).
```
