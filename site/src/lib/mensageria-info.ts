// Definições dos balões "i" do funil de envio da Mensageria.
// Cada entrada: título | texto | cálculo (opcional) | referência (opcional).

export type InfoDef = { titulo: string; texto: string; calculo?: string; referencia?: string };

export const INFO_DEFS: Record<string, InfoDef> = {
	carregados: {
		titulo: 'Carregados',
		texto: 'Todos os registros que vieram no arquivo ou pela API, antes de qualquer filtro.',
		calculo: 'Base da campanha',
	},
	higienizados: {
		titulo: 'Higienizados',
		texto: 'Registros aprovados na higienização: contato válido, sem duplicidade, fora da lista de bloqueio e do descadastro, com o texto completo. Só eles podem ser disparados.',
		calculo: 'Higienizados ÷ Carregados',
	},
	disparados_sms: {
		titulo: 'Disparados (SMS)',
		texto: 'Mensagens que o MotorCX enviou à operadora pela rota de SMS escolhida (fornecedor e % de tráfego da campanha). A partir daqui, quem leva a mensagem até o celular é a operadora do número (Vivo, Claro, TIM e outras). Cada SMS tem até 160 caracteres; acima disso a mensagem é bloqueada antes do disparo. As respostas do cliente também são cobradas.',
		calculo: 'Base de Enviados, Entregues e Não entregues',
	},
	disparados_rcs: {
		titulo: 'Disparados (RCS)',
		texto: 'Mensagens que o MotorCX enviou à operadora pelo agente RCS verificado da empresa (nome, logo e selo de verificação no celular). O RCS só chega a aparelhos com RCS ativo; o que não chegar segue a regra de fallback para SMS da campanha. O tipo define a cobrança: Basic (só texto, até 160 caracteres), Single (com imagem, cartão ou botões) e Conversacional (sessão de 24 horas aberta pela resposta do cliente).',
		calculo: 'Base de Enviados, Entregues, Não entregues e Fallback',
	},
	disparados_email: {
		titulo: 'Disparados (e-mail)',
		texto: 'E-mails que o MotorCX entregou ao provedor de envio de e-mail, já assinados com o domínio do remetente (SPF, DKIM e DMARC). A partir daqui, o provedor tenta entregar ao servidor de e-mail do destinatário (Gmail, Outlook ou o servidor da empresa dele), que aceita, recusa (bounce) ou manda para o spam. Não há operadora nem custo por caractere.',
		calculo: 'Base de Entregues e dos bounces',
	},
	enviados: {
		titulo: 'Enviados',
		texto: 'A operadora confirmou que enviou a mensagem ao número. Quando a operadora não devolve o retorno final (DLR), a mensagem fica só como Enviado.',
		calculo: 'Enviados ÷ Disparados',
	},
	entregues_sms: {
		titulo: 'Entregues (SMS/RCS)',
		texto: 'A operadora devolveu o retorno de entrega (DLR) confirmando que a mensagem chegou ao aparelho.',
		calculo: 'Entregues ÷ Disparados',
	},
	nao_entregues: {
		titulo: 'Não entregues',
		texto: 'A operadora devolveu retorno de falha: número inexistente ou cancelado, aparelho desligado até a mensagem expirar, sem cobertura ou recusa da operadora.',
		calculo: 'Não entregues ÷ Disparados',
	},
	respostas: {
		titulo: 'Respostas',
		texto: 'Clientes que responderam à mensagem. O Radar classifica cada resposta (quer negociar, já pagou, não reconhece a dívida…).',
		calculo: 'Respostas ÷ Entregues',
	},
	sem_retorno: {
		titulo: 'Sem retorno final',
		texto: 'Mensagens enviadas pela operadora que não receberam nem Entregue nem Não entregue. O retorno ainda pode chegar depois.',
		calculo: 'Sem retorno ÷ Disparados',
	},
	fallback: {
		titulo: 'Fallback (SMS)',
		texto: 'Mensagens RCS que não chegaram (aparelho sem RCS ou falha) e foram reenviadas por SMS, conforme a regra de fallback da campanha. Entram de novo no funil do SMS.',
		calculo: 'Fallback ÷ Disparados RCS',
	},
	entregues_email: {
		titulo: 'Entregues (e-mail)',
		texto: 'O servidor de e-mail do destinatário aceitou a mensagem. Não garante caixa de entrada: pode ir para a pasta de spam.',
		calculo: 'Entregues ÷ Disparados',
		referencia: 'Saudável: acima de 95%',
	},
	bounce_permanente: {
		titulo: 'Bounce permanente',
		texto: 'Endereço ou domínio que não existe. O MotorCX marca o e-mail como inexistente na Orquestração, para não insistir nele e proteger a reputação do remetente.',
		calculo: 'Bounce permanente ÷ Disparados',
		referencia: 'Saudável: abaixo de 2%',
	},
	bounce_temporario: {
		titulo: 'Bounce temporário',
		texto: 'Falha passageira: caixa cheia, servidor fora do ar ou mensagem grande demais. O provedor tenta de novo; o e-mail não é marcado como inexistente.',
		calculo: 'Bounce temporário ÷ Disparados',
	},
	aberturas: {
		titulo: 'Aberturas únicas',
		texto: 'Pessoas que abriram o e-mail pelo menos uma vez. É um número estimado: o Apple Mail e alguns provedores abrem as imagens sozinhos e inflam a abertura. Use os cliques como sinal mais confiável.',
		calculo: 'Aberturas únicas ÷ Entregues',
	},
	cliques: {
		titulo: 'Cliques únicos (CTR)',
		texto: 'Pessoas que clicaram em pelo menos um link do e-mail. Os links passam pelo encurtador do MotorCX.',
		calculo: 'Cliques únicos ÷ Entregues',
	},
	ctor: {
		titulo: 'Clique por abertura (CTOR)',
		texto: 'De quem abriu, quantos clicaram. Mede se o conteúdo convence, separado do assunto.',
		calculo: 'Cliques únicos ÷ Aberturas únicas',
	},
	descadastros: {
		titulo: 'Descadastros',
		texto: 'Pessoas que pediram para não receber mais. Vão direto para o descadastro.',
		calculo: 'Descadastros ÷ Entregues',
		referencia: 'Atenção: acima de 0,5%',
	},
	spam: {
		titulo: 'Marcados como spam',
		texto: 'Destinatários que clicaram em “É spam”. É o indicador que mais derruba a reputação do domínio; quem marca vai para o descadastro.',
		calculo: 'Spam ÷ Entregues',
		referencia: 'Gmail e Yahoo exigem abaixo de 0,3%; o ideal é abaixo de 0,1%',
	},
	score_entrega: {
		titulo: 'Score de Entrega',
		texto: 'Antes do envio, o Score classifica cada número por probabilidade de entrega (Alto, Médio, Baixo ou Sem histórico) e segura os de baixa entrega. Você escolhe quais faixas enviar — os represados não saem e você não paga o SMS deles.',
		calculo: 'Economia = SMS evitados − custo do Score',
	},
	sem_historico: {
		titulo: 'Sem histórico',
		texto: 'Número que ainda não passou pela Mensageria: o Score não tem como classificar.',
	},
};
