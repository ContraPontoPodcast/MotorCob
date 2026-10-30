import { agentesSite } from '@/data/site';

export function Agentes() {
	return (
		<section id="agentes" className="scroll-mt-[92px] bg-white px-5 py-20 md:scroll-mt-[64px] md:py-28">
			<div className="mx-auto max-w-[1120px]">
				<p className="text-center text-[17px] font-semibold text-[#6E6E73]">Seus agentes</p>
				<h2 className="ls-tight mt-3 text-center font-bold text-[#1D1D1F]" style={{ fontSize: 'clamp(32px, 5vw, 56px)' }}>Quatro especialistas, trabalhando antes de você chegar.</h2>
				<div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
					{agentesSite.map(a => (
						<div key={a.titulo} className="rounded-[18px] bg-[#F5F5F7] p-6">
							<h3 className="text-[19px] font-semibold text-[#1D1D1F]">{a.titulo}</h3>
							<p className="mt-2 text-[14px] leading-relaxed text-[#6E6E73]">{a.texto}</p>
						</div>
					))}
				</div>
				<p className="ls-tight mt-12 text-center text-[24px] font-bold text-[#1D1D1F]">A IA aprende. Você decide.</p>
			</div>
		</section>
	);
}
