# MotorCob na nuvem (Supabase + motorcob.online)

```
motorcob.online (site)  ──login/leitura/upload──>  Supabase (Postgres + Auth + Storage)
                                                        ↑  grava resultados (chave service_role)
                                          rotina diária do motor (Python)
```

- **Supabase:** banco, login e arquivos. Tabelas e permissões em
  `supabase/migrations/20260925000001_motorcob.sql`.
- **Site:** só login, envio de arquivos e consulta. Prompt em `docs/PROMPT_SITE.md`.
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

SQL Editor › New query › cole o conteúdo de
`supabase/migrations/20260925000001_motorcob.sql` › Run. Deve terminar sem erro.

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
3. Os demais usuários: convide pelo painel e defina o papel na tela Usuários do site.

| Papel | Pode |
|---|---|
| admin | tudo, inclusive gerenciar usuários |
| planejamento | enviar arquivos, baixar todas as saídas (inclusive `fila_do_dia.csv`, que tem contato) |
| operacao | baixar os IDs por canal, consultar clientes e o painel inicial |
| gestao | painel, comitê, IDs e auditoria de acessos (sem arquivos com contato) |

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
1. Durante o dia, a equipe de planejamento envia pelo site os arquivos (clientes, contatos,
   parcelas, retornos dos fornecedores, log do portal).
2. No horário agendado, o Mac roda `scripts/rodar_dia.sh`, que agora: baixa os envios
   pendentes → roda o motor → publica TAG, trilha, fila do dia (IDs) e arquivos → marca
   cada envio como processado (ou erro, com o motivo) e registra a execução com os alertas.
3. A operação entra no site e baixa os IDs de cada canal.

No fim do mês, `scripts/relatorio_mes.sh 2026-09` publica os KPIs e o Excel do comitê no site.

Se a rotina falhar, a execução aparece com erro na tela inicial do site e os envios
continuam pendentes para a próxima rodada. O Mac precisa estar ligado no horário (ou roda
quando acordar).

## Testar as permissões localmente

Com um Postgres 15+ vazio:
```bash
psql -d sb -f supabase/testes/stub_supabase.sql
psql -d sb -f supabase/migrations/20260925000001_motorcob.sql
python supabase/testes/testar_rls.py      # 31 verificações por papel
```
