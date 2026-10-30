import { SecaoDupla } from './secao-dupla';

const cards = [
	{ nome: 'Arquivo', texto: 'Carga geral, incremental, retirada, acordos, pagamentos e ocorrências. O MotorCX reconhece o layout.' },
	{ nome: 'API', texto: 'O sistema do credor manda direto, com token e escopo. Mesmo relatório do arquivo.' },
];

export function CargaSite() {
	return (
		<SecaoDupla
			id="carga-site"
			bg="#FFFFFF"
			rotulo="Arquivo ou API"
			titulo="Sua carga, do jeito que ela existe hoje."
			texto="Cada credor escolhe como os dados chegam. Começa por arquivo e passa para API quando a integração estiver pronta, sem refazer nada."
		>
			<div className="grid gap-4 sm:grid-cols-2">
				{cards.map(c => (
					<div key={c.nome} className="rounded-[16px] p-5" style={{ backgroundColor: '#F5F5F7' }}>
						<p className="text-[17px] font-semibold text-[#1D1D1F]">{c.nome}</p>
						<p className="mt-1.5 text-[15px] leading-relaxed text-[#6E6E73]">{c.texto}</p>
					</div>
				))}
			</div>
		</SecaoDupla>
	);
}
