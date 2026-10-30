import { useEffect, useState } from 'react';
import { ChevronDown, FlaskConical, Layers3, Scale, TrendingUp } from 'lucide-react';

const STORAGE_KEY = 'motorcob.personas.como-mede';

/** Bloco explicativo "Como o MotorCob mede" — recolhível, aberto na 1ª visita. */
export function ComoMotorCobMede({ caracteristicas }: { caracteristicas: string[] }) {
	const [open, setOpen] = useState(true);

	useEffect(() => {
		try {
			const seen = localStorage.getItem(STORAGE_KEY);
			if (seen === '1') setOpen(false);
		} catch { /* noop */ }
	}, []);

	function toggle() {
		setOpen(prev => {
			const next = !prev;
			try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* noop */ }
			return next;
		});
	}

	const passos = [
		{ icon: FlaskConical, titulo: 'Cada acionamento vira uma tentativa', texto: 'Cliente × canal × dia. Se a ocorrência voltou como CPC (pelo mapeamento de ocorrências do credor), a tentativa deu certo.' },
		{ icon: Layers3, titulo: 'O motor descobre o que separa os clientes', texto: 'Ele testa as colunas da carga (UF, faixa de saldo, faixa de atraso, DDD, tem WhatsApp…) e fica com as que mais mudam a taxa de CPC por canal. Cada combinação vira uma persona.' },
		{ icon: Scale, titulo: 'Pouco volume não decide sozinho', texto: 'Enquanto a persona tem poucas tentativas num canal, a taxa dela é puxada para a média da carteira. Quanto mais tentativas, mais pesa o dado da própria persona.' },
		{ icon: TrendingUp, titulo: 'O ranking é CPC por real gasto', texto: 'Taxa de CPC ÷ custo do canal (página Canais). O 1º é o ★ Melhor canal da persona, o 2º é o ☆ 2º melhor. Só entram canais que o cliente tem. Todo dia ~10% dos clientes começam pelo 2º canal, para o motor continuar testando.' },
	];

	return (
		<section className="mb-6 overflow-hidden rounded-xl border border-[#dfe8ea] bg-white">
			<button type="button" aria-expanded={open} onClick={toggle} className="flex w-full items-center justify-between px-5 py-4 text-left">
				<div className="min-w-0">
					<h2 className="text-sm font-bold text-[#163943]">Como o MotorCX escolhe o melhor canal de cada persona</h2>
					<p className="mt-0.5 truncate text-[11px] text-slate-500">4 passos curtos para entender o que está sendo visto aqui.</p>
				</div>
				<ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
			</button>
			{open && (
				<div className="border-t border-[#ecf0f1] p-5">
					<ol className="grid gap-4 sm:grid-cols-2">
						{passos.map((p, i) => {
							const Icon = p.icon;
							return (
								<li key={i} className="flex gap-3">
									<span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#eaf2f3] text-[#0F4C5C]"><Icon size={16} /></span>
									<div className="min-w-0">
										<p className="text-xs font-bold text-[#163943]">{i + 1}. {p.titulo}</p>
										<p className="mt-1 text-[11px] leading-relaxed text-slate-500">{p.texto}</p>
									</div>
								</li>
							);
						})}
					</ol>

					{caracteristicas.length > 0 && (
						<div className="mt-4 rounded-lg bg-[#f5f8f9] p-3">
							<p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Colunas escolhidas pelo motor</p>
							<div className="flex flex-wrap gap-1.5">
								{caracteristicas.map(c => (
									<span key={c} className="inline-flex items-center gap-1 rounded-full bg-[#eaf2f3] px-2.5 py-0.5 text-[11px] font-semibold text-[#0F4C5C]">{c}</span>
								))}
							</div>
							<p className="mt-2 text-[10px] text-slate-400">São as que mais mudam a resposta por canal.</p>
						</div>
					)}

					<p className="mt-4 text-[11px] italic text-slate-400">A persona é refeita todo dia com as ocorrências até ontem.</p>
				</div>
			)}
		</section>
	);
}
