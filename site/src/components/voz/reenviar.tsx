// Mensageria › Agente virtual › Lotes › Reenviar agora (SQL 65; protótipo aprovado em 01/11/2026).
// É o Resubmit feito à mão: escolhe os resultados (e a onda), vê quantos voltam e quantos ficam fora e por quê
// (previa_reenvio_voz) e pede (pedir_reenvio_voz, permissão reenviar_lote_voz). A VM confere tudo de novo na hora.
// Só contagens: os números ficam no lote (sem_contato_lote_voz).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Lock, RotateCw } from 'lucide-react';
import { usePermissao } from '@/components/app-shell';
import { supabase, friendlyError } from '@/lib/supabase';
import { CHIPS_LOTE, MOTIVO_FORA, PRIORIDADES, nomeOnda, totalFora, type OndaVoz, type Previa, type Prioridade } from '@/lib/renitencia';
import { PERM_VOZ, inteiro } from '@/lib/voz';
import { Botao, Cartao, Pilula } from './ui';

type SemContato = { situacao: string; onda_id: number | null; numeros: number };
export type Reenvio = { id: number; pedido_em: string; filtros: { resultados?: string[] }; situacao: string; previa: Previa | null; volta_real: number | null; prioridade: string };

export function useReenvios(loteId: number | null) {
	const [semContato, setSemContato] = useState<SemContato[]>([]);
	const [reenvios, setReenvios] = useState<Reenvio[]>([]);
	async function carregar() {
		if (!supabase || loteId == null) return;
		const [s, r] = await Promise.all([
			supabase.rpc('sem_contato_lote_voz', { lote: loteId }),
			supabase.from('voz_reenvios').select('id,pedido_em,filtros,situacao,previa,volta_real,prioridade').eq('lote_id', loteId).order('pedido_em', { ascending: false }).limit(20),
		]);
		setSemContato(((s.data ?? []) as SemContato[]).map(x => ({ ...x, numeros: Number(x.numeros) })));
		setReenvios((r.data ?? []) as Reenvio[]);
	}
	return { semContato, reenvios, carregar };
}

export function SemContatoLote({ loteId, ondas, semContato, podeReenviarHoje, onPedido }: {
	loteId: number; ondas: OndaVoz[]; semContato: SemContato[]; podeReenviarHoje: boolean; onPedido: () => void;
}) {
	const pode = usePermissao(PERM_VOZ.reenviarLote);
	const [sel, setSel] = useState<string[]>(['nao_atendida', 'maquina', 'caixa_postal', 'ocupado']);
	const [onda, setOnda] = useState<string>('todas');
	const [aberto, setAberto] = useState(false);
	const [prioridade, setPrioridade] = useState<Prioridade>('normal');
	const [outro, setOutro] = useState(true);
	const [previa, setPrevia] = useState<Previa | null>(null);
	const [ocupado, setOcupado] = useState(false);

	const filtradas = semContato.filter(x => onda === 'todas' || String(x.onda_id) === onda);
	const porChip = (sits: string[]) => filtradas.filter(x => sits.includes(x.situacao)).reduce((t, x) => t + x.numeros, 0);
	const sits = CHIPS_LOTE.filter(c => sel.includes(c.k)).flatMap(c => c.sits);
	const escolhidos = porChip(sits);
	const ondasArg = onda === 'todas' ? null : [Number(onda)];

	useEffect(() => {
		if (!aberto || !supabase) return;
		let ativo = true;
		setPrevia(null);
		void supabase.rpc('previa_reenvio_voz', { lote: loteId, resultados: sits, ondas: ondasArg, prioridade, outro_numero: outro })
			.then(({ data, error }) => { if (!ativo) return; if (error) { toast.error(friendlyError(error)); setAberto(false); return; } setPrevia(data as Previa); });
		return () => { ativo = false; };
	}, [aberto, outro, prioridade]);

	async function pedir() {
		if (!supabase) return;
		setOcupado(true);
		const { error } = await supabase.rpc('pedir_reenvio_voz', { lote: loteId, resultados: sits, ondas: ondasArg, prioridade, outro_numero: outro });
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return; }
		setAberto(false);
		toast.success(`${inteiro(previa?.volta ?? 0)} números na fila. A onda sai assim que o intervalo de cada um permitir.`);
		onPedido();
	}

	const botao = !pode ? <Pilula><Lock size={12} /> Sem permissão para reenviar</Pilula>
		: <Botao onClick={() => setAberto(true)} disabled={!escolhidos || !podeReenviarHoje} title={podeReenviarHoje ? undefined : 'Só o lote de hoje, ligando ou pausado'}><RotateCw size={14} /> Reenviar agora</Botao>;

	return (
		<>
			<Cartao titulo="Sem contato neste lote" linha="Toque para escolher. Os números ficam no lote; a tela mostra só contagens." direita={
				<div className="flex flex-wrap items-center gap-2">
					<select aria-label="Onda" value={onda} onChange={e => setOnda(e.target.value)} className="h-9 max-w-[240px] rounded-lg bg-[var(--base-fill)] px-2.5 text-[13px] font-semibold text-[var(--base-texto)]">
						<option value="todas">Todas as ondas</option>
						{ondas.map(o => <option key={o.id} value={String(o.id)}>{nomeOnda(o).nome}</option>)}
					</select>
					{botao}
				</div>
			}>
				<div className="flex flex-wrap gap-1.5">
					{CHIPS_LOTE.map(c => {
						const on = sel.includes(c.k);
						return (
							<button key={c.k} type="button" aria-pressed={on} onClick={() => setSel(s => on ? s.filter(x => x !== c.k) : [...s, c.k])}
								className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold"
								style={on ? { backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)', borderColor: 'var(--base-texto)' } : { borderColor: 'var(--base-borda)', color: 'var(--base-texto-2)' }}>
								{c.n}<b className="tabular-nums">{inteiro(porChip(c.sits))}</b>
							</button>
						);
					})}
				</div>
				<p className="mt-2.5 text-[11.5px] text-[var(--base-texto-3)]">{escolhidos ? `${inteiro(escolhidos)} números escolhidos.` : 'Escolha pelo menos um resultado com números.'} Cada volta conta como tentativa do dia e passa pelas mesmas regras da renitência.</p>
			</Cartao>

			{aberto && (
				<div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/40 px-4 py-8" onClick={() => !ocupado && setAberto(false)}>
					<div role="dialog" aria-modal="true" aria-label="Reenviar agora" className="my-auto flex w-full max-w-[520px] flex-col gap-3 rounded-2xl border p-5 text-[var(--base-texto)]" style={{ backgroundColor: 'var(--base-cartao)', borderColor: 'var(--base-borda)', boxShadow: '0 18px 48px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
						<h2 className="text-[17px] font-bold">Reenviar {inteiro(previa?.selecionados ?? escolhidos)} números agora?</h2>
						<p className="text-[13px] text-[var(--base-texto-2)]">{CHIPS_LOTE.filter(c => sel.includes(c.k)).map(c => c.n).join(', ')} · {onda === 'todas' ? 'todas as ondas' : nomeOnda(ondas.find(o => String(o.id) === onda)!).nome}</p>
						{!previa ? <p className="text-[13px] text-[var(--base-texto-2)]">Conferindo as regras…</p> : <>
							<div className="grid gap-2.5 sm:grid-cols-2">
								<div className="rounded-xl border px-3 py-2.5 text-[12px] text-[var(--base-texto-2)]" style={{ borderColor: 'var(--estado-pronto)', backgroundColor: 'var(--estado-pronto-fundo, transparent)' }}>Voltam<b className="block text-[22px] tabular-nums text-[var(--base-texto)]">{inteiro(previa.volta)}</b>{previa.volta_outro_numero ? `${inteiro(previa.volta_outro_numero)} por outro número do cliente` : 'no mesmo número'}</div>
								<div className="rounded-xl border px-3 py-2.5 text-[12px] text-[var(--base-texto-2)]" style={{ borderColor: 'var(--base-borda)' }}>Ficam fora<b className="block text-[22px] tabular-nums text-[var(--base-texto)]">{inteiro(totalFora(previa))}</b>e não recebem ligação nesta volta</div>
							</div>
							<div className="flex flex-col rounded-xl border" style={{ borderColor: 'var(--base-borda)' }}>
								{Object.entries(previa.fora ?? {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => (
									<div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b px-3 py-2 text-[13px] last:border-b-0" style={{ borderColor: 'var(--base-borda)' }}>
										<span>{MOTIVO_FORA[k]?.n ?? k}</span><b className="tabular-nums">{inteiro(Number(n))}</b>
										<small className="col-span-2 text-[12px] text-[var(--base-texto-2)]">{MOTIVO_FORA[k]?.t}</small>
									</div>
								))}
								{totalFora(previa) === 0 && <div className="px-3 py-2 text-[13px]">Nenhum número fica fora</div>}
							</div>
							{previa.espera_intervalo > 0 && <p className="text-[13px] text-[var(--base-texto-2)]">Dos que voltam, {inteiro(previa.espera_intervalo)} ainda esperam o intervalo da renitência e saem quando ele permitir.</p>}
						</>}
						<div className="flex flex-wrap items-center gap-4 text-[13px]">
							<label className="inline-flex items-center gap-2 text-[var(--base-texto-2)]">Prioridade
								<select value={prioridade} onChange={e => setPrioridade(e.target.value as Prioridade)} className="h-8 rounded-lg border bg-[var(--base-cartao)] px-2 text-[13px] text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}>
									{(Object.keys(PRIORIDADES) as Prioridade[]).map(k => <option key={k} value={k}>{PRIORIDADES[k]}</option>)}
								</select>
							</label>
							<label className="inline-flex items-center gap-2 text-[var(--base-texto-2)]"><input type="checkbox" checked={outro} onChange={e => setOutro(e.target.checked)} /> Tentar outro número do cliente</label>
						</div>
						<p className="text-[11.5px] text-[var(--base-texto-3)]">Cada volta conta como tentativa do dia. Os números são conferidos de novo na hora de discar, então o total pode mudar um pouco.</p>
						<div className="flex flex-wrap justify-end gap-2">
							<Botao secundario onClick={() => setAberto(false)} disabled={ocupado}>Cancelar</Botao>
							<Botao onClick={() => void pedir()} disabled={ocupado || !previa?.volta}>Reenviar {inteiro(previa?.volta ?? 0)}</Botao>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
