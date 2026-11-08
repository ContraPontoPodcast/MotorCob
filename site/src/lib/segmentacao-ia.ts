// Descrever segmentos e régua (etapa 5 da IA na Orquestração, SQL 79; protótipo proto-segmentacao v2).
//
// A IA (na VM) devolve a PROPOSTA já compilada pelo motor (motor/segmentacao_ia.py): segmentos por ref com ação,
// condições, estratégia (Definicao do motor) e a ordem final; perguntas com opções, cada opção com um patch
// (caminho → valor) sobre a proposta. Aqui, sem IA e sem custo: aplicar as respostas (o mesmo que
// `aplicar_patch_proposta` do Python), montar a prévia de contagens (previa_segmentacao, SQL 76), conferências,
// a matriz "de onde vêm", a tabela da régua por perfil e o que bloqueia o Aplicar. O banco valida de novo no Aplicar.
import type { Acao, Definicao } from '@/lib/estrategia';
import type { Condicao } from '@/lib/supabase';
import type { ResultadoPrevia } from '@/lib/previa-segmentacao';
import { fraseValor } from '@/lib/condicoes';
import { nomeCanal } from '@/lib/personas';

export const LIMITE_TEXTO = 6000;
export const LIMITE_SEGMENTOS = 8;
export const CREDITOS_DESCREVER = 2;

export type AcaoSeg = 'novo' | 'alterar' | 'manter' | 'desligar';
export type SegmentoProposto = {
	ref: string; acao: AcaoSeg; existente: string | null; codigo: string; nome: string; nome_antes: string | null;
	condicoes: Condicao[]; condicoes_antes: Condicao[] | null; compartilhado_com: string[]; estrategia_antes: string | null;
	trechos: string[]; incluir: boolean; estrategia: 'nova' | 'manter' | 'nenhuma'; definicao: Definicao | null;
	resumo_regua: string; so_digital: boolean | null; canais_bloqueados: string[] | null; canais_a_ativar: string[];
	nao_citado?: boolean;
};
export type PatchItem = { caminho: string[]; valor: unknown; remover?: boolean };
export type Opcao = { valor: string; rotulo: string; detalhe: string; patch: PatchItem[] };
export type Pergunta = { codigo: string; ref: string; texto: string; contexto: string; opcoes: Opcao[]; padrao: string };
export type Entendi = { frase: string; tipo: 'segmento' | 'regua' | 'fora'; ref: string; item: string };
export type Fora = { trecho: string; motivo: string; ref: string };
export type Proposta = {
	esquema: number; ticket: string; demais: 'manter' | 'desligar'; ordem: string[];
	segmentos: Record<string, SegmentoProposto>;
	entendi: Entendi[]; suposicoes: { ref: string; texto: string }[]; perguntas: Pergunta[]; fora: Fora[];
	hash_base?: string | null;
};
export type Respostas = Record<string, string>;
export type PedidoSegmentacao = {
	id: string; situacao: 'pendente' | 'gerando' | 'gerado' | 'com_erros' | 'descartado' | 'aplicado';
	texto: string; proposta: Proposta | null; resultado: { erros?: string[] } | null; hash_base: string | null;
	pedido_em: string; credor_id: string;
};
export type Aplicacao = {
	id: string; credor_id: string; aplicada_em: string; situacao: 'aplicada' | 'desfeita'; ligada_em: string | null;
	resumo: { novos?: number; alterados?: number; desligados?: number; estrategias?: number; pausados?: number; versoes?: number };
	criados: {
		pausados?: (string | number)[]; clusters?: (string | number)[];
		// SQL 82: versão nova dos segmentos alterados que estão valendo (a atual segue até ligar), por id do segmento
		espera?: { versoes?: Record<string, { ligada_em?: string | null }>; concluida_em?: string | null; substituida_por?: number | null } | null;
	};
};

export const ROTULO_ACAO: Record<AcaoSeg, string> = { novo: 'Novo', alterar: 'Alterar', manter: 'Manter', desligar: 'Desligar nesta carteira' };

const ROTULO_CAMPO: Record<string, string> = {
	saldo: 'Saldo total', dias_atraso: 'Dias de atraso', qtd_contratos: 'Quantidade de contratos', idade: 'Idade',
	qtd_telefones: 'Qtd. de telefones', tem_email: 'Tem e-mail', tem_celular: 'Tem celular', so_fixo: 'Só fixo',
	tem_whatsapp: 'Tem WhatsApp', persona: 'Persona',
};
const OP_FRASE: Record<string, string> = {
	'=': 'é', '!=': 'é diferente de', '>': 'maior que', '>=': 'maior ou igual a', '<': 'menor que', '<=': 'até',
	entre: 'entre', em: 'é um destes:', nao_em: 'não é nenhum destes:', contem: 'contém', vazio: 'está vazio', preenchido: 'está preenchido',
};
const DINHEIRO = new Set(['saldo', 'valor_parcela']);

export function rotuloCampo(campo: string): string { return ROTULO_CAMPO[campo] ?? campo; }

/** "Dias de atraso entre 31 e 90", "Saldo total até R$ 2.000". */
export function textoCondicao(c: Condicao): string {
	const op = OP_FRASE[c.op] ?? c.op;
	if (c.op === 'vazio' || c.op === 'preenchido') return `${rotuloCampo(c.campo)} ${op}`;
	const rs = (v: unknown) => (DINHEIRO.has(c.campo) && typeof v === 'number' ? `R$ ${v.toLocaleString('pt-BR')}` : null);
	if (c.op === 'entre' && Array.isArray(c.valor)) {
		const [a, b] = c.valor as unknown[];
		return `${rotuloCampo(c.campo)} entre ${rs(a) ?? fraseValor({ op: '=', valor: a })} e ${rs(b) ?? fraseValor({ op: '=', valor: b })}`;
	}
	return `${rotuloCampo(c.campo)} ${op} ${rs(c.valor) ?? fraseValor(c)}`;
}

// ------------------------------------------------------------------ respostas (patch sobre a proposta)
function copiar<T>(x: T): T { return x == null ? x : JSON.parse(JSON.stringify(x)); }

/** Igual a motor/segmentacao_ia.aplicar_patch_proposta: caminho → valor; pai que não existe é pulado. */
export function aplicarPatch(prop: Proposta, patch: PatchItem[]): Proposta {
	const novo = copiar(prop) as unknown as Record<string, unknown>;
	for (const p of patch) {
		let alvo: unknown = novo;
		for (const k of p.caminho.slice(0, -1)) {
			alvo = alvo && typeof alvo === 'object' && !Array.isArray(alvo) ? (alvo as Record<string, unknown>)[k] : undefined;
			if (alvo == null) break;
		}
		if (!alvo || typeof alvo !== 'object' || Array.isArray(alvo)) continue;
		const ult = p.caminho[p.caminho.length - 1];
		if (p.remover) delete (alvo as Record<string, unknown>)[ult];
		else (alvo as Record<string, unknown>)[ult] = copiar(p.valor);
	}
	return novo as unknown as Proposta;
}

export function respostasPadrao(prop: Proposta): Respostas {
	return Object.fromEntries(prop.perguntas.map(q => [q.codigo, q.padrao]));
}

/** A proposta com as respostas escolhidas (as perguntas na ordem em que vieram). */
export function comRespostas(prop: Proposta, respostas: Respostas): Proposta {
	let p = prop;
	for (const q of prop.perguntas) {
		const o = q.opcoes.find(x => x.valor === (respostas[q.codigo] ?? q.padrao)) ?? q.opcoes.find(x => x.valor === q.padrao);
		if (o && o.patch.length) p = aplicarPatch(p, o.patch);
	}
	return { ...p, perguntas: prop.perguntas };
}

/** Troca a posição de dois segmentos na ordem (resposta de "faixas se cruzam"). */
export function trocarOrdem(prop: Proposta, a: string, b: string): Proposta {
	const ordem = [...prop.ordem];
	const i = ordem.indexOf(a), j = ordem.indexOf(b);
	if (i < 0 || j < 0) return prop;
	[ordem[i], ordem[j]] = [ordem[j], ordem[i]];
	return { ...prop, ordem };
}

// ------------------------------------------------------------------ o que fica, o que sai
/** Segmentos que ficam nesta carteira, na ordem final (sem os desligados e os "não criar"). */
export function emOrdem(prop: Proposta): SegmentoProposto[] {
	return prop.ordem.map(r => prop.segmentos[r]).filter((s): s is SegmentoProposto => !!s && s.incluir !== false && s.acao !== 'desligar');
}
export function desligados(prop: Proposta): SegmentoProposto[] {
	return Object.values(prop.segmentos).filter(s => s.acao === 'desligar' && s.incluir !== false);
}
export function naoCriados(prop: Proposta): SegmentoProposto[] {
	return Object.values(prop.segmentos).filter(s => s.incluir === false);
}

// ------------------------------------------------------------------ o que o Aplicar faz (SQL 82, decisão do dono 08/11/2026)
/** Segmento novo nasce pausado; segmento atual alterado (ou com estratégia nova) segue na versão atual até você ligar a
 * nova; o resto não muda. */
export type EfeitoAplicar = 'pausado' | 'versao_nova' | null;
export function efeitoAplicar(s: SegmentoProposto): EfeitoAplicar {
	if (s.incluir === false || s.acao === 'desligar') return null;
	if (s.acao === 'novo') return 'pausado';
	return s.acao === 'alterar' || s.estrategia === 'nova' ? 'versao_nova' : null;
}
/** Com algo para ligar, a ordem nova, os desligados e o Demais também esperam o Ligar (o que vale hoje não muda). */
export function temOQueLigar(prop: Proposta): boolean {
	return emOrdem(prop).some(s => efeitoAplicar(s) !== null);
}
/** Na faixa "Aplicado": segmentos novos ainda pausados e versões novas ainda esperando o Ligar. */
export function esperaAplicacao(ap: Aplicacao, segmentos: { cluster_id: string; em_uso: boolean }[]) {
	const ids = new Set((ap.criados?.pausados ?? []).map(String));
	const pausados = segmentos.filter(s => ids.has(String(s.cluster_id)) && !s.em_uso).map(s => String(s.cluster_id));
	const esp = ap.criados?.espera;
	const valendo = !!esp && esp.substituida_por == null && esp.concluida_em == null;
	const versoes = valendo ? Object.entries(esp?.versoes ?? {}).filter(([, v]) => !v?.ligada_em).map(([k]) => k) : [];
	return { pausados, versoes, total: new Set([...pausados, ...versoes]).size };
}

export function contarAcoes(prop: Proposta) {
	const fica = emOrdem(prop);
	return {
		novos: fica.filter(s => s.acao === 'novo').length,
		alterados: fica.filter(s => s.acao === 'alterar').length,
		mantidos: fica.filter(s => s.acao === 'manter').length,
		desligados: desligados(prop).length,
		estrategias: fica.filter(s => s.estrategia === 'nova').length,
	};
}

/** Corpo da previa_segmentacao: os segmentos que ficam, na ordem final (ref = ref da proposta). */
export function corpoPrevia(prop: Proposta) {
	return { segmentos: emOrdem(prop).map(s => ({ ref: s.ref, codigo: s.codigo, nome: s.nome, condicoes: s.condicoes })) };
}

export type Contagens = {
	porRef: Record<string, number>; demais: number; total: number; dataBase: string | null;
	sobreposicao: { a: string; b: string; clientes: number }[];
	deOnde: { de: string; para: string; clientes: number }[];
	mudam: number; hoje: Record<string, number>; semDado: string[];
};

/** Resultado da prévia em termos da proposta (refs, "Demais"). */
export function lerContagens(prop: Proposta, r: ResultadoPrevia): Contagens {
	const fica = emOrdem(prop);
	const refDe = (pos: number | null) => (pos == null ? 'Demais' : fica[pos - 1]?.ref ?? 'Demais');
	const porRef: Record<string, number> = {};
	for (const s of r.segmentos) porRef[s.ref ?? refDe(s.posicao)] = s.clientes;
	const codigoDe = (ref: string) => (ref === 'Demais' ? 'Demais' : prop.segmentos[ref]?.codigo ?? ref);
	const deOnde = r.de_onde.map(d => ({ de: d.de ?? 'Demais', para: refDe(d.para), clientes: d.clientes }));
	const hoje: Record<string, number> = {};
	for (const d of deOnde) hoje[d.de] = (hoje[d.de] ?? 0) + d.clientes;
	const mudam = deOnde.filter(d => d.de !== codigoDe(d.para)).reduce((n, d) => n + d.clientes, 0);
	return {
		porRef, demais: r.demais, total: r.clientes, dataBase: r.data_base, deOnde, hoje, mudam, semDado: r.campos_sem_dado ?? [],
		sobreposicao: r.sobreposicao.filter(o => o.clientes > 0).map(o => ({ a: refDe(o.a), b: refDe(o.b), clientes: o.clientes })),
	};
}

/** Matriz "De onde vêm os clientes": linhas = segmento de hoje; colunas = proposto (códigos + Demais). */
export function matrizDeOnde(prop: Proposta, c: Contagens) {
	const colunas = [...emOrdem(prop).map(s => ({ ref: s.ref, codigo: s.codigo })), { ref: 'Demais', codigo: 'Demais' }];
	const linhas = [...new Set(c.deOnde.map(d => d.de))].sort((a, b) => (a === 'Demais' ? 1 : b === 'Demais' ? -1 : 0));
	const celula = (de: string, para: string) => c.deOnde.filter(d => d.de === de && d.para === para).reduce((n, d) => n + d.clientes, 0);
	return {
		colunas,
		linhas: linhas.map(de => ({ de, valores: colunas.map(col => celula(de, col.ref)), total: c.hoje[de] ?? 0 })),
		totais: colunas.map(col => (col.ref === 'Demais' ? c.demais : c.porRef[col.ref] ?? 0)),
	};
}

export type Conferencia = { tom: 'ok' | 'atencao' | 'erro'; titulo: string; texto: string; troca?: { a: string; b: string } };

/** Conferências da tela 3 (só contagens do banco; nada da IA). */
export function conferencias(prop: Proposta, c: Contagens | null, canaisAtivos: Set<string>): Conferencia[] {
	const out: Conferencia[] = [];
	const fica = emOrdem(prop);
	const novos = new Set(fica.filter(s => s.acao === 'novo' || s.acao === 'alterar').map(s => s.ref));
	const cod = (r: string) => prop.segmentos[r]?.codigo ?? r;
	if (c) {
		const entreNovos = c.sobreposicao.filter(o => novos.has(o.a) && novos.has(o.b));
		if (entreNovos.length === 0) out.push({ tom: 'ok', titulo: 'Nenhuma sobreposição entre os segmentos propostos.', texto: 'Conferido no banco: cada cliente bateu em no máximo um dos segmentos novos ou alterados.' });
		for (const o of entreNovos) out.push({ tom: 'atencao', titulo: `Faixas se cruzam: ${o.clientes.toLocaleString('pt-BR')} clientes cabem em ${cod(o.a)} e ${cod(o.b)}.`, texto: `Pela ordem, ficam em ${cod(o.a)} e nunca recebem a régua de ${cod(o.b)}.`, troca: { a: o.a, b: o.b } });
		const resolvidos = c.sobreposicao.filter(o => !(novos.has(o.a) && novos.has(o.b)) && (novos.has(o.a) || novos.has(o.b)));   // entre segmentos que não mudam: nada novo
		if (resolvidos.length) out.push({ tom: 'atencao', titulo: 'Sobreposição resolvida pela ordem.', texto: resolvidos.map(o => `${o.clientes.toLocaleString('pt-BR')} de ${cod(o.a)} também se encaixam em ${cod(o.b)}; ficam em ${cod(o.a)}, que vem antes.`).join(' ') });
		if (c.demais > 0) out.push({ tom: 'atencao', titulo: `${c.demais.toLocaleString('pt-BR')} clientes não cabem em nenhum segmento e vão para Demais.`, texto: prop.demais === 'desligar' ? 'Demais desligado: sem ação (acordos continuam).' : 'Seguem a estratégia da carteira.' });
		const vazios = fica.filter(s => (c.porRef[s.ref] ?? 0) === 0 && s.acao !== 'manter');
		if (vazios.length) out.push({ tom: 'atencao', titulo: `${vazios.map(s => s.codigo).join(', ')} ${vazios.length > 1 ? 'ficaram' : 'ficou'} com 0 clientes hoje.`, texto: 'Pode ser um valor diferente na carga ou um recorte que ainda não chegou.' });
		else out.push({ tom: 'ok', titulo: 'Nenhum segmento novo ou alterado ficou vazio.', texto: '' });
		if (c.semDado.length) out.push({ tom: 'atencao', titulo: 'Campo sem dado para contar.', texto: `${c.semDado.join(', ')}: a contagem trata como vazio.` });
	}
	out.push({ tom: 'ok', titulo: 'Campos e operadores existem nesta carteira e o motor aceitou as condições e as réguas.', texto: '' });
	const aAtivar = canaisAAtivar(prop, canaisAtivos);
	if (aAtivar.length) out.push({ tom: 'erro', titulo: `Canal a ativar: ${aAtivar.map(nomeCanal).join(', ')}.`, texto: 'Aplicar fica bloqueado até o canal estar ativo nesta empresa.' });
	return out;
}

export function canaisAAtivar(prop: Proposta, canaisAtivos: Set<string>): string[] {
	return [...new Set(emOrdem(prop).flatMap(s => s.canais_a_ativar ?? []))].filter(c => !canaisAtivos.has(c));
}

/** O que impede o Aplicar (a tela mostra o motivo; o banco confere de novo). */
export function bloqueiosAplicar(prop: Proposta, opts: { canaisAtivos: Set<string>; hashAtual: string | null; confirmou: boolean }): string[] {
	const b: string[] = [];
	const n = emOrdem(prop).filter(s => s.acao === 'novo' || s.acao === 'alterar').length;
	if (n > LIMITE_SEGMENTOS) b.push(`No máximo ${LIMITE_SEGMENTOS} segmentos novos ou alterados por texto (a proposta tem ${n}).`);
	const aAtivar = canaisAAtivar(prop, opts.canaisAtivos);
	if (aAtivar.length) b.push(`Ative ${aAtivar.map(nomeCanal).join(', ')} antes de aplicar.`);
	if (prop.hash_base && opts.hashAtual && prop.hash_base !== opts.hashAtual) b.push('A carteira mudou desde a geração (segmentos, ordem ou estratégias): gere a proposta de novo.');
	if (!opts.confirmou) b.push('Confirme que entendeu quantos clientes mudam de segmento.');
	return b;
}

// ------------------------------------------------------------------ a régua do segmento (tela 4)
export const NOME_ESTAGIO: Record<string, string> = {
	localizacao: 'Cliente novo', giro: 'Não CPC', cpc: 'CPC · sem resposta', acordo: 'Acordo',
};

export function estagiosDoSegmento(d: Definicao | null) {
	if (!d) return [];
	const loc = d.localizacao;
	const giro = d.giro;
	const diasLoc = loc?.passos ? Object.keys(loc.passos).map(Number).sort((a, b) => a - b) : [];
	return [
		{ id: 'localizacao', nome: 'Cliente novo', doTexto: diasLoc.length > 0, resumo: diasLoc.length ? `Dias ${diasLoc.join(', ')} · vira Não CPC no D+${loc?.dias_sem_contato_para_ncp ?? 8}` : 'padrão do motor' },
		{ id: 'giro', nome: 'Não CPC', doTexto: !!giro?.passos, resumo: giro?.passos ? `ciclo de ${giro.ciclo_dias} dias × ${giro.max_ciclos} voltas` : 'padrão do motor' },
		{ id: 'cpc', nome: 'CPC · sem resposta', doTexto: !!d.cpc?.intervalo_cpb, resumo: d.cpc?.intervalo_cpb ? (d.cpc.intervalo_cpb === 1 ? 'todo dia' : `a cada ${d.cpc.intervalo_cpb} dias`) : 'padrão do motor' },
		{ id: 'acordo', nome: 'Acordo', doTexto: false, resumo: 'antes e depois do vencimento: padrão' },
	];
}

export type PersonaInfo = { id: string; nome: string; canais: string[]; cor?: string };
export type LinhaTabela = { perfil: string; personaId: string | null; prioridade: number; detalhe: string; dias: { dia: number; acoes: Acao[]; segue: boolean }[] };

/** "Régua por perfil" (tela 4): uma linha por persona com raia + Público geral, dias do Cliente novo. */
export function tabelaRegua(d: Definicao | null, personas: PersonaInfo[]): LinhaTabela[] {
	const passos = d?.localizacao?.passos ?? {};
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);
	if (!dias.length) return [];
	const de = (a: Acao, id: string) => (a.personas ?? []).some(x => String(x) === id);   // o site grava o id como número
	const comRaia = personas.filter(p => dias.some(n => (passos[String(n)] ?? []).some(a => de(a, p.id))));
	const linhas: LinhaTabela[] = comRaia.map((p, i) => ({
		perfil: p.nome, personaId: p.id, prioridade: i + 1,
		detalhe: p.canais.length ? p.canais.map(nomeCanal).join(' → ') : '',
		dias: dias.map(n => {
			const proprias = (passos[String(n)] ?? []).filter(a => de(a, p.id));
			return { dia: n, acoes: proprias.length ? proprias : (passos[String(n)] ?? []).filter(a => !a.personas?.length), segue: proprias.length === 0 };
		}),
	}));
	linhas.push({
		perfil: comRaia.length ? 'Demais (sem persona mapeada)' : 'Todos os clientes', personaId: null, prioridade: linhas.length + 1, detalhe: 'ciclo que você escreveu',
		dias: dias.map(n => ({ dia: n, acoes: (passos[String(n)] ?? []).filter(a => !a.personas?.length), segue: false })),
	});
	return linhas;
}

const MODO: Record<string, string> = { junto: '+ junto', reserva: '↻ reserva', senao: '↳ senão', sempre: 'e sempre' };
/** Conector antes do canal na célula ("↻ reserva", "↳ senão"…); vazio no 1º. */
export function conectorModo(modo: string | undefined, primeiro: boolean): string {
	return primeiro ? '' : MODO[modo ?? 'sempre'] ?? '';
}

export function nomeAcao(canal: string): string {
	return canal === 'enriquecimento' ? 'Enriquecimento (bureau)' : canal === 'sem_acao' ? 'Sem ação' : nomeCanal(canal);
}

// ------------------------------------------------------------------ textos
export const MOTIVO_FORA: Record<string, { tom: 'erro' | 'atencao'; titulo: (t: string) => string; texto: string }> = {
	campo_inexistente: { tom: 'erro', titulo: t => `“${t}” não é um campo desta carteira.`, texto: 'A condição saiu do segmento. Para usar, envie o dado como coluna da carga.' },
	canal_desligado: { tom: 'atencao', titulo: t => `${t} está desligado nesta carteira.`, texto: 'O canal ficou fora da régua; o dia segue com os outros canais.' },
	canal_nao_contratado: { tom: 'atencao', titulo: t => `${t} não está contratado nesta empresa.`, texto: 'O canal não pode ser ligado na carteira; o dia ficou sem ele. Fale com o comercial para contratar.' },
	valor_oferta: { tom: 'erro', titulo: () => 'Valores e ofertas nunca entram na régua.', texto: 'A oferta vem da alçada da carteira ou do CRM; a mensagem usa a variável da oferta.' },
	persona_inexistente: { tom: 'atencao', titulo: t => `Persona “${t}” não existe nesta carteira.`, texto: 'A raia não foi criada; quem seria dela segue o Público geral.' },
	recorte_vazio: { tom: 'atencao', titulo: t => `“${t}” deixa 0 clientes hoje.`, texto: 'Padrão: o segmento não é criado. Pode ser um nome diferente na carga ou uma carga que ainda não chegou.' },
};

const ERRO_GERACAO: Record<string, string> = {
	llm_indisponivel: 'A IA não respondeu agora. Tente de novo em alguns minutos.',
	resposta_fora_do_esquema: 'A IA respondeu fora do formato combinado, mesmo depois de 2 correções.',
	texto_longo: 'O texto passou de 6.000 caracteres.',
	limite_segmentos: `O texto pede mais de ${LIMITE_SEGMENTOS} segmentos novos ou alterados. Divida em dois textos.`,
	segmento_sem_condicao: 'Um segmento só usa campos que não existem nesta carteira.',
	condicao_invalida: 'Uma condição não fecha (faixa invertida ou texto onde precisa de número).',
	existente_invalido: 'O texto cita um segmento que não está nesta carteira.',
	regua_invalida: 'O motor recusou a régua de um segmento.',
	falha_na_geracao: 'A geração falhou.',
	sem_proposta: 'A geração terminou sem proposta.',
};

/** Erros da geração (códigos da VM) → frases em português, sem repetir. */
export function explicarErrosGeracao(erros: string[] | undefined | null): string[] {
	const out: string[] = [];
	for (const e of erros ?? []) {
		const t = ERRO_GERACAO[e.split(':')[0]] ?? 'O motor recusou a proposta.';
		if (!out.includes(t)) out.push(t);
	}
	return out.length ? out : ['A geração terminou sem proposta.'];
}

/** "HH:MM" de Brasília. */
export function horaBR(iso: string): string {
	try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); } catch { return ''; }
}
