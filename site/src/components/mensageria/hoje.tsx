import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { supabase, friendlyError, today, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { LoteCard, type AcaoLote } from '@/components/mensageria/lote-card';
import type { LoteMensageria } from '@/lib/mensageria';

export function HojeMensageria() {
	const { empresa, permissoes } = useMotorAuth();
	const canAct = permissoes.includes('enviar_mensagens');
	const [lotes, setLotes] = useState<LoteMensageria[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busyId, setBusyId] = useState<string | null>(null);
	const [temModelo, setTemModelo] = useState<boolean | null>(null);
	const timer = useRef<number | null>(null);

	const reload = useCallback(async () => {
		if (!supabase || !empresa) return;
		const { data, error } = await supabase.from('mensageria_lotes').select('*').eq('empresa_id', empresa.id).eq('data', today());
		if (error) { setError(friendlyError(error)); setLoading(false); return; }
		setLotes((data ?? []) as LoteMensageria[]);
		setError('');
		setLoading(false);
	}, [empresa?.id]);

	// Verifica se há modelo de e-mail (para o aviso de bloqueio).
	useEffect(() => {
		if (!supabase || !empresa) return;
		let active = true;
		(async () => {
			const { data } = await supabase.from('mensageria_modelos_email').select('empresa_id').eq('empresa_id', empresa.id).maybeSingle();
			if (active) setTemModelo(!!(data as Row | null));
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	useEffect(() => {
		if (!empresa) return;
		void reload();
	}, [reload, empresa?.id]);

	// Atualiza a cada 30 s com a aba visível.
	useEffect(() => {
		function tick() { if (document.visibilityState === 'visible') void reload(); }
		timer.current = window.setInterval(tick, 30000);
		return () => { if (timer.current) window.clearInterval(timer.current); };
	}, [reload]);

	async function onAction(id: string, acao: AcaoLote) {
		if (!supabase) return;
		setBusyId(id);
		const { error } = await supabase.rpc('mudar_lote', { lote: id, acao });
		if (error) setError(friendlyError(error));
		else { await reload(); setError(''); }
		setBusyId(null);
	}

	if (loading) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;

	return (
		<div className="space-y-4">
			{error && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

			{temModelo === false && (
				<div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#FFF8E1] px-5 py-4" style={{ border: '1px solid #FFE08A' }}>
					<p className="flex-1 text-[14px] text-[#9a631b]">Sem modelo de e-mail cadastrado, os lotes de e-mail ficam bloqueados.</p>
					<Link to="/mensageria/email" className="shrink-0 rounded-full bg-[#1D1D1F] px-4 py-2 text-[13px] font-medium text-white hover:opacity-85">Cadastrar modelo</Link>
				</div>
			)}

			{lotes.length === 0 ? (
				<div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<p className="text-[15px] text-[#1D1D1F]">Nenhum lote hoje.</p>
					<p className="mt-1 text-[14px] text-[#6E6E73]">Os lotes nascem da Lista do dia, por volta das 6h.</p>
				</div>
			) : (
				lotes.map((l) => (
					<LoteCard key={l.id} lote={l} canAct={canAct} busyId={busyId} onAction={onAction} />
				))
			)}
		</div>
	);
}
