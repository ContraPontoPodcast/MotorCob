# Prompt Horizons — Workspace 19: Painel da Mensageria com Disparado, Enviado e os botões "i"

Rode depois do SQL 17 (`17_funil_assistente.sql`). Substitui os cards e o funil de entrega do Painel (prompt 11,
item 3); o funil de engajamento (prompt 14) continua. Protótipo: https://claude.ai/artifact/XWCscHJhaWo4HQNM9MzUGf

```text
No Painel de cada produto da Mensageria (/mensageria/{canal}) e no detalhe da campanha, troque a fonte para
from('mensageria_funil_status').select('*').eq('empresa_id', empresa).eq('canal', canal).gte('data', ini)
.lte('data', fim) (detalhe: .eq('campanha_id', id)) e some as linhas. Não mude tabelas, views ou políticas.
pct(a, b) = a ÷ b × 100 com 1 casa (2 casas abaixo de 1%), vírgula decimal; b = 0 → "—".

1. SMS E RCS — 7 cards numa linha (quebram em 2 linhas abaixo de 1100px), cada um com o botão "i":
   Carregados ("base da campanha") · Higienizados ("{pct(higienizados, carregados)} dos carregados") · Disparados
   ("base dos percentuais") · Enviados ("{pct(enviados, disparados)} dos disparados") · Entregues (verde,
   "{pct(entregues, disparados)} dos disparados") · Não entregues (vermelho, "{pct(nao_entregues, disparados)} dos
   disparados") · Respostas (azul, "{pct(respostas, entregues)} dos entregues"). No RCS, +1 card Fallback (SMS).
   FUNIL DE ENVIO: as mesmas etapas em barras (largura ÷ carregados), com "i" ao lado de cada nome e o número + % à
   direita. Abaixo: "Sem retorno final da operadora: {sem_retorno} ({pct(sem_retorno, disparados)} dos disparados)"
   com "i", e "Ficaram na higienização: inválidos {invalidos} · bloqueados (lista de bloqueio, descadastro, sem
   texto) {bloqueados}". Gráfico por dia: disparados, entregues, não entregues.
   ENTREGA POR OPERADORA (SMS): supabase.rpc('rodar_relatorio', {base: 'mensagens', filtros: {empresa, de, ate,
   campos: [{campo: 'canal', op: 'igual', valor: canal}]}, agrupar: ['operadora', 'situacao'], metricas:
   [{funcao: 'contar', nome: 'n'}]}). Por operadora (Vivo, Claro, TIM, Oi, Outras): Disparados (tudo menos pendente
   e bloqueada) · Entregues % (entregue + descadastro) · Não entregues % (falhou) · Sem retorno % (enviada), sobre
   os disparados.

2. E-MAIL — cards com "i": Carregados · Higienizados · Disparados · Entregues ("{pct(entregues, disparados)} dos
   disparados") · Bounce permanente ("{pct(bounce_permanente, disparados)}") · Bounce temporário. ENGAJAMENTO
   (barras ÷ entregues): Entregues · Aberturas únicas · Cliques únicos · Respostas, cada um com % dos entregues; e
   "Clique por abertura (CTOR): {pct(cliques, aberturas)}" com "i" + "Aberturas são estimadas (o Apple Mail abre
   sozinho)". SAÚDE DO REMETENTE (tabela): Taxa de entrega (ref. acima de 95%) · Bounce permanente (abaixo de 2%) ·
   Marcados como spam = spam ÷ entregues (abaixo de 0,1%; limite 0,3%) · Descadastros ÷ entregues (abaixo de 0,5%).
   Coluna Situação: "Dentro" verde #248A3D ou "Atenção" vermelho #D70015.

3. BOTÃO "i": círculo 18px, borda #D2D2D7, "i" itálico 11px #6E6E73; ativo/hover fundo #1D1D1F texto branco.
   Clique abre um balão branco (até 320px, raio 14, sombra) perto do botão, sem sair da tela: título 14px 600, o
   texto e, numa faixa #F5F5F7, o cálculo; quando houver, a referência em 12.5px #6E6E73. Fecha com Esc, clique
   fora ou rolagem. aria-label "O que é {status}", aria-expanded. Textos (título | texto | cálculo | referência):
   - Carregados | Todos os registros que vieram no arquivo ou pela API, antes de qualquer filtro. | Base da campanha
   - Higienizados | Registros aprovados na higienização: contato válido, sem duplicidade, fora da lista de bloqueio e do descadastro, com o texto completo. Só eles podem ser disparados. | Higienizados ÷ Carregados
   - Disparados (SMS) | Mensagens que o MotorCob enviou à operadora pela rota de SMS escolhida (fornecedor e % de tráfego da campanha). A partir daqui, quem leva a mensagem até o celular é a operadora do número (Vivo, Claro, TIM e outras). Cada SMS tem até 160 caracteres; acima disso a mensagem é bloqueada antes do disparo. As respostas do cliente também são cobradas. | Base de Enviados, Entregues e Não entregues
   - Disparados (RCS) | Mensagens que o MotorCob enviou à operadora pelo agente RCS verificado da empresa (nome, logo e selo de verificação no celular). O RCS só chega a aparelhos com RCS ativo; o que não chegar segue a regra de fallback para SMS da campanha. O tipo define a cobrança: Basic (só texto, até 160 caracteres), Single (com imagem, cartão ou botões) e Conversacional (sessão de 24 horas aberta pela resposta do cliente). | Base de Enviados, Entregues, Não entregues e Fallback
   - Disparados (e-mail) | E-mails que o MotorCob entregou ao provedor de envio de e-mail, já assinados com o domínio do remetente (SPF, DKIM e DMARC). A partir daqui, o provedor tenta entregar ao servidor de e-mail do destinatário (Gmail, Outlook ou o servidor da empresa dele), que aceita, recusa (bounce) ou manda para o spam. Não há operadora nem custo por caractere. | Base de Entregues e dos bounces
   - Enviados | A operadora confirmou que enviou a mensagem ao número. Quando a operadora não devolve o retorno final (DLR), a mensagem fica só como Enviado. | Enviados ÷ Disparados
   - Entregues (SMS/RCS) | A operadora devolveu o retorno de entrega (DLR) confirmando que a mensagem chegou ao aparelho. | Entregues ÷ Disparados
   - Não entregues | A operadora devolveu retorno de falha: número inexistente ou cancelado, aparelho desligado até a mensagem expirar, sem cobertura ou recusa da operadora. | Não entregues ÷ Disparados
   - Respostas | Clientes que responderam à mensagem. O Radar classifica cada resposta (quer negociar, já pagou, não reconhece a dívida…). | Respostas ÷ Entregues
   - Sem retorno final | Mensagens enviadas pela operadora que não receberam nem Entregue nem Não entregue. O retorno ainda pode chegar depois. | Sem retorno ÷ Disparados
   - Fallback (SMS) | Mensagens RCS que não chegaram (aparelho sem RCS ou falha) e foram reenviadas por SMS, conforme a regra de fallback da campanha. Entram de novo no funil do SMS. | Fallback ÷ Disparados RCS
   - Entregues (e-mail) | O servidor de e-mail do destinatário aceitou a mensagem. Não garante caixa de entrada: pode ir para a pasta de spam. | Entregues ÷ Disparados | Saudável: acima de 95%
   - Bounce permanente | Endereço ou domínio que não existe. O MotorCob marca o e-mail como inexistente na Orquestração, para não insistir nele e proteger a reputação do remetente. | Bounce permanente ÷ Disparados | Saudável: abaixo de 2%
   - Bounce temporário | Falha passageira: caixa cheia, servidor fora do ar ou mensagem grande demais. O provedor tenta de novo; o e-mail não é marcado como inexistente. | Bounce temporário ÷ Disparados
   - Aberturas únicas | Pessoas que abriram o e-mail pelo menos uma vez. É um número estimado: o Apple Mail e alguns provedores abrem as imagens sozinhos e inflam a abertura. Use os cliques como sinal mais confiável. | Aberturas únicas ÷ Entregues
   - Cliques únicos (CTR) | Pessoas que clicaram em pelo menos um link do e-mail. Os links passam pelo encurtador do MotorCob. | Cliques únicos ÷ Entregues
   - Clique por abertura (CTOR) | De quem abriu, quantos clicaram. Mede se o conteúdo convence, separado do assunto. | Cliques únicos ÷ Aberturas únicas
   - Descadastros | Pessoas que pediram para não receber mais. Vão direto para o descadastro. | Descadastros ÷ Entregues | Atenção: acima de 0,5%
   - Marcados como spam | Destinatários que clicaram em “É spam”. É o indicador que mais derruba a reputação do domínio; quem marca vai para o descadastro. | Spam ÷ Entregues | Gmail e Yahoo exigem abaixo de 0,3%; o ideal é abaixo de 0,1%

4. RELATÓRIOS: a base nova "Funil de envio (status)" (relatorio_bases 'funil') aparece no montador; os padrões
   "Entregabilidade por dia e canal" e "Saúde do e-mail" já usam essa base.

Confira em 1440, 1024 e 390px: cards sem cortar texto, balões dentro da tela, sem rolagem lateral.
```
