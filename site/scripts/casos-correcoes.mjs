// Gera tests/dados/fluxo_correcoes_casos.json: cada caso é um fluxo com uma pendência, a correção de um clique que o
// site oferece (site/src/lib/fluxo.ts › correcaoDe) e a definição depois dela. O Python (tests/test_fluxo_correcoes.py)
// confere com voz/fluxo_validador.py que a definição de depois some com a pendência e não cria outra; o site
// (site/fluxo/fluxo.test.ts) confere que a correção continua dando exatamente o "depois" gravado aqui.
// Rodar de novo só quando a regra de uma correção mudar de propósito:
//   node --experimental-strip-types --no-warnings site/scripts/casos-correcoes.mjs
import { writeFileSync } from 'node:fs';
import { correcaoDe } from '../src/lib/fluxo.ts';

const s = (quando, rotulo, para, tipo = quando === 'falhou' ? 'falha' : 'normal') => ({ quando, rotulo, para, tipo });
const b = (id, tipo, modo, params, saidas = [], titulo) => ({ id, tipo, modo, ...(titulo ? { titulo } : {}), params, saidas });
const CONECTORES = [
	{ id: 1, nome: 'Buscar ofertas', finalidade: 'buscar_ofertas', situacao: 'ativo' },
	{ id: 2, nome: 'Validar cadastro', finalidade: 'validar_cadastro', situacao: 'ativo' },
	{ id: 3, nome: 'Registrar acordo', finalidade: 'registrar_acordo', situacao: 'ativo' },
	{ id: 4, nome: 'Gerar boleto ou link', finalidade: 'gerar_boleto', situacao: 'rascunho' },
];
const ABERTURA = 'Olá, aqui é a central da {{assessoria}}. Falo com {{primeiro_nome}}?';
const IDENT = { fala: 'Para sua segurança, me confirma o dia e o mês do seu nascimento?', pergunta: 'dia_mes_nascimento', conector_id: 2, tentativas: 2 };

/** O negociador do desenho (v5 das fixturas, sem a parte de intenções): base dos casos. */
function base() {
	return { esquema: 1, blocos: [
		b('N1', 'abertura', 'arvore', { fala: ABERTURA }, [s('titular', 'Sou eu', 'N2'), s('terceiro', 'Não é a pessoa', 'N14')]),
		b('N2', 'identidade', 'cognicao', { ...IDENT }, [s('confirmou', 'Confirmou', 'N3'), s('nao_confirmou', 'Não confirmou', 'N14'), s('falhou', 'Conector falhou', 'N13')]),
		b('N3', 'intencao', 'cognicao', { fala: 'Consta {{saldo}} em aberto. Como fica melhor para você?', intencoes: ['quero_negociar', 'sem_dinheiro'], confianca_min: 0.7, tentativas: 2 }, [s('quero_negociar', 'Quer negociar', 'N6'), s('sem_dinheiro', 'Sem dinheiro agora', 'N9'), s('nao_entendido', 'Não entendi', 'N13')]),
		b('N6', 'oferta', 'cognicao', { origem: 'carteira', fala: 'Consigo para você {{oferta.parcelas}} parcelas de {{oferta.valor_parcela}}. Fica bom?' }, [s('aceitou', 'Aceitou', 'N7'), s('recusou', 'Recusou', 'N9')]),
		b('N7', 'registrar', 'sistema', { registra: 'acordo_crm', conectores: [3] }, [s('registrado', 'Registrado', 'N11'), s('falhou', 'CRM falhou', 'N13')]),
		b('N11', 'link', 'arvore', { canal: 'whatsapp_sms', fala: 'Acabei de mandar o link do acordo no seu WhatsApp.' }, [s('enviado', 'Enviado', 'N12')]),
		b('N12', 'encerrar', 'arvore', { fala: 'Obrigada pela atenção. Até logo.', resultado: 'promessa' }, [], 'Encerrar · acordo'),
		b('N9', 'retorno', 'cognicao', { fala: 'Quando fica melhor eu ligar de novo?', dias_max: 7 }, [s('agendou', 'Agendou', 'N17'), s('nao_agendou', 'Não agendou', 'N13')]),
		b('N17', 'encerrar', 'arvore', { fala: 'Combinado, eu ligo nesse horário. Até lá!', resultado: 'retorno_agendado' }, [], 'Encerrar · retorno'),
		b('N13', 'transferir', 'arvore', { fala: 'Vou passar você para um atendente agora, só um instante.', motivo: 'pedido_humano' }, [], 'Transferir · atendente'),
		b('N14', 'encerrar', 'arvore', { fala: 'Peço que {{primeiro_nome}} retorne para a {{assessoria}}. Obrigada.', resultado: 'recado' }, [], 'Encerrar · recado neutro'),
	] };
}
const mudar = (d, id, f) => ({ ...d, blocos: d.blocos.map(x => (x.id === id ? f(structuredClone(x)) : x)) });
const sem = (d, ...ids) => ({ ...d, blocos: d.blocos.filter(x => !ids.includes(x.id)) });
const com = (d, ...bs) => ({ ...d, blocos: [...d.blocos, ...bs] });

const casos = [
	['abertura cita o credor', 'valor_antes_identidade:N1', mudar(base(), 'N1', x => ({ ...x, params: { fala: 'Olá, bom dia! Aqui é a Lia, da {{assessoria}}, em nome do {{credor}}. Falo com {{primeiro_nome}}?' } }))],
	['identidade cita o saldo antes de confirmar', 'valor_antes_identidade:N2', mudar(base(), 'N2', x => ({ ...x, params: { ...x.params, fala: 'Sobre o saldo de {{saldo}}: para sua segurança, me confirma o dia e o mês do seu nascimento?' } }))],
	['agendar retorno sem saída, final de retorno solto (v5 das fixturas)', 'sem_saida:N9', mudar(base(), 'N9', x => ({ ...x, saidas: [] }))],
	['agendar retorno sem saída e sem final que sirva: cria Encerrar', 'sem_saida:N9', sem(mudar(base(), 'N9', x => ({ ...x, saidas: [] })), 'N17')],
	['registrar sem a saída "falhou"', 'saida_faltando:N7', mudar(base(), 'N7', x => ({ ...x, saidas: x.saidas.filter(y => y.quando !== 'falhou') }))],
	['abertura sem "Não é a pessoa"', 'saida_faltando:N1', mudar(base(), 'N1', x => ({ ...x, saidas: x.saidas.filter(y => y.quando !== 'terceiro') }))],
	['saída para etapa que foi removida', 'saida_inexistente:N6', mudar(base(), 'N6', x => ({ ...x, saidas: x.saidas.map(y => (y.quando === 'recusou' ? { ...y, para: 'N30' } : y)) }))],
	['terceiro vai para Transferir', 'terceiro_sem_recado', mudar(base(), 'N1', x => ({ ...x, saidas: x.saidas.map(y => (y.quando === 'terceiro' ? { ...y, para: 'N13' } : y)) }))],
	['etapa solta que não leva a nada usado', 'inalcancavel:N20', com(base(), b('N20', 'pergunta', 'arvore', { fala: 'Posso continuar?', tentativas: 1, opcoes: [{ codigo: 'sim', rotulo: 'Sim' }] }, [s('sim', 'Sim', 'N13')]))],
	['conversa livre sem "Transferir para humano"', 'transferir_humano_desligado:N5', mudar(com(base(), b('N5', 'generativa', 'generativo', { objetivo: 'Fechar acordo com uma das ofertas recebidas, sem pressionar.', tom: ['cordial'], max_turnos: 8, ferramentas: ['apresentar_oferta', 'encerrar_chamada'], contrapropostas_max: 2 }, [s('fechou_acordo', 'Fechou acordo', 'N7', 'devolve'), s('sem_acordo', 'Sem acordo', 'N6', 'devolve')])), 'N3', x => ({ ...x, saidas: x.saidas.map(y => (y.quando === 'quero_negociar' ? { ...y, para: 'N5' } : y)) }))],
	['identidade sem conector: o único "Validar cadastro" ativo', 'identidade_sem_conferencia:N2', mudar(base(), 'N2', x => ({ ...x, params: { ...x.params, conector_id: null }, saidas: x.saidas.filter(y => y.quando !== 'falhou') }))],
	['registrar com o boleto do CRM em rascunho', 'conector_inativo:N7', mudar(base(), 'N7', x => ({ ...x, params: { ...x.params, conectores: [3, 4] } }))],
];
const sai = { _sobre: 'Correções de um clique do editor do fluxo (PR4 do redesenho). Gerado por site/scripts/casos-correcoes.mjs a partir de site/src/lib/fluxo.ts › correcaoDe. tests/test_fluxo_correcoes.py confere com voz/fluxo_validador.py que "depois" não tem a pendência e não tem pendência nova; site/fluxo/fluxo.test.ts confere que a correção ainda dá este "depois".', conectores: CONECTORES, casos: [] };
for (const [nome, codigo, antes] of casos) {
	const c = correcaoDe(antes, codigo, { conectores: CONECTORES });
	if (!c) throw new Error(`sem correção: ${nome}`);
	sai.casos.push({ nome, codigo, botao: c.botao, antes, depois: c.definicao });
}
// casos sem botão: precisam de uma decisão de quem edita
const semBotao = [
	['intenção sem saída (cada intenção pede um destino)', 'sem_saida:N3', mudar(base(), 'N3', x => ({ ...x, saidas: [] }))],
	['oferta sem "Aceitou" (continua a conversa)', 'saida_faltando:N6', mudar(base(), 'N6', x => ({ ...x, saidas: x.saidas.filter(y => y.quando !== 'aceitou') }))],
	['oferta cita o valor antes da identidade (o tipo já é sensível)', 'valor_antes_identidade:N6', mudar(base(), 'N1', x => ({ ...x, saidas: x.saidas.map(y => (y.quando === 'titular' ? { ...y, para: 'N6' } : y)) }))],
	['etapa solta que outra etapa solta usa', 'inalcancavel:N20', com(base(), b('N20', 'pergunta', 'arvore', { fala: 'Posso continuar?', tentativas: 1, opcoes: [{ codigo: 'sim', rotulo: 'Sim' }] }, [s('sim', 'Sim', 'N21')]), b('N21', 'pergunta', 'arvore', { fala: 'Tudo bem?', tentativas: 1, opcoes: [{ codigo: 'sim', rotulo: 'Sim' }] }, [s('sim', 'Sim', 'N20')]))],
];
sai.sem_botao = semBotao.map(([nome, codigo, antes]) => {
	if (correcaoDe(antes, codigo, { conectores: CONECTORES })) throw new Error(`não devia ter correção: ${nome}`);
	return { nome, codigo, antes };
});
writeFileSync(new URL('../../tests/dados/fluxo_correcoes_casos.json', import.meta.url), JSON.stringify(sai, null, 1) + '\n');
console.log(`${sai.casos.length} casos com botão, ${sai.sem_botao.length} sem`);
