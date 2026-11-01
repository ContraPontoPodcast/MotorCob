// Mensageria › Agente virtual › Lotes › Reciclar mailing (SQL 65; redesign aprovado, renitencia-v2).
// Modal em 3 passos: 1) o que reciclar (lote inteiro ou filtro por resultado e onda), 2) quem fica de fora (não
// ligar e inexistente travados) e 3) o limite por cliente no dia. A prévia completa vem de previa_reciclagem_voz:
// voltam e ficam fora por motivo, ondas, duração estimada, se cabe na janela UF/DDD e chamadas curtas previstas.
// O pedido é pedir_reciclagem_voz (permissão reciclar_lote_voz). Histórico em voz_reciclagens. Só contagens.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Lock, Recycle } from 'lucide-react';
import { supabase, friendlyError } from '@/lib/supabase';
import {
	CHIPS_LOTE, EXCLUSOES, MOTIVO_FORA_REC, NOME, TRAVADAS, duracao, nomeOnda, type OndaVoz, type PreviaReciclagem,
} from '@/lib/renitencia';
import { inteiro } from '@/lib/voz';
import { Botao, Cartao } from './ui';

type SemContato = { situacao: string; onda_id: number | null; numeros: number };
const pc = (n: number, d = 0) => `${n.toFixed(d).replace('.', ',')}%`;
const chip = (on: boolean) => on ? { backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)', borderColor: 'var(--base-texto)' } : { borderColor: 'var(--base-borda)', color: 'var(--base-texto-2)' };

function Passo({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--base-borda)' }}>
			<span className="flex items-center gap-2 text-[13.5px] font-bold"><i className="grid h-5 w-5 place-items-center rounded-full text-[11px] not-italic text-[var(--base-cartao)]" style={{ backgroundColor: 'var(--area)' }}>{n}</i>{titulo}</span>
			{children}
		</div>
	);
}

export function ReciclarModal({ loteId, ondas, semContato, promessaSuspende, modo, onClose, onPedido }: {
	loteId: number; ondas: OndaVoz[]; semContato: SemContato[]; promessaSuspende: boolean; modo: string | null;
	onClose: () => void; onPedido: () => void;
}) {
	const [escopo, setEscopo] = useState<'lote' | 'filtro'>('lote');
	const [res, setRes] = useState<string[]>(CHIPS_LOTE.filter(c => c.k !== 'numero_incorreto').map(c => c.k));
	const [onda, setOnda] = useState('todas');
	const [excl, setExcl] = useState<string[]>(['cpc', 'recusa', 'pessoa_errada', 'retorno']);
	const [limite, setLimite] = useState<'mantem' | 'recomeca'>('mantem');
	const [p, setP] = useState<PreviaReciclagem | null>(null);
	const [ocupado, setOcupado] = useState(false);

	const sits = CHIPS_LOTE.filter(c => res.includes(c.k)).flatMap(c => c.sits);
	const filtradas = semContato.filter(x => onda === 'todas' || String(x.onda_id) === onda);
	const porChip = (s: string[]) => filtradas.filter(x => s.includes(x.situacao)).reduce((t, x) => t + x.numeros, 0);
	const excluir = promessaSuspende && !excl.includes('promessa') ? [...excl, 'promessa'] : excl;
	const args = { lote: loteId, escopo, resultados: escopo === 'filtro' ? sits : null, ondas: escopo === 'filtro' && onda !== 'todas' ? [Number(onda)] : null, excluir, limite_cliente: limite };
	const chave = JSON.stringify(args);

	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		setP(null);
		if (escopo === 'filtro' && !sits.length) return;
		const t = window.setTimeout(() => {
			void supabase!.rpc('previa_reciclagem_voz', args).then(({ data, error }) => {
				if (!ativo) return;
				if (error) { toast.error(friendlyError(error)); return; }
				setP(data as PreviaReciclagem);
			});
		}, 250);
		return () => { ativo = false; window.clearTimeout(t); };
	}, [chave]);

	useEffect(() => {
		const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) onClose(); };
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	}, [ocupado, onClose]);

	async function pedir() {
		if (!supabase) return;
		setOcupado(true);
		const { error } = await supabase.rpc('pedir_reciclagem_voz', args);
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success(`${inteiro(p?.volta ?? 0)} números voltam ao mailing. A VM recomeça do começo, pelas mesmas regras.`);
		onClose();
		onPedido();
	}

	const fora = p ? Object.entries(p.fora ?? {}).filter(([, n]) => Number(n) > 0) : [];
	const totFora = fora.reduce((t, [, n]) => t + Number(n), 0);
	const parcial = p && !p.cabe_na_janela;

	return (
		<div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/40 px-4 py-8" onClick={() => !ocupado && onClose()}>
			<div role="dialog" aria-modal="true" aria-label="Reciclar mailing" className="my-auto flex w-full min-w-0 max-w-[640px] flex-col gap-3 rounded-2xl border p-5 text-[var(--base-texto)]" style={{ backgroundColor: 'var(--base-cartao)', borderColor: 'var(--base-borda)', boxShadow: '0 18px 48px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
				<h2 className="text-[17px] font-bold">Reciclar o mailing do lote</h2>
				<p className="text-[13px] text-[var(--base-texto-2)]">Diferente do Reenviar, zera as tentativas e os estágios dos números escolhidos e disca de novo, do começo{modo ? `, no modo ${modo === 'vertical' ? 'vertical' : 'horizontal'}` : ''}.</p>

				<Passo n={1} titulo="O que reciclar">
					<div className="flex flex-wrap gap-4 text-[13px]">
						<label className="inline-flex items-center gap-2"><input type="radio" name="rc-esc" checked={escopo === 'lote'} onChange={() => setEscopo('lote')} /> Lote inteiro</label>
						<label className="inline-flex items-center gap-2"><input type="radio" name="rc-esc" checked={escopo === 'filtro'} onChange={() => setEscopo('filtro')} /> Filtrar por resultado e onda</label>
					</div>
					{escopo === 'filtro' && <>
						<div className="flex flex-wrap gap-1.5">
							{CHIPS_LOTE.filter(c => c.k !== 'numero_incorreto').map(c => {
								const on = res.includes(c.k);
								return <button key={c.k} type="button" aria-pressed={on} onClick={() => setRes(s => on ? s.filter(x => x !== c.k) : [...s, c.k])} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold" style={chip(on)}>{c.n}<b className="tabular-nums">{inteiro(porChip(c.sits))}</b></button>;
							})}
						</div>
						{!sits.length && <p className="text-[12px] text-[var(--estado-atencao-texto)]">Escolha pelo menos um resultado.</p>}
						<select aria-label="Onda" value={onda} onChange={e => setOnda(e.target.value)} className="h-9 w-full max-w-full rounded-lg bg-[var(--base-fill)] px-2.5 text-[13px] font-semibold">
							<option value="todas">Todas as ondas</option>
							{ondas.map(o => <option key={o.id} value={String(o.id)}>{nomeOnda(o).nome}</option>)}
						</select>
					</>}
				</Passo>

				<Passo n={2} titulo="Quem fica de fora">
					<div className="flex flex-wrap gap-1.5">
						{EXCLUSOES.map(x => {
							const trav = x.k === 'promessa' && promessaSuspende, on = trav || excl.includes(x.k);
							return <button key={x.k} type="button" aria-pressed={on} aria-disabled={trav || undefined} title={trav ? 'A promessa já suspende ligações nesta carteira' : x.t}
								onClick={trav ? undefined : () => setExcl(s => on ? s.filter(y => y !== x.k) : [...s, x.k])}
								className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold" style={chip(on)}>{trav && <Lock size={12} />}{x.n}</button>;
						})}
						{TRAVADAS.map(x => <button key={x.k} type="button" aria-pressed aria-disabled title={x.t} className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold" style={chip(true)}><Lock size={12} />{x.n}</button>)}
					</div>
					{!promessaSuspende && <p className="text-[11.5px] text-[var(--base-texto-3)]">Promessa: a carteira não suspende por promessa, então quem prometeu volta, a menos que vocês marquem.</p>}
					<p className="flex items-start gap-1.5 text-[12px] text-[var(--base-texto-2)]"><Lock size={12} className="mt-0.5 shrink-0" />Nunca zera: “não ligar”, número inexistente (voz), limite de chamadas curtas da MP 1.396/2026 (a contagem do dia continua) e a janela UF/DDD.</p>
				</Passo>

				<Passo n={3} titulo="Limite por cliente no dia">
					<div role="radiogroup" aria-label="Limite por cliente no dia" className="flex flex-col gap-2 text-[13px]">
						<label className="flex items-start gap-2"><input type="radio" name="rc-lim" className="mt-1" checked={limite === 'mantem'} onChange={() => setLimite('mantem')} /><span>Mantém o limite de hoje (recomendado)<small className="block text-[12px] text-[var(--base-texto-2)]">quem já usou as tentativas do dia fica de fora até amanhã</small></span></label>
						<label className="flex items-start gap-2 rounded-lg p-1.5" style={limite === 'recomeca' ? { backgroundColor: 'var(--estado-atencao-fundo)' } : undefined}><input type="radio" name="rc-lim" className="mt-1" checked={limite === 'recomeca'} onChange={() => setLimite('recomeca')} /><span>Recomeça a contagem do dia<small className="block text-[12px] text-[var(--base-texto-2)]">Risco CDC art. 71 e reclamação: o mesmo cliente pode receber o dobro de ligações hoje. Fica registrado com o seu nome.</small></span></label>
					</div>
				</Passo>

				<div className="flex flex-col gap-2 rounded-xl p-3" style={{ backgroundColor: 'var(--base-fill)' }}>
					{!p ? <p className="text-[13px] text-[var(--base-texto-2)]">{escopo === 'filtro' && !sits.length ? 'Escolha o que reciclar.' : 'Conferindo as regras…'}</p> : <>
						<div className="grid gap-2.5 sm:grid-cols-2">
							<div className="rounded-xl border px-3 py-2.5 text-[12px] text-[var(--base-texto-2)]" style={{ borderColor: 'var(--estado-pronto)', backgroundColor: 'var(--base-cartao)' }}>Voltam<b className="block text-[22px] tabular-nums text-[var(--base-texto)]">{inteiro(p.volta)}</b>de {inteiro(p.base)} números já discados</div>
							<div className="rounded-xl border px-3 py-2.5 text-[12px] text-[var(--base-texto-2)]" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>Ficam fora<b className="block text-[22px] tabular-nums text-[var(--base-texto)]">{inteiro(totFora)}</b>pelos motivos abaixo</div>
						</div>
						{fora.length > 0 && <div className="flex flex-col rounded-xl border" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
							{fora.map(([k, n]) => (
								<div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b px-3 py-2 text-[13px] last:border-b-0" style={{ borderColor: 'var(--base-borda)' }}>
									<span>{MOTIVO_FORA_REC[k]?.n ?? NOME[k] ?? k}</span><b className="tabular-nums">{inteiro(Number(n))}</b>
									<small className="col-span-2 text-[12px] text-[var(--base-texto-2)]">{MOTIVO_FORA_REC[k]?.t}</small>
								</div>
							))}
						</div>}
						<p className="text-[13px] text-[var(--base-texto-2)]">
							Estimativa: {inteiro(p.chamadas)} chamadas em {p.ondas} {p.ondas === 1 ? 'onda' : 'ondas'}{p.ondas > 1 ? ' (uma por spin)' : ''}, cerca de {duracao(p.duracao_min)} com {inteiro(p.por_hora)} chamadas por hora.{' '}
							{parcial ? <b className="text-[var(--estado-atencao-texto)]">{p.janela_fonte === 'uf_ddd' ? 'Pelas janelas UF/DDD do lote' : `A janela fecha em ${duracao(p.resta_min)}`}: cabe cerca de {pc(p.cabe_pct)}; o resto fica como “não enviado no dia (fora da janela)”.</b> : 'Cabe na janela de hoje.'}
						</p>
						{p.janela_fonte === 'uf_ddd' && p.janelas.length > 1 && (
							<div className="flex flex-wrap gap-1.5">{p.janelas.map(j => <span key={j.abre + j.fecha} className="rounded-full px-2.5 py-0.5 text-[11.5px]" style={{ backgroundColor: 'var(--base-cartao)', color: j.cabe_pct < 100 ? 'var(--estado-atencao-texto)' : 'var(--base-texto-2)' }}>{j.ufs.length ? j.ufs.slice(0, 4).join(', ') + (j.ufs.length > 4 ? '…' : '') : 'janela'} até {j.fecha}: cabe {pc(j.cabe_pct)}</span>)}</div>
						)}
						<p className="text-[13px] text-[var(--base-texto-2)]">Chamadas curtas do dia: {p.curtas.hoje.fracao != null ? pc(p.curtas.hoje.fracao * 100) : '—'} agora → <b style={{ color: p.curtas.acima_do_aviso ? 'var(--estado-atencao-texto)' : 'var(--base-texto)' }}>{p.curtas.fracao_depois != null ? pc(p.curtas.fracao_depois * 100) : '—'}</b> previsto ({inteiro(p.curtas_previstas)} curtas a mais) · aviso {pc(p.curtas.aviso * 100)} · MP 85%.</p>
					</>}
					{limite === 'recomeca' && <p className="rounded-lg px-3 py-2 text-[12.5px]" style={{ backgroundColor: 'var(--estado-atencao-fundo)' }}><b>Recomeçar a contagem do dia fica no histórico com o seu nome.</b> Use só com motivo (ex.: lote carregado errado). A janela, o “não ligar” e as curtas continuam valendo.</p>}
					<p className="text-[11.5px] text-[var(--base-texto-3)]">Os números são conferidos de novo na hora de discar. Fica no histórico de reciclagens e na Auditoria.</p>
				</div>

				<div className="flex flex-wrap justify-end gap-2">
					<Botao secundario onClick={onClose} disabled={ocupado}>Cancelar</Botao>
					<Botao onClick={() => void pedir()} disabled={ocupado || !p?.volta}><Recycle size={14} /> Reciclar {inteiro(p?.volta ?? 0)}</Botao>
				</div>
			</div>
		</div>
	);
}

type Reciclagem = { id: number; pedido_em: string; origem: string; escopo: string; filtros: { resultados?: string[] }; excluir: string[]; limite_cliente: string; situacao: string; volta_real: number | null; fora_real: Record<string, number> | null; previa: { volta?: number } | null };

export function HistoricoReciclagens({ credorId, versao }: { credorId: number | null; versao: number }) {
	const [linhas, setLinhas] = useState<Reciclagem[] | null>(null);
	useEffect(() => {
		if (!supabase) return;
		let q = supabase.from('voz_reciclagens').select('id,pedido_em,origem,escopo,filtros,excluir,limite_cliente,situacao,volta_real,fora_real,previa')
			.gte('pedido_em', new Date(Date.now() - 7 * 86_400_000).toISOString()).order('pedido_em', { ascending: false }).limit(30);
		q = credorId == null ? q.is('credor_id', null) : q.eq('credor_id', credorId);
		void q.then(({ data }) => setLinhas((data ?? []) as Reciclagem[]));
	}, [credorId, versao]);
	if (!linhas?.length) return null;
	const filtro = (r: Reciclagem) => {
		const esc = r.escopo === 'lote' ? 'Lote inteiro' : (r.filtros?.resultados ?? []).map(k => NOME[k] ?? k).join(', ') || 'Filtro';
		const ex = (r.excluir ?? []).map(k => EXCLUSOES.find(x => x.k === k)?.n ?? k);
		return `${esc} · fora: ${ex.length ? ex.join(', ') : 'só as travadas'}`;
	};
	return (
		<Cartao titulo="Histórico de reciclagens" linha="Últimos 7 dias desta carteira. Só contagens; nenhum telefone.">
			<div className="overflow-x-auto">
				<table className="w-full min-w-[560px] border-collapse text-[13px]">
					<thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--base-texto-3)]">{['Quando', 'Filtros e exclusões', 'Limite do dia', 'Voltaram', 'Ficaram fora'].map((h, i) => <th key={h} className={`py-2 pr-3 ${i > 2 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
					<tbody>{linhas.map(r => (
						<tr key={r.id} className="border-t align-top" style={{ borderColor: 'var(--base-borda)' }}>
							<td className="py-2 pr-3">{new Date(r.pedido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}<small className="block text-[11.5px] text-[var(--base-texto-3)]">{r.origem === 'automatica' ? 'Automática' : 'Manual'} · {r.situacao === 'concluido' ? 'concluída' : r.situacao === 'pendente' ? 'na fila' : r.situacao === 'em_onda' ? 'em curso' : 'cancelada'}</small></td>
							<td className="py-2 pr-3">{filtro(r)}</td>
							<td className="py-2 pr-3">{r.limite_cliente === 'recomeca' ? <span className="rounded-full bg-[var(--estado-atencao-fundo)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--estado-atencao-texto)]">Recomeçou</span> : 'Mantém'}</td>
							<td className="py-2 pr-3 text-right tabular-nums">{inteiro(r.volta_real ?? r.previa?.volta ?? 0)}</td>
							<td className="py-2 text-right tabular-nums">{inteiro(Object.values(r.fora_real ?? {}).reduce((t, n) => t + Number(n || 0), 0))}</td>
						</tr>
					))}</tbody>
				</table>
			</div>
		</Cartao>
	);
}
