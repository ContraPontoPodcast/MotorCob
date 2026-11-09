// Confirmar identidade do agente de voz (SQL 88): quem confere (CRM, arquivo ou os dois em ordem), quantas perguntas,
// quais e em que ordem, o que fazer se faltar dado no arquivo e o limite de erros no dia. A forma é a mesma de
// public.identidade_mailing_valida (banco) e de voz/fluxo.py › config_identidade (VM): o banco decide. Sem
// configuração salva, o agente faz exatamente o de hoje (só o CRM, uma pergunta por etapa).
// Padrões aprovados pelo dono em 08/11/2026: com CRM, "CRM; se falhar, o arquivo"; sem CRM, "Só o arquivo"; carteira
// já no ar fica como hoje até alguém salvar. Nenhum dado de cliente passa por aqui: só a configuração.

export type FonteIdentidade = 'crm' | 'arquivo' | 'crm_arquivo' | 'arquivo_crm';
export type PerguntaIdentidade = 'dia_mes_nascimento' | 'ultimos3_documento' | 'ano_nascimento';
export type SeFaltar = 'proxima' | 'menos' | 'transferir';
export interface ConfigIdentidade { fonte: FonteIdentidade; perguntas: PerguntaIdentidade[]; quantas: 1 | 2; se_faltar: SeFaltar; erros_dia: 3 | 4 | 6 }
export interface IdentidadeVigente { id: number; credor_id: number | null; identidade: ConfigIdentidade; vigente_desde: string }
export interface VersaoIdentidade { id: number; credor_id: number | null; identidade: ConfigIdentidade; mudancas: string | null; vigente_desde: string; vigente_ate: string | null }

export const FONTES: { id: FonteIdentidade; nome: string; desc: string }[] = [
	{ id: 'crm', nome: 'Só o CRM', desc: 'Como hoje: o conector Validar cadastro confere. Sem CRM, o agente não confirma.' },
	{ id: 'arquivo', nome: 'Só o arquivo', desc: 'O MotorCX confere com o que veio na carga (guardado só como código). Não precisa de CRM.' },
	{ id: 'crm_arquivo', nome: 'CRM; se falhar, o arquivo', desc: 'O CRM confere. Se ele não responder (tempo esgotado, erro), confere pelo arquivo.' },
	{ id: 'arquivo_crm', nome: 'Arquivo; se faltar o dado, o CRM', desc: 'Confere pelo arquivo. Cliente sem o dado no arquivo, ou erro do MotorCX: pergunta ao CRM.' },
];
export const PERGUNTAS: { id: PerguntaIdentidade; nome: string; fala: string; respostas: string }[] = [
	{ id: 'dia_mes_nascimento', nome: 'Dia e mês de nascimento', fala: '"…me confirma o dia e o mês do seu nascimento?"', respostas: '366 respostas possíveis' },
	{ id: 'ultimos3_documento', nome: '3 últimos dígitos do CPF/CNPJ', fala: '"…me diz os três últimos números do seu CPF?"', respostas: '1.000 respostas possíveis' },
	{ id: 'ano_nascimento', nome: 'Ano de nascimento', fala: '"…e o ano em que você nasceu?"', respostas: 'cerca de 80 respostas plausíveis' },
];
/** A fala que o agente usa na 2ª pergunta (e na reserva): a mesma de voz/fluxo.py › PERGUNTAS_FALA. */
export const FALA_PERGUNTA: Record<PerguntaIdentidade, string> = {
	dia_mes_nascimento: 'Para sua segurança, me confirma o dia e o mês do seu nascimento?',
	ultimos3_documento: 'Certo. E me diz os três últimos números do seu CPF?',
	ano_nascimento: 'E o ano em que você nasceu?',
};
export const SE_FALTAR: { id: SeFaltar; nome: string; desc: string }[] = [
	{ id: 'proxima', nome: 'Usar a próxima fonte', desc: 'ex.: sem data válida → pergunta ao CRM; sem CRM → transfere' },
	{ id: 'menos', nome: 'Fazer só a pergunta que tem dado', desc: 'mínimo de 1 pergunta; nunca confirma sem nenhuma' },
	{ id: 'transferir', nome: 'Transferir para um atendente', desc: 'sem confirmar, o atendente decide' },
];
export const ERROS_DIA = [3, 4, 6] as const;
export const RECUSADAS: [string, string][] = [
	['Nome da mãe', 'Dado de outra pessoa, comum em vazamentos, e a grafia falada raramente bate exato com o código.'],
	['CPF inteiro', 'Fica inteiro na gravação e na transcrição; é o dado mais vazado do país. Só os 3 últimos.'],
	['Número do contrato ou valor da dívida', 'Perguntar já revela que existe dívida com o credor (quebra "identidade antes da dívida").'],
	['Endereço, CEP, e-mail ou telefone', 'Quem mora junto sabe; e o telefone é o que discamos.'],
	['Senha, cartão, token', 'Trava 2: nunca. A pessoa que oferecer ouve a fala fixa.'],
];

const NOME_FONTE = Object.fromEntries(FONTES.map(f => [f.id, f.nome])) as Record<FonteIdentidade, string>;
const NOME_PERGUNTA = Object.fromEntries(PERGUNTAS.map(p => [p.id, p.nome])) as Record<PerguntaIdentidade, string>;

/** A recomendada: com CRM, "CRM; se falhar, o arquivo"; sem CRM, "Só o arquivo". Duas perguntas, ano como reserva desligado. */
export function recomendada(temCrm: boolean): ConfigIdentidade {
	return { fonte: temCrm ? 'crm_arquivo' : 'arquivo', perguntas: ['dia_mes_nascimento', 'ultimos3_documento'], quantas: 2, se_faltar: 'proxima', erros_dia: 4 };
}
/** O de hoje (carteira já no ar): só o CRM e uma pergunta. Salvar isto é o mesmo que hoje, com o limite de erros no dia. */
export function comoHoje(): ConfigIdentidade {
	return { fonte: 'crm', perguntas: ['dia_mes_nascimento'], quantas: 1, se_faltar: 'proxima', erros_dia: 4 };
}
/** O que a tela mostra preenchido quando a carteira ainda não tem configuração. */
export function inicial(temCrm: boolean, carteiraNoAr: boolean): ConfigIdentidade {
	return carteiraNoAr && temCrm ? comoHoje() : recomendada(temCrm);
}

/** Cópia de public.identidade_mailing_valida: '' quando vale; senão o motivo em português. */
export function validarIdentidade(c: ConfigIdentidade): string {
	if (!FONTES.some(f => f.id === c.fonte)) return 'Escolha quem confere.';
	if (!SE_FALTAR.some(s => s.id === c.se_faltar)) return 'Escolha o que fazer se faltar dado.';
	if (!(ERROS_DIA as readonly number[]).includes(c.erros_dia)) return 'Escolha os erros no dia: 3, 4 ou 6.';
	if (c.quantas !== 1 && c.quantas !== 2) return 'Escolha 1 ou 2 perguntas.';
	if (new Set(c.perguntas).size !== c.perguntas.length || c.perguntas.some(p => !NOME_PERGUNTA[p])) return 'Perguntas inválidas.';
	if (c.perguntas.length < c.quantas) return c.quantas === 2 ? 'Ligue pelo menos 2 perguntas.' : 'Ligue pelo menos 1 pergunta.';
	return '';
}

/** Só as chaves que o banco aceita, na forma dele. */
export function paraSalvarIdentidade(c: ConfigIdentidade): ConfigIdentidade {
	return { fonte: c.fonte, perguntas: [...c.perguntas], quantas: c.quantas, se_faltar: c.se_faltar, erros_dia: c.erros_dia };
}

export function iguais(a: ConfigIdentidade | null | undefined, b: ConfigIdentidade | null | undefined): boolean {
	return JSON.stringify(a ? paraSalvarIdentidade(a) : null) === JSON.stringify(b ? paraSalvarIdentidade(b) : null);
}

/** "CRM; se falhar, o arquivo" (sem configuração: o de hoje). */
export function textoFonte(c: ConfigIdentidade | null | undefined): string {
	return c ? NOME_FONTE[c.fonte] : 'Só o CRM (como hoje)';
}
/** As perguntas que o agente faz, em palavras: "dia e mês de nascimento + 3 últimos dígitos do CPF/CNPJ". */
export function textoPerguntas(c: ConfigIdentidade | null | undefined): string {
	if (!c) return 'a pergunta da etapa';
	return c.perguntas.slice(0, c.quantas).map(p => NOME_PERGUNTA[p].charAt(0).toLowerCase() + NOME_PERGUNTA[p].slice(1)).join(' + ');
}
/** Usa o arquivo (e precisa da chave de identidade e das colunas da carga). */
export const usaArquivo = (c: ConfigIdentidade | null | undefined) => !!c && c.fonte !== 'crm';
/** Usa o CRM (e precisa do conector Validar cadastro na etapa). */
export const usaCrm = (c: ConfigIdentidade | null | undefined) => !c || c.fonte !== 'arquivo';

/** Troca a ordem de uma pergunta (−1 sobe, +1 desce). */
export function mover(c: ConfigIdentidade, p: PerguntaIdentidade, d: -1 | 1): ConfigIdentidade {
	const i = c.perguntas.indexOf(p);
	const j = i + d;
	if (i < 0 || j < 0 || j >= c.perguntas.length) return c;
	const ps = [...c.perguntas];
	[ps[i], ps[j]] = [ps[j], ps[i]];
	return { ...c, perguntas: ps };
}
/** Liga ou desliga uma pergunta (desligada sai da lista; ligada entra no fim). Nunca deixa menos que `quantas`. */
export function alternar(c: ConfigIdentidade, p: PerguntaIdentidade): ConfigIdentidade {
	if (c.perguntas.includes(p)) {
		if (c.perguntas.length <= c.quantas) return c;
		return { ...c, perguntas: c.perguntas.filter(x => x !== p) };
	}
	return { ...c, perguntas: [...c.perguntas, p] };
}
/** Muda a quantidade; com 2, liga a 2ª pergunta recomendada se faltar. */
export function comQuantas(c: ConfigIdentidade, q: 1 | 2): ConfigIdentidade {
	if (q === 2 && c.perguntas.length < 2) {
		const falta = PERGUNTAS.map(p => p.id).find(p => !c.perguntas.includes(p) && p !== 'ano_nascimento') ?? 'ano_nascimento';
		return { ...c, quantas: 2, perguntas: [...c.perguntas, falta] };
	}
	return { ...c, quantas: q };
}

/** O relatório da carga (envios.relatorio.identidade_voz, só contagens): "Agente de voz: 47.902 com dado para conferir
 *  pelo arquivo · 308 sem data válida". Sem as colunas apontadas: null. Nunca há valor de cliente aqui. */
export function resumoCarga(r: unknown): string | null {
	if (!r || typeof r !== 'object') return null;
	const x = r as Record<string, unknown>;
	const n = (k: string) => (typeof x[k] === 'number' ? (x[k] as number) : 0);
	const col = (x.colunas ?? {}) as Record<string, unknown>;
	if (!col.nascimento && !col.documento_validacao) return null;
	const f = (v: number) => v.toLocaleString('pt-BR');
	const partes = [`Agente de voz: ${f(n('clientes_com_codigo'))} com dado para conferir pelo arquivo`];
	if (col.nascimento && n('nascimento_invalidas')) partes.push(`${f(n('nascimento_invalidas'))} sem data válida`);
	if (col.documento_validacao && n('documento_invalidos')) partes.push(`${f(n('documento_invalidos'))} sem documento válido`);
	if (x.chave === false) partes.push('a chave de identidade da empresa ainda não existe: nada foi guardado');
	return partes.join(' · ');
}
