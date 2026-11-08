// Depois de aplicar (protótipo proto-segmentacao, tela 5b): faixa com o que foi feito, os segmentos que nasceram
// PAUSADOS (decisão do dono: conferir a régua e ligar), Ligar, Reenquadrar agora e Desfazer aplicação (só até a
// próxima rotina; SQL 79 › desfazer_segmentacao). Cada chip abre a régua do segmento no editor (raias por persona).
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { Botao, Modal, Pilula } from '@/components/ds';
import { friendlyError, supabase } from '@/lib/supabase';
import { horaBR, type Aplicacao } from '@/lib/segmentacao-ia';

type Seg = { cluster_id: string; codigo: string; nome: string; em_uso: boolean };

export function FaixaAplicada({ empresaId, credorId, credorNome, segmentos, versao, onMudou, onAbrir, onReenquadrar }: {
	empresaId: string; credorId: string; credorNome: string; segmentos: Seg[]; versao: number;
	onMudou: () => void; onAbrir: (clusterId: string) => void; onReenquadrar: () => void;
}) {
	const [ap, setAp] = useState<Aplicacao | null>(null);
	const [rotinaDepois, setRotinaDepois] = useState(false);
	const [pedindo, setPedindo] = useState<null | 'desfazer'>(null);
	const [conflitos, setConflitos] = useState<string[] | null>(null);
	const [ocupado, setOcupado] = useState(false);

	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		void (async () => {
			const { data } = await supabase!.from('segmentacao_aplicacoes').select('id,credor_id,aplicada_em,situacao,ligada_em,resumo,criados')
				.eq('credor_id', credorId).eq('situacao', 'aplicada').order('aplicada_em', { ascending: false }).limit(1);
			const a = (data?.[0] ?? null) as Aplicacao | null;
			let depois = false;
			if (a) {
				const ex = await supabase!.from('execucoes').select('id').eq('empresa_id', empresaId).gt('iniciada_em', a.aplicada_em).limit(1);
				depois = (ex.data ?? []).length > 0;
			}
			if (!ativo) return;
			setAp(a); setRotinaDepois(depois);
		})();
		return () => { ativo = false; };
	}, [credorId, empresaId, versao]);

	if (!ap) return null;
	const ids = new Set((ap.criados?.pausados ?? []).map(String));
	const daAplicacao = segmentos.filter(s => ids.has(String(s.cluster_id)));
	const pausados = daAplicacao.filter(s => !s.em_uso);
	if (rotinaDepois && pausados.length === 0) return null;
	const r = ap.resumo ?? {};

	async function ligar() {
		if (!supabase || !ap) return;
		setOcupado(true);
		const { error } = await supabase.rpc('ligar_segmentacao', { aplicacao: ap.id });
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success('Segmentos ligados. Valem na próxima rotina (ou em “Reenquadrar agora”).');
		onMudou();
	}

	async function desfazer(forcar: boolean) {
		if (!supabase || !ap) return;
		setOcupado(true);
		const { data, error } = await supabase.rpc('desfazer_segmentacao', { aplicacao: ap.id, forcar });
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); setPedindo(null); return; }
		const res = data as { ok: boolean; conflitos: string[] };
		if (!res.ok) { setConflitos(res.conflitos); return; }
		setPedindo(null); setConflitos(null);
		toast.success('Aplicação desfeita: segmentos, ordem e estratégias voltaram ao que eram.');
		onMudou();
	}

	return (
		<div className="space-y-2" data-faixa-aplicada>
			<div className="rounded-xl border border-[var(--estado-pronto)] bg-[var(--estado-pronto-fundo)] px-4 py-3">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<p className="flex min-w-0 items-start gap-2 text-[13px] text-[var(--base-texto)]"><Check size={16} className="mt-0.5 flex-none text-[var(--estado-pronto-texto)]" />
						<span><b>Aplicado em {credorNome} às {horaBR(ap.aplicada_em)}</b> · {r.novos ?? 0} segmento{(r.novos ?? 0) === 1 ? '' : 's'} novo{(r.novos ?? 0) === 1 ? '' : 's'}, {r.alterados ?? 0} alterado{(r.alterados ?? 0) === 1 ? '' : 's'}, {r.desligados ?? 0} desligado{(r.desligados ?? 0) === 1 ? '' : 's'} nesta carteira · {r.estrategias ?? 0} estratégia{(r.estrategias ?? 0) === 1 ? '' : 's'} criada{(r.estrategias ?? 0) === 1 ? '' : 's'}.{' '}
							{pausados.length > 0 ? <>{pausados.length} pausado{pausados.length === 1 ? '' : 's'} até você conferir a régua e ligar.</> : 'Tudo ligado: vale na próxima rotina.'}</span></p>
					<div className="flex flex-wrap gap-2">
						{pausados.length > 0 && <Botao pequeno onClick={() => void ligar()} disabled={ocupado}>Conferi, ligar {pausados.length === 1 ? 'o segmento' : `os ${pausados.length}`}</Botao>}
						<Botao pequeno tipo="secundario" onClick={onReenquadrar}>Reenquadrar agora</Botao>
					</div>
				</div>
				{!rotinaDepois && <button type="button" onClick={() => setPedindo('desfazer')} className="mt-1 pl-6 text-[12.5px] font-semibold text-[var(--base-texto-2)] hover:underline">Desfazer aplicação</button>}
			</div>
			{daAplicacao.length > 0 && (
				<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] px-4 py-3">
					<p className="text-[13px] font-bold text-[var(--base-texto)]">Revise a régua de cada segmento <span className="font-normal text-[var(--base-texto-3)]">· abre o editor com as raias por persona; ajuste e salve se quiser mudar algo</span></p>
					<div className="mt-2 flex flex-wrap gap-1.5">
						{daAplicacao.map(s => (
							<button key={s.cluster_id} type="button" onClick={() => onAbrir(s.cluster_id)} className="flex max-w-full items-center gap-1.5 rounded-full border border-[var(--base-borda)] px-2.5 py-1 text-[12.5px] hover:bg-[var(--base-fill)]" data-revisar-seg={s.codigo}>
								<span className="grid h-5 min-w-[26px] place-items-center rounded px-1 text-[10.5px] font-bold" style={{ backgroundColor: 'var(--area)', color: 'var(--area-ativo-texto)' }}>{s.codigo}</span>
								<span className="truncate font-semibold text-[var(--base-texto)]">{s.nome}</span>
								{s.em_uso ? <Pilula tom="ok" className="!text-[10px]">ligado</Pilula> : <Pilula tom="atencao" className="!text-[10px]">pausado</Pilula>}
							</button>
						))}
					</div>
				</div>
			)}
			{pedindo === 'desfazer' && (
				<Modal titulo={conflitos ? 'Alguém mexeu nestes segmentos depois' : 'Desfazer a aplicação?'}
					texto={conflitos ? `${conflitos.join(', ')} ${conflitos.length === 1 ? 'mudou' : 'mudaram'} depois da aplicação. Desfazer volta ao que era antes da aplicação e perde essa mudança.`
						: 'Volta condições, nomes, ordem, vínculos e Demais ao que eram e desliga nesta carteira os segmentos criados (nada é apagado; as estratégias criadas ficam na empresa). Mensagens já enviadas não voltam.'}
					confirmar={conflitos ? 'Desfazer mesmo assim' : 'Desfazer'} perigo ocupado={ocupado}
					onConfirmar={() => void desfazer(!!conflitos)} onFechar={() => { setPedindo(null); setConflitos(null); }} />
			)}
		</div>
	);
}
