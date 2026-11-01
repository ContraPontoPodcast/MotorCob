// Dados de DEMONSTRAÇÃO do Fluxo do agente (só desenvolvimento: VITE_FLUXO_FIXTURES=1 e `npm run dev`; a rota
// /dev/fluxo nem existe no build de produção). Tudo fictício, como no protótipo aprovado: empresa, carteiras, IDs
// CLI-xxxxx e personas de ficção. Nenhum dado pessoal. Serve para ver as 7 telas sem banco (Playwright).
import {
	TIPOS, validarLocal, type Bloco, type Definicao, type MetricaBloco,
} from '@/lib/fluxo';
import type {
	AlcadaRow, CasoRow, ChamadaCrmRow, ConectorRow, ConversaRow, FluxoApi, FluxoRow, IntencaoRow, LoteRow, ModeloRow, PedidoRow, PersonaRow,
	ResultadoLoteRow, RespostaRow, Simulacao, VersaoRow,
} from './api';

const b = (id: string, tipo: Bloco['tipo'], modo: Bloco['modo'], titulo: string | undefined, params: Record<string, unknown>, saidas: [string, string, string][] = []): Bloco => ({
	id, tipo, modo, ...(titulo ? { titulo } : {}), params,
	saidas: saidas.map(([quando, rotulo, para]) => ({ quando, rotulo, para, tipo: tipo === 'generativa' ? 'devolve' : quando === 'falhou' ? 'falha' : 'normal' })),
});

/** Negociador · Cartão Aurora v5 (rascunho com as pendências do desenho: N9 sem saída, N17 inalcançável, C4 e alçada). */
export function definicaoV5(): Definicao {
	return { esquema: 1, blocos: [
		b('N1', 'abertura', 'arvore', undefined, { fala: 'Olá, aqui é a central da {{assessoria}}, em nome de {{credor}}. Falo com {{primeiro_nome}}?' }, [['titular', 'Sou eu', 'N2'], ['terceiro', 'Não é a pessoa', 'N14']]),
		b('N2', 'identidade', 'cognicao', undefined, { fala: 'Para sua segurança, me confirma o dia e o mês do seu nascimento?', pergunta: 'dia_mes_nascimento', conector_id: 2, tentativas: 2 }, [['confirmou', 'Confirmou', 'N3'], ['nao_confirmou', 'Não confirmou', 'N14'], ['falhou', 'Conector falhou', 'N13']]),
		b('N3', 'intencao', 'cognicao', undefined, { fala: 'Consta {{saldo}} em aberto no Cartão Aurora. Como fica melhor para você?', intencoes: ['quero_negociar', 'ja_paguei', 'nao_reconheco', 'sem_dinheiro'], confianca_min: 0.7, tentativas: 2 }, [['quero_negociar', 'Quer negociar', 'N4'], ['ja_paguei', 'Já paguei', 'N8'], ['nao_reconheco', 'Não reconheço', 'N10'], ['sem_dinheiro', 'Sem dinheiro agora', 'N9'], ['nao_entendido', 'Não entendi 2×', 'N13']]),
		b('N4', 'conector', 'sistema', 'Buscar ofertas (C1)', { conector_id: 1, fala_espera: 'Um instante, vou ver as condições.' }, [['respondeu', 'Respondeu', 'N15'], ['falhou', 'Falhou', 'N6']]),
		b('N15', 'condicao', 'sistema', 'Tem oferta?', { campo: 'ofertas_quantidade', op: '>=', valor: 1 }, [['sim', 'Sim', 'N5'], ['nao', 'Nenhuma oferta', 'N13']]),
		b('N5', 'generativa', 'generativo', 'Negociar dentro das ofertas', { objetivo: 'Fechar acordo com uma das ofertas recebidas. Comece pela menor parcela; fora das ofertas, explique o limite uma vez.', tom: ['cordial', 'frases_curtas', 'sem_giria', 'nao_pressiona'], max_turnos: 8, ferramentas: ['apresentar_oferta', 'registrar_promessa', 'agendar_retorno', 'consultar_base', 'transferir_humano', 'encerrar_chamada'], contrapropostas_max: 2 }, [['fechou_acordo', 'Fechou acordo', 'N7'], ['contestou', 'Contestou', 'N10'], ['sem_acordo', 'Sem acordo', 'N9'], ['fora_alcada', 'Fora da alçada', 'N13']]),
		b('N7', 'registrar', 'sistema', 'Registrar promessa/acordo', { registra: 'acordo_crm', conectores: [3, 4] }, [['registrado', 'Registrado', 'N11'], ['falhou', 'CRM falhou', 'N13']]),
		b('N11', 'link', 'arvore', 'Enviar link (SMS ou WhatsApp)', { canal: 'whatsapp_sms', fala: 'Acabei de mandar o link do acordo no seu WhatsApp.' }, [['enviado', 'Enviado', 'N12']]),
		b('N12', 'encerrar', 'arvore', 'Encerrar · acordo', { fala: 'Obrigada pela atenção. Até logo.', resultado: 'promessa', codigo: 'acordo_registrado' }),
		b('N6', 'oferta', 'cognicao', 'Oferta da carteira', { origem: 'carteira', fala: 'Consigo para você {{oferta.parcelas}} parcelas de {{oferta.valor_parcela}}. Fica bom?' }, [['aceitou', 'Aceitou', 'N7'], ['quer_outra', 'Quer outra condição', 'N5'], ['recusou', 'Recusou', 'N9']]),
		b('N8', 'pergunta', 'arvore', 'Pergunta · já paguei', { fala: 'Em que data você pagou?', tentativas: 1, opcoes: [{ codigo: 'informou_data', rotulo: 'Informou a data' }, { codigo: 'nao_lembra', rotulo: 'Não lembra' }] }, [['informou_data', 'Informou a data', 'N16'], ['nao_lembra', 'Não lembra', 'N13']]),
		b('N16', 'encerrar', 'arvore', 'Encerrar · alega pagamento', { fala: 'Obrigada. Vou registrar e a equipe confere o pagamento.', resultado: 'recusa', codigo: 'alega_pagamento' }),
		b('N10', 'transferir', 'arvore', 'Transferir · contestação', { fala: 'Vou passar você para um atendente.', motivo: 'contestacao' }),
		b('N9', 'retorno', 'cognicao', 'Agendar retorno', { fala: 'Quando fica melhor eu ligar de novo?', dias_max: 7 }),
		b('N17', 'encerrar', 'arvore', 'Encerrar · retorno', { fala: 'Combinado, eu ligo nesse horário. Até lá!', resultado: 'retorno_agendado' }),
		b('N13', 'transferir', 'arvore', 'Transferir · atendente', { fala: 'Vou passar você para um atendente agora, só um instante.', motivo: 'pedido_humano' }),
		b('N14', 'encerrar', 'arvore', 'Encerrar · recado neutro', { fala: 'Peço que {{primeiro_nome}} retorne para a {{assessoria}}. Obrigada.', resultado: 'recado' }),
	] };
}
/** v4 em uso: o mesmo fluxo sem as pendências (N9 → N17, link pelo MotorCX sem C4). */
function definicaoV4(): Definicao {
	const d = definicaoV5();
	return { esquema: 1, blocos: d.blocos.map(x => x.id === 'N9' ? { ...x, saidas: [{ quando: 'agendou', rotulo: 'Agendou', para: 'N17', tipo: 'normal' }, { quando: 'nao_agendou', rotulo: 'Não agendou', para: 'N13', tipo: 'normal' }] }
		: x.id === 'N7' ? { ...x, params: { registra: 'acordo_crm', conectores: [3] } } : x) };
}
function definicaoLocalizador(): Definicao {
	return { esquema: 1, blocos: [
		b('N1', 'abertura', 'arvore', undefined, { fala: 'Olá, aqui é a central da {{assessoria}}. Falo com {{primeiro_nome}}?' }, [['titular', 'Sou eu', 'N2'], ['terceiro', 'Não é a pessoa', 'N6']]),
		b('N2', 'identidade', 'cognicao', undefined, { fala: 'Para sua segurança, me confirma o dia e o mês do seu nascimento?', pergunta: 'dia_mes_nascimento', conector_id: 2, tentativas: 2 }, [['confirmou', 'Confirmou', 'N3'], ['nao_confirmou', 'Não confirmou', 'N6'], ['falhou', 'Conector falhou', 'N9']]),
		b('N3', 'pergunta', 'arvore', undefined, { fala: 'Posso transferir você agora para um atendente da {{assessoria}}?', tentativas: 1, opcoes: [{ codigo: 'sim', rotulo: 'Pode transferir' }, { codigo: 'nao', rotulo: 'Agora não' }] }, [['sim', 'Pode transferir', 'N4'], ['nao', 'Agora não', 'N5'], ['sem_resposta', 'Sem resposta', 'N4']]),
		b('N4', 'transferir', 'arvore', undefined, { fala: 'Vou passar você para um atendente agora.', motivo: 'cpc' }),
		b('N5', 'retorno', 'cognicao', undefined, { fala: 'Quando fica melhor para falarmos?', dias_max: 7 }, [['agendou', 'Agendou', 'N7'], ['nao_agendou', 'Não agendou', 'N8']]),
		b('N6', 'encerrar', 'arvore', 'Encerrar · recado neutro', { fala: 'Peço que {{primeiro_nome}} retorne a ligação para a {{assessoria}}. Obrigada.', resultado: 'recado' }),
		b('N7', 'encerrar', 'arvore', undefined, { fala: 'Combinado, eu ligo nesse horário.', resultado: 'retorno_agendado' }),
		b('N8', 'encerrar', 'arvore', undefined, { fala: 'Obrigada pela atenção.', resultado: 'cpc' }),
		b('N9', 'transferir', 'arvore', 'Transferir · atendente', { fala: 'Vou passar você para um atendente.', motivo: 'pedido_humano' }),
	] };
}
function definicaoConversacional(): Definicao {
	const d = definicaoLocalizador();
	return { esquema: 1, blocos: [
		...d.blocos.filter(x => ['N1', 'N2', 'N6', 'N9'].includes(x.id)).map(x => x.id === 'N2' ? { ...x, saidas: x.saidas.map(s => s.quando === 'confirmou' ? { ...s, para: 'N3' } : s) } : x),
		b('N3', 'generativa', 'generativo', 'Conversa de negociação', { objetivo: 'Entender a situação e fechar um acordo dentro da alçada da carteira, sem pressionar.', tom: ['cordial', 'nao_pressiona'], max_turnos: 12, ferramentas: ['apresentar_oferta', 'registrar_promessa', 'consultar_base', 'transferir_humano', 'encerrar_chamada'], contrapropostas_max: 2 }, [['fechou_acordo', 'Fechou acordo', 'N4'], ['sem_acordo', 'Sem acordo', 'N9']]),
		b('N4', 'registrar', 'sistema', undefined, { registra: 'promessa_motorcx', conectores: [] }, [['registrado', 'Registrado', 'N5'], ['falhou', 'Falhou', 'N9']]),
		b('N5', 'encerrar', 'arvore', undefined, { fala: 'Combinado. Obrigada!', resultado: 'promessa' }),
	] };
}

const agora = '2026-10-31T13:00:00Z';
const v = (id: number, fluxo_id: number, credor_id: number | null, versao: number, situacao: VersaoRow['situacao'], definicao: Definicao, extra: Partial<VersaoRow> = {}): VersaoRow => ({
	id, fluxo_id, empresa_id: 1, credor_id, versao, situacao, definicao, motivo: null, parecer: null, criado_em: agora, atualizado_em: agora,
	aprovado_em: situacao === 'rascunho' ? null : agora, em_uso_em: situacao === 'em_uso' ? '2026-10-22T12:00:00Z' : null, arquivado_em: situacao === 'arquivado' ? '2026-10-21T12:00:00Z' : null, enviado_aprovacao_em: null, ...extra,
});

function metricasDe(versao: number, escala = 1): (MetricaBloco & { fluxo_versao_id: number; dia: string })[] {
	const m = (bloco_id: string, chegaram: number, saidas: Record<string, number>, turnos_medio: number | null = null) => ({ fluxo_versao_id: versao, dia: '2026-10-30', bloco_id, chegaram: Math.round(chegaram * escala), saidas: Object.fromEntries(Object.entries(saidas).map(([k, n]) => [k, Math.round(n * escala)])), turnos_medio });
	return [
		m('N1', 12480, { titular: 9870, terceiro: 1430 }), m('N2', 9870, { confirmou: 8220, nao_confirmou: 720, falhou: 120 }),
		m('N3', 8220, { quero_negociar: 3370, sem_dinheiro: 1810, nao_entendido: 1150, ja_paguei: 900, nao_reconheco: 575 }),
		m('N4', 3370, { respondeu: 3309, falhou: 61 }), m('N15', 3309, { sim: 3189, nao: 140 }),
		m('N5', 3189, { fechou_acordo: 1148, sem_acordo: 1210, fora_alcada: 287, contestou: 96 }, 5.2), m('N7', 1170, { registrado: 1124, falhou: 46 }),
		m('N11', 1124, { enviado: 1118 }), m('N12', 1118, {}), m('N13', 1850, {}), m('N10', 671, {}), m('N14', 2150, {}),
	];
}

export function criarApiFixturas(): FluxoApi {
	const fluxos: FluxoRow[] = [
		{ id: 1, empresa_id: 1, credor_id: 11, nome: 'Negociador', tipo_agente: 'negociador', modelo_origem: 'negociador', roteiro_origem_id: null, criado_em: agora },
		{ id: 2, empresa_id: 1, credor_id: 12, nome: 'Localizador', tipo_agente: 'localizador', modelo_origem: 'localizador', roteiro_origem_id: null, criado_em: agora },
		{ id: 3, empresa_id: 1, credor_id: 13, nome: 'Negociador conversacional', tipo_agente: 'negociador', modelo_origem: null, roteiro_origem_id: 7, criado_em: agora },
		{ id: 4, empresa_id: 1, credor_id: 11, nome: 'Preventivo', tipo_agente: 'ambos', modelo_origem: 'ambos', roteiro_origem_id: null, criado_em: agora },
	];
	const versoes: VersaoRow[] = [
		v(105, 1, 11, 5, 'rascunho', definicaoV5(), { atualizado_em: '2026-10-31T15:00:00Z' }),
		v(104, 1, 11, 4, 'em_uso', definicaoV4()),
		v(103, 1, 11, 3, 'arquivado', definicaoV4()),
		v(202, 2, 12, 2, 'em_uso', definicaoLocalizador(), { atualizado_em: '2026-10-18T12:00:00Z' }),
		v(301, 3, 13, 1, 'em_uso', definicaoConversacional(), { atualizado_em: '2026-10-09T12:00:00Z', motivo: 'migrado do roteiro v3' }),
		v(401, 4, 11, 1, 'rascunho', definicaoLocalizador(), { atualizado_em: '2026-10-30T12:00:00Z', enviado_aprovacao_em: '2026-10-30T18:00:00Z' }),
	];
	const conectores: ConectorRow[] = [
		{ id: 1, empresa_id: 1, nome: 'Buscar ofertas', finalidade: 'buscar_ofertas', metodo: 'GET', url: 'https://api.crm-aurora.example.com/v2/clientes/{id_cliente}/ofertas', autenticacao: 'oauth2_cc', segredo_ref: 'crm/1/1/20261030', cabecalhos_fixos: {}, mapa_entrada: [{ origem: 'id_cliente', destino: 'id_cliente', onde: 'path' }], mapa_saida: [{ origem: '$.offers[*].id', destino: 'oferta.id', grava: 'nao' }, { origem: '$.offers[*].installments', destino: 'oferta.parcelas', grava: 'nao' }, { origem: '$.offers.length', destino: 'codigo', grava: 'codigo' }], timeout_ms: 2500, tentativas: 1, idempotencia: false, em_falha: 'alternativa_carteira', situacao: 'ativo', versao: 2, teste_pedido_em: null, testado_em: '2026-10-30T12:00:00Z', teste_ok: true, credencial_trocada_em: agora, atualizado_em: agora },
		{ id: 2, empresa_id: 1, nome: 'Validar cadastro', finalidade: 'validar_cadastro', metodo: 'POST', url: 'https://api.crm-aurora.example.com/v2/clientes/{id_cliente}/validacoes', autenticacao: 'oauth2_cc', segredo_ref: 'crm/1/2/20261020', cabecalhos_fixos: {}, mapa_entrada: [{ origem: 'id_cliente', destino: 'id_cliente', onde: 'path' }, { origem: 'data_informada', destino: 'birthDayMonth', onde: 'corpo' }], mapa_saida: [{ origem: '$.match', destino: 'codigo', grava: 'codigo', valores: { true: 'identidade_ok', false: 'identidade_nao_confere' } }], timeout_ms: 2000, tentativas: 0, idempotencia: false, em_falha: 'ramo', situacao: 'ativo', versao: 1, teste_pedido_em: null, testado_em: '2026-10-20T12:00:00Z', teste_ok: true, credencial_trocada_em: agora, atualizado_em: agora },
		{ id: 3, empresa_id: 1, nome: 'Registrar acordo', finalidade: 'registrar_acordo', metodo: 'POST', url: 'https://api.crm-aurora.example.com/v2/acordos', autenticacao: 'oauth2_cc', segredo_ref: 'crm/1/3/20261020', cabecalhos_fixos: {}, mapa_entrada: [{ origem: 'id_cliente', destino: 'customerRef', onde: 'corpo' }, { origem: 'oferta.id', destino: 'offerId', onde: 'corpo' }], mapa_saida: [{ origem: '$.id', destino: 'acordo.id', grava: 'nao' }], timeout_ms: 3000, tentativas: 1, idempotencia: true, em_falha: 'transferir', situacao: 'ativo', versao: 1, teste_pedido_em: null, testado_em: '2026-10-20T12:00:00Z', teste_ok: true, credencial_trocada_em: agora, atualizado_em: agora },
		{ id: 4, empresa_id: 1, nome: 'Gerar boleto ou link', finalidade: 'gerar_boleto', metodo: 'POST', url: 'https://api.crm-aurora.example.com/v2/acordos/{acordo_id}/boleto', autenticacao: 'oauth2_cc', segredo_ref: null, cabecalhos_fixos: {}, mapa_entrada: [{ origem: 'acordo.id', destino: 'agreementId', onde: 'path' }], mapa_saida: [{ origem: '$.url', destino: 'link_pagamento', grava: 'nao' }], timeout_ms: 2500, tentativas: 0, idempotencia: false, em_falha: 'ramo', situacao: 'rascunho', versao: 1, teste_pedido_em: null, testado_em: null, teste_ok: null, credencial_trocada_em: null, atualizado_em: agora },
	];
	const intencoes: IntencaoRow[] = [['quero_negociar', 'Quer negociar'], ['ja_paguei', 'Já paguei'], ['nao_reconheco', 'Não reconhece'], ['sem_dinheiro', 'Sem dinheiro agora'], ['pedir_humano', 'Pede um atendente'], ['agendar_retorno', 'Pede retorno'], ['informou_data', 'Informou uma data'], ['nao_lembra', 'Não lembra']].map(([codigo, nome]) => ({ codigo, nome, descricao: null, ativa: true }));
	const personas: PersonaRow[] = [['desempregado_recente', 'Desempregado recente', 'Perdeu o emprego há 2 meses; quer pagar, mas pouco.', 3], ['ja_pagou', 'Diz que já pagou', 'Afirma ter pago por boleto; quer ser ouvido.', 3], ['contesta_procon', 'Contesta e cita Procon', 'Não reconhece os juros e ameaça reclamar.', 4], ['idoso_dificuldade', 'Idoso com dificuldade de entender', 'Confunde valores e datas; pede para repetir.', 4], ['irritado', 'Irritado', 'Recebeu muitas ligações e interrompe.', 4], ['negocia_rapido', 'Esqueceu', 'Quer resolver rápido e pede o link.', 1]]
		.map(([codigo, nome, objetivo, dif], i) => ({ id: i + 1, empresa_id: null, codigo: String(codigo), nome: String(nome), perfil: String(codigo), objetivo: String(objetivo), dificuldade: Number(dif), resultados_aceitos: ['promessa', 'retorno_agendado'], travas_esperadas: [], ativa: true }));
	const taxas: [number, number][] = [[24, 18], [31, 22], [11, 9], [15, 14], [19, 12], [62, 51]];
	const resultado = (lote: number, ix: 0 | 1): ResultadoLoteRow[] => personas.map((p, i) => ({ persona_id: p.id, persona: p.nome, perfil: p.perfil, conversas: 20, passaram: 20 - (i === 1 || i === 2 || i === 3 ? 1 : 0), acordos: Math.round(taxas[i][ix] / 5), taxa_acordo: taxas[i][ix], opt_out: i === 4 ? 2 : 0, transferidas: 3, turnos_medio: 9.4, reprovadas: null })).map(r => ({ ...r, persona_id: r.persona_id + 0 * lote }));
	const conversas: ConversaRow[] = [
		{ id: 412, lote_id: 51, persona_id: 2, resultado: 'transferida_pedido_humano', passou: false, caminho: ['N1', 'N2', 'N3', 'N13'], travas: [], fechou_acordo: false, turnos: 6, caso_teste_id: null, transcricao: [{ quem: 'pessoa', texto: 'Paguei pelo app do banco no dia 3.' }, { quem: 'agente', texto: 'Desculpe, não entendi. Pode repetir?' }, { quem: 'pessoa', texto: 'Eu já paguei!' }] },
		{ id: 398, lote_id: 51, persona_id: 4, resultado: 'sem_acordo', passou: false, caminho: ['N1', 'N2', 'N3', 'N4', 'N15', 'N5', 'N9'], travas: ['repeticao'], fechou_acordo: false, turnos: 14, caso_teste_id: null, transcricao: [{ quem: 'pessoa', texto: 'São quantas vezes mesmo? E quanto é cada uma?' }, { quem: 'agente', texto: 'São 6 parcelas de R$ 218,00 ou à vista com 15% de desconto.' }] },
		{ id: 377, lote_id: 51, persona_id: 3, resultado: 'transferida_fora_alcada', passou: false, caminho: ['N1', 'N2', 'N3', 'N4', 'N15', 'N5', 'N13'], travas: ['alcada'], fechou_acordo: false, turnos: 8, caso_teste_id: 31, transcricao: [{ quem: 'pessoa', texto: 'Tira os juros que eu fecho hoje.' }, { quem: 'agente', texto: 'Esse valor passa do limite que posso oferecer. Vou passar você para um atendente.' }] },
		...Array.from({ length: 6 }, (_, i): ConversaRow => ({ id: 300 + i, lote_id: 51, persona_id: (i % 6) + 1, resultado: 'promessa', passou: true, caminho: ['N1', 'N2', 'N3', 'N4', 'N15', 'N5', 'N7', 'N11', 'N12'], travas: i < 3 ? ['pedido_humano'] : i === 3 ? ['nao_me_ligue'] : [], fechou_acordo: true, turnos: 10, transcricao: null, caso_teste_id: null })),
	];
	const pedidos: PedidoRow[] = [
		{ id: 412, empresa_id: 1, credor_id: 13, texto: 'Tipo de agente: Negociador.\nQuero que o agente confirme a data de nascimento antes de falar de valor. Depois, busque as ofertas no CRM e ofereça primeiro à vista com desconto; se não aceitar, parcelado em até 6x. Se a pessoa disser que já pagou, pergunte a data do pagamento. Se não reconhecer a dívida, passe para um atendente. Se estiver sem dinheiro, combine um dia para ligar de novo. Para confirmar, peça o CPF.', anexos: ['entradas/aurora/fluxo/2026-10-31/abc_roteiro_operacao_v7.pdf'], tipo: 'ia', fluxo_id: 3, versao_origem_id: null, versao_gerada_id: 105, situacao: 'gerado', chamado_id: null, respostas: null,
			resultado: { entendi: [{ frase: 'Confirmar a data de nascimento antes do valor', bloco: 'N2' }, { frase: 'Buscar ofertas; à vista primeiro, depois até 6×', bloco: 'N4' }, { frase: 'Já pagou: perguntar a data', bloco: 'N8' }, { frase: 'Não reconhece: passar a um atendente', bloco: 'N10' }, { frase: 'Sem dinheiro: combinar um dia', bloco: 'N9' }, { frase: 'Pedir o CPF (trava fixa: confere só dia e mês)', bloco: '' }], suposicoes: ['Desconto à vista dentro da alçada da carteira.'], perguntas: ['Qual conector traz as ofertas?', 'Desconto máximo à vista?', 'Depois de quantas recusas o agente para de negociar?', 'Boleto: gerar no CRM ou mandar o link do MotorCX?'], mudancas: [], erros: [], tentativas: 2 },
			pedido_em: agora, gerado_em: agora, geracoes: 2, prazo_em: null },
		{ id: 409, empresa_id: 1, credor_id: 11, texto: 'Confirme a data de nascimento, busque as ofertas e negocie dentro delas.', anexos: [], tipo: 'ia', fluxo_id: 1, versao_origem_id: null, versao_gerada_id: 103, situacao: 'gerado', chamado_id: null, respostas: null, resultado: { entendi: [], perguntas: [] }, pedido_em: '2026-10-01T12:00:00Z', gerado_em: '2026-10-01T12:00:00Z', geracoes: 1, prazo_em: null },
	];
	const chamadas: ChamadaCrmRow[] = [['15:41:07', 'VOZ-7F21', 'CLI-40217', 1, 200, 402, 1, 'ofertas_1_3', 'ok'], ['15:40:52', 'VOZ-7F1C', 'CLI-38810', 2, 200, 276, 1, 'identidade_ok', 'ok'], ['15:40:31', 'VOZ-7F0A', 'CLI-51402', 1, null, 2500, 2, 'falhou', 'tempo'], ['15:39:58', 'VOZ-7EF3', 'CLI-29174', 3, 200, 844, 1, 'acordo_registrado', 'ok'], ['15:38:40', 'VOZ-7ED2', 'CLI-10583', 3, 503, 1210, 2, 'falhou', 'http_5xx']]
		.map(([h, idc, cli, con, st, lat, t, cod, classe], i) => ({ id: i + 1, conector_id: Number(con), id_chamada: String(idc), id_cliente: String(cli), fluxo_versao_id: 104, bloco_id: 'N4', ocorrido_em: `2026-10-31T${String(h)}-03:00`, tentativa: Number(t), http_status: st == null ? null : Number(st), classe: String(classe), latencia_ms: Number(lat), resultado_codigo: String(cod), ofertas_acima_alcada: 0, usou_alternativa: i === 2 }));
	const respostas: RespostaRow[] = [{ id: 1, fluxo_versao_id: 105, bloco_id: 'N5', pergunta: 'Isso suja meu nome?', resposta: 'Com o acordo em dia, a negativação é retirada em até 5 dias úteis depois do primeiro pagamento.', revisado_em: agora }, { id: 2, fluxo_versao_id: 105, bloco_id: 'N5', pergunta: 'Posso pagar no cartão?', resposta: 'O pagamento é pelo link, por boleto ou Pix.', revisado_em: null }];
	const casos: CasoRow[] = [{ id: 31, fluxo_id: 1, nome: 'CRM fora cai na carteira', falas: ['Sou eu', '12 de março', 'Quero parcelar', 'Aceito'], caminho_esperado: ['N1', 'N2', 'N3', 'N4', 'N6', 'N7', 'N11', 'N12'], resultado_esperado: 'promessa', conectores_falham: [1], ativo: true }];
	const lotes: LoteRow[] = [{ id: 51, fluxo_versao_id: 105, personas: [1, 2, 3, 4, 5, 6], quantidade: 20, situacao: 'concluido', pedido_em: agora, concluido_em: '2026-10-31T13:42:00Z', conversas: 120, tokens: 412000 }, { id: 41, fluxo_versao_id: 104, personas: [1, 2, 3, 4, 5, 6], quantidade: 20, situacao: 'concluido', pedido_em: '2026-10-20T12:00:00Z', concluido_em: '2026-10-20T12:30:00Z', conversas: 120, tokens: 398000 }];
	const modelos: ModeloRow[] = [{ codigo: 'localizador', nome: 'Localizador', tipo_agente: 'localizador', descricao: 'Confirma o titular e transfere para o discador de vocês. Quase tudo fala fixa.' }, { codigo: 'negociador', nome: 'Negociador', tipo_agente: 'negociador', descricao: 'Confirma o titular, entende a intenção, busca ofertas no CRM e negocia.' }, { codigo: 'ambos', nome: 'Localizador + Negociador', tipo_agente: 'ambos', descricao: 'Negocia quando há oferta; sem oferta, transfere com CPC.' }];
	let alcada: AlcadaRow | null = null;
	const espera = <T,>(x: T) => new Promise<T>(r => setTimeout(() => r(x), 120));
	const pend = (d: Definicao, credor: number | null) => {
		const e = validarLocal(d);
		for (const x of d.blocos) {
			const p = x.params ?? {};
			const ids = [p.conector_id, ...(Array.isArray(p.conectores) ? p.conectores : [])].filter(n => typeof n === 'number') as number[];
			if (ids.some(id => conectores.find(c => c.id === id)?.situacao !== 'ativo')) e.push(`conector_inativo:${x.id}`);
			if (x.tipo === 'identidade' && p.conector_id == null) e.push(`identidade_sem_conferencia:${x.id}`);
		}
		if (credor === 11 && !alcada && d.blocos.some(x => x.tipo === 'oferta' || x.tipo === 'generativa')) e.push('sem_alcada');
		return [...new Set(e)].sort();
	};
	const conversaDemo: [string | null, string, string, string][] = [
		[null, 'Olá, aqui é a central da Aurora Cobranças, em nome do Varejo Aurora. Falo com Ana?', 'N1', 'arvore'],
		['', 'Obrigada. Para confirmar, qual o dia e o mês do seu nascimento?', 'N2', 'cognicao'],
		['', 'Consta R$ 1.380,00 em aberto no Cartão Aurora. Como fica melhor para você?', 'N3', 'cognicao'],
		['', 'Tenho duas condições: 6× de R$ 230,00 ou à vista com 15% de desconto. Qual prefere?', 'N5', 'generativo'],
		['', 'Entendo. Posso colocar o vencimento no dia em que o seu salário cai?', 'N5', 'generativo'],
	];
	return {
		fluxos: async () => espera({ fluxos, versoes }),
		versao: async id => espera(versoes.find(x => x.id === id) ?? null),
		versoesDoFluxo: async f => espera(versoes.filter(x => x.fluxo_id === f).sort((a, c) => c.versao - a.versao)),
		fluxo: async id => espera(fluxos.find(x => x.id === id) ?? null),
		modelos: async () => espera(modelos), intencoes: async () => espera(intencoes),
		pedidos: async () => espera(pedidos), pedido: async id => espera(pedidos.find(x => x.id === id) ?? null),
		conectores: async () => espera(conectores),
		saude: async () => espera([{ conector_id: 1, volume_24h: 412, p50_ms: 402, p95_ms: 910, erro_pct: 1.8, ultima: agora }, { conector_id: 2, volume_24h: 1240, p50_ms: 290, p95_ms: 640, erro_pct: 1.3, ultima: agora }, { conector_id: 3, volume_24h: 118, p50_ms: 844, p95_ms: 2100, erro_pct: 3.9, ultima: agora }]),
		chamadasCrm: async () => espera(chamadas), hosts: async () => espera(['api.crm-aurora.example.com']), cuidaConectores: async () => espera(false),
		alcada: async () => espera(alcada),
		pendencias: async (_e, c, d) => espera(pend(d, c)),
		bloqueios: async id => { const x = versoes.find(y => y.id === id); return espera(x ? pend(x.definicao, x.credor_id) : []); },
		avisos: async id => espera(id === 105 ? ['roleplay_reprovadas:3'] : id === 401 ? ['roleplay_ausente'] : []),
		salvarFluxo: async a => { const x = versoes.find(y => y.id === a.versao); if (x) { x.definicao = a.definicao; x.atualizado_em = new Date().toISOString(); x.enviado_aprovacao_em = null; } return espera(a.versao ?? 0); },
		enviar: async id => { const x = versoes.find(y => y.id === id); if (x) x.enviado_aprovacao_em = new Date().toISOString(); await espera(0); },
		aprovar: async id => { const x = versoes.find(y => y.id === id); if (x) x.situacao = 'aprovado_empresa'; await espera(0); },
		usar: async id => { const x = versoes.find(y => y.id === id); if (x) { for (const y of versoes) if (y.credor_id === x.credor_id && y.situacao === 'em_uso') y.situacao = 'arquivado'; x.situacao = 'em_uso'; } await espera(0); },
		voltar: async () => { await espera(0); }, duplicar: async () => espera(105), criarDeModelo: async () => espera(105),
		respostas: async id => espera(respostas.filter(r => r.fluxo_versao_id === id)),
		salvarResposta: async (versao, bloco, pergunta, resposta) => { respostas.push({ id: respostas.length + 1, fluxo_versao_id: versao, bloco_id: bloco, pergunta, resposta, revisado_em: null }); await espera(0); },
		revisarResposta: async id => { const r = respostas.find(x => x.id === id); if (r) r.revisado_em = agora; await espera(0); },
		apagarResposta: async () => { await espera(0); },
		casos: async f => espera(casos.filter(c => c.fluxo_id === f)),
		resultadosCasos: async versao => espera(versao === 105 ? [{ caso_id: 31, fluxo_versao_id: 105, passou: true, caminho_obtido: casos[0].caminho_esperado, resultado_obtido: 'promessa', executado_em: agora }] : []),
		salvarCaso: async () => { await espera(0); }, apagarCaso: async () => { await espera(0); },
		simular: async (_versao, falas, _falhar, cenarios = {}): Promise<Simulacao> => {
			const cen = (c: { conector: number; nome?: string; classe: string; status?: number | null; ms?: number | null; codigo?: string | null }) => cenarios[String(c.conector)] === 'tempo' ? { ...c, classe: 'tempo', status: null, ms: 2500, codigo: 'falhou' } : cenarios[String(c.conector)] === '401' ? { ...c, classe: 'http_4xx', status: 401, ms: 120, codigo: 'falhou' } : c;
			const turnos = conversaDemo.slice(0, Math.min(falas.length + 1, conversaDemo.length)).map(([, texto, bloco, modo], i) => ({
				pessoa: i === 0 ? null : falas[i - 1], falas: [{ texto, bloco, modo }], bloco, caminho: [bloco],
				intencao: bloco === 'N3' && i > 0 ? null : i === 3 ? { intencao: 'quero_negociar', confianca: 'alta', entidades: ['prazo: dia do salário'] } : null,
				conectores: (i === 2 ? [{ conector: 2, nome: 'Validar cadastro', classe: 'ok', status: 200, ms: 276, codigo: 'identidade_ok' }] : i === 3 ? [{ conector: 1, nome: 'Buscar ofertas', classe: 'ok', status: 200, ms: 402, codigo: 'ofertas_1_3' }] : []).map(cen),
				travas: /não me lig|nao me lig/i.test(falas[i - 1] ?? '') ? ['nao_me_ligue'] : [], devolucoes: [], fim: null,
			}));
			const caminho = ['N1', 'N2', 'N3', 'N4', 'N15', 'N5'].slice(0, Math.min(6, falas.length * 2 + 1));
			return espera({ turnos, caminho, resultado: null, encerrada: false });
		},
		ouvir: async () => espera({ audio: '', mime: 'audio/mpeg' }),
		cancelarPedido: async id => { const p = pedidos.find(x => x.id === id); if (p) { p.situacao = 'cancelado'; p.versao_gerada_id = null; p.cancelado_em = new Date().toISOString(); } await espera(0); },
		rodarCasos: async () => espera([{ id: 31, nome: casos[0].nome, passou: true }]),
		metricas: async vs => espera([...(vs.includes(104) ? metricasDe(104) : []), ...(vs.includes(103) ? metricasDe(103, 0.6) : []), ...(vs.includes(202) ? [{ fluxo_versao_id: 202, dia: '2026-10-30', bloco_id: 'N1', chegaram: 5410, saidas: { titular: 4200 } }, { fluxo_versao_id: 202, dia: '2026-10-30', bloco_id: 'N4', chegaram: 3311, saidas: {} }] : []), ...(vs.includes(301) ? [{ fluxo_versao_id: 301, dia: '2026-10-30', bloco_id: 'N1', chegaram: 2930, saidas: { titular: 2300 } }, { fluxo_versao_id: 301, dia: '2026-10-30', bloco_id: 'N2', chegaram: 2300, saidas: { confirmou: 1980 } }, { fluxo_versao_id: 301, dia: '2026-10-30', bloco_id: 'N4', chegaram: 299, saidas: { registrado: 299 } }] : [])]),
		intencoesDia: async () => espera([['quero_negociar', 3370], ['sem_dinheiro', 1810], ['nao_entendido', 1150], ['ja_paguei', 900], ['nao_reconheco', 575]].map(([intencao, n]) => ({ bloco_id: 'N3', intencao: String(intencao), n: Number(n), fluxo_versao_id: 104 }))),
		personas: async () => espera(personas),
		lotes: async versao => espera(lotes.filter(l => l.fluxo_versao_id === versao)),
		resultadoLote: async lote => espera(resultado(lote, lote === 51 ? 0 : 1)),
		conversas: async lote => espera(lote === 51 ? conversas : conversas.filter(c => c.passou).map(c => ({ ...c, lote_id: 41, travas: c.travas.length ? [...c.travas, 'pedido_humano'] : ['terceiro'] }))),
		rodarRoleplay: async () => espera(52), paraCaso: async () => espera(32),
		pedirFluxo: async () => espera(412), responderPedido: async () => { await espera(0); },
		anexar: async (_s, f) => espera(`entradas/aurora/fluxo/2026-11-01/demo_${f.name}`),
		salvarAlcada: async a => { alcada = { id: 1, credor_id: a.credor, desconto_max_pct: a.desconto, parcelas_max: a.parcelas, parcela_min: a.parcelaMin, entrada_min: a.entradaMin, validade_dias: a.validade, ofertas_padrao: [], vigente_desde: '2026-11-01', vigente_ate: null }; await espera(0); },
		salvarConector: async () => espera(5), testarConector: async () => { await espera(0); }, situacaoConector: async () => { await espera(0); },
		trocarCredencial: async id => espera(`crm/1/${id}/20261101`), liberarHost: async () => { await espera(0); }, revogarHost: async () => { await espera(0); },
	};
}

/** Garante que o tipo de cada bloco das fixturas existe (falha cedo se o catálogo mudar). */
export const tiposDasFixturas = () => definicaoV5().blocos.every(x => !!TIPOS[x.tipo]);
