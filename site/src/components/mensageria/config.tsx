import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { CANAL_NOME } from '@/lib/mensageria';

type CanalHorario = { canal: string; janela_inicio: string | null; janela_fim: string | null; sabado: boolean };

export function ConfigMensageria() {
	const { empresa } = useMotorAuth();
	const [aprovar, setAprovar] = useState(true);
	const [carregado, setCarregado] = useState(false);
	const [horarios, setHorarios] = useState<CanalHorario[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [sucesso, setSucesso] = useState('');

	// Lê config (aprovar_lotes) e horários dos canais.
	useEffect(() => {
		if (!supabase || !empresa) return;
		let active = true;
		(async () => {
			const { data: cfg } = await supabase.from('mensageria_config').select('*').eq('empresa_id', empresa.id).maybeSingle();
			if (!active) return;
			const c = cfg as Row | null;
			setAprovar(c?.aprovar_lotes == null ? true : !!c.aprovar_lotes);
			setCarregado(true);

			const { data: ch } = await supabase.from('canais_empresa').select('canal,janela_inicio,janela_fim,sabado').eq('empresa_id', empresa.id);
			if (!active) return;
			setHorarios(((ch ?? []) as Row[]).map((r) => ({
				canal: String(r.canal),
				janela_inicio: (r.janela_inicio as string) ?? null,
				janela_fim: (r.janela_fim as string) ?? null,
				sabado: !!r.sabado,
			})));
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	async function toggleAprovar(on: boolean) {
		if (!supabase || !empresa) return;
		setBusy(true); setError(''); setSucesso('');
		const { error } = await supabase.rpc('definir_aprovacao_lotes', { empresa: empresa.id, aprovar: on });
		setBusy(false);
		if (error) { setError(friendlyError(error)); return; }
		setAprovar(on);
		setSucesso(on ? 'Aprovação de lotes ativada.' : 'Aprovação de lotes desligada.');
	}

	const canaisMensageria = ['sms', 'email', 'rcs', 'whatsapp'];
	const horarioPorCanal = (canal: string) => horarios.find((h) => h.canal === canal);

	if (!carregado) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;

	return (
		<div className="space-y-4">
			{error && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
			{sucesso && <div className="rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">{sucesso}</div>}

			{/* Aprovação de lotes */}
			<div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<p className="text-[16px] font-semibold text-[#1D1D1F]">Aprovar cada lote antes do envio</p>
						<p className="mt-1 text-[14px] text-[#6E6E73]">Desligado, o lote do dia sai sozinho no horário do canal.</p>
					</div>
					<button role="switch" aria-checked={aprovar} disabled={busy} onClick={() => toggleAprovar(!aprovar)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${aprovar ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}>
						<span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${aprovar ? 'left-6' : 'left-1'}`} />
					</button>
				</div>
			</div>

			{/* Horário dos canais */}
			<div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div>
						<p className="text-[16px] font-semibold text-[#1D1D1F]">Horário dos canais</p>
						<p className="mt-1 text-[14px] text-[#6E6E73]">Segunda a sábado, conforme configurado em Canais e mensagens. Domingo nunca envia.</p>
					</div>
					<Link to="/canais" className="rounded-full border border-[#D2D2D7] px-4 py-2 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Alterar em Canais e mensagens</Link>
				</div>
				<div className="divide-y divide-[#F0F0F2]">
					{canaisMensageria.map((canal) => {
						const h = horarioPorCanal(canal);
						const inicio = h?.janela_inicio ?? '08:00';
						const fim = h?.janela_fim ?? '20:00';
						return (
							<div key={canal} className="flex flex-wrap items-center justify-between gap-2 py-3">
								<span className="text-[15px] font-medium text-[#1D1D1F]">{CANAL_NOME[canal] ?? canal}</span>
								<span className="text-[14px] tnum text-[#6E6E73]">{inicio}–{fim} · {h?.sabado ? 'sábado até 14:00' : 'sem sábado'}</span>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
