# MotorCob na nuvem (Supabase + motorcob.online)

```
motorcob.online (site)  ──login/leitura/upload──>  Supabase (Postgres + Auth + Storage)
                                                        ↑  grava resultados (chave service_role)
                                          rotina diária do motor (Python)
```

- **Supabase:** banco, login e arquivos. Tabelas e permissões em `supabase/migrations/`
  (aplicar na ordem do nome do arquivo).
- **Várias empresas clientes no mesmo site:** tabela `empresas`; todo dado tem
  `empresa_id`; usuário de empresa só vê a própria; a equipe MotorCob (`perfis.equipe`)
  vê todas. Arquivos no Storage ficam em `entradas/<slug>/...` e `saidas/<slug>/...`.
- **Site:** só login, envio de arquivos e consulta. Prompt em `docs/PROMPT_SITE.md` e o
  ajustes em `docs/PROMPT_SITE_MULTIEMPRESA.md` (várias empresas e clusters) e
  `docs/PROMPT_SITE_ESTRATEGIAS.md` (estratégias, canais e retorno do enriquecimento).
- **Rotina do motor** (`nuvem/sincronizar.py`, roda no Mac): baixa as entradas enviadas
  pelo site, roda o `rodar_dia.py` e publica estado, trilha, fila e arquivos de volta.

## 1. Criar o projeto no Supabase

1. https://supabase.com › New project.
   - Nome: `motorcob` · **Região: South America (São Paulo)** · senha forte do banco
     (guarde num cofre de senhas).
   - Projeto **separado** de qualquer outro (não use o projeto do Portal ContraPonto).
2. Plano: para dados de produção, prefira um plano pago (backup diário e sem pausa por
   inatividade).

## 2. Aplicar o banco

SQL Editor › New query › cole o conteúdo de cada arquivo de `supabase/migrations/`, na
ordem, › Run. Cada um deve terminar sem erro:
1. `20260925000001_motorcob.sql` (banco inicial)
2. `20260928000001_multiempresa.sql` (várias empresas; quem já era admin vira equipe
   MotorCob; dado que já existia vai para a empresa `legado`)
3. `20260928000002_clusters.sql` (clusters de cada empresa, definidos no site)
4. `20260929000001_estrategias.sql` (estratégias por cluster, canais da empresa e retorno do
   enriquecimento)
5. `20260930000001_mapa_esteira.sql` (saldo por cliente e as views do Mapa da Esteira)
6. `20261002000001_numeros_por_cliente.sql` (quantos contatos por cliente em cada canal)
7. `20261003000001_personas.sql` (personas aprendidas e sugestões de régua)
8. `20261004000001_acoes_dia.sql` (ações realizadas: totais por dia, canal, régua,
   segmento e persona — sem dado pessoal)
9. `20261005000001_credores.sql` (credores/carteiras de cada empresa; credor_id em tudo;
   tipos de arquivo incremental, retirada, acordo e baixa)
10. `20261006000001_enquadramento.sql` (onde cada cliente se enquadrou: esteira, persona,
   ação de hoje; view enquadramento)
11. `20261007000001_personas_usuario.sql` (personas criadas pela empresa por carteira, usadas
   como público das ações da esteira)
12. `20261008000001_enriquecimento_esteira.sql` (quando cada cliente foi ao bureau e quando voltou)
13. `20261009000001_segmentos_carteira.sql` (quais carteiras usam cada segmento e se está em uso
   em cada uma; view segmentos_em_uso)

Atalho para quem já aplicou até o 4: `supabase/atualizar_producao_2026-10.sql` junta do 5
ao 13 num arquivo só (pode ser rodado mais de uma vez). Site: `docs/PROMPT_SITE_ATUALIZACAO.md`.

(Alternativa pela linha de comando: `supabase link --project-ref <ref>` e `supabase db push`.)

## 3. Configurar o login

Authentication:
- **Sign In / Providers › Email:** habilitado. **Allow new users to sign up: DESLIGADO**
  (só entra quem for convidado).
- **URL Configuration:** Site URL `https://motorcob.online`; Redirect URLs
  `https://motorcob.online/**`.
- **Emails:** personalize os modelos de convite e de redefinição de senha em português.
  Para produção, configure um SMTP próprio (o envio padrão do Supabase é limitado).

## 4. Primeiro administrador

1. Authentication › Users › **Invite user** com o seu e-mail. Aceite o convite e defina a senha.
2. SQL Editor:
   ```sql
   update public.perfis set papel = 'admin' where email = 'seu-email@dominio.com';
   ```
3. Os demais usuários: crie pelo painel (Add user, Auto Confirm) e, na tela Usuários do
   site, escolha a empresa e o papel. Sem empresa, o usuário não vê nada.

| Papel | Pode |
|---|---|
| admin | equipe MotorCob: tudo, inclusive empresas e usuários. De empresa: papel e ativo dos usuários da própria empresa |
| planejamento | enviar arquivos, baixar todas as saídas da empresa (inclusive `fila_do_dia.csv`) |
| operacao | baixar as listas por canal (ID + contato), consultar clientes e o painel inicial |
| gestao | painel, comitê, listas por canal e auditoria de acessos |

Tudo sempre dentro da empresa do usuário (a equipe MotorCob escolhe a empresa no site).

## 5. Chaves

Project Settings › API:
- **URL** e **anon/public key** → vão para o site (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- **service_role key** → **só** para a rotina do motor. Nunca no site, nunca no git, nunca
  em mensagem. Quem tem essa chave lê e altera tudo.

## 6. Site

Siga `docs/PROMPT_SITE.md`.

## 7. Ligar a rotina do Mac ao site

No Mac, com o MotorCob já instalado (`docs/PRODUCAO.md`):
```bash
~/MotorCob/scripts/configurar_nuvem.sh
```
Ele pede a URL do projeto e a chave service_role (digitada sem aparecer na tela), grava em
`~/MotorCob-dados/config/supabase.env` (só o seu usuário lê) e testa a conexão.

A partir daí, o fluxo diário é:
1. Durante o dia, cada empresa (ou a equipe MotorCob por ela) envia pelo site a **base
   bruta** e o arquivo de **ocorrências** (CPC ou não por tentativa), além de retornos de
   fornecedor e parcelas quando houver.
2. No horário agendado — ou, com `scripts/instalar_mac.sh vigiar`, até 2 minutos depois
   de a carga do credor chegar (`rodar_dia.sh --vigiar` → `nuvem.sincronizar vigiar`, só
   para a empresa que subiu a carga) — o Mac roda `scripts/rodar_dia.sh`, que: atualiza o motor
   (`git pull`) → para cada empresa ativa, baixa os envios pendentes → converte a base
   bruta pelo `empresas/<slug>.json` → junta o retorno do enriquecimento → lê clusters,
   estratégias e canais que a empresa definiu no site →
   liga cada ocorrência ao contato que o motor mandou
   acionar → roda o motor → publica TAG, trilha, fila do dia e arquivos → marca cada envio
   como processado (ou erro, com o motivo) e registra a execução da empresa com os
   alertas. Uma empresa com erro não impede as outras.
3. A operação entra no site e baixa a lista de cada canal (ID do cliente + contato).

No fim do mês, `scripts/relatorio_mes.sh 2026-09` publica os KPIs e o Excel do comitê no site.

Se a rotina falhar, a execução aparece com erro na tela inicial do site e os envios
continuam pendentes para a próxima rodada. O Mac precisa estar ligado no horário (ou roda
quando acordar).

## Testar as permissões localmente

Com um Postgres 15+ vazio:
```bash
psql -d sb -f supabase/testes/stub_supabase.sql
psql -d sb -f supabase/migrations/20260925000001_motorcob.sql
psql -d sb -f supabase/migrations/20260928000001_multiempresa.sql
psql -d sb -f supabase/migrations/20260928000002_clusters.sql
psql -d sb -f supabase/migrations/20260929000001_estrategias.sql
psql -d sb -f supabase/migrations/20260930000001_mapa_esteira.sql
python supabase/testes/testar_rls.py      # 96 verificações por papel e por empresa
```
