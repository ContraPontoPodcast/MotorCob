import { heroSteps } from '@/data/site';

export function Hero() {
	return (
		<section id="top" className="scroll-mt-[92px] bg-white px-5 pt-32 pb-20 md:scroll-mt-[64px] md:pt-40 md:pb-28">
			<div className="mx-auto max-w-[980px] text-center">
				<p className="text-[17px] font-semibold text-[#6E6E73]">Inteligência de contato para cobrança</p>
				<h1 className="ls-tight mt-5 font-bold text-[#1D1D1F]" style={{ fontSize: 'clamp(40px, 9vw, 112px)', lineHeight: 1.05 }}>Pare de adivinhar.</h1>
				<p className="mx-auto mt-6 max-w-[680px] leading-relaxed text-[#6E6E73]" style={{ fontSize: 'clamp(17px, 2vw, 21px)' }}>
					O MotorCX usa seus agentes de IA para decidir, para cada cliente da carteira, <span className="font-semibold text-[#1D1D1F]">quem acionar, por qual canal e em qual telefone.</span> Todo dia. E eles aprendem com cada ocorrência.
				</p>
				<div className="mt-9 flex flex-wrap items-center justify-center gap-3">
					<a href="#contato" className="rounded-full bg-[#1D1D1F] px-6 py-3 text-[15px] font-medium text-white transition-colors hover:bg-[#3a3a3c]">Agendar uma conversa</a>
					<a href="#produto" className="rounded-full bg-[#F2F2F7] px-6 py-3 text-[15px] font-medium text-[#1D1D1F] transition-colors hover:bg-[#e5e5ea]">Ver a plataforma</a>
				</div>
			</div>

			<div className="mx-auto mt-16 max-w-[980px] rounded-[18px] bg-[#F5F5F7] p-6 md:p-10">
				<p className="text-[13px] font-semibold text-[#6E6E73]">Como o MotorCX decide um cliente, antes do primeiro disparo do dia</p>

				<div className="mt-7 hidden md:block">
					<div className="relative flex items-start justify-between">
						<div className="absolute left-[8%] right-[8%] top-[4px] h-px bg-[#D2D2D7]" />
						{heroSteps.map((s, i) => (
							<div key={i} className="relative z-10 flex w-1/6 flex-col items-center px-2 text-center">
								<span className="mb-3 block h-[9px] w-[9px] rounded-full" style={{ backgroundColor: s.positive ? '#34C759' : '#1D1D1F' }} />
								<span className="text-[12px] text-[#6E6E73]">{s.label}</span>
								<span className="mt-1 text-[15px] font-semibold" style={{ color: s.positive ? '#248A3D' : '#1D1D1F', whiteSpace: s.nowrap ? 'nowrap' : undefined }}>{s.value}</span>
							</div>
						))}
					</div>
				</div>

				<div className="mt-2 divide-y divide-[#E5E5EA] md:hidden">
					{heroSteps.map((s, i) => (
						<div key={i} className="flex items-center justify-between gap-3 py-3">
							<span className="text-[12px] text-[#6E6E73]">{s.label}</span>
							<span className="text-[15px] font-semibold" style={{ color: s.positive ? '#248A3D' : '#1D1D1F', whiteSpace: s.nowrap ? 'nowrap' : undefined }}>{s.value}</span>
						</div>
					))}
				</div>

				<p className="mt-7 text-[12px] text-[#6E6E73]">Dados fictícios. O MotorCX mostra só o ID do cliente, nunca CPF ou telefone completo.</p>
			</div>
		</section>
	);
}
