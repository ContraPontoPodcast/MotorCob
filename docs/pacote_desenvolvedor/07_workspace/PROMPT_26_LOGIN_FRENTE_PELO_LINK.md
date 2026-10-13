# Prompt Horizons — Workspace 26: login abre com a frente que veio no link

Projeto do **motorcob.online** (o da plataforma), depois do prompt 23 (passo 40). O site motorcli.online manda
quem clica em "Entrar" para `/login?frente=motorcli`.

```text
Login: frente escolhida pelo link. Não mude tabelas nem o resto do login.

1. /login aceita ?frente=motorcob ou ?frente=motorcli (qualquer outro valor é ignorado). Guarde o valor em
   sessionStorage "mc-frente-link" ao abrir a página.
2. Enquanto não há frente escolhida, o primeiro passo do login mostra o nome da frente do link no lugar de
   "MotorCX" ao lado do símbolo (ex.: "MotorCli" e, embaixo, "por MotorCX").
3. Depois da senha e do código de duas etapas:
   - se a frente do link está em rpc('minhas_frentes'): entra direto nela, sem a tela "Escolha a frente": só
     troque o contexto (sessionStorage "mc-frente"). NÃO chame escolher_frente aqui, para não mexer na
     frente preferida que o usuário já gravou;
   - se não está: siga o fluxo normal e mostre um aviso discreto no topo do Workspace: "Sua empresa ainda não
     tem o MotorCli. Fale com o time comercial." (ou MotorCob), com um "×" para fechar.
   Apague "mc-frente-link" depois de usar.
4. Já logado e abrindo /login?frente=motorcli: troque para a frente (se liberada) e vá para /workspace.

Confira: motorcli.online › Entrar abre o login com "MotorCli"; usuário com as duas frentes entra direto no
MotorCli; usuário só MotorCob vê o aviso e entra no MotorCob.
```
