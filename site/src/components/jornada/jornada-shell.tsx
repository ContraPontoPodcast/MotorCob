import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Wallet, Plus } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, type Credor, type Row } from '@/lib/supabase';

/** Carteiras (credores) da frente MotorCli da empresa ativa. Seleção por ?carteira=. */
export function useJornadaCarteira() {
	const { empresa } = useMotorAuth();
	const [searchParams, setSearchParams] = useSearchParams();
	const [carteiras, setCarteiras] = useState<Credor[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!supabase || !empresa) { setCarteiras([]); setLoading(false); return; }
		let active = true;
		supabase.from('credores').select('*').eq('empresa_id', empresa.id).order('nome')
			.then(({ data }) => {
				if (!active) return;
				// frente='motorcli' (defensivo: se a coluna ainda não existe, vem vazio).
				const list = ((data ?? []) as Row[]).filter(r => r.frente === 'motorcli') as unknown as Credor[];
				setCarteiras(list);
				setLoading(false);
			});
		return () => { active = false; };
	}, [empresa?.id]);

	const codigo = searchParams.get('carteira');
	const carteira = carteiras.find(c => c.codigo === codigo) ?? carteiras[0] ?? null;

	function setCarteira(c: Credor | null) {
		setSearchParams(prev => { if (c) prev.set('carteira', c.codigo); else prev.delete('carteira'); return prev; }, { replace: true });
	}

	return { empresa, carteiras, carteira, setCarteira, loading };
}

/** Cabeçalho das telas da Jornada: título + linha de contexto + seletor de Carteira. */
export function JornadaHeading({ title, linha, actions }: { title: string; linha?: string; actions?: ReactNode }) {
	const { carteiras, carteira, setCarteira, loading } = useJornadaCarteira();
	return (
		<div className="mb-7 flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0">
				<h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#1D1D1F]">{title}</h1>
				{linha && <p className="mt-1 text-[14px] text-[#6E6E73]">{linha}</p>}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{!loading && carteiras.length > 0 && (
					<label className="flex h-9 items-center gap-1.5 rounded-[10px] bg-[#F2F2F7] px-3 text-[13px] font-medium text-[#1D1D1F]">
						<Wallet size={15} className="text-[#8E8E93]" />
						<span className="sr-only">Carteira</span>
						<select aria-label="Carteira" value={carteira?.codigo ?? ''} onChange={e => setCarteira(carteiras.find(c => c.codigo === e.target.value) ?? null)} className="h-9 max-w-[200px] bg-transparent text-[13px] font-medium outline-none">
							{carteiras.map(c => <option key={c.id} value={c.codigo}>{c.nome}</option>)}
						</select>
					</label>
				)}
				{actions}
			</div>
		</div>
	);
}

/** Card "Crie a primeira carteira" mostrado quando a empresa não tem carteira MotorCli. */
export function SemCarteiraCard() {
	return (
		<div className="rounded-2xl bg-[#F5F5F7] px-6 py-16 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA' }}>
				<Wallet size={26} className="text-[#8E8E93]" />
			</div>
			<h2 className="text-lg font-semibold text-[#1D1D1F]">Nenhuma carteira da Jornada</h2>
			<p className="mx-auto mt-2 max-w-sm text-sm text-[#6E6E73]">Crie a primeira carteira para começar a enviar a jornada dos seus clientes.</p>
			<Link to="/jornada/carteiras" className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">
				<Plus size={16} /> Criar carteira
			</Link>
		</div>
	);
}
