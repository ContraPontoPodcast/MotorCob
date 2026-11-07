import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { numberBR, supabase, type Condicao } from '@/lib/supabase';
import { dataCurta, montarProposta, resumirEditado, type ResultadoPrevia, type ResumoEditado, type SegmentoParaPrevia } from '@/lib/previa-segmentacao';

/** "Clientes hoje" do segmento em edição (SQL 76): conta no banco, com a regra do motor e a ordem da carteira.
 *  Só contagens; recalcula 0,6 s depois da última mudança nas condições. Sem a RPC (banco antigo) ou sem permissão,
 *  some sem atrapalhar o formulário. */
export function PreviaClientes({ empresaId, credorId, emUso, editado, condicoes, erroCondicoes }: {
	empresaId: string;
	credorId: string;
	emUso: SegmentoParaPrevia[];
	editado: { id: string | null; codigo: string; nome: string; ordem: number };
	/** Condições já normalizadas (null quando o formulário ainda tem condição incompleta). */
	condicoes: Condicao[] | null;
	erroCondicoes?: string | null;
}) {
	const [res, setRes] = useState<ResumoEditado | null>(null);
	const [estado, setEstado] = useState<'carregando' | 'ok' | 'indisponivel'>('carregando');
	const chave = JSON.stringify([condicoes, editado.id, editado.ordem, emUso.map(s => [s.id, s.ordem, s.condicoes])]);

	useEffect(() => {
		if (!supabase || !condicoes) return;
		let ativo = true;
		setEstado('carregando');
		const t = setTimeout(async () => {
			const proposta = montarProposta(emUso, { ...editado, condicoes });
			const { data, error } = await supabase!.rpc('previa_segmentacao', { empresa: empresaId, credor: credorId, proposta });
			if (!ativo) return;
			if (error || !data) { setEstado('indisponivel'); return; }
			setRes(resumirEditado(data as ResultadoPrevia));
			setEstado('ok');
		}, 600);
		return () => { ativo = false; clearTimeout(t); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [chave, empresaId, credorId]);

	if (estado === 'indisponivel') return null;
	const caixa = 'rounded-lg border border-[#e2eaec] bg-[#fafcfc] px-4 py-3 text-xs leading-relaxed text-slate-600';
	if (!condicoes) {
		return <div className={caixa} aria-live="polite"><p className="flex items-center gap-2 font-semibold text-[#163943]"><Users size={14}/> Clientes hoje</p><p className="mt-1">{erroCondicoes ? `Complete as condições para estimar: ${erroCondicoes}` : 'Complete as condições para estimar.'}</p></div>;
	}
	if (estado === 'carregando' && !res) {
		return <div className={caixa} aria-live="polite"><p className="flex items-center gap-2 font-semibold text-[#163943]"><Users size={14}/> Clientes hoje</p><p className="mt-1">Contando…</p></div>;
	}
	if (!res) return null;
	if (!res.dataBase) {
		return <div className={caixa} aria-live="polite"><p className="flex items-center gap-2 font-semibold text-[#163943]"><Users size={14}/> Clientes hoje</p><p className="mt-1">A estimativa aparece depois da primeira rotina desta carteira.</p></div>;
	}
	return (
		<div className={caixa} aria-live="polite" data-testid="previa-clientes">
			<p className="flex flex-wrap items-center gap-2 font-semibold text-[#163943]">
				<Users size={14}/> Clientes hoje: <span className="text-base font-bold" data-testid="previa-clientes-n">{numberBR(res.clientes)}</span>
				<span className="font-normal text-slate-400">de {numberBR(res.total)} em cobrança · rotina de {dataCurta(res.dataBase)}{estado === 'carregando' ? ' · recalculando…' : ''}</span>
			</p>
			{res.erro ? <p className="mt-1 text-[#B42318]">O motor ignoraria este segmento: {res.erro}</p> : <>
				{res.acima.length > 0 && <p className="mt-1">{numberBR(res.batem)} batem nas condições; {res.acima.map(a => `${numberBR(a.clientes)} em ${a.codigo}`).join(', ')} ficam no segmento de cima (o cliente fica no 1º segmento em que se encaixa).</p>}
				{res.deOnde.length > 0 && <p className="mt-1">Vêm de: {res.deOnde.slice(0, 5).map(d => `${d.de} ${numberBR(d.clientes)}`).join(' · ')}</p>}
			</>}
			{res.semDado.length > 0 && <p className="mt-1 text-[#80520f]">Sem dado para contar: {res.semDado.join(', ')} (a contagem trata como vazio).</p>}
		</div>
	);
}
