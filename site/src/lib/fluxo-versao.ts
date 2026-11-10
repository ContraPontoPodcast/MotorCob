// Caminho da versão do fluxo do agente (PR7 do redesenho; SPEC §2.1 e §2.4): Rascunho → Testes → Aprovação → Em uso,
// com uma única ação principal por fase; o checklist "Antes de aprovar"; e "o que muda" entre duas versões, em
// palavras (diferencas). Funções puras, sem banco: quem decide se a versão pode ir adiante continua sendo o banco
// (fluxo_voz_bloqueios em enviar/aprovar/usar_fluxo_voz). Aqui só se lê o que ele já respondeu. Testado em
// src/components/fluxo/versao.test.tsx (npm test).
import {
	MODOS, OPCOES, TIPOS, TRAVAS, explicar, impedem, nomesEtapas, numerosRoteiro, rotuloDe, roteiro,
	type Bloco, type Definicao, type SituacaoVersao,
} from './fluxo';

// ---------------------------------------------------------------- fases
export type Fase = 0 | 1 | 2 | 3;
export const FASES = ['Rascunho', 'Testes', 'Aprovação', 'Em uso'] as const;

/** Pendências que são do desenho (validador, conectores, alçada): tudo que impede, menos caso de teste que falhou. */
export const pendenciasDoDesenho = (bloqueios: string[]) => impedem(bloqueios).filter(p => !p.codigo.startsWith('caso_falhou'));
export const casosQueFalharam = (bloqueios: string[]) => bloqueios.filter(c => c.startsWith('caso_falhou')).length;

/**
 * Fase da versão. Rascunho com pendência no desenho → 0 (Rascunho). Rascunho sem pendência no desenho → 1 (Testes: os
 * casos de teste seguram; personas é aviso). Enviado para aprovação ou aprovado pela empresa → 2 (Aprovação). Em uso → 3.
 * Arquivada → null (só consulta).
 */
export function faseVersao(a: { situacao: SituacaoVersao; bloqueios: string[]; enviadoEm?: string | null }): Fase | null {
	if (a.situacao === 'arquivado') return null;
	if (a.situacao === 'em_uso') return 3;
	if (a.situacao === 'aprovado_empresa') return 2;
	if (pendenciasDoDesenho(a.bloqueios).length) return 0;
	if (a.enviadoEm && !impedem(a.bloqueios).length) return 2;
	return 1;
}

export type AcaoFase =
	| { tipo: 'corrigir'; rotulo: string; nota: string }
	| { tipo: 'testes'; rotulo: string; nota: string }
	| { tipo: 'enviar'; rotulo: string; nota: string }
	| { tipo: 'revisar'; rotulo: string; nota: string }
	| { tipo: 'usar'; rotulo: string; nota: string }
	| { tipo: 'nenhuma'; rotulo: ''; nota: string };

/**
 * A única ação principal do cabeçalho, conforme a fase e quem está vendo (as mesmas permissões de antes: Editar canais
 * envia; Aprovar roteiro de voz aprova e coloca em uso; a equipe MotorCX monta e envia, nunca aprova). Aprovar em si
 * fica na aba Versões e aprovação, com o checklist: aqui o botão de quem aprova é "Revisar e aprovar".
 */
export function acaoDaFase(a: {
	situacao: SituacaoVersao; bloqueios: string[]; enviadoEm?: string | null; podeEditar: boolean; podeAprovar: boolean;
	casos?: { passaram: number; total: number }; emUso?: number | null; versao: number;
}): AcaoFase {
	const fase = faseVersao(a);
	const desenho = pendenciasDoDesenho(a.bloqueios).length;
	const falharam = casosQueFalharam(a.bloqueios);
	const casos = a.casos && a.casos.total ? `${a.casos.passaram} de ${a.casos.total} casos de teste passaram.` : '';
	const vaiArquivo = a.emUso && a.emUso !== a.versao ? ` A v${a.emUso} vai para o arquivo.` : '';
	if (fase === null) return { tipo: 'nenhuma', rotulo: '', nota: 'Versão arquivada: só consulta.' };
	if (fase === 3) return { tipo: 'nenhuma', rotulo: '', nota: 'Esta versão atende as ligações.' };
	if (fase === 0) {
		const n = `${desenho} ${desenho === 1 ? 'ponto' : 'pontos'}`;
		return a.podeEditar
			? { tipo: 'corrigir', rotulo: `Corrigir ${n}`, nota: 'Enviar para aprovação libera quando o desenho estiver certo.' }
			: { tipo: 'nenhuma', rotulo: '', nota: `${n.charAt(0).toUpperCase()}${n.slice(1)} a corrigir no desenho. Quem tem Editar canais corrige.` };
	}
	if (a.situacao === 'aprovado_empresa') {
		return a.podeAprovar
			? { tipo: 'usar', rotulo: 'Colocar em uso', nota: `Vale a partir da próxima ligação.${vaiArquivo}` }
			: { tipo: 'nenhuma', rotulo: '', nota: 'Aprovada. Quem tem Aprovar roteiro de voz coloca em uso.' };
	}
	if (fase === 1 && falharam) {
		return { tipo: 'testes', rotulo: 'Ver os testes', nota: `${falharam} ${falharam === 1 ? 'caso de teste falhou' : 'casos de teste falharam'}. Caso que falha segura a aprovação.` };
	}
	if (fase === 1) {
		if (a.podeEditar) return { tipo: 'enviar', rotulo: 'Enviar para aprovação', nota: `${casos ? `${casos} ` : ''}Quem aprova recebe o aviso no sino.` };
		if (a.podeAprovar) return { tipo: 'revisar', rotulo: 'Revisar e aprovar', nota: 'Ainda não enviada, mas nada impede a aprovação.' };
		return { tipo: 'nenhuma', rotulo: '', nota: 'Pronta para aprovação. Quem tem Editar canais envia.' };
	}
	// fase 2, rascunho enviado
	return a.podeAprovar
		? { tipo: 'revisar', rotulo: 'Revisar e aprovar', nota: 'Enviada. Veja o que muda, os testes e as respostas prontas antes de aprovar.' }
		: { tipo: 'nenhuma', rotulo: '', nota: 'Enviada. Aguardando quem tem Aprovar roteiro de voz.' };
}

// ---------------------------------------------------------------- antes de aprovar
export type EstadoCheck = 'ok' | 'erro' | 'aviso';
export interface ItemCheck { id: 'desenho' | 'travas' | 'casos' | 'personas' | 'respostas' | 'alcada'; estado: EstadoCheck; texto: string; impede: boolean }

/**
 * "Antes de aprovar": desenho, 7 travas, casos de teste, personas (aviso), respostas prontas sem revisão (aviso) e
 * alçada. Impede = o banco também recusa (fluxo_voz_bloqueios); aviso nunca impede.
 */
export function antesDeAprovar(a: {
	bloqueios: string[]; avisos: string[];
	casos: { id: number; passou: boolean | null }[];
	respostas: { revisado_em: string | null }[];
	alcada: { desconto_max_pct: number; parcelas_max: number } | null;
}): ItemCheck[] {
	const desenho = pendenciasDoDesenho(a.bloqueios).filter(p => p.codigo !== 'sem_alcada').length;
	const falharam = Math.max(casosQueFalharam(a.bloqueios), a.casos.filter(c => c.passou === false).length);
	const rodaram = a.casos.filter(c => c.passou != null).length;
	const passaram = a.casos.filter(c => c.passou === true).length;
	const semRev = a.respostas.filter(r => !r.revisado_em).length;
	const personas = a.avisos.filter(c => c.startsWith('roleplay_')).map(c => explicar(c).texto);
	const semAlcada = a.bloqueios.some(c => c === 'sem_alcada');
	const pct = (v: number) => `${String(v).replace('.', ',')}%`;
	return [
		{ id: 'desenho', estado: desenho ? 'erro' : 'ok', impede: desenho > 0, texto: desenho ? `Desenho do fluxo: ${desenho} ${desenho === 1 ? 'ponto' : 'pontos'} a corrigir` : 'Desenho do fluxo sem pendências' },
		{ id: 'travas', estado: 'ok', impede: false, texto: `${TRAVAS.length} travas fixas valendo (não dependem do fluxo)` },
		{
			id: 'casos', impede: falharam > 0,
			estado: falharam ? 'erro' : !a.casos.length || rodaram < a.casos.length ? 'aviso' : 'ok',
			texto: !a.casos.length ? 'Casos de teste: nenhum guardado'
				: falharam ? `Casos de teste: ${falharam} de ${a.casos.length} ${falharam === 1 ? 'falhou' : 'falharam'}`
				: rodaram < a.casos.length ? `Casos de teste: ${passaram} de ${a.casos.length} passaram; ${a.casos.length - rodaram} ainda não ${a.casos.length - rodaram === 1 ? 'rodou' : 'rodaram'} nesta versão`
				: `Casos de teste: ${passaram} de ${a.casos.length} passaram`,
		},
		{ id: 'personas', estado: personas.length ? 'aviso' : 'ok', impede: false, texto: personas.length ? `Personas (aviso): ${personas.join(' ')}` : 'Personas: sem aviso' },
		{ id: 'respostas', estado: semRev ? 'aviso' : 'ok', impede: false, texto: !a.respostas.length ? 'Respostas prontas: nenhuma nesta versão' : semRev ? `Respostas prontas: ${semRev} sem revisão (só as revisadas vão para a ligação)` : 'Respostas prontas: todas revisadas' },
		{
			id: 'alcada', estado: semAlcada ? 'erro' : 'ok', impede: semAlcada,
			texto: semAlcada ? 'Alçada da carteira: não cadastrada' : a.alcada ? `Alçada da carteira: até ${pct(a.alcada.desconto_max_pct)} de desconto e ${a.alcada.parcelas_max} parcelas` : 'Alçada da carteira: não precisa (o fluxo não oferece)',
		},
	];
}

// ---------------------------------------------------------------- o que muda (em palavras)
export interface Diferenca { tipo: 'nova' | 'removida' | 'alterada'; id: string; nome: string; detalhes: string[] }

const CAMPOS: Record<string, string> = {
	fala: 'Fala', objetivo: 'Objetivo da IA', fala_espera: 'Fala de espera', max_turnos: 'Limite de turnos', contrapropostas_max: 'Contrapropostas',
	conector_id: 'Conector', conectores: 'Conectores', registra: 'O que registra', tentativas: 'Tentativas', intencoes: 'O que a etapa entende',
	opcoes: 'Opções', ferramentas: 'O que a IA pode fazer', tom: 'Tom', resultado: 'Resultado', motivo: 'Motivo', dias_max: 'Prazo do retorno',
	canal: 'Canal', campo: 'Condição', op: 'Condição', valor: 'Condição', confianca_min: 'Certeza mínima', pergunta: 'Pergunta de identidade',
	origem: 'Origem da oferta', exemplos: 'Exemplos', codigo: 'Código do resultado',
};
const LISTAS: Record<string, readonly (readonly [string, string])[]> = {
	registra: OPCOES.registra, resultado: OPCOES.resultado_encerrar, motivo: OPCOES.motivo_transferir, canal: OPCOES.canal_link,
	origem: OPCOES.origem_oferta, pergunta: OPCOES.pergunta_identidade, campo: OPCOES.campo_condicao, op: OPCOES.op,
};
const igual = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
const curto = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function valorEmPalavras(campo: string, v: unknown, conectores: Map<number, string>): string {
	if (v == null || v === '' || (Array.isArray(v) && !v.length)) return 'nada';
	if (campo === 'conector_id') return conectores.get(Number(v)) ?? `conector ${String(v)}`;
	if (campo === 'conectores' && Array.isArray(v)) return v.map(x => conectores.get(Number(x)) ?? `conector ${String(x)}`).join(', ');
	if (campo === 'ferramentas' && Array.isArray(v)) return v.map(x => rotuloDe(OPCOES.ferramentas, x)).join(', ');
	if (campo === 'tom' && Array.isArray(v)) return v.map(x => rotuloDe(OPCOES.tom, x)).join(', ');
	if (campo === 'opcoes' && Array.isArray(v)) return v.map(o => (o && typeof o === 'object' ? String((o as { rotulo?: unknown }).rotulo ?? '') : String(o))).join(', ');
	if (LISTAS[campo]) return rotuloDe(LISTAS[campo], v);
	if (typeof v === 'string') return `"${curto(v.trim())}"`;
	if (Array.isArray(v)) return v.map(String).join(', ');
	if (typeof v === 'object') return 'ajustado';
	return String(v);
}

function mudancasDoBloco(a: Bloco, b: Bloco, nomesA: Map<string, string>, nomesB: Map<string, string>, conectores: Map<number, string>): string[] {
	const out: string[] = [];
	if (a.tipo !== b.tipo) out.push(`Virou ${TIPOS[b.tipo]?.nome ?? b.tipo} (antes: ${TIPOS[a.tipo]?.nome ?? a.tipo}).`);
	if ((a.titulo ?? '') !== (b.titulo ?? '') && nomesA.get(a.id) !== nomesB.get(b.id)) out.push(`Nome: "${nomesB.get(b.id)}" (antes: "${nomesA.get(a.id)}").`);
	if (a.modo !== b.modo) out.push(`Modo: ${MODOS[b.modo]?.nome ?? b.modo} (antes: ${MODOS[a.modo]?.nome ?? a.modo}).`);
	if ((a.repetir_max ?? null) !== (b.repetir_max ?? null)) out.push(`Se voltar para esta etapa: no máximo ${b.repetir_max ?? 'sem limite'} (antes: ${a.repetir_max ?? 'sem limite'}).`);
	const pa = a.params ?? {}, pb = b.params ?? {};
	const vistos = new Set<string>();
	for (const k of [...new Set([...Object.keys(pa), ...Object.keys(pb)])]) {
		if (igual(pa[k], pb[k])) continue;
		const rot = CAMPOS[k] ?? 'Outro ajuste';
		if (rot === 'Condição') {
			if (vistos.has(rot)) continue;
			vistos.add(rot);
			const cond = (p: Record<string, unknown>) => `${rotuloDe(OPCOES.campo_condicao, p.campo)} ${rotuloDe(OPCOES.op, p.op)} ${String(p.valor ?? '')}`;
			out.push(`Condição: ${cond(pb)} (antes: ${cond(pa)}).`);
			continue;
		}
		if (k === 'exemplos') { out.push('Exemplos de respostas mudaram.'); continue; }
		if (!CAMPOS[k]) { if (!vistos.has(rot)) { vistos.add(rot); out.push('Outros ajustes na etapa.'); } continue; }
		out.push(`${rot}: ${valorEmPalavras(k, pb[k], conectores)} (antes: ${valorEmPalavras(k, pa[k], conectores)}).`);
	}
	const sa = new Map(a.saidas.map(s => [s.quando, s])), sb = new Map(b.saidas.map(s => [s.quando, s]));
	const destino = (n: Map<string, string>, para: string) => n.get(para) ?? 'etapa que não existe mais';
	for (const [q, s] of sb) {
		const antes = sa.get(q);
		if (!antes) out.push(`Nova resposta: "${s.rotulo}" → ${destino(nomesB, s.para)}.`);
		else if (antes.para !== s.para) out.push(`"${s.rotulo}" agora vai para ${destino(nomesB, s.para)} (antes: ${destino(nomesA, antes.para)}).`);
		else if (antes.rotulo !== s.rotulo) out.push(`Resposta "${antes.rotulo}" passou a se chamar "${s.rotulo}".`);
	}
	for (const [q, s] of sa) if (!sb.has(q)) out.push(`Saiu a resposta "${s.rotulo}" (ia para ${destino(nomesA, s.para)}).`);
	return out;
}

/**
 * O que muda de `antes` (ex.: a versão em uso) para `depois` (a nova), em palavras: etapa nova, removida ou alterada,
 * com a fala antes → depois e cada resposta que mudou de destino. Na ordem do roteiro da versão nova; as removidas no fim.
 */
export function diferencas(antes: Definicao, depois: Definicao, ctx: { conectores?: { id: number; nome: string }[] } = {}): Diferenca[] {
	const conectores = new Map((ctx.conectores ?? []).map(c => [c.id, c.nome]));
	const nomesA = nomesEtapas(antes), nomesB = nomesEtapas(depois);
	const porA = new Map(antes.blocos.map(b => [b.id, b]));
	const idsB = new Set(depois.blocos.map(b => b.id));
	const ordem = numerosRoteiro(roteiro(depois));
	const pos = (id: string) => ordem.get(id) ?? Number.MAX_SAFE_INTEGER;
	const out: Diferenca[] = [];
	for (const b of [...depois.blocos].sort((x, y) => pos(x.id) - pos(y.id))) {
		const a = porA.get(b.id);
		if (!a) {
			const fala = typeof b.params?.fala === 'string' && b.params.fala.trim() ? [`Diz: "${curto(b.params.fala.trim())}"`] : typeof b.params?.objetivo === 'string' && b.params.objetivo.trim() ? [`Objetivo: "${curto(b.params.objetivo.trim())}"`] : [];
			out.push({ tipo: 'nova', id: b.id, nome: nomesB.get(b.id) ?? b.id, detalhes: [`${TIPOS[b.tipo]?.nome ?? b.tipo}.`, ...fala] });
			continue;
		}
		const det = mudancasDoBloco(a, b, nomesA, nomesB, conectores);
		if (det.length) out.push({ tipo: 'alterada', id: b.id, nome: nomesB.get(b.id) ?? b.id, detalhes: det });
	}
	for (const a of antes.blocos) if (!idsB.has(a.id)) out.push({ tipo: 'removida', id: a.id, nome: nomesA.get(a.id) ?? a.id, detalhes: [] });
	return out;
}

/** "2 etapas novas, 1 removida e 3 alteradas." */
export function resumoDiferencas(d: Diferenca[]): string {
	if (!d.length) return 'Nenhuma diferença no desenho.';
	const n = (t: Diferenca['tipo']) => d.filter(x => x.tipo === t).length;
	const partes = [
		n('nova') ? `${n('nova')} ${n('nova') === 1 ? 'etapa nova' : 'etapas novas'}` : '',
		n('removida') ? `${n('removida')} ${n('removida') === 1 ? 'removida' : 'removidas'}` : '',
		n('alterada') ? `${n('alterada')} ${n('alterada') === 1 ? 'alterada' : 'alteradas'}` : '',
	].filter(Boolean);
	const txt = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
	return `${txt.charAt(0).toUpperCase()}${txt.slice(1)}.`;
}
