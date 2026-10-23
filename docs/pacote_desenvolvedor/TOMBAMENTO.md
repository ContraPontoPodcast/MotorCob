# Tombamento — virada da homologação (SQL 29 a 44, funções, motor, prompts 36 a 70)

Roteiro único para colocar no ar tudo o que foi homologado de 14 a 16/10/2026. Substitui, para este lote, a sequência
dos passos 59 a 105 do `00_LEIA_PRIMEIRO.md`: o mesmo conteúdo, agrupado por lugar e com cada função publicada uma vez
só, na versão final. A página com os textos prontos para copiar e marcar fica no artifact "Tombamento MotorCX".

Regras: **B a E numa sentada só** (com o plantão pausado, a Lista do dia de amanhã não sai) · **banco antes das telas**
(SQL e funções novas aceitam o site atual) · **senhas e tokens só no painel de cada serviço**.

## A. Preparar (dias antes; nada muda para os clientes)
1. GitHub: merge do PR 111 (Workspace). Os PRs 108 a 110 já estão na main.
2. SQL Editor: `01_banco/CONFERENCIA_GERAL.sql` (só lê). Leia pelo nome da linha (SQL 27, SQL 29…), não pelo número.
   Esperado: até o SQL 28 OK; do SQL 29 em diante FALTA.
3. Só se der FALTA: SQL 27 (`20261124000001_ver_empresa_criada.sql`) e SQL 28 (`20261125000001_ciclo_padroes.sql`).
   Pendências anteriores continuam: confirmar o SQL 26 e o passo 41 (MotorCli Jornada).
4. Provedor do modelo do Assistente: limite mensal um pouco acima do teto (R$ 399,90).
5. Supabase › Database › Backups: backup de hoje.

## B. Abrir a janela (mesmo dia, depois que a Lista do dia sair)
1. Google Cloud: `sudo systemctl stop motorcob` (via `gcloud compute ssh motorcob … --command=…`, `06_referencias/NUVEM_GCP.md`).
2. Supabase › Auth › Providers › Email: senha mínima 12, letras e dígitos; leaked password protection.
3. Supabase › Edge Functions › Secrets: conferir o remetente de hoje. Se não houver `FATURA_EMAIL_DE`, criar
   `EMAIL_DE_FINANCEIRO` com o endereço que manda as faturas hoje; idem `RELATORIO_EMAIL_DE` / `EMAIL_DE_RELATORIOS`.

## C. Banco (SQL Editor, em ordem)
SQL 29 `20261126000001_ajustes_console` · SQL 30 `20261127000001_produtos_rotas_administrativo` (mistura do Teleco
de agosto/2026, editável depois) · SQL 31 `20261128000001_estrategia_carteira` · SQL 32
`20261129000001_experiencia_glossario_tema` · SQL 33 `20261130000001_score_entrega_qualidade` · SQL 34
`20261201000001_padroes_comuns_avisos` · SQL 35 `20261202000001_primeiro_uso` · SQL 36
`20261203000001_atendimento_radar` · SQL 37 `20261204000001_faturas_contratacao` · SQL 38
`20261205000001_acordos_fatura` · SQL 39 `20261206000001_relatorios_v2` · SQL 40 `20261207000001_jornada_v2` · SQL 41
`20261208000001_api_v2` · SQL 42 `20261209000001_emails_sistema` · SQL 43 `20261210000001_assistente_v2` · SQL 44
`20261211000001_workspace_v2`. Depois, a conferência de novo: SQL 29 a SQL 44 OK.

## D. Funções (versão final, uma vez cada; `python3 scripts/juntar_funcao.py <nome>`)
`cobranca`, `pagamentos-webhook`, `api`, `admin-usuarios`, `assistente` (colar por cima; configurações ficam) ·
`relatorios` (nova, Verify JWT desligado). A `emails` fica para a etapa H. As publicações intermediárias dos passos 60, 71, 74, 84, 87,
90, 95, 98, 101 e 104 não são necessárias.

## E. Modelos do login e motor (fecha a janela)
1. Auth › Templates: convite, redefinir senha, avisos de segurança; validade do link 86400 s (`EMAILS_SISTEMA.md`, passo 5).
2. GitHub › Actions › imagem: execução verde depois do merge.
3. Google Cloud: `sudo systemctl start motorcob-atualizar; sudo systemctl start motorcob` e conferir o log ("plantão no ar").

## F. Site (Horizons, no seu ritmo, em ordem)
36–37 Console e empresa · 38–40 Produtos, fornecedores, Administrativo · 41–42 Orquestração · 43–45 Glossário, tema,
menus · 46–48 Qualidade e Score · 49–50 Padrões comuns · 51–52 Primeiro uso · 53–54 Atendimento e Radar · 55–58
Faturas e acordo · 59–60 Relatórios · 61–62 Jornada · 63 Integrações · 64–65 E-mails · 66–67 Assistente · 68–70
Workspace. Um prompt por vez, conferindo a tela; se o Horizons publica só no botão, publique no fim de cada grupo.

## G. Conferir e completar
0. SQL 45 (`20261212000001_links_inicio.sql`): links do Início que davam 404 (Lista do dia, carga com erro, envio
   pausado, avisos de fatura). Só SQL Editor; o site não muda.
0b. SQL 46 (`20261213000001_permissoes_ver.sql`): permissões `ver_clientes` e `ver_painel` (Clientes, Personas e
   Painel voltam ao menu). Depois, com o protótipo `docs/homologacao/navegacao-prototipo.html` aprovado, prompt 73
   (navegação por áreas, Onda 1) no Horizons. Auditoria CX/UX em `docs/homologacao/auditoria_navegacao/`.
1. Console › Fornecedores e rotas: mistura de operadoras do mês.
2. Teste como cliente: Início, Pessoas e perfis, Suporte, Notificações, Assistente.
3. Depois: DMARC `p=quarantine` (2 a 4 semanas sem falha) e `08_api/DOMINIO_API.md` quando o DNS for liberado.

## H. E-mails do sistema (caixa padrão da Hostinger; a Locaweb fica só para a Mensageria)
Até aqui os e-mails saem como hoje (faturas e relatórios pela conta atual, com o remetente de hoje; login pelo envio
atual do Supabase). Os avisos do sino ainda não viram e-mail; a fila só olha as últimas 24 horas, nada se acumula.
1. Hostinger: remetente único `sistema@motorcx.online` para todas as frentes (`02_supabase_painel/EMAILS_SISTEMA.md`).
2. DNS de motorcx.online: SPF certo, DKIM ativo (seletor `hostingermail-a`); falta só o `rua=` no DMARC.
3. Supabase › Secrets: `EMAIL_SMTP_USUARIO`, `EMAIL_SMTP_SENHA`, `EMAIL_LINK_SEGREDO` e `EMAIL_DE_ACESSO`,
   `EMAIL_DE_FINANCEIRO`, `EMAIL_DE_AVISOS`, `EMAIL_DE_RELATORIOS` = `sistema@motorcx.online`.
4. Função `emails` (nova, Verify JWT desligado).
5. Republicar `cobranca` e `relatorios` (só depois do passo 3).
6. Supabase › Auth › SMTP: `smtp.hostinger.com`, porta 465, a caixa do passo 1, remetente `sistema@motorcx.online`, nome MotorCX.
7. Console › E-mails do sistema: rodapé, e-mails da equipe, seletor do DKIM, "Enviar teste para mim", "Esqueci a senha".
