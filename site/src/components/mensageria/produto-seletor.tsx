import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Mail, MessageCircle, MessageSquare, Smartphone, ChevronRight } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { PRODUTOS, CANAL_STORAGE_KEY, type CanalId } from '@/lib/mensageria-produtos';
import { MensageriaModal } from '@/components/workspace/mensageria-modal';

const ICONS: Record<string, typeof Mail> = { sms: MessageSquare, rcs: Smartphone, email: Mail, whatsapp: MessageCircle };

export function ProdutoSeletor() {
	const { empresa } = useMotorAuth();
	const [liberados, setLiberados] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [interesse, setInteresse] = useState(false);
	const navigate = useNavigate();

	useEffect(() => {
		if (!supabase || !empresa) { setLoading(false); return; }
		let active = true;
		(async () => {
			const { data, error } = await supabase.from('empresa_modulos').select('canais').eq('empresa_id', empresa.id).eq('modulo', 'mensageria').maybeSingle();
			if (!active) return;
			if (error) { setErro(friendlyError(error)); setLoading(false); return; }
			const c = (data as Row | null)?.canais;
			const list = Array.isArray(c) ? c as string[] : [];
			setLiberados(list);
			setLoading(false);
			// Um canal só: vai direto para ele (replace).
			if (list.length === 1) {
				try { localStorage.setItem(CANAL_STORAGE_KEY, list[0]); } catch { /* ignore */ }
				navigate(`/mensageria/${list[0]}`, { replace: true });
			}
		})();
		return () => { active = false; };
	}, [empresa?.id, navigate]);

	function abrir(canal: CanalId) {
		try { localStorage.setItem(CANAL_STORAGE_KEY, canal); } catch { /* ignore */ }
		navigate(`/mensageria/${canal}`);
	}

	if (!empresa) {
		return (
			<div className="mx-auto max-w-[1080px] px-4 py-10">
				<div className="rounded-2xl bg-white p-10 text-center text-[#6E6E73]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					Escolha a empresa no topo para ver a Mensageria.
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-[1080px] px-4 py-8">
			<h1 className="mb-2 text-[26px] font-bold tracking-tight text-[#1D1D1F]">Mensageria</h1>
			<p className="mb-6 text-[15px] text-[#6E6E73]">Escolha o canal para acompanhar lotes, campanhas e respostas.</p>

			{erro && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{loading ? (
				<p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					{PRODUTOS.map(p => {
						const liberado = liberados.includes(p.id);
						const Icon = ICONS[p.id] ?? MessageSquare;
						return (
							<div key={p.id} className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
								<div className="flex items-start gap-4">
									<div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: p.cor }}>
										<Icon size={24} strokeWidth={1.8} />
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<h2 className="text-[18px] font-semibold text-[#1D1D1F]">{p.nome}</h2>
											{!liberado && <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[11px] font-semibold text-[#8E8E93]">Indisponível</span>}
										</div>
										<p className="mt-1 text-[14px] leading-snug text-[#6E6E73]">{p.descricao}</p>
									</div>
								</div>
								<div className="mt-5 flex justify-end">
									{liberado ? (
										<button onClick={() => abrir(p.id)} className="flex h-9 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">
											Abrir <ChevronRight size={15} />
										</button>
									) : (
										<button onClick={() => setInteresse(true)} className="flex h-9 items-center gap-1.5 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
											Quero conhecer
										</button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}

			<div className="mt-6 flex items-center gap-2 text-[13px] text-[#8E8E93]">
				<Link to="/relatorios" className="font-medium text-[#0A60D0] hover:underline">Ver relatórios</Link>
				<span>·</span>
				<Link to="/mensageria" className="hover:underline">Mensageria</Link>
			</div>

			<MensageriaModal open={interesse} onClose={() => setInteresse(false)} />
		</div>
	);
}
