import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import {
	FASES_ORDEM, FASE_DEFAULT_LABEL, FASE_ESTADO, faseLabel, gerarIdEtapa, isFaseId, ordemStages, validarEtapas,
	type CondicaoEtapa, type ContandoJanela, type Definicao, type DestinoSaida, type Etapa, type FaseId, type SaidasEtapa,
} from '@/lib/estrategia';
import type { Coluna } from '@/components/clusters/cluster-form';
import { numberBR } from '@/lib/supabase';
import { isFaixa, type LinhaPropensaoCarteira } from '@/lib/propensao';
import { Info } from '@/components/glossario/info';

// ---- Campos e operadores de condição (mesmo padrão dos Segmentos) ----
const CALCULADOS: Coluna[] = [
	{ nome: 'saldo', tipo: 'numero' }, { nome: 'dias_atraso', tipo: 'numero' }, { nome: 'qtd_contratos', tipo: 'numero' },
	{ nome: 'idade', tipo: 'numero' }, { nome: 'qtd_telefones', tipo: 'numero' },
	{ nome: 'tem_email', tipo: 'texto' }, { nome: 'tem_celular', tipo: 'texto' }, { nome: 'so_fixo', tipo: 'texto' },
];
const calculadoLabel: Record<string, string> = {
	saldo: 'Saldo total', dias_atraso: 'Dias de atraso', qtd_contratos: 'Quantidade de contratos',
	idade: 'Idade (anos)', qtd_telefones: 'Qtd. de telefones', tem_email: 'Tem e-mail', tem_celular: 'Tem celular', so_fixo: 'Só fixo',
};
const OPS = [
	{ id: '=', label: 'é igual a', num: true, txt: true },
	{ id: '!=', label: 'é diferente de', num: true, txt: true },
	{ id: '>', label: 'maior que', num: true, txt: false },
	{ id: '>=', label: 'maior ou igual', num: true, txt: false },
	{ id: '<', label: 'menor que', num: true, txt: false },
	{ id: '<=', label: 'menor ou igual', num: true, txt: false },
	{ id: 'em', label: 'está entre', num: true, txt: true },
	{ id: 'nao_em', label: 'não está entre', num: true, txt: true },
	{ id: 'contem', label: 'contém', num: false, txt: true },
	{ id: 'vazio', label: 'está vazio', num: true, txt: true },
	{ id: 'preenchido', label: 'está preenchido', num: true, txt: true },
];
function fieldTipo(campo: string, colunas: Coluna[]): 'numero' | 'texto' {
	if (campo === 'fase' || campo === 'propensao') return 'texto';
	const all = [...CALCULADOS, ...colunas];
	return all.find(c => c.nome === campo)?.tipo ?? 'texto';
}
function opsFor(tipo: 'numero' | 'texto') {
	return OPS.filter(o => (tipo === 'numero' ? o.num : o.txt));
}

const FAIXAS_PROP = ['A', 'B', 'C', 'D', 'E'] as const;
function faixaPropStyle(letra: string): { backgroundColor: string; color: string } {
	const k = letra.toUpperCase();
	return { backgroundColor: `var(--prop-${k}-bg)`, color: `var(--prop-${k}-text)` };
}

const FASES_SELECT: { id: FaseId; label: string }[] = FASES_ORDEM.map(id => ({ id, label: FASE_DEFAULT_LABEL[id] }));

// ---- Helpers de estágio ----
function faseAtivo(def: Definicao, fase: FaseId): boolean {
	return def[fase]?.ativo !== false;
}
function faseTemConteudo(def: Definicao, fase: FaseId): boolean {
	const o = def[fase] as Record<string, unknown> | undefined;
	if (!o) return false;
	if (fase === 'cpc') return !!((o.ordem as unknown[] | undefined)?.length || (o.junto as unknown[] | undefined)?.length);
	return !!(o.passos && Object.keys(o.passos as object).length);
}
/** Rótulo de "sem régua"/"sem canais" para uma fase ativa (ou null). */
function faseSemReguaInfo(def: Definicao, fase: FaseId): string | null {
	if (!faseAtivo(def, fase)) return null;
	if (fase === 'cpc') {
		const semCanais = !(def.cpc?.ordem?.some(a => a.canal) ?? false);
		return semCanais ? '· sem canais: segue a ordem padrão do motor' : null;
	}
	return faseTemConteudo(def, fase) ? null : '· sem régua';
}
function toggleFase(def: Definicao, fase: FaseId, on: boolean): Definicao {
	if (on) {
		const o = def[fase] ?? {};
		const isCpc = fase === 'cpc';
		const temConteudo = faseTemConteudo(def, fase);
		// Ligar uma fase sem régua: grava {"ativo": true} mantendo o que existe e,
		// para as fases com passos, também "passos": {} (nunca apaga a chave).
		// Deu CPC sem canais: só grava ativo true (segue a ordem padrão do motor).
		const base = isCpc || temConteudo ? { ...o, ativo: true } : { ...o, ativo: true, passos: (o as Record<string, unknown>).passos ?? {} };
		return { ...def, [fase]: base };
	}
	const o = def[fase] ?? {};
	return { ...def, [fase]: { ...o, ativo: false } };
}

function etapaPorId(def: Definicao, id: string): Etapa | undefined {
	return (def.etapas ?? []).find(e => e.id === id);
}
function updateEtapa(def: Definicao, id: string, patch: Partial<Etapa>): Definicao {
	return { ...def, etapas: (def.etapas ?? []).map(e => e.id === id ? { ...e, ...patch } : e) };
}
function setOrdem(def: Definicao, ordem: string[]): Definicao {
	return { ...def, ordem_etapas: ordem };
}

/** Prévia "≈ N clientes hoje" de uma fase. */
function previewFase(fase: FaseId, contagem: Record<string, number>): string {
	const total = FASE_ESTADO[fase].reduce((s, e) => s + (contagem[e] ?? 0), 0);
	return `≈ ${numberBR(total)} clientes hoje`;
}
/** Prévia de uma etapa: só quando todas as condições são de Situação do cliente (= ou em). */
function previewEtapa(etapa: Etapa, contagem: Record<string, number>, propensaoSegRows?: LinhaPropensaoCarteira[] | null, coletando?: boolean, propensaoError?: string): string {
	if (!etapa.condicoes.length) return 'prévia na próxima lista';
	const todasPropensao = etapa.condicoes.every(c => c.campo === 'propensao' && c.op === 'em');
	if (todasPropensao) {
		if (propensaoError) return 'prévia indisponível (erro ao ler a propensão)';
		if (coletando) return '≈ 0 clientes hoje (Coletando)';
		if (!propensaoSegRows) return 'prévia na próxima lista';
		const faixas = new Set<string>();
		for (const c of etapa.condicoes) {
			const vals = Array.isArray(c.valor) ? c.valor : (c.valor ? [c.valor] : []);
			for (const v of vals) if (typeof v === 'string') faixas.add(v);
		}
		const total = propensaoSegRows.filter(r => isFaixa(r.faixa_propensao) && faixas.has(r.faixa_propensao)).reduce((s, r) => s + (Number(r.clientes) || 0), 0);
		return `≈ ${numberBR(total)} clientes hoje`;
	}
	const todasFase = etapa.condicoes.every(c => c.campo === 'fase' && (c.op === '=' || c.op === 'em'));
	if (!todasFase) return 'prévia na próxima lista';
	const estados = new Set<string>();
	for (const c of etapa.condicoes) {
		const vals = Array.isArray(c.valor) ? c.valor : [c.valor];
		for (const v of vals) if (isFaseId(v as string)) FASE_ESTADO[v as FaseId].forEach(e => estados.add(e));
	}
	const total = [...estados].reduce((s, e) => s + (contagem[e] ?? 0), 0);
	return `≈ ${numberBR(total)} clientes hoje`;
}

/** Aviso "nunca recebe ninguém" quando a etapa está abaixo da fase que ela condição. */
function avisoNuncaRecebe(etapa: Etapa, ordem: string[], def: Definicao): string | null {
	for (const c of etapa.condicoes) {
		if (c.campo !== 'fase') continue;
		const vals = Array.isArray(c.valor) ? c.valor : [c.valor];
		for (const v of vals) {
			if (!isFaseId(v as string)) continue;
			const posEtapa = ordem.indexOf(etapa.id);
			const posFase = ordem.indexOf(v as string);
			if (posEtapa > posFase && posFase >= 0) {
				return `Este estágio nunca recebe ninguém: suba-o acima de ${faseLabel(def, v as FaseId)}.`;
			}
		}
	}
	return null;
}

/** Etapa sem régua (sem passos ou vazia). */
function etapaSemRegua(etapa: Etapa): boolean {
	const p = etapa.passos;
	if (!p) return true;
	return !Object.values(p).some(arr => arr && arr.length > 0);
}

/** Fases desligadas que nenhuma etapa acima delas pega. */
function fasesDescobertas(def: Definicao, ordem: string[]): FaseId[] {
	const descobertas: FaseId[] = [];
	for (const fase of FASES_ORDEM) {
		if (faseAtivo(def, fase)) continue;
		const posFase = ordem.indexOf(fase);
		let pega = false;
		for (const e of def.etapas ?? []) {
			if (!e.ativo) continue;
			const posEtapa = ordem.indexOf(e.id);
			if (posEtapa > posFase) continue; // abaixo não pega
			for (const c of e.condicoes) {
				if (c.campo !== 'fase') continue;
				const vals = Array.isArray(c.valor) ? c.valor : [c.valor];
				if (vals.includes(fase)) { pega = true; break; }
			}
			if (pega) break;
		}
		if (!pega) descobertas.push(fase);
	}
	return descobertas;
}

// Botões A–E da condição de propensão (fato).
function PropensaoBotoes({ cond, canEdit, coletando, erro, upd, i }: {
	cond: CondicaoEtapa; canEdit: boolean; coletando: boolean; erro?: string; upd: (i: number, patch: Partial<CondicaoEtapa>) => void; i: number;
}) {
	const arr = Array.isArray(cond.valor) ? cond.valor as string[] : (cond.valor ? [cond.valor as string] : []);
	return (
		<div className="flex min-w-[180px] flex-1 flex-wrap items-center gap-1.5">
			{FAIXAS_PROP.map(f => {
				const on = arr.includes(f);
				return (
					<button key={f} type="button" disabled={!canEdit} onClick={() => {
						const next = on ? arr.filter(x => x !== f) : [...arr, f];
						upd(i, { valor: next });
					}} className={`grid h-7 w-7 place-items-center rounded text-[12px] font-bold transition ${on ? 'ring-2 ring-offset-1 ring-[var(--base-texto-3)]' : 'opacity-50'}`} style={faixaPropStyle(f)}>{f}</button>
				);
			})}
			{erro
				? <span className="ml-1 rounded-full bg-[var(--estado-erro-fundo)] px-2 py-0.5 text-[10px] font-bold text-[var(--estado-erro-texto)]">Indisponível</span>
				: coletando && <span className="ml-1 rounded-full bg-[var(--estado-atencao-fundo)] px-2 py-0.5 text-[10px] font-bold text-[var(--estado-atencao-texto)]">Coletando</span>}
		</div>
	);
}

// ===================== Editor de condições =====================
function CondicoesEditor({ condicoes, onChange, colunas, canEdit, propensaoColetando, propensaoError }: {
	condicoes: CondicaoEtapa[]; onChange: (c: CondicaoEtapa[]) => void; colunas: Coluna[]; canEdit: boolean; propensaoColetando: boolean; propensaoError?: string;
}) {
	const semColunas = colunas.length === 0;
	const temPropensao = condicoes.some(c => c.campo === 'propensao');
	function add() { onChange([...condicoes, { campo: 'fase', op: '=', valor: 'localizacao' }]); }
	function upd(i: number, patch: Partial<CondicaoEtapa>) { onChange(condicoes.map((c, idx) => idx === i ? { ...c, ...patch } : c)); }
	function del(i: number) { onChange(condicoes.filter((_, idx) => idx !== i)); }

	return (
		<div>
			<div className="mb-2 flex items-center justify-between">
				<label className="text-xs font-semibold text-[var(--base-texto-2)]">Quem entra (todas precisam bater)</label>
				{canEdit && <button type="button" onClick={add} className="flex items-center gap-1 text-xs font-bold text-[var(--destaque)] hover:underline"><Plus size={14} /> condição</button>}
			</div>
			{condicoes.length === 0 && <p className="text-xs text-[var(--base-texto-3)]">Nenhuma condição — o motor ignora a etapa.</p>}
			<div className="space-y-2">
				{condicoes.map((c, i) => {
					const tipo = fieldTipo(c.campo, colunas);
					const opsList = opsFor(tipo);
					const noValor = c.op === 'vazio' || c.op === 'preenchido';
					const isLista = c.op === 'em' || c.op === 'nao_em';
					const isFase = c.campo === 'fase';
					const isPropensao = c.campo === 'propensao';
					return (
						<div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] p-2">
							{semColunas ? (
								<input value={c.campo} disabled={!canEdit} onChange={e => upd(i, { campo: e.target.value })} placeholder="Nome da coluna" className="h-9 w-[150px] rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60" />
							) : (
								<select value={c.campo} disabled={!canEdit} onChange={e => { const v = e.target.value; if (v === 'fase') upd(i, { campo: v, op: '=', valor: 'localizacao' }); else if (v === 'propensao') upd(i, { campo: v, op: 'em', valor: [] }); else upd(i, { campo: v, valor: '' }); }} className="h-9 w-[180px] rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60">
									<optgroup label="Fatos do MotorCX">
										<option value="fase">Situação do cliente</option>
										<option value="propensao">Propensão a pagamento (fato)</option>
										<option value="__abordagem" disabled>Abordagem da persona (fato)</option>
									</optgroup>
									<optgroup label="Calculados">{CALCULADOS.map(co => <option key={co.nome} value={co.nome}>{calculadoLabel[co.nome]}</option>)}</optgroup>
									{colunas.length > 0 && <optgroup label="Colunas da base">{colunas.map(co => <option key={co.nome} value={co.nome}>{co.nome}</option>)}</optgroup>}
								</select>
							)}
							<select value={isPropensao ? 'em' : c.op} disabled={!canEdit || isPropensao} onChange={e => upd(i, { op: e.target.value })} className="h-9 w-[150px] rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60">
								{opsList.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
							</select>
							{!noValor && (
								isPropensao ? (
									<PropensaoBotoes cond={c} canEdit={canEdit} coletando={propensaoColetando} erro={propensaoError} upd={upd} i={i} />
								) : isFase && isLista ? (
									<div className="flex min-w-[180px] flex-1 flex-wrap gap-1.5">
										{FASES_SELECT.map(f => {
											const arr = Array.isArray(c.valor) ? c.valor as string[] : (c.valor ? [c.valor as string] : []);
											const on = arr.includes(f.id);
											return (
												<label key={f.id} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${on ? 'border-[var(--area)] bg-[var(--area)] text-[var(--area-ativo-texto)]' : 'border-[var(--base-borda)] text-[var(--base-texto-2)]'}`}>
													<input type="checkbox" checked={on} disabled={!canEdit} onChange={() => {
														const next = on ? arr.filter(x => x !== f.id) : [...arr, f.id];
														upd(i, { valor: next });
													}} className="accent-[var(--area)]" /> {f.label}
												</label>
											);
										})}
									</div>
								) : isFase ? (
									<select value={Array.isArray(c.valor) ? (c.valor[0] as string ?? '') : (c.valor as string ?? '')} disabled={!canEdit} onChange={e => upd(i, { valor: e.target.value })} className="h-9 min-w-[180px] flex-1 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60">
										{FASES_SELECT.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
									</select>
								) : isLista ? (
									<input value={Array.isArray(c.valor) ? c.valor.join(', ') : String(c.valor ?? '')} disabled={!canEdit} onChange={e => upd(i, { valor: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="valores separados por vírgula" className="h-9 min-w-[180px] flex-1 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60" />
								) : (
									<input value={Array.isArray(c.valor) ? c.valor.join(', ') : String(c.valor ?? '')} disabled={!canEdit} onChange={e => upd(i, { valor: e.target.value })} placeholder="valor" className="h-9 min-w-[120px] flex-1 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60" />
								)
							)}
							{canEdit && <button type="button" onClick={() => del(i)} aria-label="Remover condição" className="grid h-9 w-9 place-items-center rounded text-[var(--base-texto-3)] hover:bg-[var(--estado-erro-fundo)] hover:text-[var(--estado-erro)]"><Trash2 size={15} /></button>}
						</div>
					);
				})}
			</div>
			<p className="mt-2 rounded bg-[var(--base-fill)] px-3 py-2 text-[11px] leading-relaxed text-[var(--base-texto-2)]">Situação do cliente é um fato que o MotorCX calcula pelos retornos e acordos. Você usa como condição; não edita.</p>
			{temPropensao && (
				<div className="mt-2 rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] px-3 py-2 text-[11px] leading-relaxed text-[var(--base-texto-2)]">
					<p><Info slug="propensao-a-pagamento" /> Propensão a pagamento: chance de pagar em 30 dias. Pagamento = quitação ou 1ª parcela paga; acordo é promessa. Faixas A (muito alta) a E (muito baixa), com cortes refeitos aos domingos.</p>
					<p className="mt-1">Quem está em Acordo em dia, em acordo (COL), liquidado ou bloqueado não tem faixa e não entra por esta condição.</p>
					{propensaoError
				? <p className="mt-2 rounded bg-[var(--estado-erro-fundo)] px-2 py-1.5 text-[11px] font-medium text-[var(--estado-erro-texto)]">Não foi possível ler a propensão desta carteira. A prévia fica indisponível; o estágio é salvo e passa a valer quando a leitura voltar.</p>
				: propensaoColetando && <p className="mt-2 rounded bg-[var(--estado-atencao-fundo)] px-2 py-1.5 text-[11px] font-medium text-[var(--estado-atencao-texto)]">Esta carteira ainda não tem faixas (poucos pagamentos para calcular). O estágio fica salvo, mas só recebe clientes quando houver faixa.</p>}
				</div>
			)}
			<div className="mt-2 flex flex-wrap gap-2">
				<span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--base-borda)] bg-[var(--base-fill)] px-2.5 py-1 text-[10px] font-semibold text-[var(--base-texto-3)]">Abordagem da persona (fato) <span className="rounded-full bg-[var(--estado-atencao-fundo)] px-1.5 py-0.5 text-[var(--estado-atencao-texto)]">Coletando · em breve</span></span>
			</div>
		</div>
	);
}

// ===================== Editor de referência/prazo =====================
function ReferenciaEditor({ etapa, colunas, canEdit, onChange }: {
	etapa: Etapa; colunas: Coluna[]; canEdit: boolean; onChange: (patch: Partial<Etapa>) => void;
}) {
	const referencia: ContandoJanela = etapa.referencia ?? { tipo: 'entrada' };
	const de = etapa.de ?? 1;
	const ate = etapa.ate ?? 30;
	const temCiclo = !!etapa.ciclo;
	const ciclo = etapa.ciclo ?? { dias: 8, vezes: 3 };
	function setRef(tipo: ContandoJanela['tipo']) {
		onChange({ referencia: tipo === 'coluna' ? { tipo: 'coluna', coluna: referencia.coluna } : { tipo } });
	}
	return (
		<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] p-4">
			<p className="mb-3 text-xs font-bold text-[var(--base-texto)]">Por quanto tempo</p>
			<div className="flex flex-wrap items-center gap-2">
				<label className="flex items-center gap-1 text-[11px] text-[var(--base-texto-2)]">de
					<input type="number" value={de} disabled={!canEdit} onChange={e => onChange({ de: Number(e.target.value) })} className="h-9 w-16 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-center text-xs outline-none focus:border-[var(--area)] disabled:opacity-60" />
				</label>
				<label className="flex items-center gap-1 text-[11px] text-[var(--base-texto-2)]">até
					<input type="number" value={ate} disabled={!canEdit} onChange={e => onChange({ ate: Number(e.target.value) })} className="h-9 w-16 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-center text-xs outline-none focus:border-[var(--area)] disabled:opacity-60" />
				</label>
				<span className="text-[11px] text-[var(--base-texto-3)]">dias</span>
				<label className="ml-2 flex items-center gap-1 text-[11px] text-[var(--base-texto-2)]">contando
					<select value={referencia.tipo} disabled={!canEdit} onChange={e => setRef(e.target.value as ContandoJanela['tipo'])} className="h-9 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60">
						<option value="entrada">da entrada neste estágio</option>
						<option value="atraso">dos dias de atraso</option>
						<option value="vencimento">do vencimento da parcela</option>
						<option value="coluna">de uma data da carga</option>
					</select>
				</label>
				{referencia.tipo === 'coluna' && (
					colunas.length === 0 ? (
						<input value={referencia.coluna ?? ''} disabled={!canEdit} onChange={e => onChange({ referencia: { tipo: 'coluna', coluna: e.target.value } })} placeholder="Nome da coluna da data na carga" className="h-9 min-w-[180px] flex-1 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60" />
					) : (
						<select value={referencia.coluna ?? ''} disabled={!canEdit} onChange={e => onChange({ referencia: { tipo: 'coluna', coluna: e.target.value } })} className="h-9 max-w-[160px] rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60">
							<option value="">escolha a coluna</option>
							{colunas.map(c => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
						</select>
					)
				)}
			</div>
			{de > ate && <p className="mt-2 text-[11px] font-semibold text-[var(--estado-erro-texto)]">“de” precisa ser menor ou igual a “até”.</p>}
			{ate - de > 730 && <p className="mt-2 text-[11px] font-semibold text-[var(--estado-erro-texto)]">A janela pode ter no máximo 730 dias.</p>}
			<label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-[var(--base-texto-2)]">
				<input type="checkbox" checked={temCiclo} disabled={!canEdit} onChange={e => { if (e.target.checked) onChange({ ciclo: etapa.ciclo ?? { dias: 8, vezes: 3 } }); else onChange({ ciclo: undefined }); }} className="accent-[var(--area)]" />
				Repetir a régua a cada N dias
			</label>
			{temCiclo && (
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<label className="flex items-center gap-1 text-[11px] text-[var(--base-texto-2)]">a cada
						<input type="number" min={2} max={60} value={ciclo.dias} disabled={!canEdit} onChange={e => onChange({ ciclo: { ...ciclo, dias: Number(e.target.value) } })} className="h-9 w-16 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-center text-xs outline-none focus:border-[var(--area)] disabled:opacity-60" />
						dias
					</label>
					<label className="flex items-center gap-1 text-[11px] text-[var(--base-texto-2)]">·
						<input type="number" min={1} max={24} value={ciclo.vezes} disabled={!canEdit} onChange={e => onChange({ ciclo: { ...ciclo, vezes: Number(e.target.value) } })} className="h-9 w-16 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-center text-xs outline-none focus:border-[var(--area)] disabled:opacity-60" />
						vezes
					</label>
				</div>
			)}
		</div>
	);
}

// ===================== Editor de saídas =====================
const EVENTOS_SAIDA: { id: keyof SaidasEtapa; label: string; permiteFica: boolean }[] = [
	{ id: 'cpc', label: 'Quando der CPC', permiteFica: true },
	{ id: 'acordo', label: 'Quando fechar acordo', permiteFica: true },
	{ id: 'pagamento', label: 'Quando pagar', permiteFica: true },
	{ id: 'fim_janela', label: 'No fim do prazo', permiteFica: false },
];
function destinoLabel(d: DestinoSaida | undefined, etapas: Etapa[]): string {
	if (!d) return '—';
	if (d === 'fica') return 'Fica neste estágio';
	if (d === 'sai') return 'Sai da régua';
	if (d === 'padrao') return 'Volta ao geral';
	if (d.startsWith('etapa:')) {
		const id = d.slice(6);
		const e = etapas.find(x => x.id === id);
		return e ? `Vai para “${e.nome}”` : '—';
	}
	return '—';
}
function SaidasEditor({ saidas, etapas, etapaId, onChange, canEdit }: {
	saidas: SaidasEtapa | undefined; etapas: Etapa[]; etapaId: string; onChange: (s: SaidasEtapa | undefined) => void; canEdit: boolean;
}) {
	const s = saidas ?? {};
	function set(ev: keyof SaidasEtapa, val: DestinoSaida | '') {
		const next = { ...s };
		if (val === '') delete next[ev]; else next[ev] = val as DestinoSaida;
		onChange(Object.keys(next).length ? next : undefined);
	}
	const outras = etapas.filter(e => e.id !== etapaId);
	return (
		<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] p-4">
			<p className="mb-3 text-xs font-bold text-[var(--base-texto)]">Quando sair</p>
			<div className="space-y-2">
				{EVENTOS_SAIDA.map(ev => (
					<div key={ev.id} className="flex flex-wrap items-center gap-2">
						<span className="w-44 shrink-0 text-[11px] font-medium text-[var(--base-texto-2)]">{ev.label}</span>
						<select value={(s[ev.id] as string) ?? ''} disabled={!canEdit} onChange={e => set(ev.id, e.target.value as DestinoSaida)} className="h-9 flex-1 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)] disabled:opacity-60">
							<option value="">—</option>
							{ev.permiteFica && <option value="fica">Fica neste estágio</option>}
							<option value="sai">Sai da régua</option>
							<option value="padrao">Volta ao geral</option>
							{outras.map(e => <option key={e.id} value={`etapa:${e.id}`}>Vai para “{e.nome}”</option>)}
						</select>
					</div>
				))}
			</div>
			<p className="mt-2 text-[11px] text-[var(--base-texto-3)]">Volta ao geral = o 1º estágio em que o cliente se encaixar; se não houver nenhum, ele fica sem ação.</p>
		</div>
	);
}

// ===================== Componente principal =====================
export function EstagiosEditor({ def, setDef, canEdit, colunas, semEstagio, contagemEstado, onMontarRegua, propensaoSegRows, propensaoColetando, propensaoError }: {
	def: Definicao;
	setDef: (d: Definicao) => void;
	canEdit: boolean;
	colunas: Coluna[];
	semEstagio: number;
	contagemEstado: Record<string, number>;
	onMontarRegua: (stageId: string) => void;
	propensaoSegRows?: LinhaPropensaoCarteira[] | null;
	propensaoColetando?: boolean;
	propensaoError?: string;
}) {
	const ordem = useMemo(() => ordemStages(def), [def]);
	const [selId, setSelId] = useState<string | null>(ordem[0] ?? null);
	const [dragId, setDragId] = useState<string | null>(null);
	const [overId, setOverId] = useState<string | null>(null);

	const etapas = def.etapas ?? [];
	const descobertas = useMemo(() => fasesDescobertas(def, ordem), [def, ordem]);

	// garante seleção válida
	const selValido = selId && ordem.includes(selId);
	const current = selValido ? selId : (ordem[0] ?? null);

	function mover(id: string, dir: -1 | 1) {
		const idx = ordem.indexOf(id);
		const j = idx + dir;
		if (j < 0 || j >= ordem.length) return;
		const next = [...ordem];
		[next[idx], next[j]] = [next[j], next[idx]];
		setDef(setOrdem(def, next));
	}
	function onDrop(targetId: string) {
		if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
		const from = ordem.indexOf(dragId);
		const to = ordem.indexOf(targetId);
		if (from < 0 || to < 0) { setDragId(null); setOverId(null); return; }
		const next = [...ordem];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		setDef(setOrdem(def, next));
		setDragId(null); setOverId(null);
	}
	function toggle(id: string, on: boolean) {
		if (isFaseId(id)) setDef(toggleFase(def, id, on));
		else {
			const e = etapaPorId(def, id);
			if (e) setDef(updateEtapa(def, id, { ativo: on }));
		}
	}
	function addEtapa() {
		const existentes = etapas.map(e => e.id);
		const id = gerarIdEtapa('Novo estágio', existentes);
		const nova: Etapa = { id, nome: 'Novo estágio', ativo: true, condicoes: [{ campo: 'fase', op: '=', valor: 'localizacao' }], referencia: { tipo: 'entrada' }, de: 1, ate: 30 };
		// insere antes da 1ª fase (etapas primeiro)
		const firstFaseIdx = ordem.findIndex(o => isFaseId(o));
		const nextOrdem = firstFaseIdx >= 0 ? [...ordem.slice(0, firstFaseIdx), id, ...ordem.slice(firstFaseIdx)] : [...ordem, id];
		setDef({ ...def, etapas: [...etapas, nova], ordem_etapas: nextOrdem });
		setSelId(id);
	}
	function apagarEtapa(id: string) {
		if (!window.confirm('Apagar este estágio? As saídas que apontavam para ele voltam ao geral.')) return;
		const nextEtapas = etapas.filter(e => e.id !== id);
		// limpa saídas que apontavam para ele
		const limpas = nextEtapas.map(e => {
			if (!e.saidas) return e;
			const s = { ...e.saidas };
			for (const k of Object.keys(s)) if ((s[k as keyof SaidasEtapa] as string) === `etapa:${id}`) delete s[k as keyof SaidasEtapa];
			return { ...e, saidas: Object.keys(s).length ? s : undefined };
		});
		const nextOrdem = ordem.filter(o => o !== id);
		setDef({ ...def, etapas: limpas, ordem_etapas: nextOrdem });
		setSelId(ordem.find(o => o !== id) ?? null);
		toast.success('Estágio apagado.');
	}
	function criarParaSemEstagio() {
		const desligadas = FASES_ORDEM.filter(f => !faseAtivo(def, f));
		if (desligadas.length === 0) { toast('Todas as fases estão ligadas — não há clientes sem estágio para capturar.'); return; }
		const id = gerarIdEtapa('Todos os outros', etapas.map(e => e.id));
		const nova: Etapa = { id, nome: 'Todos os outros', ativo: true, condicoes: [{ campo: 'fase', op: 'em', valor: desligadas }], referencia: { tipo: 'entrada' }, de: 1, ate: 30 };
		// acima da 1ª fase desligada
		const firstDesligadaIdx = Math.min(...desligadas.map(f => ordem.indexOf(f)));
		const nextOrdem = [...ordem.slice(0, firstDesligadaIdx), id, ...ordem.slice(firstDesligadaIdx)];
		setDef({ ...def, etapas: [...etapas, nova], ordem_etapas: nextOrdem });
		setSelId(id);
		onMontarRegua(id);
	}

	const selEtapa = current && !isFaseId(current) ? etapaPorId(def, current) : undefined;
	const selFase = current && isFaseId(current) ? current : undefined;

	return (
		<div className="grid gap-4 lg:grid-cols-[340px_1fr]">
			{/* ===== Coluna da esquerda: lista ===== */}
			<div>
				<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-3">
					<div className="mb-2 flex items-center justify-between">
						<p className="text-[13px] font-bold text-[var(--base-texto)]">Estágios</p>
						{canEdit && <button type="button" onClick={addEtapa} className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--base-borda)] px-2.5 text-[11px] font-semibold text-[var(--base-texto)] hover:bg-[var(--base-fill)]"><Plus size={13} /> Estágio</button>}
					</div>
					<p className="mb-3 text-[11px] leading-relaxed text-[var(--base-texto-3)]">O cliente fica no 1º estágio em que se encaixa. Arraste para mudar.</p>
					<div className="space-y-1.5">
						{ordem.map((id, idx) => {
							const isF = isFaseId(id);
							const etapa = !isF ? etapaPorId(def, id) : undefined;
							const fase = isF ? (id as FaseId) : undefined;
							const nome = isF ? faseLabel(def, fase!) : (etapa?.nome ?? id);
							const ativo = isF ? faseAtivo(def, fase!) : (etapa?.ativo ?? true);
							const preview = isF ? previewFase(fase!, contagemEstado) : previewEtapa(etapa!, contagemEstado, propensaoSegRows, propensaoColetando, propensaoError);
							const aviso = !isF && etapa ? avisoNuncaRecebe(etapa, ordem, def) : null;
							const semRegua = !isF && etapa ? etapaSemRegua(etapa) : false;
							const isSel = current === id;
							const isDrag = dragId === id;
							const isOver = overId === id;
							return (
								<div
									key={id}
									draggable={canEdit}
									onDragStart={() => setDragId(id)}
									onDragOver={e => { e.preventDefault(); setOverId(id); }}
									onDragLeave={() => setOverId(null)}
									onDrop={() => onDrop(id)}
									onDragEnd={() => { setDragId(null); setOverId(null); }}
									onClick={() => setSelId(id)}
									className={`group flex cursor-pointer items-center gap-2 rounded-lg border p-2 transition ${isSel ? 'border-[var(--destaque)] bg-[var(--destaque-suave)]' : 'border-[var(--base-borda)] bg-[var(--base-cartao)] hover:bg-[var(--base-fill)]'} ${isDrag ? 'opacity-40' : ''} ${isOver ? 'ring-2 ring-[var(--destaque)]' : ''} ${!ativo ? 'opacity-60' : ''}`}
								>
									{canEdit && <span className="cursor-grab text-[var(--base-texto-3)]" aria-label="Arrastar"><GripVertical size={14} /></span>}
									<span className="grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-bold text-[var(--base-texto-3)]">{idx + 1}</span>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[12px] font-semibold text-[var(--base-texto)]">{nome}</p>
										<p className="truncate text-[10px] text-[var(--base-texto-3)]">{preview}</p>
										{aviso && <p className="mt-0.5 text-[10px] font-semibold text-[var(--estado-atencao-texto)]">{aviso}</p>}
										{!isF && semRegua && etapa?.ativo && <p className="mt-0.5 text-[10px] font-semibold text-[var(--estado-atencao-texto)]">Estágio sem régua: o motor ignora.</p>}
										{isF && ativo && faseSemReguaInfo(def, fase!) && <p className="mt-0.5 text-[10px] font-semibold text-[var(--estado-atencao-texto)]">{faseSemReguaInfo(def, fase!)}</p>}
									</div>
									{canEdit && (
										<div className="flex shrink-0 flex-col items-center gap-0.5">
											<button role="switch" aria-checked={ativo} onClick={e => { e.stopPropagation(); toggle(id, !ativo); }} className={`relative h-5 w-9 rounded-full transition-colors ${ativo ? 'bg-[var(--estado-pronto)]' : 'bg-[var(--base-texto-3)]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${ativo ? 'left-[18px]' : 'left-0.5'}`} /></button>
										</div>
									)}
								</div>
							);
						})}
					</div>
					{canEdit && ordem.length > 1 && current && (
						<div className="mt-2 flex gap-1">
							<button type="button" onClick={() => mover(current, -1)} disabled={ordem.indexOf(current) === 0} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--base-borda)] py-1.5 text-[11px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)] disabled:opacity-40"><ChevronUp size={13} /> Subir</button>
							<button type="button" onClick={() => mover(current, 1)} disabled={ordem.indexOf(current) === ordem.length - 1} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--base-borda)] py-1.5 text-[11px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)] disabled:opacity-40"><ChevronDown size={13} /> Descer</button>
						</div>
					)}
				</div>

				{/* Aviso de clientes sem estágio */}
				{semEstagio > 0 && (
					<div className="mt-3 rounded-lg border border-[var(--estado-atencao)] bg-[var(--estado-atencao-fundo)] p-3">
						<p className="text-[12px] font-semibold text-[var(--estado-atencao-texto)]"><AlertTriangle size={13} className="mr-1 inline" />≈ {numberBR(semEstagio)} clientes sem estágio na última lista: ficam sem ação.</p>
						{canEdit && <button type="button" onClick={criarParaSemEstagio} className="mt-2 flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}><Plus size={13} /> Criar um estágio para eles</button>}
					</div>
				)}
				{descobertas.map(f => (
					<div key={f} className="mt-2 rounded-lg border border-[var(--estado-atencao)] bg-[var(--estado-atencao-fundo)] px-3 py-2 text-[11px] font-semibold text-[var(--estado-atencao-texto)]">Quem está em {faseLabel(def, f)} fica sem estágio.</div>
				))}
			</div>

			{/* ===== Coluna da direita: editor ===== */}
			<div>
				{!current && <div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-8 text-center text-sm text-[var(--base-texto-3)]">Escolha um estágio à esquerda.</div>}
				{selFase && (
					<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-5">
						<div className="mb-4 flex flex-wrap items-center gap-3">
							<h3 className="text-[15px] font-bold text-[var(--base-texto)]">Estágio</h3>
							<input value={faseLabel(def, selFase)} disabled={!canEdit} maxLength={40} onChange={e => setDef({ ...def, rotulos_fases: { ...def.rotulos_fases, [selFase]: e.target.value } })} className="h-9 min-w-[180px] flex-1 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-3 text-sm font-semibold text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-60" />
						</div>
						<div className="space-y-3">
							<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] p-4">
								<p className="text-xs font-bold text-[var(--base-texto)]">Quem entra</p>
								<p className="mt-1 text-[12px] text-[var(--base-texto-2)]">Situação do cliente = {faseLabel(def, selFase)}, regra do motor.</p>
								<p className="mt-1 text-[11px] text-[var(--base-texto-3)]">Para outra regra, crie um estágio com “+ Estágio”.</p>
							</div>
							<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] p-4 text-[12px] leading-relaxed text-[var(--base-texto-2)]">
								{resumoFaseSimples(def, selFase)}
							</div>
							{canEdit && <button type="button" onClick={() => onMontarRegua(selFase)} className="flex h-9 items-center gap-2 rounded-lg px-5 text-[13px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Montar a régua deste estágio</button>}
						</div>
					</div>
				)}
				{selEtapa && (
					<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-5">
						<div className="mb-4 flex flex-wrap items-center gap-3">
							<h3 className="text-[15px] font-bold text-[var(--base-texto)]">Estágio</h3>
							<input value={selEtapa.nome} disabled={!canEdit} maxLength={40} onChange={e => setDef(updateEtapa(def, selEtapa.id, { nome: e.target.value }))} className="h-9 min-w-[180px] flex-1 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-3 text-sm font-semibold text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-60" />
							<span className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--base-texto-3)]">{selEtapa.id}</span>
						</div>
						<div className="space-y-4">
							<CondicoesEditor condicoes={selEtapa.condicoes} colunas={colunas} canEdit={canEdit} propensaoColetando={!!propensaoColetando} propensaoError={propensaoError} onChange={c => setDef(updateEtapa(def, selEtapa.id, { condicoes: c }))} />
							<ReferenciaEditor etapa={selEtapa} colunas={colunas} canEdit={canEdit} onChange={p => setDef(updateEtapa(def, selEtapa.id, p))} />
							<SaidasEditor saidas={selEtapa.saidas} etapas={etapas} etapaId={selEtapa.id} canEdit={canEdit} onChange={s => setDef(updateEtapa(def, selEtapa.id, { saidas: s }))} />
							{(validarEtapas(def).find(e => e.id === selEtapa.id)?.mensagens ?? []).map((m, i) => (
								<div key={i} className="rounded-lg border border-[var(--estado-erro)] bg-[var(--estado-erro-fundo)] px-4 py-2 text-[12px] font-medium text-[var(--estado-erro-texto)]">{m}</div>
							))}
							{etapaSemRegua(selEtapa) && selEtapa.ativo && (
								<div className="rounded-lg border border-[var(--estado-atencao)] bg-[var(--estado-atencao-fundo)] px-4 py-2.5 text-[12px] font-medium text-[var(--estado-atencao-texto)]">Estágio sem régua: o motor ignora, e quem cairia nele vai para o próximo.</div>
							)}
							{selEtapa.aviso && (
								<div className="rounded-lg border border-[var(--estado-atencao)] bg-[var(--estado-atencao-fundo)] px-4 py-2.5 text-[12px] font-medium text-[var(--estado-atencao-texto)]">{selEtapa.aviso}</div>
							)}
							<div className="flex flex-wrap items-center gap-2">
								{canEdit && <button type="button" onClick={() => onMontarRegua(selEtapa.id)} className="flex h-9 items-center gap-2 rounded-lg px-5 text-[13px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Montar a régua deste estágio</button>}
								{canEdit && <button type="button" onClick={() => apagarEtapa(selEtapa.id)} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--estado-erro)] px-4 text-[13px] font-semibold text-[var(--estado-erro)] hover:bg-[var(--estado-erro-fundo)]"><Trash2 size={14} /> Apagar estágio</button>}
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

/** Resumo curto de uma fase (prazo e saídas). */
function resumoFaseSimples(def: Definicao, fase: FaseId): string {
	const map: Record<FaseId, string> = {
		localizacao: `Quem entra: clientes novos · sai: sem CPC → Não CPC${def.localizacao?.ativo === false ? ' (desligada)' : ''}`,
		cpc: `Quem entra: quem deu CPC · sai: sem resposta → Não CPC${def.cpc?.ativo === false ? ' (desligada)' : ''}`,
		giro: `Quem entra: não CPC · sai: ao fim dos ciclos, espera novo enriquecimento${def.giro?.ativo === false ? ' (desligada)' : ''}`,
		preventivo: `Quem entra: clientes em acordo, antes do vencimento${def.preventivo?.ativo === false ? ' (desligada)' : ''}`,
		quebra: `Quem entra: clientes em acordo com parcela vencida${def.quebra?.ativo === false ? ' (desligada)' : ''}`,
	};
	return map[fase];
}
