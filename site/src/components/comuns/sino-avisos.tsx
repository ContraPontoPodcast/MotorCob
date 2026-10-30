import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell } from 'lucide-react';
import { supabase, type Row } from '@/lib/supabase';

export type Aviso = {
	id: string;
	tipo: 'pronto' | 'atencao' | 'erro';
	titulo: string;
	texto: string | null;
	link: string | null;
	criado_em: string;
	lido: boolean;
};

/** "há 5 min", "há 2 h", "há 3 dias". */
export function tempoRelativo(iso: string): string {
	const d = new Date(iso);
	if (isNaN(d.getTime())) return '';
	const diff = Date.now() - d.getTime();
	const min = Math.floor(diff / 60000);
	if (min < 1) return 'agora';
	if (min < 60) return `há ${min} min`;
	const h = Math.floor(min / 60);
	if (h < 24) return `há ${h} h`;
	const dias = Math.floor(h / 24);
	if (dias < 30) return `há ${dias} dia${dias > 1 ? 's' : ''}`;
	const meses = Math.floor(dias / 30);
	return `há ${meses} ${meses > 1 ? 'meses' : 'mês'}`;
}

/**
 * Sino de avisos da barra do topo (plataforma e Console).
 * Mostra o número de avisos novos (rpc avisos_novos), atualizado a cada 60 s
 * e ao voltar para a aba. O painel lista meus_avisos(30); o link é sempre uma
 * rota interna — navega pelo router e marca o aviso como lido.
 *
 * `onDark` adapta o ícone a fundos escuros (menu lateral, barra do mobile).
 * Ninguém cria aviso pelo site: quem grava é o motor.
 */
export function SinoAvisos({ onDark = false }: { onDark?: boolean } = {}) {
	const navigate = useNavigate();
	const [novos, setNovos] = useState(0);
	const [aberto, setAberto] = useState(false);
	const [avisos, setAvisos] = useState<Aviso[]>([]);
	const [loading, setLoading] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	const carregarNovos = useCallback(async () => {
		if (!supabase) return;
		try {
			const { data } = await supabase.rpc('avisos_novos');
			setNovos(Number((data as Row | null)?.total ?? 0));
		} catch { /* ignora; tenta no próximo ciclo */ }
	}, []);

	const carregarAvisos = useCallback(async () => {
		if (!supabase) return;
		setLoading(true);
		try {
			const { data } = await supabase.rpc('meus_avisos', { limite: 30 });
			setAvisos((data ?? []) as Aviso[]);
		} catch { /* ignora */ }
		setLoading(false);
	}, []);

	// Conta de novos a cada 60 s e ao voltar à aba.
	useEffect(() => {
		void carregarNovos();
		const id = window.setInterval(carregarNovos, 60000);
		function onVis() { if (document.visibilityState === 'visible') void carregarNovos(); }
		document.addEventListener('visibilitychange', onVis);
		return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
	}, [carregarNovos]);

	// Carrega a lista ao abrir.
	useEffect(() => {
		if (!aberto) return;
		void carregarAvisos();
	}, [aberto, carregarAvisos]);

	// Fecha ao clicar fora ou com Esc.
	useEffect(() => {
		if (!aberto) return;
		function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setAberto(false); }
		document.addEventListener('mousedown', onClick);
		document.addEventListener('keydown', onKey);
		return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
	}, [aberto]);

	async function marcarLido(id: string) {
		if (!supabase) return;
		setAvisos(prev => prev.map(a => a.id === id ? { ...a, lido: true } : a));
		setNovos(n => Math.max(0, n - 1));
		try { await supabase.rpc('marcar_avisos_lidos', { ids: [id] }); } catch { /* ignora */ }
	}

	async function marcarTodas() {
		if (!supabase) return;
		setAvisos(prev => prev.map(a => ({ ...a, lido: true })));
		setNovos(0);
		try { await supabase.rpc('marcar_avisos_lidos'); } catch { /* ignora */ }
	}

	function abrirLink(aviso: Aviso) {
		void marcarLido(aviso.id);
		setAberto(false);
		if (aviso.link) navigate(aviso.link);
	}

	const temNaoLidos = avisos.some(a => !a.lido);

	return (
		<div className="relative" ref={ref}>
			<button
				onClick={() => setAberto(o => !o)}
				aria-label={novos > 0 ? `Avisos, ${novos} novos` : 'Avisos'}
				aria-expanded={aberto}
				className={`relative grid h-9 w-9 place-items-center rounded-full transition-colors ${onDark ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-[#8E8E93] hover:bg-[#F5F5F7] hover:text-[#1D1D1F]'}`}
			>
				<Bell size={18} />
				{novos > 0 && (
					<span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[10px] font-bold text-white tnum">{novos > 99 ? '99+' : novos}</span>
				)}
			</button>

			{aberto && (
				<div className="absolute right-0 top-11 z-50 w-[380px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
					<div className="flex items-center justify-between border-b border-[#E5E5EA] px-4 py-3">
						<h2 className="text-[15px] font-semibold text-[#1D1D1F]">Avisos</h2>
						{temNaoLidos && (
							<button onClick={() => void marcarTodas()} className="text-[13px] font-medium text-[#0A60D0] hover:underline">Marcar todas como lidas</button>
						)}
					</div>
					<div className="max-h-[420px] overflow-y-auto">
						{loading ? (
							<p className="px-4 py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
						) : avisos.length === 0 ? (
							<p className="px-4 py-8 text-center text-[14px] text-[#8E8E93]">Nenhum aviso nos últimos 90 dias.</p>
						) : (
							avisos.map(a => (
								<div key={a.id} className={`flex gap-3 border-b border-[#F0F0F2] px-4 py-3 last:border-b-0 ${a.lido ? '' : 'bg-[#F8F9FB]'}`}>
									<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: a.lido ? 'transparent' : 'var(--area)' }} />
									<div className="min-w-0 flex-1">
										<p className={`text-[14px] leading-snug ${a.lido ? 'font-normal text-[#1D1D1F]' : 'font-semibold text-[#1D1D1F]'}`}>{a.titulo}</p>
										{a.texto && <p className="mt-0.5 text-[13px] leading-snug text-[#6E6E73]">{a.texto}</p>}
										<div className="mt-1.5 flex items-center gap-3">
											<span className="text-[11px] text-[#8E8E93]">{tempoRelativo(a.criado_em)}</span>
											{a.link && <button onClick={() => abrirLink(a)} className="text-[12px] font-medium text-[#0A60D0] hover:underline">Abrir</button>}
											{!a.lido && !a.link && <button onClick={() => void marcarLido(a.id)} className="text-[12px] font-medium text-[#8E8E93] hover:text-[#1D1D1F]">Marcar como lida</button>}
										</div>
									</div>
								</div>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
}
