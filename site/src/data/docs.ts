export type DocArtigo = {
  slug: string;
  titulo: string;
  categoria: string;
  resumo: string;
  paragrafos: string[];
};

export const DOC_CATEGORIAS = [
  'Primeiros passos',
  'Lista do dia',
  'Orquestração',
  'Mensageria',
  'Arquivos e cargas',
  'Segurança e conta',
];

export const DOC_ARTIGOS: DocArtigo[] = [
  {
    slug: 'primeiros-passos',
    titulo: 'Do convite à primeira Lista do dia',
    categoria: 'Primeiros passos',
    resumo: 'Convite, senha, código de duas etapas, enviar a carga e conferir a Lista do dia às 6h.',
    paragrafos: [
      'Você recebeu um convite por e-mail. Abra o link, crie sua senha e, na primeira entrada, ligue a verificação em duas etapas com um aplicativo autenticador (Google Authenticator, Authy ou similar). Esse código passa a ser pedido a cada novo acesso.',
      'Depois de entrar, escolha a empresa no topo. Se a sua empresa tem mais de um credor (carteira), escolha também o credor com o qual vai trabalhar — a Lista do dia, a carteira e os números mudam por credor.',
      'O primeiro passo operacional é enviar a carga do credor em “Enviar arquivos”. O MotorCX reconhece o layout, mapeia as colunas e, se faltar algo, abre um chamado de suporte automaticamente.',
      'Às 6h da manhã, a rotina vira a Lista do dia: quem acionar hoje, por canal, com o motivo de quem ficou de fora. Abra “Lista do dia” e baixe os arquivos por canal.',
      'Ao longo do dia, acompanhe as ações em “Ações” e o andamento em “Painel”. Tudo fica registrado na auditoria.',
    ],
  },
  {
    slug: 'lista-do-dia',
    titulo: 'Como ler a Lista do dia',
    categoria: 'Lista do dia',
    resumo: 'Os quatro grupos (com ação, regra da esteira, sem contato, fora da cobrança) e o que fazer com quem está sem canal.',
    paragrafos: [
      'A Lista do dia separa a carteira em quatro grupos. O primeiro é “com ação”: são os clientes que o MotorCX decidiu acionar hoje, já com o canal e a mensagem escolhidos pela estratégia.',
      'O segundo grupo é “regra da esteira”: clientes que a régua do segmento mandou esperar — por exemplo, quem recebeu um SMS ontem e ainda está no prazo de resposta.',
      'O terceiro é “sem contato”: clientes sem telefone ou e-mail válido. Para esses, o Enriquecimento busca contatos novos; enquanto não chegam, eles não entram na lista.',
      'O quarto é “fora da cobrança”: clientes quitados, retirados ou bloqueados. Eles saem da lista e voltam só se a situação mudar.',
      'Quem está sem contato não é um erro — é uma oportunidade. Ligue o Enriquecimento ou abra um chamado para que o time MotorCX busque os contatos.',
    ],
  },
  {
    slug: 'orquestracao',
    titulo: 'Réguas, “senão” e telefone Hot',
    categoria: 'Orquestração',
    resumo: 'Arrastar canal para o dia, reserva para quem não atendeu e priorizar quem deu CPC.',
    paragrafos: [
      'Na Orquestração, cada segmento tem uma régua: qual canal acionar em cada dia, a partir do evento (vencimento, atraso, acordo). Você arrasta o canal para o dia e define o “senão” — o que fazer se o canal principal não entregar.',
      'O “senão” é a reserva: se o SMS não for entregue, o MotorCX tenta o e-mail; se o RCS não for lido, cai para o SMS. Assim ninguém fica sem tentativa.',
      'O telefone Hot é uma prioridade. Quem deu CPC (clicou no link de pagamento) vira Hot e passa à frente em todos os canais — a chance de acordo é maior.',
      'Você pode montar personas para afinar a régua: clientes com perfil de pagamento, de fuga, de negociação. Cada persona recebe a régua que faz mais sentido.',
      'Ao salvar, o MotorCX valida a régua e avisa se algum dia ficou sem canal ou se há mensagens faltando.',
    ],
  },
  {
    slug: 'arquivos',
    titulo: 'Arquivo ou API',
    categoria: 'Arquivos e cargas',
    resumo: 'Carga geral, incremental, retirada, acordos, pagamentos; mapeamento de colunas; relatório de linhas aceitas e rejeitadas.',
    paragrafos: [
      'A carga chega por arquivo (CSV, TXT ou XLSX) ou por API. No arquivo, o MotorCX reconhece os tipos: carga geral (a base toda), incremental (só os novos), retirada (quem saiu), acordos, pagamentos e ocorrências.',
      'No primeiro envio, o MotorCX pede o mapeamento de colunas: qual coluna é o contrato, qual é o valor, qual é o telefone. Depois disso, ele lembra o layout do credor.',
      'Cada envio gera um relatório: quantas linhas foram aceitas, quantas rejeitadas e o motivo de cada rejeição (CPF inválido, valor zerado, data fora do formato).',
      'As ocorrências de canal (SMS entregue, RCS lido, ligação atendida) voltam como arquivo de retorno e alimentam o motor — é assim que ele aprende e propõe mudanças.',
      'Se a carga vier por API, o relatório é o mesmo. A diferença é que o sistema do credor envia direto, com token e escopo, sem passar pelo site.',
    ],
  },
  {
    slug: 'mensageria',
    titulo: 'Templates e frases',
    categoria: 'Mensageria',
    resumo: 'WhatsApp e RCS com template aprovado, SMS e agente virtual com frase, descadastro respeitado em todos os canais.',
    paragrafos: [
      'Cada canal tem o seu tipo de mensagem. WhatsApp e RCS usam templates aprovados pela operadora — você cadastra o template, com variáveis, e o MotorCX envia no formato certo.',
      'SMS e agente virtual usam frases: textos curtos, com variáveis de contrato e valor. O MotorCX conta os caracteres do SMS para você não estourar o limite.',
      'O descadastro é respeitado em todos os canais. Quem responde “SAIR” em qualquer canal é marcado e não recebe mais — o motor bloqueia automaticamente.',
      'Você pode montar um playbook: para cada etapa (prevenção, cobrança, acordo), uma frase ou template. Importe por CSV ou crie direto na tela.',
      'As mensagens da Lista do dia saem no horário permitido de cada canal, respeitando o silêncio noturno e os feriados.',
    ],
  },
  {
    slug: 'seguranca',
    titulo: 'Senha, duas etapas e sessões',
    categoria: 'Segurança e conta',
    resumo: 'Como ligar o autenticador e encerrar sessões.',
    paragrafos: [
      'Sua senha tem pelo menos 12 caracteres, com letra e número. Para trocar, vá em “Minha conta → Segurança”: o MotorCX envia um código ao seu e-mail e você confirma antes de definir a senha nova.',
      'A verificação em duas etapas liga um aplicativo autenticador. Escaneie o QR ou digite a chave, insira o código de 6 dígitos e pronto — a cada entrada, o código é pedido.',
      'Para Admin, a verificação é obrigatória e não pode ser desligada. Os demais perfis podem ligar e desligar, mas recomendamos manter ligada.',
      'Em “Sessões”, você vê o dispositivo atual e pode sair de todos os outros de uma vez. Útil se esqueceu logado em outro computador.',
      'A sessão expira sozinha após 30 minutos sem uso, com aviso 1 minuto antes. Você pode continuar conectado ou sair.',
    ],
  },
];
