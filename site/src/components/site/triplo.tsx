const cols = [
	{ t: 'Decide.', p: 'Cada cliente cai num segmento e recebe a ação do dia, no canal certo e no telefone Hot primeiro.' },
	{ t: 'Aprende.', p: 'Cada ocorrência volta para o motor. CPC vira Hot, número inválido sai, o melhor canal de cada perfil aparece.' },
	{ t: 'Prova.', p: 'Cada ação fica registrada com o motivo. O relatório do comitê sai pronto todo mês.' },
];

export function Triplo() {
	return (
		<section className="bg-[#F5F5F7] px-5 py-20 md:py-28">
			<div className="mx-auto grid max-w-[1120px] gap-10 md:grid-cols-3 md:gap-8">
				{cols.map(c => (
					<div key={c.t}>
						<h3 className="ls-tight text-[28px] font-bold text-[#1D1D1F]">{c.t}</h3>
						<p className="mt-3 text-[17px] leading-relaxed text-[#6E6E73]">{c.p}</p>
					</div>
				))}
			</div>
		</section>
	);
}
