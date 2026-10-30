import { SecaoDupla } from './secao-dupla';

const itens = [
	{ nome: 'Réguas por segmento', texto: 'Dia a dia, com “senão” e reserva para quem não atendeu.' },
	{ nome: 'Telefone Hot primeiro', texto: 'Quem deu CPC vira prioridade em todos os canais.' },
	{ nome: 'Lista do dia com motivo', texto: 'Quem entra, quem fica de fora e por quê.' },
	{ nome: 'Comitê pronto', texto: 'O relatório mensal sai sozinho.' },
];

export function OrquestracaoSite() {
	return (
		<SecaoDupla
			id="orquestracao-site"
			bg="#FFFFFF"
			rotulo="Orquestração"
			titulo="Cada cliente no canal certo, no dia certo."
			texto="Segmentos, réguas e personas decidem quem acionar, por qual canal e em qual telefone. O motor aprende com cada ocorrência e propõe mudanças com evidência."
		>
			<div className="divide-y divide-[#E5E5EA]">
				{itens.map(it => (
					<div key={it.nome} className="py-5">
						<p className="text-[17px] font-semibold text-[#1D1D1F]">{it.nome}</p>
						<p className="mt-1 text-[15px] leading-relaxed text-[#6E6E73]">{it.texto}</p>
					</div>
				))}
			</div>
		</SecaoDupla>
	);
}
