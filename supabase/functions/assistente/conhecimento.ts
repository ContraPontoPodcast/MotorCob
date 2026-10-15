// Base de conhecimento do Assistente MotorCX (o que o modelo pode responder). Mantenha igual ao uso real da
// plataforma: tela nova ou regra nova entra aqui no mesmo PR. Nada de preço, chave, endereço interno ou dado pessoal.
export const CONHECIMENTO = `# Base de conhecimento do Assistente MotorCX

Referência para responder dúvidas de uso da plataforma MotorCX (frentes MotorCob e MotorCli). Público: usuários de assessorias de cobrança, de credores e de áreas de CX e relacionamento (perfis Admin, Planejamento, Operação e Gestão) e a equipe MotorCX. Os nomes de menus, telas e botões estão escritos como aparecem na plataforma.

Regras de atendimento do assistente:

- Nunca peça nem aceite CPF, telefone, e-mail ou nome de devedor. Se o usuário colar um dado desses, não o repita e oriente a usar o ID do cliente ou o número do contrato.
- Preços, contratos, descontos e valores comerciais: não informe. Responda "Fale com o time comercial ou abra um chamado em Suporte › Abrir chamado".
- Quando a resposta depender de uma permissão, diga que o Admin da empresa pode liberar em Usuários e permissões.
- Se não souber, oriente a abrir um chamado em Suporte.

---

## Visão geral e login

- O MotorCX é a plataforma de inteligência de decisão para a experiência do cliente. Ela tem duas frentes: MotorCob (Cobrança) e MotorCli (Jornada do Cliente). A plataforma, a segurança e a conta são as mesmas; muda o nome, a cor e as telas do produto principal.
- No MotorCob os produtos são Orquestração (Lista do dia, réguas e personas) e Mensageria (SMS, RCS, E-mail e WhatsApp). No MotorCli, Jornada (momentos da relação com o cliente) e Mensageria. A equipe MotorCX usa também o Console. A integração por API (cargas e Lista do dia pelo sistema da empresa) é explicada em Documentação. Cada empresa vê só as frentes e os módulos contratados.
- Escolha da frente: quem tem acesso às duas frentes escolhe no login (MotorCob ou MotorCli), com a opção "Lembrar a minha escolha neste navegador". Para trocar depois: menu do usuário › "Trocar para MotorCli" (ou MotorCob). Quem tem só uma frente entra direto nela. O Admin da empresa pode limitar um usuário a uma frente em Usuários e permissões › Frentes; ligar uma frente nova na empresa é com o time comercial.
- Login: e-mail e senha, depois o código de verificação em duas etapas (para o perfil Admin a verificação em duas etapas é obrigatória). O login nunca informa se um e-mail existe.
- Primeiro acesso: o convite chega por e-mail e abre a página "Crie sua senha.". "Esqueci a senha" abre a página "Nova senha.". A senha precisa ter pelo menos 12 caracteres; as regras aparecem na tela enquanto você digita. Link vencido: peça um novo ao Admin da sua empresa ou use "Esqueci a senha".
- A sessão se encerra sozinha depois de 30 minutos sem uso. Um minuto antes aparece o aviso "Sua sessão vai expirar" com o botão "Continuar conectado".
- Se aparecer "Seu acesso foi desativado. Fale com o Admin da sua empresa.", o usuário foi desativado ou ficou sem permissões.

### Workspace (primeira tela depois do login)

O Workspace (/workspace) é a tela inicial depois do login. Tem uma barra escura no topo com:

- Símbolo do MotorCX com o nome da frente e o seletor de empresa. Cliente vê só a própria empresa; a equipe MotorCX vê uma lista com busca de todas as empresas.
- Links: Início, Empresa, Suporte e, só para a equipe MotorCX, Console MotorCX.
- À direita, o avatar. Clicar no avatar abre o menu do usuário: Minha conta, Documentação, Sobre o MotorCX e Sair.

O Início do Workspace mostra:

1. Saudação e o campo "O que você quer fazer?" (atalho ⌘K no Mac ou Ctrl+K no Windows). É um campo só para buscar e para perguntar: digite o nome de uma tela ou ação (por exemplo "campanha", "faturas", "convidar") e use ↑ ↓ Enter para ir direto; ou escreva uma pergunta (terminando com "?" ou começando com como, onde, o que, por que, qual) e o Assistente MotorCX responde logo abaixo do campo.
2. "Para hoje": quantos clientes entram em ação hoje, chamados que o suporte respondeu e aguardam você, e fatura em aberto ou vencida (só para quem vê faturamento). Sem pendências: "Tudo em dia por aqui."
3. "Seus produtos": um card por módulo. Produto ativo tem o botão "Abrir {produto} ›" (Orquestração abre a Lista do dia; Mensageria abre o último canal usado; Console, só para a equipe, abre a Saúde). Produto não contratado aparece esmaecido com o botão "Quero conhecer", que abre um chamado de interesse comercial.

### Assistente MotorCX

- Onde usar: no campo "O que você quer fazer?" do Início do Workspace (a resposta aparece logo abaixo) ou pelo avatar no canto inferior direito das telas do Workspace ("Dúvida? Fala comigo!"), que abre a conversa numa gaveta à direita. "Continuar a conversa" leva a pergunta do campo para a gaveta.
- Cada resposta pode trazer o passo a passo e um botão que abre a tela certa. Use 👍 ou 👎 para dizer se ajudou.
- O Assistente responde sobre o uso da plataforma. Ele não vê a carteira, os clientes, os envios nem as faturas da empresa; para um caso específico, abra um chamado em Suporte.
- Cada pergunta fica registrada por 90 dias para a equipe MotorCX melhorar as respostas. Não escreva CPF, telefone, e-mail ou nome de devedores: esses dados são apagados antes de a pergunta ser processada.
- Limite: 30 perguntas por hora por usuário.

---

## Navegação dentro dos produtos

Dentro da Orquestração, da Mensageria e do Console, a navegação é um menu lateral escuro à esquerda.

Topo do menu, de cima para baixo:

1. Símbolo do MotorCX com o nome da frente (MotorCob ou MotorCli). O botão ao lado do logo recolhe o menu, deixando só os ícones; clique de novo para expandir.
2. "‹ Voltar ao Workspace": volta ao Início do Workspace.
3. Seletor de empresa (o mesmo do Workspace).
4. Seletor de produto: Workspace, Orquestração, Mensageria e Console MotorCX (só equipe). Produto sem módulo ativo aparece esmaecido com "Quero conhecer". Trocar de produto leva à tela inicial dele.
5. Só na Mensageria: o controle de canal SMS · RCS · E-mail · WhatsApp. Canal não liberado aparece desabilitado. Trocar o canal mantém a mesma tela no outro canal (por exemplo, de Campanhas do SMS para Campanhas do RCS), e o último canal fica lembrado.

Itens do menu:

- Orquestração: Operação (Início, Lista do dia, Ações, Painel) · Carteira (Clientes, Personas, Credores) · Estratégia (Mapa da Esteira, Orquestração, Comitê) · Dados (Enviar arquivos) · Administração (Canais e frases).
- Mensageria: Operação (Painel, Campanhas, Lotes do dia) · Atendimento (Respostas, com um selo azul de não lidas) · Conteúdo (Templates no SMS e RCS, ou Modelo de e-mail no E-mail; Listas) · Análise (Relatórios) · Administração (Configurações).
- Console (só equipe MotorCX): Operação (Saúde, Empresas, Atendimento) · Financeiro (Faturamento, Fornecedores, Margem) · Administração (Equipe).
- Grupo fixo no fim, igual nos três produtos: Relatórios · Usuários e permissões · Auditoria. Cada item só aparece para quem tem a permissão.
- Rodapé do menu: avatar, nome e perfil. Clicar abre o mesmo menu do usuário do Workspace (Minha conta, Documentação, Sobre o MotorCX, Sair).

No celular, o menu abre pelo botão "Menu" na barra do topo.

Cabeçalho de cada tela: título à esquerda e uma linha de contexto (empresa, produto, canal na Mensageria e a data). À direita, o campo "Buscar cliente" (⌘K ou Ctrl+K), que procura só por ID do cliente ou número do contrato, e o botão principal da tela. Na Mensageria, o selo de modo (Simulação ou Envio real) fica ao lado do título.

Sem permissão de edição, uma tela abre só para leitura (campos desabilitados, sem Salvar ou Excluir). Ao tentar uma ação sem permissão aparece "Seu perfil não tem permissão para esta ação. Fale com o Admin da sua empresa."

---

## O que significa (glossário) e ajuda

O menu Ajuda › O que significa (e o "?" no topo) traz todos os termos da plataforma; todo (i) leva direto ao termo. Nomes que mudaram: Hot → Contato principal; CPC A → CPC · em negociação; CPC B → CPC · sem resposta (1ª, 2ª tentativa…); Localização → Cliente novo; G1, G2, G3 → 1º, 2º, 3º ciclo; RE → Parado · aguarda enriquecimento; Colchão → Acordo em dia; Preventivo → Acordo · antes do vencimento; Quebra → Acordo · parcela vencida; Cluster → Segmento; Templates → Modelos de mensagem; Credor → Carteira. Mantêm o nome: Fallback, MC e %MC, Auditoria e DLR (só SMS e RCS; WhatsApp tem status de entrega e e-mail tem bounce).
A ajuda acompanha o tempo de casa de cada pessoa: até 15 dias as explicações ficam abertas, de 16 a 30 dias aparece só o (i), depois de 30 dias fica desligada. Em Minha conta a pessoa religa a ajuda e escolhe o tema claro ou escuro. Senha: 12 caracteres ou mais, com letra e número. Arquivos: CSV, TXT e XLSX em todo envio.

---

## Score de Entrega e Economia do Score

O Score de Entrega (contratado à parte) dá a cada número uma faixa pelo histórico da Mensageria: Alto, Médio, Baixo e Sem histórico. Na campanha, o cliente marca as faixas que recebem (Todos, Alto, Médio, Baixo, Sem histórico); os números fora não são enviados e voltam no retorno com o nome da faixa. Uma pequena amostra sai mesmo assim (grupo de controle) para provar a entrega real de cada faixa. Cobrança: por número analisado ou só pelos represados; o SMS segue no preço padrão. Em Mensageria › Economia do Score o cliente vê, por período e por campanha, a economia líquida e o custo unitário efetivo (total pago ÷ lista carregada) comparado ao SMS padrão. O sino no topo da tela mostra os avisos: lista lida, prévia pronta, campanha com erro, envios pausados por saldo e, para o Técnico, alertas de qualidade dos fornecedores. Avisos com mais de 90 dias somem. Processos demorados (importar lista, calcular a prévia) mostram as etapas e avisam no sino quando terminam, então dá para sair da tela. Empresa nova vê no Início os Primeiros passos, montados pelo que foi contratado e marcados sozinhos conforme acontecem (por exemplo, primeira carga, primeiro template, teste em simulação). Toda empresa começa em simulação: nada sai para os clientes. Depois do teste, quem pode enviar mensagens pede o envio real na faixa da Mensageria; o Suporte da MotorCob responde em até 1 hora e o aviso chega no sino.

---

## Orquestração

A Orquestração decide, todo dia, qual ação cada cliente da carga recebe e por qual canal. O fluxo é: a empresa envia a carga do credor → o MotorCob gera a Lista do dia (um contato por cliente em cada canal) → a empresa devolve a ocorrência dizendo se cada cliente deu CPC → o contato que deu CPC vira o contato principal e as próximas ações saem por ele.

Vários números e listas são por credor (carteira). Quando a tela pedir, escolha o credor no topo.

### Início

Resumo do dia da empresa e do credor: data e hora em que a rotina do dia terminou, situação da carteira e alertas. Botão principal: "Abrir Lista do dia".

### Lista do dia

O que o MotorCob mandou fazer hoje. Mostra quatro números com o percentual sobre o total:

- Carteira avaliada (total de clientes avaliados).
- Com ação hoje: liberados para todos os canais.
- Fora por regra da esteira: segurados por uma regra da esteira.
- Sem contato válido: sem contato para os canais do dia.

Abaixo, "Por que hoje", com o filtro Todos · Em ação · Esteira · Sem contato. Cada linha mostra o motivo, uma barra de participação e a quantidade. Em "Todos" aparece também o grupo "Fora da cobrança".

Para baixar a lista (permissão "Baixar a lista do dia"):

1. Orquestração › Lista do dia.
2. Escolha o credor no topo.
3. Clique em "Baixar lista". Os arquivos são por canal e trazem o ID do cliente e o contato daquele canal.

A Lista do dia é gerada pela rotina por volta das 6h.

### Ações

Quantas ações o MotorCob mandou fazer e o que voltou delas (uma ação = um cliente acionado num canal num dia): enviadas, com retorno, CPC, custo e custo por CPC, com filtros. Os números de um dia só se completam quando a ocorrência da empresa chega: se aparecer aviso de ações sem ocorrência, envie o arquivo de ocorrência em Enviar arquivos.

### Painel

Indicadores da carteira por período: localização, custo por CPC, acordos e custo por acordo, com quebra por canal.

### Clientes

Consulta de um cliente pelo ID (ou contrato). A tela "Cliente {ID}" mostra o segmento, a persona, a fase atual (Cliente novo, Não CPC, CPC · em negociação, CPC · sem resposta, Acordo em dia, Acordo · antes do vencimento, Acordo · parcela vencida, Quitado, Bloqueado) e o histórico do cliente na esteira. Nunca mostra nome, CPF, telefone ou e-mail.

### Personas

Perfis de devedor da carteira. O anel de cada persona mostra a maturidade (não a quantidade de clientes); o ranking de canais destaca o melhor e o segundo canal, com o resultado em CPC. Quem tem "Editar a orquestração" cria e ajusta as personas.

### Credores

As carteiras da empresa. Cada credor tem nome, código (aparece ao lado do nome, com botão de copiar), estratégia padrão e o campo "Como a carga chega":

- Arquivo: envie pelo site, em Enviar arquivos (CSV, TXT ou XLSX).
- API: o sistema do credor envia direto pela API, com token. O relatório de linhas aceitas e rejeitadas é o mesmo do arquivo.

Quem tem "Editar credores" cria e edita credores; os demais só veem.

### Mapa da Esteira

Onde está a base hoje em cada etapa dos acionamentos e quem se moveu entre elas: Cliente novo, Não CPC (em ciclos: 1º ciclo, 2º ciclo…, e Parado · aguarda enriquecimento), CPC · em negociação, CPC · sem resposta, Acordo em dia, Acordo · antes do vencimento, Acordo · parcela vencida, Quitado e Bloqueado. Mede por clientes ou saldo, com filtros.

### Orquestração (tela)

Onde se desenha o que cada segmento recebe a cada dia.

- Escolha o segmento no topo. Cada segmento tem faixas recolhíveis: Cliente novo, Deu CPC, Não CPC, Acordo e "Como vai funcionar".
- Os canais (WhatsApp, RCS, SMS, E-mail, Agente virtual, Discador, Enriquecimento) aparecem como pílulas coloridas.
- Mensagem por canal: WhatsApp e RCS usam template (aprovado no provedor); SMS e Agente virtual usam frase; Discador, E-mail e Enriquecimento não têm mensagem.
- A bolinha dentro da pílula indica a mensagem: branca cheia = escolhida; só contorno = sem template ou sem frase; vermelha = a frase ou o template foi desativado.
- Na faixa "Deu CPC", o contato principal e o canal do CPC vêm sempre primeiro; a escolha por estágio (CPC · em negociação e CPC · sem resposta) segue a mesma regra.

Para montar a régua de um segmento (permissão "Editar a orquestração"):

1. Orquestração › Orquestração e escolha o credor no topo.
2. Escolha o segmento.
3. Arraste um canal da paleta para o dia ("solte um canal aqui").
4. No WhatsApp ou RCS, clique na bolinha e use "Escolher template" (busca por nome, código ou texto). No SMS ou Agente virtual, use "Escolher frase".
5. Confira em "Como vai funcionar" quantas ações estão sem template ou sem frase.
6. Clique em "Salvar".

Depois de ajustar, quem tem a permissão "Reenquadrar agora" pode pedir a rodada do motor na hora, sem esperar a rotina seguinte.

### Comitê

Planilha mensal do comitê para download (permissão "Baixar o relatório de comitê").

### Enviar arquivos

Envio dos arquivos da carteira (permissão "Enviar arquivos"): carga do credor, ocorrência (o retorno dizendo, por cliente, se deu CPC), atualização de contatos (enriquecimento), acordos, pagamentos e retornos dos canais. Formatos CSV, TXT ou XLSX.

1. Orquestração › Enviar arquivos.
2. Escolha o credor e o tipo de arquivo.
3. Arraste o arquivo ou clique para escolher.
4. Acompanhe na tabela de envios: pendente, processado ou erro. Clique no envio para ver o relatório de linhas lidas, aceitas e rejeitadas.

Arquivo com layout novo fica aguardando o mapeamento de colunas antes de ser processado. Só quem está na carga do dia recebe ação.

### Canais e frases

Cadastro dos canais da empresa (horário de envio e custo) e das mensagens (permissão "Editar canais e frases").

- WhatsApp e RCS: aba "Templates". Campos Nome, "Código do template no provedor" (obrigatório) e "Prévia do texto".
- SMS e Agente virtual: aba "Frases". No SMS há um contador "{n}/160"; acima de 160 caracteres o SMS não é enviado. No RCS, até 160 caracteres é RCS Basic; acima, RCS Single.
- Discador e E-mail não têm aba de frases.

---

## Jornada (frente MotorCli)

A Jornada decide, todo dia, qual conversa cada cliente da carteira recebe conforme o momento da relação. Ela aparece no seletor de produto quando a frente atual é o MotorCli. Menu: Operação (Início, Lista do dia, Enviar arquivos) · Configuração (Carteiras, Momentos da jornada, Canais).

### Momentos
Cada cliente fica em no máximo um momento por dia, nesta prioridade:
1. Pré-vencimento: de 5 dias antes até o dia do vencimento (passos padrão D-5, D-2 e D0). Quem já pagou o vencimento sai.
2. Boas-vindas: até 2 dias depois da contratação (D0).
3. Ativação: de 3 a 30 dias depois da contratação, só para quem não ativou (D+3, D+7, D+15 e D+30).
4. Retenção: de 30 a 89 dias sem atividade (D+30, D+45, D+60 e D+75).
5. Reativação: de 90 a 365 dias sem atividade (D+90, D+120, D+180 e D+270).
Um passo por vez: o passo que caiu num domingo ou feriado sai no próximo dia útil, até a data do passo seguinte. Entre duas ações para o mesmo cliente há uma espera (padrão 48 horas); o pré-vencimento não espera.

### Quem fica de fora
Cliente com dias de atraso maior que zero fica com a cobrança (MotorCob), não com a Jornada. Também ficam de fora: bloqueado (opt-out, óbito ou judicial), sem momento hoje, passo já feito, espera entre ações e sem contato elegível. O Início da Jornada mostra quantos clientes ficaram de fora por motivo.

### Contato e canal
O contato principal sai primeiro; contato inválido, descadastrado ou de outra pessoa fica de fora. WhatsApp só em número confirmado como WhatsApp na carga (coluna whatsapp_valido = sim). "Melhor canal" escolhe entre os canais do passo pelo resultado da carteira quando já há tentativas suficientes; sem evidência, segue a ordem configurada. Se o canal não tem contato ou está desligado em Canais, vale o "senão" do passo.

### Enviar arquivos (Jornada)
Dois arquivos por carteira, em CSV com ponto e vírgula (ou .xlsx):
- Clientes da jornada: id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade;dias_atraso;bloqueio. Datas em AAAA-MM-DD ou DD/MM/AAAA; vencimento_pago e ativado com sim ou não.
- Contatos: id_cliente;contato;tipo;whatsapp_valido (tipo telefone ou email).
O botão "Baixar modelo" gera o arquivo vazio com o cabeçalho certo. A Lista do dia sai na rodada da manhã.

### Momentos da jornada (estratégias)
Em Configuração › Momentos da jornada: ligue ou desligue cada momento, mude os passos (dia, canal e "senão") e as horas entre ações. Cada carteira usa a estratégia escolhida em Carteiras ou a padrão da frente. Se uma estratégia tiver erro, a rodada usa o padrão do MotorCli e avisa.

### Lista do dia (Jornada)
ID do cliente, momento, passo e canal de cada ação de hoje. "Baixar por canal" baixa um arquivo por canal para o seu fornecedor; com a Mensageria contratada, os lotes de SMS, RCS e e-mail são montados sozinhos.

## Mensageria

Envio de mensagens por SMS, RCS, E-mail e WhatsApp. Abra em Workspace › Seus produtos › Mensageria e escolha o canal no controle do menu. Só aparecem liberados os canais contratados.

Origem das mensagens:

- Lista do dia: o MotorCX monta os lotes sozinho a partir da Lista do dia e envia dentro do horário do canal.
- Campanhas: listas enviadas pela própria empresa.

Os envios respeitam o horário do canal, o orçamento do centro de custo, os descadastros e as listas de bloqueio. Domingo nunca envia.

### Simulação e envio real

- Simulação: faixa amarela "Simulação: nenhuma mensagem sai de verdade e nada é cobrado. Os resultados são de teste."
- Envio real: selo verde "Envio real". Só a equipe MotorCX muda o modo, quando o fornecedor estiver integrado. Envio real entra no consumo e na fatura.

### Painel

Funil de entrega e engajamento do canal. Filtros de período (Hoje, 7 dias, 30 dias, Mês atual, Personalizado) e de origem (Todas, Lista do dia ou uma campanha). Mostra cards com cada status, o funil, o gráfico por dia e a tabela por origem. Os botões "i" ao lado de cada status explicam o que ele significa.

No RCS, o card "Fallback" mostra quantos aparelhos sem RCS receberam por SMS ou WhatsApp, conforme a configuração.

### Campanhas

Situações: Lendo a lista, Confirme o layout, Pronta, Agendada, Enviando, Concluída, Cancelada e Erro (com o motivo).

Para criar uma campanha (permissão "Enviar mensagens"):

1. Mensageria › Campanhas › Nova campanha.
2. Dados: nome, template (no E-mail, o modelo de e-mail), centro de custo (opcional), "Rastrear links" e, no RCS, o que fazer "Se o aparelho não tiver RCS" (configuração da empresa, SMS, WhatsApp ou não enviar).
3. Lista: arraste o arquivo (.csv, .txt ou .xlsx, até 20 MB). Qualquer layout serve: o MotorCX identifica as colunas e você confirma. Aguarde "Lendo a lista…".
4. Layout: confira o uso de cada coluna (Telefone, E-mail, ID do cliente, uma variável do template ou Ignorar). Variáveis do template sem coluna aparecem em vermelho. Clique em "Confirmar layout".
5. Envio: veja a prévia do template e escolha "Enviar agora" ou "Agendar" (data e hora).

A campanha pode ser cancelada antes de concluir. Clique numa campanha para ver o funil dela.

### Lotes do dia

Os lotes que nascem da Lista do dia, por volta das 6h. Cada lote mostra o canal, o credor, a situação (Aguardando aprovação, Agendado, Enviando, Pausado, Concluído, Cancelado), a janela de envio e os números do funil.

Para aprovar um lote (permissão "Enviar mensagens"):

1. Mensageria › Lotes do dia.
2. No lote "Aguardando aprovação", clique em "Aprovar envio" (ou "Cancelar").
3. Lote agendado ou enviando pode ser pausado; lote pausado pode ser retomado ou cancelado. Ao cancelar, as mensagens que ainda não saíram não serão enviadas.

O detalhe do lote lista cada mensagem (ID do cliente, destino mascarado, situação, motivo) com "Exportar CSV". Sem modelo de e-mail cadastrado, os lotes de e-mail ficam bloqueados.

A aprovação de cada lote é ligada por padrão; pode ser desligada em Configurações ("Aprovar cada lote antes do envio"). Desligada, o lote do dia sai sozinho no horário do canal.

### Respostas e Radar

Caixa de entrada das respostas dos clientes no SMS, RCS e WhatsApp (permissão "Enviar mensagens").

O Radar lê cada resposta e mostra a intenção do cliente em seis classes: CPC Negócio, CPC, Alega pagamento, Judicial, Desconhece e Baixo calão. O pedido de negócio pesa mais que o palavrão ("me manda o boleto" com palavrão é CPC Negócio). Cada resposta mostra a classe, a confiança e o motivo ("Por que"), com a origem "IA" ou "Regras". Em simulação, o Radar usa só as regras.

Para responder:

1. Mensageria › Respostas.
2. Filtre por classe, situação (Abertas, Resolvidas, Todas), "Só não lidas", ID do cliente ou campanha.
3. Abra a conversa, escreva e clique em "Enviar". A resposta sai pelo mesmo canal, no horário de envio. No SMS a resposta é cobrada como SMS.
4. Use Reclassificar, Assumir e Resolver ou Reabrir conforme o caso.

Com um filtro de classe ativo, "Responder a todos deste filtro" envia a mesma resposta para até 200 conversas abertas. Contatos que pediram para não receber mais mensagens são recusados.

Os textos das respostas ficam guardados por 90 dias e depois são apagados; a classificação continua nos relatórios.

### Templates e Modelo de e-mail

Permissão "Editar canais e frases".

- SMS: texto com contador "{n}/160 sem as variáveis". Depois de preencher as variáveis, o SMS acima de 160 caracteres não é enviado.
- RCS: categoria (Autenticação, Transacional, Marketing) e tipo de mídia: Simples, Botões (1 a 4: Abrir link, Resposta rápida, Ligar), Arquivo (PDF ou imagem até 10 MB), Rich card ou Carrossel (2 a 10 cards). A tela mostra o selo RCS Basic ou RCS Single.
- "Rastrear links": os links viram endereços curtos do MotorCX para saber quem clicou.
- E-mail: Mensageria › Modelo de e-mail, com nome do remetente, assunto e texto. A única variável é {empresa}. O rodapé de descadastro é colocado automaticamente.

Para criar um template: Mensageria › Templates › Novo template, preencha e salve. Também há Editar, Duplicar e Arquivar.

### Listas

Abas Bloqueio e Favoritos, por canal ou para todos os canais.

- Bloqueio: suspeitos e números que nunca devem receber mensagem.
- Favoritos: passam direto pela validação de formato e de operadora (descadastro e bloqueio continuam valendo). Use para números da sua equipe e de teste.

Para adicionar: Mensageria › Listas › Bloqueio (ou Favoritos) › Adicionar; escolha o canal, o motivo e cole telefones ou e-mails (um por linha) ou escolha um CSV (só a primeira coluna). A lista mostra só o destino mascarado.

Descadastros (quem respondeu SAIR, clicou no link de descadastro, foi descadastrado manualmente ou reclamou) nunca recebem mensagem daquele canal.

### Configurações

- Centros de custo: nome, orçamento do mês (vazio = sem limite), alerta em %, e o que fazer ao acabar o orçamento (Bloquear envios ou Enviar mesmo assim). O gasto é estimado pelos preços do contrato.
- Centro de custo da Lista do dia e, no RCS, o fallback "Se o aparelho não tiver RCS" (Enviar por SMS, Enviar por WhatsApp, Não enviar) e o template do SMS de fallback (vazio = o texto do RCS, se couber em 160).
- Agente RCS (Não conversacional ou Conversacional): só leitura para o cliente; a equipe MotorCX altera.
- Aprovar cada lote antes do envio.
- Horário de cada canal (só leitura; altera-se em Canais e frases).

### Links rastreados (mcob.pro)

Com "Rastrear links" ligado no template ou na campanha, cada link vira um endereço curto do MotorCX no domínio mcob.pro (exemplo: https://mcob.pro/Ab12Cd34). No SMS, o link curto ocupa cerca de 30 dos 160 caracteres. Link inexistente ou vencido mostra "Este link expirou.".

O Painel e o detalhe da campanha mostram o funil de engajamento (Enviados, Entregues, Clicaram, Responderam, CPC Negócio), CTR (clicaram ÷ entregues), cliques por hora e aparelho e "Quem clicou" (só o ID do cliente). Cliques de robôs são ignorados.

---

## Status de entrega

### SMS e RCS

Funil: Carregado → Higienizado → Disparado → Enviado → Entregue / Não entregue → Respostas.

- Carregado: linhas recebidas da Lista do dia ou da campanha.
- Higienizado: válidos para envio, depois de tirar inválidos e bloqueados (lista de bloqueio, descadastro, sem texto).
- Disparado: o MotorCX entregou a mensagem à operadora, pela rota de SMS da campanha ou pelo agente RCS verificado.
- Enviado: a operadora confirmou o envio ao número.
- Entregue / Não entregue: retorno de entrega da operadora (DLR). Entregue inclui quem recebeu e pediu para sair.
- Respostas: clientes que responderam.
- Sem retorno final: a operadora confirmou o envio, mas não devolveu a DLR final (nem de entregue nem de falha).

Percentuais: Enviado, Entregue e Não entregue são calculados sobre os Disparados; Respostas, sobre os Entregues.

SMS: até 160 caracteres. Acima de 160 caracteres o SMS não é enviado. Antes do envio, a operadora do número é consultada e número inválido não sai. Cada resposta do cliente é cobrada pelo preço do SMS.

RCS:

- Basic: texto até 160 caracteres.
- Single: imagem, card ou botões (ou texto acima de 160).
- Conversacional: com agente conversacional, a resposta do cliente abre uma sessão de 24 horas; nesse período, novas mensagens ao mesmo número não têm custo extra. Com agente não conversacional, a resposta é ignorada.
- Aparelhos sem RCS seguem o fallback configurado (SMS, WhatsApp ou não enviar).

### E-mail

- Disparado: entregue ao provedor de e-mail, assinado com SPF, DKIM e DMARC.
- Entregue: o servidor do destinatário aceitou. Percentual sobre os Disparados; saudável acima de 95%.
- Bounce permanente: o endereço ou o domínio não existe. Conta como não entregue e o e-mail é marcado como inexistente na Orquestração. Saudável abaixo de 2%.
- Bounce temporário: caixa cheia ou servidor fora do ar.
- Aberturas únicas ÷ Entregues: valor estimado (o Apple Mail abre e-mails automaticamente).
- Cliques únicos ÷ Entregues: CTR.
- CTOR: cliques ÷ aberturas.
- Descadastros ÷ Entregues: atenção acima de 0,5%.
- Spam ÷ Entregues: Gmail e Yahoo exigem abaixo de 0,3%; o ideal é abaixo de 0,1%. Marcação de spam vira descadastro com origem "Reclamação".

---

## Relatórios

Menu lateral › Relatórios (na Mensageria, abre já filtrado pelo canal). Abas: Padrão · Personalizados · Novo relatório.

- Padrão: relatórios prontos por categoria (Entrega, Higienização, Respostas, Links, Descadastros, Custo, Analítico), com filtros de período, canal e origem ou campanha. Botões "Exportar CSV" e "Salvar como personalizado".
- Personalizados: os relatórios salvos pela empresa, com Abrir, Editar, Duplicar e Excluir.

Para montar um relatório:

1. Relatórios › Novo relatório.
2. Escolha a base (por exemplo, "Funil de envio (status)").
3. Escolha o formato: "Linha a linha" (colunas) ou "Resumo" (agrupar e métricas: contar, somar, média, mínimo, máximo).
4. Adicione filtros (campo, operador, valor).
5. Defina a ordem.
6. Salve com nome, descrição e categoria. O período é escolhido ao abrir.

"Sem dados no período (ou sem permissão para esta base)" indica período vazio ou falta de permissão. 

---

## Empresa

Workspace › Empresa. Abas:

- Visão geral: dados cadastrais da empresa. Só a equipe MotorCX edita.
- Contatos: pessoas com quem a MotorCX fala (não precisam de acesso). Quem tem "Gerenciar usuários" edita.
- Membros: usuários da empresa, com perfil, último acesso e situação. "Convidar membro" e "Gerenciar" levam a Usuários e permissões.
- Módulos: módulos e canais contratados. Para incluir um módulo, fale com o comercial ("Quero conhecer" abre um chamado).
- Faturamento (permissão "Ver faturamento"): preços do contrato, consumo do mês por item, próxima fatura estimada e faturas com situação (Em aberto, Vencida, Paga, Cancelada), botões "Boleto" e "Nota fiscal". Clique numa fatura para ver itens e ajustes. Dúvidas sobre valores e contrato: fale com o time comercial ou abra um chamado com o motivo "Faturamento".

---

## Minha conta

Menu do usuário › Minha conta (/conta). Abas:

- Dados: foto e dados do perfil. O e-mail só o Admin da empresa troca.
- Permissões: o que o seu perfil pode fazer nesta empresa (só leitura). Quem ajusta é o Admin, em Usuários e permissões.
- Segurança: senha, verificação em duas etapas e sessões.
- Tokens de API: ver a seção API.

Para trocar a senha:

1. Minha conta › Segurança.
2. Digite a nova senha duas vezes (as regras aparecem enquanto você digita).
3. Digite o código enviado ao seu e-mail.

As outras sessões continuam até você encerrá-las.

Para ligar a verificação em duas etapas:

1. Minha conta › Segurança › Verificação em duas etapas › Ligar.
2. Leia o QR code com um aplicativo autenticador (ou copie a chave).
3. Digite o código de 6 dígitos.

Para quem não é Admin, a verificação é opcional e pode ser desligada com o código. Para Admin é obrigatória. Se perder o autenticador, peça ao Admin da empresa para resetar a verificação em duas etapas em Usuários e permissões.

Sessões: "Sair de todos os outros dispositivos" e "Sair deste dispositivo".

Documentação: menu do usuário › Documentação (/docs), com busca e artigos de Primeiros passos, Lista do dia, Orquestração, Mensageria, Arquivos e cargas, Segurança e conta, e Integração e API.

---

## Suporte

Workspace › Suporte. A tela mostra o prazo de resposta informado pela MotorCX e a lista de chamados (Abertos, Resolvidos, Todos), com protocolo e situação: Aberto, Em atendimento, Aguardando você, Resolvido.

Para abrir um chamado:

1. Suporte › Abrir chamado (ou digite "chamado" em "O que você quer fazer?").
2. Escolha o motivo: Acesso e login, Lista do dia e orquestração, Envio de arquivos e cargas, Mensageria, Faturamento, Integração e API, Sugestão de melhoria ou Outro.
3. Preencha assunto, prioridade (Normal ou Alta; Alta = a operação parou) e descrição.
4. Anexe até 5 arquivos de até 10 MB (CSV, TXT, PDF, JPG, PNG, ZIP, XLS, XLSX). Anexar o arquivo ajuda a resolver mais rápido.
5. Clique em "Enviar". Você recebe o protocolo; a resposta chega na plataforma e por e-mail.

No chamado, responda pela conversa ou use "Marcar como resolvido". Responder um chamado resolvido o reabre.

---

## Usuários e permissões

Menu lateral › Usuários e permissões (permissão "Gerenciar usuários"). Convide pessoas, defina o perfil e ajuste os acessos. Também é possível trocar o perfil, desativar, reativar, resetar a senha e resetar a verificação em duas etapas.

Para convidar um usuário:

1. Usuários e permissões › Convidar usuário.
2. Informe o e-mail e o perfil.
3. A pessoa recebe o convite por e-mail e cria a senha.

Perfis e o que cada um pode fazer por padrão:

- Admin: tudo, incluindo usuários, permissões, auditoria, acessos, faturamento e tokens de API. Sempre mantém "Gerenciar usuários" e "Gerenciar permissões".
- Planejamento: baixar a Lista do dia e os arquivos completos, baixar o comitê, enviar arquivos, reenquadrar, editar orquestração, credores, canais e frases, e enviar mensagens.
- Operação: baixar a Lista do dia. Não vê menus de configuração nem de administração.
- Gestão: baixar a Lista do dia, baixar o comitê, ver acessos e ver faturamento.

O Admin pode mudar esse padrão na página Permissões (grade de permissões × perfis; ponto laranja = diferente do padrão; "Voltar ao padrão MotorCob" desfaz). Ninguém altera o próprio perfil, e só Admin cria ou altera Admin.

---

## Auditoria

Menu lateral › Auditoria (permissão "Ver auditoria"). Registra quem alterou o quê e quando nas configurações, usuários e permissões. Colunas: Quando, Quem, O quê, Ação (Criou, Alterou, Excluiu) e Registro. Expanda a linha para ver campo, antes e depois. Filtros por período, tipo e usuário; "Exportar CSV". É só leitura: ninguém edita nem apaga a auditoria.

---

## API

A API permite que o sistema da empresa envie cargas e leia a Lista do dia sem passar pelo site. Requer a permissão "Gerenciar tokens de API" (Admin).

Para criar um token:

1. Minha conta › Tokens de API › Criar token.
2. Informe o nome (por exemplo, "ERP Financeiro"), os escopos, os credores (vazio = todos) e a validade (30, 90, 180 ou 365 dias).
3. Copie o token na hora: por segurança, ele não aparece de novo. Guarde num cofre de segredos, nunca no código.

Escopos: "Enviar cargas", "Acompanhar cargas" e "Ler a Lista do dia". Limite de 10 tokens ativos por empresa. "Revogar" para o token na hora.

Endpoints:

- Enviar carga (credor, tipo e nome do arquivo; tipos geral, incremental, retirada, acordo, baixa ou ocorrência; CSV, TXT ou XLSX até 20 MB).
- Acompanhar carga: situação pendente, aguardando (layout novo, aguardando mapeamento no site), processado ou erro, com o relatório.
- Lista do dia: por credor, canal e data; devolve o mesmo CSV que o site baixa.

Regras: o credor precisa estar com "Como a carga chega" = API (em Credores); limite de 60 chamadas por minuto por token; cada download da Lista do dia fica registrado em Acessos. Nunca mande CPF, nome ou telefone em parâmetro de URL.

A documentação completa (endereço, autenticação, exemplos e códigos de erro) está em Documentação › Integração e API (/docs/api), também acessível pelo link "Ver a documentação da API" em Tokens de API.

---

## LGPD e dados pessoais

- A plataforma nunca mostra nem busca por CPF ou nome do devedor. A busca é só por ID do cliente ou número do contrato.
- Telefones e e-mails dos clientes não ficam guardados no banco de dados: a plataforma guarda só o destino mascarado e um código de verificação (hash). Telas, exportações e relatórios mostram só o ID do cliente e o destino mascarado.
- Textos de respostas dos clientes ficam 90 dias e depois são apagados.
- Antes de qualquer resposta ser analisada pela IA do Radar, números e e-mails são substituídos por marcadores.
- O assistente nunca pede nem recebe CPF, telefone, e-mail ou nome de devedores. Para falar de um cliente, use o ID do cliente.
`;
