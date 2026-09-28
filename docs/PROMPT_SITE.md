# Prompt para construir o site motorcob.online

Cole o bloco abaixo inteiro na ferramenta que vai construir o site (Lovable, Bolt, v0 ou
uma nova sessão do Claude Code). Antes, siga `docs/NUVEM.md` até o passo 4: o banco
precisa existir e você vai precisar da **URL do projeto** e da **chave anon (pública)**
do Supabase. **Nunca** entregue a chave `service_role` para a ferramenta do site.

---

```text
Construa o site MotorCob (motorcob.online): o painel web de um motor de gestão de
contatos para empresas de cobrança. Todo o texto da interface em português do Brasil.

## Contexto
O processamento NÃO acontece no site. Uma rotina diária em Python (já existe) lê os
arquivos enviados, calcula a TAG de cada cliente e grava os resultados no Supabase.
O site tem quatro funções: (1) login, (2) enviar arquivos de entrada, (3) baixar a
fila do dia (IDs de cliente por canal) e (4) consultar resultados (painel, extrato
do cliente, comitê). O banco já está criado — NÃO crie, altere ou apague tabelas,
views, buckets ou políticas. Só leia e escreva no que está descrito abaixo.

## Stack
- React + Vite + TypeScript + Tailwind + shadcn/ui, supabase-js v2.
- Variáveis de ambiente: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (chave anon/pública).
  Nunca use nem peça a chave service_role.
- Datas exibidas em DD/MM/AAAA; no banco estão em ISO (AAAA-MM-DD). Fuso America/Sao_Paulo.

## Login
- Tela /login com e-mail + senha e "Esqueci minha senha" (supabase.auth.resetPasswordForEmail,
  redirectTo https://motorcob.online/nova-senha). Tela /nova-senha para definir a senha
  (também usada no primeiro acesso de quem foi convidado).
- NÃO existe cadastro público: não crie tela de "criar conta". Usuários são convidados
  pelo administrador no Supabase.
- Todas as outras rotas exigem sessão; sem sessão, redirecione para /login.
- Após o login, leia o perfil: select id, nome, email, papel, ativo from perfis where id = auth.uid().
  Se não houver perfil ou ativo = false, mostre "Acesso não liberado. Fale com o
  administrador." e um botão Sair.
- Papéis: admin, planejamento, operacao, gestao. Mostre nome e papel no topo, com botão Sair.
  Esconda do menu o que o papel não pode usar (as permissões reais já estão no banco).

## Menu e páginas
1. Início (/) — todos os papéis
   - Card "Última rotina" da view ultima_execucao: data_ref, status (rodando/ok/erro com cor),
     horário de término, e a lista `alertas` em destaque (amarelo). Se status = erro, mostre
     o campo `erro`. Se não houver execução com data_ref = hoje, mostre o aviso
     "A rotina de hoje ainda não rodou".
   - Gráfico de barras de clientes por estado (view resumo_estados: estado, clientes),
     com os rótulos: LOC Localização · CPA CPC A · CPB CPC B · NCP Não CPC · PRE Preventivo ·
     COL Colchão · QBR Quebra · LIQ Liquidado · BLQ Bloqueado.
   - Resumo da fila de hoje (view resumo_fila, data = hoje): clientes por canal.

2. Fila do dia (/fila) — todos os papéis
   - Seletor de data (padrão hoje). Um card por canal (whatsapp, rcs, agente_voz, discador,
     sms, email) com a quantidade de clientes (view resumo_fila, reserva = false) e botão
     "Baixar IDs" que baixa do Storage o arquivo `saidas/{data}/ids/{canal}.csv`
     (supabase.storage.from('saidas').createSignedUrl(caminho, 60)).
   - Se existir reserva (resumo_fila com reserva = true), mostre no card do discador:
     "Reserva: N clientes — só se o agente virtual não conseguir contato hoje" e o botão
     "Baixar reserva" (`saidas/{data}/ids/discador_reserva.csv`).
   - Botão "Baixar tudo (.zip)" que junta os arquivos de ids/ do dia (use JSZip).
   - A cada download, registre: insert into acessos (acao, alvo) values ('download', caminho).
   - Para admin e planejamento, mostre também downloads de `saidas/{data}/fila_do_dia.csv`
     (detalhe com contato), `saidas/{data}/enriquecimento.csv` e `saidas/{data}/alertas.txt`.
   - Nomes amigáveis dos canais: WhatsApp, RCS, Agente virtual, Discador, SMS, E-mail.
   - Se o arquivo não existir, mostre "Ainda não gerado para esta data".

3. Enviar arquivos (/envios) — só admin e planejamento
   - Formulário: tipo (select: clientes, contatos, parcelas, retorno, portal) + arquivo .csv
     (arrastar e soltar; vários de uma vez quando tipo = retorno). Limite 50 MB por arquivo.
   - Upload para o bucket 'entradas' no caminho `{tipo}/{AAAA-MM-DD de hoje}/{timestamp}_{nome original}`
     (troque espaços e acentos do nome por '_'). Depois do upload, insira em envios:
     (tipo, caminho, nome_original). Registre em acessos: ('envio', caminho).
   - Ajuda por tipo, com as colunas esperadas (separador ;):
     clientes: id_cliente;data_entrada;saldo;dias_atraso;bloqueio
     contatos: id_cliente;contato;tipo;origem;cpf;whatsapp_valido;atualizado_em
     parcelas: id_cliente;id_acordo;parcela;vencimento;valor;pago_em
     retorno: arquivo do fornecedor, como ele vem (o motor reconhece pelo nome do arquivo)
     portal: token;evento;ocorrido_em;valor_acordo
   - Tabela dos últimos 50 envios (envios order by enviado_em desc): data/hora, tipo, nome,
     status (pendente/processado/erro com cor) e, ao clicar, o JSON `relatorio` formatado
     (linhas lidas, aceitas, rejeitadas, quarentena).

4. Cliente (/cliente) — todos os papéis
   - Campo de busca por ID do cliente (exato). Registre em acessos: ('consulta_cliente', id).
   - Mostre a TAG atual (estado_cliente) decomposta em 5 chips: Safra (S260801 → "entrou em
     01/08/2026"), Cluster (A1…B3; mostre também cluster_origem se diferente), Estado,
     Canal (WA WhatsApp · RC RCS · AV Agente virtual · DC Discador · SM SMS · EM E-mail ·
     ND Nenhum) e Ciclo. Se `reenriquecer` estiver preenchido, mostre um aviso.
   - Linha do tempo da trilha (trilha where id_cliente = ? order by data, id): data, TAG,
     motivo, quem marcou. Destaque em verde as entradas em CPA e em dourado as de COL/PRE/LIQ.
   - Não existe telefone, e-mail ou CPF no banco — não tente exibi-los.

5. Painel (/painel) — admin, planejamento, gestao
   - Leia kpis (inicio, fim, safra, cluster, dados jsonb). Seletor de período (distinct
     inicio/fim). Linha TOTAL em cards: clientes, % localizados (dados.pct_localizados),
     custo por CPC descoberto (dados.custo_por_cpc_descoberto), tentativas até o contato,
     acordos, custo por acordo, % parcelas em dia, % regularização até D+5.
   - Gráfico de barras de localização por canal (dados.pct_loc_WA, pct_loc_RC, pct_loc_AV,
     pct_loc_DC, pct_loc_SM, pct_loc_EM).
   - Tabela por safra × cluster com as mesmas métricas (percentuais com 1 casa, R$ no
     formato brasileiro).

6. Comitê (/comite) — admin, planejamento, gestao
   - Liste as pastas de `saidas/comite/` (uma por mês AAAA-MM) e, em cada uma, os arquivos
     .xlsx e .csv com botão de download (registre em acessos).

7. Usuários (/usuarios) — só admin
   - Tabela de perfis: nome, e-mail, papel (select editável) e ativo (switch) → update perfis.
   - Texto de ajuda: "Para convidar alguém: Supabase › Authentication › Users › Invite user.
     O convidado entra como Operação; defina o papel aqui."

## Visual
- Sóbrio e profissional (B2B, financeiro). Fundo claro, cor principal azul-petróleo
  (#0F4C5C), destaque âmbar (#E9A23B) para alertas, verde (#2E7D32) para ok, vermelho
  (#C62828) para erro. Fonte Inter.
- Menu lateral recolhível; responsivo (funciona no celular); estados vazios e de
  carregamento em todas as telas; mensagens de erro em português, sem detalhes técnicos.
- Logo em texto: "MotorCob" com o subtítulo "Gestão de contatos".

## Segurança e LGPD
- Nunca exponha dados pessoais: o site só mostra id_cliente.
- Downloads sempre por URL assinada de curta duração (60 s), nunca URL pública.
- Sessão expira ao fechar o navegador se o usuário não marcar "Manter conectado".
- Não use localStorage para guardar dados de clientes.

## Entrega
- Publicar no domínio motorcob.online (com www redirecionando para o domínio sem www) e HTTPS.
```

---

## Depois de gerar o site

1. Na ferramenta do site, configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
2. Conecte o domínio `motorcob.online` na hospedagem do site (a ferramenta mostra quais
   registros DNS criar no seu registrador — normalmente um registro A ou CNAME).
3. No Supabase (Authentication › URL Configuration), confira se o Site URL é
   `https://motorcob.online` e se os Redirect URLs incluem `https://motorcob.online/**`.
4. Teste com um usuário de cada papel: operação não deve ver "Enviar arquivos" nem
   "Usuários"; gestão não deve conseguir baixar `fila_do_dia.csv`.
