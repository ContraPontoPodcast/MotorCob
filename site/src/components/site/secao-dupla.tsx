export function SecaoDupla({
	id,
	bg,
	rotulo,
	titulo,
	texto,
	children,
}: {
	id: string;
	bg: string;
	rotulo: string;
	titulo: string;
	texto: string;
	children: React.ReactNode;
}) {
	return (
		<section id={id} className="scroll-mt-[92px] px-5 py-24 md:scroll-mt-[64px]" style={{ backgroundColor: bg }}>
			<div className="mx-auto grid max-w-[1120px] gap-10 md:grid-cols-[0.85fr_1.15fr] md:gap-16">
				<div>
					<p className="text-[17px] font-semibold text-[#6E6E73]">{rotulo}</p>
					<h2 className="ls-tight mt-3 font-bold text-[#1D1D1F]" style={{ fontSize: 'clamp(30px, 5vw, 52px)', lineHeight: 1.1 }}>{titulo}</h2>
					<p className="mt-4 text-[18px] leading-relaxed text-[#6E6E73]">{texto}</p>
				</div>
				<div className="min-w-0">{children}</div>
			</div>
		</section>
	);
}
