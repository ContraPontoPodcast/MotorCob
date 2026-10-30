import { SecaoDupla } from './secao-dupla';

const cards = [
	{ nome: 'SMS', texto: 'Remetente da empresa · respostas “SAIR” viram descadastro' },
	{ nome: 'E-mail', texto: 'Domínio verificado (SPF, DKIM, DMARC)' },
	{ nome: 'RCS', texto: 'Agente com o seu logo · Basic, Single e Conversacional · cartões, carrossel e botões · SMS de reserva' },
	{ nome: 'WhatsApp', texto: 'Em breve', breve: true },
];

export function MensageriaSite() {
	return (
		<SecaoDupla
			id="mensageria-site"
			bg="#F5F5F7"
			rotulo="Mensageria"
			titulo="Do arquivo ao envio, sem trocar de sistema."
			texto="Os lotes da Lista do dia saem da plataforma no horário permitido, e a entrega, a leitura e o descadastro voltam para o motor."
		>
			<div className="grid gap-4 sm:grid-cols-2">
				{cards.map(c => (
					<div key={c.nome} className="rounded-[16px] bg-white p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)', opacity: c.breve ? 0.6 : 1 }}>
						<p className="text-[17px] font-semibold text-[#1D1D1F]">{c.nome}</p>
						<p className="mt-1.5 text-[15px] leading-relaxed text-[#6E6E73]">{c.texto}</p>
					</div>
				))}
			</div>
		</SecaoDupla>
	);
}
