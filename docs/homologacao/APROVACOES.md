# Homologação — aprovações e fila para rodar

Nada desta lista foi rodado no site ou no banco de produção. A regra combinada (14/10/2026): primeiro
prototipar e aprovar todos os blocos, guardar aqui, e só depois rodar tudo na ordem da fila no fim deste arquivo.

## Bloco 1 · Correções rápidas do Console — pronto, aguardando merge

PR 108 (SQL 29, função `cobranca` reempacotada e prompts 36 e 37), com os testes verdes:
- chave liga/desliga única em todo o Console;
- suspender, encerrar e reativar empresa (com motivo) e excluir empresa de teste (só Master);
- avisos do Atendimento (cliente respondeu, contador) e do Suporte no Workspace;
- "Recebe faturas" em qualquer contato da empresa;
- plano de rota mostrando fornecedores inativos e a mensagem quando ninguém tem o canal.

## Bloco 2 · Produtos da Mensageria, fornecedores, rotas e perfil Administrativo — APROVADO em 14/10/2026

Protótipo aprovado: `bloco2-produtos-prototipo.html` (nesta pasta).

Decisões:
1. **Produto = rota que se vende.** Catálogo por canal, por exemplo:
   - SMS: OTP, Short, Marketing (e novos, como SMS Bet);
   - WhatsApp: Utilidade, Serviço, Marketing;
   - RCS: Basic, Single, Conversacional;
   - E-mail: com e sem anexo.

   Cada produto tem código da API, unidade, preço mínimo e preço de tabela. O Administrativo e o Master criam produtos.
2. **Fornecedores.**
   - Cadastro aberto para qualquer fornecedor do mercado, feito pelo Administrativo e pelo Master, com edição depois.
   - A credencial nunca é digitada no site: só o nome do segredo.
   - Sem integração, o fornecedor fica "simulado" e o motor usa a reserva no envio.
3. **Negociação por fornecedor e produto.**
   - **Flat:** um custo para qualquer operadora.
   - **Por operadora:** escolhe as operadoras (Vivo, Claro, TIM, Outras) e o custo de cada uma.
   - **Custo zero ou vazio é proibido** (trava no site e no banco).
4. **Rota do produto.**
   - **Preço flat:** composição com um ou mais fornecedores e % do tráfego.
   - **Por operadora:** blocos por operadora marcada, mais o bloco opcional **Demais operadoras**, que reúne as não marcadas. Ex.: Claro 100% Pontaltech; demais 50% Sinch e 50% Zenvia.
   - Operadora sem bloco e sem "Demais" vai para a rota de reserva do canal.
   - Cada bloco soma 100%.
   - Fornecedor sem custo para aquele produto ou operadora trava a rota.
   - **Rota incompleta não pode ser contratada.**
   - O custo digitado na rota grava na negociação do fornecedor, e vice-versa.
   - Pode cadastrar fornecedor novo de dentro da rota.
5. **Custo previsto.**
   - Na rota flat, é a composição.
   - Na rota por operadora, é a mistura pelo market share de celulares da Teleco (dados Anatel), editável, com fonte e mês, mais a consulta de operadora.
   - O realizado continua envio a envio, pelo fornecedor e pela operadora que levaram a mensagem.
   - A tela mostra também o custo pela mistura real do mês anterior e o pior caso.
6. **Preço.**
   - O Comercial negocia entre o mínimo e a tabela.
   - Abaixo do mínimo, só o Administrativo ou o Master, com motivo obrigatório (vai para a Auditoria).
   - A MC no mínimo aparece na tabela.
7. **Contratação por produto.**
   - Ligar o produto o libera na campanha e na API.
   - A campanha escolhe canal e produto.
   - A API recebe `produto`; se o produto não estiver contratado, responde 422 `produto_nao_contratado`; sem `produto`, vale o padrão do canal.
8. **Regra do canal no canal da empresa.**
   - O credor herda a regra e pode sobrescrever, com selo e o botão "voltar ao padrão".
   - As travas da estratégia só restringem.
9. **Comitê:** % do gasto × % dos CPCs por produto, com índice e custo por CPC.
10. **Perfil Administrativo.**
    - Responsável por: ativação da empresa (Implantação → Ativa), suspender, encerrar e reativar, faturamento, NF, produtos e preços, preço abaixo do mínimo, e fornecedores com custos e rotas.
    - Não acessa Orquestração nem Equipe. Na Auditoria, vê só preços, fornecedores e faturas.
    - O Master continua com tudo.

A escrever, depois de aprovados os blocos 3 e 4: SQL 30, testes, ajustes no motor (custo por operadora, produto no envio) e
prompts do Console, do Workspace e da API.

## Bloco 3 · Orquestração — APROVADO em 14/10/2026 ("Ok! Somente a paleta")

Protótipo: `bloco3-orquestracao-prototipo.html`.
- Carteira no topo; aviso de estratégia compartilhada entre carteiras (causa do "aparece a estratégia do outro
  credor": a estratégia fica no segmento, que é da empresa) com "Separar só para esta carteira" / "Editar para as duas".
- "Copiar de outra carteira" sempre cria cópia independente.
- Barra única: vistas (Desenho, Etapas e fases, Travas, Visão geral) + estado + Copiar + Mais ▾ + Salvar.
- Fases do motor com orçamento por canal, prioridade e travas próprias; tabela de travas estratégia × fase.
- Mapa da Esteira em cartões na ordem da jornada (massivas × acordo), movimento em barras, sem códigos (G1/RE/T1).
Separar estratégia compartilhada = cópia só na carteira atual (recomendação aceita).

## Bloco 4 · Console — incluído no bloco 5 (menus)

Usuários, Permissões e Auditoria saem do grupo sem nome do fim de todos os menus: no cliente, Empresa › Pessoas e
perfis e Empresa › Auditoria; no Console, grupos Clientes · Suporte · Financeiro · Mensageria · Administração (Equipe
e Auditoria de todas as empresas). Empresas é a primeira tela do Console.

## Bloco 5 · Repaginada da experiência — APROVADO em 14/10/2026 (inclusive a paleta)

Protótipos: `bloco5-repaginada-prototipo.html` (glossário, nomes, antes e depois, menus, decisões) e
`bloco5-paletas-prototipo.html` (paletas e ajuda). Revisão das telas: `bloco5-revisao-telas-1.md` e `-2-console.md`.

Aprovado:
1. **Glossário** "O que significa", sempre acessível (menu Ajuda e "?" no topo); todo (i) leva ao termo.
2. **Mantêm o nome** (com (i)): **Fallback**, **MC** e **%MC**, **Auditoria**, **DLR (Delivery Report)** — só SMS e RCS; WhatsApp tem status, e-mail tem bounce.
3. **Ajuda pelo tempo de casa do usuário**: até 15 dias = explicações abertas ("Primeiros dias"); 16 a 30 dias = (i)
   discreto; depois de 30 dias = desligada. Glossário sempre disponível; a pessoa religa a ajuda em Minha conta.
4. Princípios: um nome por conceito; nenhum código interno nem erro técnico cru na tela.

5. Decisões de nome aceitas como recomendado: **MotorCX = plataforma** (áreas Cobrança e Jornada do Cliente);
   CPC A/B → **"CPC · em negociação" / "CPC · sem resposta"**; "Hot" → **"Contato principal"**; **uma regra de senha**
   (12+ caracteres, letra e número) em todas as telas; **CSV, TXT e XLSX** aceitos em todo lugar; demais nomes da
   tabela "Um nome por conceito".

6. **Paleta — APROVADA em 14/10/2026** (`bloco5-paleta-areas-prototipo.html`; insumos: `bloco5-cores-concorrentes.html`,
   `bloco5-laboratorio-cores.html`). Base Apple igual em todas as áreas + uma cor de destaque por área:
   - base: menu cinza-claro #EEEFF1, conteúdo #F8F8F9, cartões #FFFFFF, bordas #E3E4E8, texto #1D1D1F / #6E6E73;
   - **Cobrança: dourado/ocre #8A6A2E** · **Jornada do Cliente: verde musgo #4F6B3A** · **Mensageria: vinho/bordô #7A2E3B**;
   - a cor da área só no botão principal, item ativo do menu, etiqueta da área e filete do título;
   - fixos: verde = pronto, âmbar = atenção, vermelho = erro, e as cores dos canais;
   - fundo **liso** nas telas de trabalho; **halo** suave na cor da área só no login, Início e telas vazias;
   - modo escuro opcional por pessoa (Minha conta); preto só no logo e no site.
   Fora das cores ocupadas pelos concorrentes (azul, roxo, laranja, vermelho, amarelo, menta/turquesa, preto como base).
   Cores em variáveis (tema): trocar depois é mudar uma tabela.

**Todos os blocos (1 a 5) aprovados.** Próximo passo: gerar SQL, testes, ajustes no motor e prompts.

## Bloco 6 · Qualidade dos fornecedores e Score de Entrega — APROVADO em 14/10/2026

Protótipo: `bloco6-qualidade-score-prototipo.html`.
- **Qualidade dos fornecedores** (Console): no SMS o fornecedor é medido pela velocidade (aceite e DLR, mediana e
  p90), por DLR que não volta e por alertas, não pelo % entregue (que reflete o mailing). Comparação de entrega
  só dentro do mesmo lote.
- **Função Técnico** na equipe: vê qualidade e detalhe técnico (código original, horários, fallback), configura o
  filtro de inteligência e os nomes devolvidos. Atende chamados.
- **Fake DLR não é implementado.** No lugar, o **Score de Entrega**, contratado e declarado: o número fora das
  faixas não sai e volta ao cliente com um nome de "não enviado", nunca com status de operadora.
- **Modelo estatístico** por número (hash): histórico de toda a Mensageria (decisão do usuário; recomendação de
  cláusula de base legal no contrato), peso maior para o recente (meia-vida), falha permanente pesa mais, base da
  operadora para pouco histórico. Janela menor (30 dias). Fornecedores com DLR ruim podem ser tirados da análise.
- Faixas **Alto, Médio, Baixo e Sem histórico** (nome mantido, com (i)). Quarentena. Sem regra por DDD.
- **Grupo de controle** (amostra sorteada que sai mesmo assim) para provar o Score.
- **Nomes devolvidos editáveis pelo Técnico**, com trava contra nomes que imitam status de operadora.
- **Cobrança**: por número analisado ou só pelos represados; o SMS fica sempre no preço padrão (a opção de SMS
  inteligente mais caro foi retirada).
- **Campanha**: caixas Todos · Alto · Médio · Baixo · Sem histórico. **Prévia antes de agendar** (pela plataforma):
  divisão do mailing por faixa e custo unitário efetivo da campanha. Pela API segue direto e o resultado aparece
  depois, na Economia do Score.
- **Economia do Score** (cliente): período com data inicial e final, por campanha; economia líquida e **custo
  unitário efetivo** (total pago ÷ mailing carregado) com valores faturados, sem simulação.

## Revisão de UX · decisões de 14/10/2026

- **Economia do Score para quem não contratou:** vitrine ("Deixa como vitrine"). Só números reais do cliente
  (SMS que não chegaram no período e quanto pagou por eles), sem simulação, e o pedido de proposta. Tela no
  protótipo do bloco 6. **Tela APROVADA em 15/10/2026 ("Ok")**: gerados vitrine_score no SQL 33 (com testes) e a
  seção VITRINE no prompt 48; o pedido de proposta abre um chamado (motivo mensageria).
- **Um nome para a lista de contatos** ("define o que for melhor"): *lista da campanha* na Mensageria, *carga* na
  Cobrança e na Jornada. "Mailing" sai das telas e fica no glossário como nome antigo. Aplicado no SQL 33, no
  Assistente e nos prompts 46 a 48.
- **Mistura de operadoras** ("pode fazer"): no fim da aba Rotas, como o prompt 39. Protótipo do bloco 2 ajustado.

## Padrões comuns — APROVADO em 15/10/2026 ("Ok!!!")

Protótipo: `padroes-comuns-prototipo.html`. Vale para a plataforma e o Console.
- **Processo demorado** com etapas, linhas lidas, tempo restante e "pode sair desta tela"; ao terminar, aviso no
  **sino** (fim de processo longo, algo que precisa da pessoa, alerta de qualidade para Técnico e Master).
- **Salvar com revisão**: painel lateral, campo alterado marcado, resumo de → para antes de salvar e pergunta ao
  descartar. Ajuste sem efeito financeiro salva direto.
- **Ações sem volta**: confirmação na própria tela com o efeito em números; o botão repete o verbo e o número.
- **Somente leitura com o motivo** (papel que pode); esconder só o sigiloso (custo, margem, outra empresa, CPF).
- **Tabela no celular** vira cartão abaixo de 600 px, com os campos principais e "Ver".
- **Cores próprias das faixas do Score** (escala de um tom; vermelho e amarelo só para erro e alerta).
- **Score nos primeiros dias**: aviso com a data em que a janela completa e quanto da lista está Sem histórico,
  sem estimativa. Ajuste na geração: o Score usa o histórico de toda a Mensageria, então a data é a do início do
  histórico da Mensageria (não a do primeiro envio de cada empresa, como dizia o texto do protótipo).
- **Um nome por conceito**: cliente vê "Não enviados" e o Console "Represados"; preço abaixo de R$ 0,10 para o
  cliente aparece por mil.
- Gerado: SQL 34 (avisos, cores no tema, score_formacao), motor (`nuvem/avisos.py`), testes e prompts 49 e 50.
- **Prévia do Score sem validade** (15/10, "Não vamos fazer"): a prévia não vence nem é recalculada sozinha antes de
  agendar. Saíram dos protótipos o "válida até" e o aviso de prévia vencendo.

## Primeiro uso do cliente — APROVADO em 15/10/2026 ("Ok para os demais")

Protótipo: `primeiro-uso-prototipo.html`.
- **Convite e conta**: e-mail com a empresa, o papel, quem convidou e a validade do link (24 h); passos da conta
  (Admin: senha, código no celular, pronto); requisitos da senha marcados enquanto digita, com a regra aprovada no
  bloco 5 (12+, letra e número; o protótipo trazia a regra antiga e foi corrigido).
- **Primeiros passos no Início**, montados pelo que foi contratado e marcados pelo que aconteceu (ninguém marca à
  mão); só "Convidar a sua equipe" pode ser pulado; dá para ocultar. "Escolher como a carga chega" saiu como passo
  à parte: a carga já vem por arquivo e o envio da primeira carga (por arquivo ou API) marca o passo.
- **Pedido de envio real**: o cliente pede depois do teste em simulação; abre chamado para o **Suporte, que
  responde em até 1 hora** ("Se for do Suporte até uma hora"). Ligam: Master e Atendimento. Pedido sem resposta
  em 1 hora vira aviso vermelho para a equipe.
- **Telas vazias** com o primeiro passo e **Console › Implantação** (empresa parada há mais de 7 dias avisa o
  vendedor).
- Conflito resolvido: o prompt 3 deixou de dizer "nada de gerar token"; com o módulo API, o card leva a
  /conta/tokens.
- Gerado: SQL 35, e-mail de convite (painel + função `admin-usuarios`), motor (`avisos.implantacao`), testes e
  prompts 51 e 52.

## Radar e caixa de atendimento — APROVADO em 15/10/2026

Protótipo: `radar-atendimento-prototipo.html`.
- **Caixa única** com SMS, RCS e WhatsApp; abas Abertas, Sem responsável, Minhas e Aguardando cliente; fila por
  prioridade da classe (CPC Negócio e Alega pagamento primeiro) e tempo de espera.
- Situações **Nova, Em atendimento, Aguardando cliente e Resolvida**; resposta do cliente reabre.
- **Notas internas**, **transferência** com aviso no sino, **histórico** da classe corrigida (alimenta a qualidade do
  Radar), outras conversas do mesmo cliente.
- **Resposta em grupo** com custo previsto e confirmação.
- **Meta de primeira resposta: opcional, sem valor padrão** ("Não precisa, pois nem todos vão usar esse recurso").
  O tempo de espera é corrido (o protótipo dizia "só no horário do canal"; simplificado com a meta opcional).
- **Desempenho por pessoa só para Admin e Gestão** ("Ok").
- **Respostas rápidas sem textos prontos** ("Não aplicar"): cada empresa escreve as suas.
- Judicial avisa Admin e Gestão; CPC Negócio sem responsável há 10 min avisa a Gestão (opcional).
- Gerado: SQL 36, motor (`avisos.atendimento`), testes e prompts 53 e 54.

## Faturas e Contratação — APROVADO em 15/10/2026

Protótipo: `faturas-contratacao-prototipo.html`.
- **Contratação por seção** (Motor e módulos, Ciclo e cobrança, Preços), cada uma com o próprio painel e resumo.
- **Preço novo vale a partir do próximo ciclo** ("Concordo"); "neste ciclo" é exceção, com motivo. O preço segue
  guardado por mês: no ciclo em dias, "próximo ciclo" é o próximo mês.
- **Lembrete por e-mail** no dia seguinte ao vencimento e 5 dias depois ("Ótimo"); no 7º dia, aviso de bloqueio.
- **10 dias de atraso: bloqueia o acesso e deixa como inadimplente** ("10 dias bloqueia o acesso e deixa como
  inadimplente"). Salvaguardas aplicadas: Faturamento e Suporte continuam abertos para pagar, envios e API param,
  e o acesso volta sozinho quando o pagamento confirma.
- **Liberação pelo Master** com a fatura ainda em aberto ("a liberação do cliente com fatura em aberto pode ocorrer
  via Master"): com motivo e prazo (padrão 7 dias, até 30); até o prazo a rotina não bloqueia de novo; passou sem
  pagar, bloqueia. O Administrativo não reativa inadimplente; pagou tudo, a liberação manual deixa de valer.
- **Estimativas mantidas** ("Mantém"), sempre escritas como estimativa: fim do ciclo (pós-pago) e duração do saldo
  (pré-pago).
- **Permissão Pagar faturas**, só Admin por padrão ("Ok").
- Emissão com total e contatos na confirmação; itens explicados com preço por mil; extrato do pré-pago.
- Correção junto: a suspensão da equipe também passa a parar os envios da Mensageria (antes só a rotina parava).
- Gerado: SQL 37, funções `cobranca` (lembrete e permissão) e `api`, motor, testes e prompts 55 e 56.

## Acordo de pagamento de fatura vencida — APROVADO em 15/10/2026

Protótipo: `acordo-fatura-prototipo.html`.
- **Quem lança: Master e Administrativo** ("Correto"); o Atendimento e o cliente não lançam.
- **Ao lançar, a empresa inadimplente é liberada** enquanto as parcelas estiverem em dia, e as faturas do acordo
  ficam "Em acordo": sem lembrete e sem bloqueio ("Correto").
- **Parcela segue a régua da fatura**: lembrete no dia seguinte e com 5 dias, aviso no 7º; **com 10 dias de atraso o
  acordo é quebrado**, o que falta volta a ser cobrado e a empresa fica inadimplente de novo ("Correto"). Na
  geração, o que falta vira **uma cobrança só** (o saldo do acordo), vencida desde a parcela atrasada; o desconto
  combinado não é retirado (nenhuma regra automática de juros ou perda de desconto foi aprovada).
- **Até 12 parcelas** ("Ok"); a 1ª vence de hoje até 30 dias, as outras mês a mês; parcela mínima de R$ 5,00.
- **Sem juros nem multa automáticos**: só desconto ou acréscimo manual, com motivo que o cliente não vê e que fica na
  Auditoria ("Perfeito").
- Cada parcela é uma cobrança própria (Pix, boleto ou cartão, nas formas do acordo) com nota fiscal quando paga
  (se a fatura já teve nota na emissão, a parcela não gera outra). Todas pagas: acordo Quitado e faturas Pagas
  (via acordo). "Informar o cliente": aviso no sino na hora e e-mail para quem recebe faturas.
- **Cancelar acordo** volta as faturas para vencidas; na geração, só sem parcela paga (com parcela paga, o
  acordo segue até quitar ou quebrar, para não cobrar duas vezes).
- Gerado: SQL 38, funções `cobranca`, `pagamentos-webhook` e `assistente`, motor, testes e prompts 57 e 58.
- Decisões da geração confirmadas em 15/10/2026 ("Perfeito"): saldo único na quebra mantendo o desconto, cancelar
  só sem parcela paga, parcela mínima de R$ 5,00 e 1ª em até 30 dias, sem nota duplicada, faixa "em dia" só no
  Início e em Faturamento.

## Relatórios e montador — APROVADO em 15/10/2026

Protótipo: `relatorios-prototipo.html`.
- Aprovado: envio por e-mail agendado, só para usuários da empresa, com os números do topo e um link, sem anexo ("Ok").
- Aprovado: relatório salvo editado por quem criou e pelo Admin; os outros abrem e duplicam ("Ok").
- Aprovado com ajuste: exportação até 50 mil linhas na hora; acima, em segundo plano com aviso no sino e link de 7
  dias; **limite de 1 milhão de linhas** ("Limitar em 1 milhão de linhas").
- Aprovado: taxas de resposta, descadastro e clique sobre os entregues ("Correto").
- Pedido do operador: "Não entregues" com a taxa em todo relatório de entrega; no e-mail, bounce permanente e
  temporário.
- Relatórios da Orquestração entram agora ("Entram"): régua, carteira, movimento, acordos, indicadores por safra e
  Jornada do MotorCli. Tela aprovada em 15/10/2026 ("Acredito que seja isso por hora"). Pendente: foto diária da
  carteira (explicado como funcionaria na prática; aguardando decisão). A Jornada do MotorCli vai ter uma revisão
  própria, como a da Cobrança.
- **Foto diária da carteira** ("Tá perfeito"): totais por situação, segmento, safra e etapa, todo dia por 90 dias e o
  fechamento de cada mês para sempre; base "Evolução da carteira" e o relatório "Como a carteira evoluiu mês a mês?".
- Na geração: o filtro Estratégia usa a estratégia atual do segmento na carteira (as ações da régua não guardam a
  estratégia do dia); a foto é tirada uma vez por dia a partir das 20h; o envio por e-mail vale para relatório
  salvo (o pronto é salvo antes de agendar).
- Gerado: SQL 39, função `relatorios`, motor (`nuvem/relatorios.py`), testes e prompts 59 e 60.
- Decisões da geração confirmadas em 15/10/2026 ("Pode seguir").

## Jornada do Cliente (MotorCli) — APROVADO em 15/10/2026 ("Ok")

Protótipo: `jornada-prototipo.html`.
- Resultado de cada momento pela carga diária (sem dado novo): Boas-vindas = recebeu a 1ª mensagem; Ativação =
  ativou em até 30 dias da contratação; Pré-vencimento = pagou até o vencimento; Retenção = voltou a usar antes de
  90 dias sem atividade; Reativação = voltou a usar. Conta para o último canal que acionou o cliente nos 7 dias
  anteriores. Comparação com o período anterior.
- "Melhor canal" escolhe pelo resultado do momento (com histórico suficiente; antes disso, como hoje).
- Prioridade dos momentos editável (padrão Pré-vencimento, Boas-vindas, Ativação, Retenção, Reativação), orçamento
  por canal em cada momento, mensagem por passo (biblioteca por momento e canal; RCS e WhatsApp pelos templates
  aprovados), estratégia por carteira (aviso de compartilhada, Separar, Copiar de outra carteira).
- Cliente em atraso: só mostrar quantos foram para a cobrança (não entra sozinho na carteira de cobrança).
- Mapa da jornada no Início, movimento entre momentos e Lista do dia sem códigos.
- Na geração: o resultado só conta episódios que começam ou terminam depois que o motor passou a medir (a base antiga
  não vira "não" no primeiro dia); pagamento atrasado conta como "não pagou em dia"; o resultado de cada mensagem é o
  do momento entre quem a recebeu por último; Boas-vindas conta a 1ª ação enviada (a entrega fica na Mensageria).
- Gerado: SQL 40, motor (`motor/jornada_resultados.py`, prioridade, orçamento e mensagem por passo, melhor canal pelo
  resultado), testes e prompts 61 e 62.

## Fila para rodar (quando liberar)

1. Merge da PR 108. Depois: SQL 29 → publicar a função `cobranca` (passo 50b) → prompts 55 e 56.
2. Pendências anteriores: confirmar o SQL 26, prompts 53 e 54 e o passo 41 (MotorCli Jornada); salvar de novo a
   Contratação da empresa criada pela metade e convidar o Admin dela.
3. Merge da PR dos blocos 2 a 5 (branch `claude/geracao-blocos-2-5`, empilhada sobre a 108). Tudo já gerado e testado
   (RLS 882 ok, motor 383 ok); nada foi rodado no site nem no banco. Ordem (passos 63 a 71 do `00_LEIA_PRIMEIRO`):
   a. Conferir a mistura de operadoras do Teleco do mês (vem semeada com agosto/2026; dá para editar depois).
   b. SQL 30 → prompts 38, 39 e 40 (Produtos e preços, Fornecedores e rotas, Administrativo/produto/canal/comitê).
   c. SQL 31 → prompts 41 e 42 (Orquestração por carteira e Mapa da Esteira).
   d. SQL 32 → senha no painel do Supabase (12+, letras e números) → prompts 43, 44 e 45 (glossário e ajuda,
      paleta, menus e nomes).
   e. Publicar de novo a função `assistente` (`python3 scripts/juntar_funcao.py assistente`) e atualizar o motor na
      nuvem (`systemctl start motorcob-atualizar`).
   f. `CONFERENCIA_GERAL.sql`: itens 17, 18 e 19 devem dar OK.
4. Bloco 6 (branch `claude/geracao-bloco-6`, empilhada sobre a dos blocos 2 a 5): SQL 33 → prompts 46, 47 e 48 →
   função `assistente` de novo → motor na nuvem (passos 72 a 74). Conferência: item 20 OK.
   Depois, padrões comuns: SQL 34 → prompts 49 e 50 → motor na nuvem (passos 75 a 77). Conferência: item 21 OK.
   Depois, primeiro uso: SQL 35 → e-mail de convite no painel e função `admin-usuarios` → prompts 51 e 52 → motor
   na nuvem (passos 78 a 80). Conferência: item 22 OK.
   Depois, atendimento: SQL 36 → prompts 53 e 54 → função `assistente` de novo → motor na nuvem (passos 81 e 82).
   Conferência: item 23 OK.
   Depois, faturas: SQL 37 → funções `cobranca` e `api` de novo → prompts 55 e 56 → motor na nuvem (passos 83 a 85).
   Conferência: item 24 OK.
   Depois, acordo de pagamento: SQL 38 → funções `cobranca`, `pagamentos-webhook` e `assistente` de novo → prompts
   57 e 58 → motor na nuvem (passos 86 a 88). Conferência: itens 9 (16 permissões) e 25 OK.
   Depois, relatórios: SQL 39 → função nova `relatorios` e `assistente` de novo → prompts 59 e 60 → motor na nuvem
   (passos 89 a 91). Conferência: item 26 OK.
   Depois, Jornada: SQL 40 → função `assistente` de novo → prompts 61 e 62 → motor na nuvem (passos 92 e 93).
   Conferência: item 27 OK.
5. Correção incluída no SQL 30: o perfil Administrativo não herda a Orquestração, as cargas, os canais nem os usuários
   do cliente (antes herdaria pelo papel Planejamento).
