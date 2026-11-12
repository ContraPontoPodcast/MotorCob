// Ofertas do agente de voz (SQL 130/131/132; SPEC_OFERTAS_v2, respostas Q1–Q18 aprovadas pelo dono). O agente lê, não
// calcula: as ofertas vêm SÓ da API do credor (conector "Buscar ofertas", inclusive o CRM) ou das colunas oferta1..3_*
// do arquivo do dia, uma fonte por ligação, na ordem configurada da carteira. A alçada só DESCARTA (nunca corta nem
// recalcula). Esta é a mesma regra do executor da VM (voz/conector.py › motivo_descarte e voz/fluxo.py ›
// _resolver_ofertas), pinada pelos casos de tests/dados/ofertas_casos.json, para a tela "Testar com cliente fictício".
// Nenhum dado de cliente: só os cenários fictícios abaixo.

export type Modo = 'api_arquivo' | 'arquivo_api' | 'so_api' | 'so_arquivo';
export type Fonte = 'api' | 'arquivo';
export interface ConfigOfertas { modo: Modo; conector_id: number | null }
export interface Oferta {
	id?: string; parcelas?: number; valor_parcela?: number; desconto_pct?: number; entrada?: number;
	validade?: string; valor_total?: number; vencimento?: string;
}
export interface Alcada { desconto_max_pct: number; parcelas_max: number; parcela_min: number; entrada_min: number }
export type Motivo = 'incompleta' | 'vencida' | 'acima_alcada' | 'conta';

export const MODOS: { id: Modo; nome: string; curto: string; desc: string; ordem: Fonte[] }[] = [
	{ id: 'api_arquivo', nome: 'API, e o arquivo como reserva', curto: 'API → arquivo', desc: 'A API do credor primeiro. Se ela falhar ou todas as ofertas forem descartadas, usa o arquivo.', ordem: ['api', 'arquivo'] },
	{ id: 'arquivo_api', nome: 'Arquivo, e a API como reserva', curto: 'Arquivo → API', desc: 'O arquivo primeiro. Se o cliente não tiver oferta válida no arquivo, consulta a API.', ordem: ['arquivo', 'api'] },
	{ id: 'so_api', nome: 'Só a API', curto: 'Só API', desc: 'Se a API falhar, o agente transfere para um atendente.', ordem: ['api'] },
	{ id: 'so_arquivo', nome: 'Só o arquivo', curto: 'Só arquivo', desc: 'Usa só as colunas de oferta do mailing do dia.', ordem: ['arquivo'] },
];
export const NOME_FONTE: Record<Fonte, string> = { api: 'API do credor', arquivo: 'Arquivo' };
export const NOME_MOTIVO: Record<Motivo, string> = { incompleta: 'incompleta (falta parcelas, valor, validade ou id)', vencida: 'vencida', acima_alcada: 'acima da alçada', conta: 'a conta não fecha' };
export const ordemDe = (m: Modo): Fonte[] => MODOS.find(x => x.id === m)?.ordem ?? ['api', 'arquivo'];
export const nomeModo = (m: Modo | null | undefined) => (m ? MODOS.find(x => x.id === m)?.nome ?? m : 'Padrão: API, e o arquivo como reserva');

/** O padrão quando a carteira ainda não escolheu (Q1): com API, API → arquivo; sem API, só o arquivo. */
export function recomendado(temApi: boolean): Modo { return temApi ? 'api_arquivo' : 'so_arquivo'; }

/** A mesma validação do banco (public.ofertas_mailing_valida). '' = pode salvar. */
export function validarOfertas(c: ConfigOfertas | null): string {
	if (!c || !MODOS.some(m => m.id === c.modo)) return 'Escolha de onde vêm as ofertas.';
	if (c.modo === 'so_arquivo') return c.conector_id == null ? '' : 'Com "só o arquivo", não há conector.';
	return Number.isInteger(c.conector_id) && (c.conector_id as number) > 0 ? '' : 'Escolha o conector "Buscar ofertas" da API.';
}
export function paraSalvarOfertas(c: ConfigOfertas): ConfigOfertas {
	return { modo: c.modo, conector_id: c.modo === 'so_arquivo' ? null : c.conector_id };
}

function num(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
	return null;
}

/** Por que a oferta não pode ser falada (a ordem da SPEC §6), ou null. Igual a voz/conector.py › motivo_descarte. */
export function motivoDescarte(o: Oferta, a: Alcada | null, hoje: string): Motivo | null {
	const parc = num(o.parcelas), vp = num(o.valor_parcela);
	const val = typeof o.validade === 'string' && /^\d{4}-\d{2}-\d{2}/.test(o.validade) ? o.validade.slice(0, 10) : null;
	if (!o.id || String(o.id).length > 40 || parc == null || !Number.isInteger(parc) || parc < 1 || vp == null || vp <= 0 || !val) return 'incompleta';
	if (val < hoje) return 'vencida';
	if (!a) return 'acima_alcada';                                        // sem alçada nada passa (Q6)
	const desc = num(o.desconto_pct) ?? 0, ent = num(o.entrada);
	if (parc > a.parcelas_max || desc < 0 || desc > a.desconto_max_pct || (parc > 1 && vp < a.parcela_min) || (ent != null && a.entrada_min > 0 && ent < a.entrada_min)) return 'acima_alcada';
	const tot = num(o.valor_total);
	if (tot != null) {
		const dif = Math.abs((ent ?? 0) + parc * vp - tot);
		if (dif > 0.05 && dif > Math.abs(tot) * 0.01) return 'conta';
	}
	return null;
}

const reais = (v: number | undefined) => 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dm = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
export const dma = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** A frase fixa da oferta, só com os campos que vieram (igual a voz/fluxo.py › condicao_oferta). Nunca faz conta. */
export function condicao(o: Oferta): string {
	const p = o.parcelas ?? 1;
	let s = p === 1 ? `à vista por ${reais(o.valor_parcela)}` : o.entrada ? `entrada de ${reais(o.entrada)} e mais ${p} parcelas de ${reais(o.valor_parcela)}` : `${p} parcelas de ${reais(o.valor_parcela)}`;
	if (o.desconto_pct) s += `, com ${String(o.desconto_pct).replace('.', ',')}% de desconto`;
	return s + (o.validade ? `. Vale até ${dm(o.validade)}.` : '.');
}
export function rotulo(o: Oferta): string {
	const p = o.parcelas ?? 1;
	return (p === 1 ? `À vista ${reais(o.valor_parcela)}` : `${o.entrada ? `${reais(o.entrada)} + ` : ''}${p}× ${reais(o.valor_parcela)}`) + (o.desconto_pct ? ` · ${String(o.desconto_pct).replace('.', ',')}%` : '');
}

// ------------------------------------------------------------------ o mesmo caminho do executor, para o teste
export interface Cenario { id: string; titulo: string; desc: string; api: { st: 'ok' | 'fora'; ofertas: Oferta[] }; arquivo: Oferta[]; resposta: Resposta }
export type Resposta = 'aceita' | 'recusa1' | 'recusa' | 'pede';
export const RESPOSTAS: Record<Resposta, string> = { aceita: 'Aceita a 1ª oferta', recusa1: 'Recusa a 1ª e aceita a 2ª', recusa: 'Recusa todas', pede: 'Pede outra condição (18 vezes)' };
export interface Linha { o: Oferta; fonte: Fonte; motivo?: Motivo | null; naoUsada?: string }
export interface Avaliacao { usadas: Oferta[] | null; fonte: Fonte | null; linhas: Linha[]; passos: { ok?: boolean; erro?: boolean; texto: string }[]; apiSemOferta: boolean; apiFalhou: boolean }

export function avaliar(c: Cenario, modo: Modo, a: Alcada | null, hoje: string): Avaliacao {
	const ordem = ordemDe(modo);
	const passos: Avaliacao['passos'] = [], linhas: Linha[] = [];
	let usadas: Oferta[] | null = null, fonte: Fonte | null = null, parou = false, falhou = false;
	const consultadas = new Set<Fonte>();
	for (const f of ordem) {
		if (usadas || parou) break;
		consultadas.add(f);
		if (f === 'api') {
			if (c.api.st === 'fora') { falhou = true; passos.push({ erro: true, texto: 'API do credor: não respondeu em 2,5 s, nem na nova tentativa (teto de 4 s). Conta como falha.' }); continue; }
			if (!c.api.ofertas.length) { parou = true; passos.push({ erro: true, texto: 'API do credor: respondeu "sem oferta para este cliente". É decisão do credor: o arquivo não é usado.' }); break; }
		}
		const ofs = f === 'api' ? c.api.ofertas : c.arquivo;
		if (f === 'arquivo' && !ofs.length) { passos.push({ erro: true, texto: 'Arquivo: não trouxe oferta para este cliente.' }); continue; }
		const boas: Oferta[] = [];
		for (const o of ofs) { const m = motivoDescarte(o, a, hoje); linhas.push({ o, fonte: f, motivo: m }); if (!m) boas.push(o); }
		if (boas.length) {
			usadas = boas.slice(0, 3); fonte = f;
			passos.push({ ok: true, texto: `${NOME_FONTE[f]}: ${boas.length} oferta(s) válida(s)${ofs.length > boas.length ? `, ${ofs.length - boas.length} descartada(s)` : ''}. É a fonte desta ligação.` });
		} else passos.push({ erro: true, texto: `${NOME_FONTE[f]}: todas as ${ofs.length} ofertas foram descartadas. Vai para a próxima fonte.` });
	}
	for (const f of ['api', 'arquivo'] as Fonte[]) {
		if (consultadas.has(f)) continue;
		const ofs = f === 'api' ? (c.api.st === 'ok' ? c.api.ofertas : []) : c.arquivo;
		const por = !ordem.includes(f) ? 'fora da ordem configurada' : parou ? 'não usada: a API disse que não há oferta' : 'reserva, não foi preciso';
		for (const o of ofs) linhas.push({ o, fonte: f, naoUsada: por });
	}
	if (!usadas) passos.push({ erro: true, texto: falhou && modo === 'so_api' ? 'Só a API e ela falhou: o agente diz a frase de falha e transfere.' : 'Nenhuma oferta válida: o agente transfere para um atendente.' });
	return { usadas, fonte, linhas, passos, apiSemOferta: parou, apiFalhou: falhou };
}

/** A conversa que o agente teria (as frases fixas do executor). */
export function conversa(r: Avaliacao, resp: Resposta, modo: Modo): { quem: 'agente' | 'cliente' | 'evento'; texto: string; tom?: 'ok' | 'atencao' }[] {
	const out: ReturnType<typeof conversa> = [{ quem: 'evento', texto: 'Identidade confirmada' }, { quem: 'agente', texto: 'Só um instante, vou ver as condições para você.' }];
	const u = r.usadas;
	if (!u) {
		out.push({ quem: 'agente', texto: r.apiFalhou && modo === 'so_api' ? 'Tive um problema aqui. Vou passar você para um atendente, só um instante.' : 'Claro, vou passar você para um atendente agora, só um instante.' });
		out.push({ quem: 'evento', texto: 'Transferido para atendente · sem oferta', tom: 'atencao' });
		return out;
	}
	const fonte = NOME_FONTE[r.fonte as Fonte];
	const fecha = (o: Oferta) => {
		out.push({ quem: 'cliente', texto: 'Pode ser.' });
		out.push({ quem: 'agente', texto: `Combinado: ${condicao(o).replace(/\. Vale até.*$/, '')}. Vou registrar o pagamento para até ${dm(o.vencimento || o.validade)}.` });
		out.push({ quem: 'evento', texto: `Promessa registrada · oferta ${o.id} · ${fonte}`, tom: 'ok' });
	};
	out.push({ quem: 'agente', texto: `Tenho uma condição para você: ${condicao(u[0])}` });
	if (resp === 'aceita') fecha(u[0]);
	else if (resp === 'pede') {
		out.push({ quem: 'cliente', texto: 'Só consigo em 18 vezes.' });
		out.push({ quem: 'agente', texto: 'Essa condição eu não tenho aqui. Vou passar você para um atendente, só um instante.' });
		out.push({ quem: 'evento', texto: 'Transferido para atendente · pediu condição fora das ofertas', tom: 'atencao' });
	} else {
		out.push({ quem: 'cliente', texto: 'Não consigo esse valor agora.' });
		if (resp === 'recusa1' && u.length > 1) { out.push({ quem: 'agente', texto: `Entendo. Também tenho: ${condicao(u[1])}` }); fecha(u[1]); }
		else {
			for (let i = 1; i < u.length; i++) { out.push({ quem: 'agente', texto: `Entendo. Também tenho: ${condicao(u[i])}` }); out.push({ quem: 'cliente', texto: 'Também não.' }); }
			out.push({ quem: 'evento', texto: 'Sem acordo · saída "recusou" do roteiro' });
		}
	}
	return out;
}

// cenários fictícios (as situações do protótipo aprovado); as datas são relativas a "hoje"
export function cenarios(hoje: string): Cenario[] {
	const d = (n: number) => { const x = new Date(`${hoje}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
	const O = (id: string, parcelas: number, valor_parcela: number, desconto_pct: number | undefined, validade: string, valor_total?: number, entrada?: number): Oferta =>
		({ id, parcelas, valor_parcela, ...(desconto_pct != null ? { desconto_pct } : {}), validade, ...(valor_total != null ? { valor_total } : {}), ...(entrada != null ? { entrada } : {}) });
	const A1 = O('A-7781', 1, 1200, 40, d(8), 1200), A2 = O('A-7782', 6, 260, 22, d(8), 1560), A3 = O('A-7783', 10, 180, 10, d(8), 1800);
	const AV = O('A-7790', 1, 1240, 38, d(-2), 1240), AX1 = O('A-7795', 1, 900, 55, d(8), 900), AX2 = O('A-7796', 24, 75, 10, d(8), 1800);
	const ARQ = [O('arq-1', 1, 1300, 35, d(6), 1300), O('arq-2', 4, 400, 20, d(6), 1600), O('arq-3', 8, 212.5, 5, d(6), 1900, 200)];
	return [
		{ id: 'normal', titulo: 'API respondeu', desc: 'A API manda 3 ofertas; o arquivo fica de reserva.', api: { st: 'ok', ofertas: [A1, A2, A3] }, arquivo: ARQ, resposta: 'recusa1' },
		{ id: 'fora', titulo: 'API fora → arquivo', desc: 'A API não responde a tempo; o agente usa o arquivo.', api: { st: 'fora', ofertas: [] }, arquivo: ARQ, resposta: 'aceita' },
		{ id: 'vencida', titulo: 'Oferta vencida', desc: 'A 1ª oferta da API venceu e não entra.', api: { st: 'ok', ofertas: [AV, A2, A3] }, arquivo: ARQ, resposta: 'aceita' },
		{ id: 'acima', titulo: 'Acima da alçada → arquivo', desc: 'As ofertas da API passam do teto e são descartadas; vale o arquivo.', api: { st: 'ok', ofertas: [AX1, AX2] }, arquivo: ARQ, resposta: 'aceita' },
		{ id: 'vazia', titulo: 'API: sem oferta', desc: 'A API responde que não há oferta para o cliente.', api: { st: 'ok', ofertas: [] }, arquivo: ARQ, resposta: 'aceita' },
		{ id: 'nenhuma', titulo: 'Nenhuma oferta → transferir', desc: 'API fora e o arquivo sem oferta para o cliente.', api: { st: 'fora', ofertas: [] }, arquivo: [], resposta: 'aceita' },
		{ id: 'pede', titulo: 'Pede outra condição', desc: 'O cliente pede 18 vezes, que não está na lista.', api: { st: 'ok', ofertas: [A1, A2, A3] }, arquivo: ARQ, resposta: 'pede' },
	];
}
/** Alçada de exemplo do teste quando a carteira não tem uma (o teste nunca usa dado real). */
export const ALCADA_EXEMPLO: Alcada = { desconto_max_pct: 40, parcelas_max: 12, parcela_min: 50, entrada_min: 0 };

// ------------------------------------------------------------------ o painel (painel_ofertas_voz, SQL 132)
export interface PainelOfertas {
	config: { id: number; credor_id: number | null; ofertas: ConfigOfertas; vigente_desde: string } | null;
	rascunho: { ofertas: ConfigOfertas; salvo_em: string } | null;
	api: {
		conector_id: number; nome: string; situacao: string; host: string; timeout_ms: number; tentativas: number; em_falha: string;
		mapeia_validade: boolean; estado: 'sem_dados' | 'no_ar' | 'instavel' | 'fora';
		chamadas: number; ok_pct: number | null; media_ms: number | null; p95_ms: number | null; falhas_tempo: number; falhas_erro: number;
	} | null;
	uso: { ligacoes: number; api: number; arquivo: number; nenhuma: number; reserva: number; api_pulada: number; descartes: Record<Motivo, number> } | null;
	carga: { em: string; relatorio: { clientes_na_carga?: number; clientes_com_oferta?: number; ofertas?: number; varios_contratos?: number; descartadas?: Partial<Record<'incompleta' | 'vencida' | 'conta', number>> } | null } | null;
	alcada: (Alcada & { credor_id: number | null }) | null;
	pode: { ativar: boolean; rascunho: boolean };
}
export const ESTADO_API: Record<string, { texto: string; tom: 'ok' | 'atencao' | 'erro' | 'neutro' }> = {
	no_ar: { texto: 'No ar', tom: 'ok' }, instavel: { texto: 'Instável', tom: 'atencao' }, fora: { texto: 'Fora do ar', tom: 'erro' },
	sem_dados: { texto: 'Sem chamadas em 24 h', tom: 'neutro' }, nao_configurada: { texto: 'Não configurada', tom: 'neutro' },
};
/** As colunas que o arquivo pode trazer, por oferta (o mesmo contrato da API). */
export const CAMPOS_ARQUIVO: { campo: string; nome: string; obrig?: boolean }[] = [
	{ campo: 'parcelas', nome: 'Parcelas', obrig: true }, { campo: 'valor_parcela', nome: 'Valor da parcela', obrig: true },
	{ campo: 'desconto', nome: 'Desconto (%)' }, { campo: 'entrada', nome: 'Entrada' }, { campo: 'validade', nome: 'Validade', obrig: true },
	{ campo: 'valor_total', nome: 'Valor total' }, { campo: 'id', nome: 'Código da oferta' }, { campo: 'vencimento', nome: '1º vencimento' },
];
