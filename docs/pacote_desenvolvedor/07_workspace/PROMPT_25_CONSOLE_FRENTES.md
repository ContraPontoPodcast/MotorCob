# Prompt Horizons — Workspace 25: ligar as frentes no Console e limitar usuários por frente

Rode depois do prompt 24. A equipe MotorCX decide quais frentes cada empresa contratou (`empresa_frentes`); o
Admin da empresa pode limitar um usuário a uma frente (`usuario_frentes`; sem linha = todas as da empresa).

```text
Frentes no Console e em Usuários. Não mude tabelas nem políticas.

1. CONSOLE › EMPRESAS › (empresa) › aba "Frentes" (só equipe): duas linhas, MotorCob · Cobrança e MotorCli ·
   Jornada do Cliente, cada uma com o quadrado da sigla (COB #C9A35A, CLI #8E8E93), chave Ligada/Desligada
   (upsert em empresa_frentes com ativo) e "desde" (data). Ao ligar o MotorCli pela primeira vez, ofereça
   "Criar a carteira Jornada" (insert em credores: codigo 'jornada', nome 'Jornada', frente 'motorcli').
   Não deixe desligar a última frente ativa: "A empresa precisa de pelo menos uma frente."
   Na lista de empresas, coluna "Frentes" com as siglas ligadas.

2. NOVA EMPRESA (Console): campo "Frentes" com as duas opções (MotorCob marcado). Depois de criar a empresa,
   grave as escolhidas em empresa_frentes (o MotorCob já nasce ligado; se desmarcado, update ativo=false depois
   de ligar o MotorCli).

3. USUÁRIOS E PERMISSÕES (cliente e equipe): coluna "Frentes" (siglas) e, no editar usuário, o grupo "Frentes
   que este usuário vê": "Todas as frentes da empresa" (padrão: apaga as linhas de usuario_frentes dele) ou
   marcar MotorCob e/ou MotorCli (grava as linhas). Só aparece se a empresa tiver as duas frentes ligadas.
   Quem pode: quem já pode gerenciar usuários.

4. CREDORES (MotorCob): a lista mostra só os de frente='motorcob'; "Novo credor" grava frente 'motorcob'.
   As carteiras do MotorCli ficam em /jornada/carteiras (prompt 24).

Confira: empresa só MotorCob segue igual; ao ligar o MotorCli, o usuário vê a escolha da frente no próximo login.
```
