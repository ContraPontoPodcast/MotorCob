import type { Route } from './+types/privacidade';
import { seo } from '@/lib/seo';
import { RotorMark } from '@/components/site/logo';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, {
		title: 'Privacidade · MotorCX',
		description: 'Como o MotorCX trata os dados de contato e de devedores, o isolamento por empresa e os direitos do titular.',
	});
}

const sections = [
	{ t: 'Dados que tratamos', p: 'O MotorCX processa dados de contato fornecidos pelo credor (ID do cliente, telefones, canal e histórico de ocorrências) com a finalidade de decidir e executar ações de cobrança.' },
	{ t: 'Isolamento por empresa', p: 'Cada empresa acessa somente a sua própria carteira. Não há compartilhamento de dados entre clientes do MotorCX, e o acesso interno é controlado por papel e por exceção.' },
	{ t: 'Telas sem dado pessoal', p: 'A operação mostra o ID do cliente, nunca CPF ou telefone completo. Dados sensíveis ficam restritos aos pontos estritamente necessários da execução.' },
	{ t: 'Retenção', p: 'Os dados são mantidos pelo prazo necessário à atividade de cobrança e aos prazos legais aplicáveis. Ao término, são removidos ou anonimizados.' },
	{ t: 'Seus direitos', p: 'Você pode solicitar acesso, correção ou exclusão dos seus dados escrevendo para o contato do credor responsável pela sua dívida ou para o MotorCX.' },
];

export default function Privacidade() {
	return (
		<main className="min-h-screen bg-white px-5 py-24 text-[#1D1D1F]">
			<div className="mx-auto max-w-[720px]">
				<div className="flex items-center gap-3"><RotorMark tone="onLight" className="h-9 w-9" /><span className="text-[19px] font-semibold" style={{ letterSpacing: '-0.02em' }}>MotorCX</span></div>
				<h1 className="ls-tight mt-10 text-[40px] font-bold" style={{ lineHeight: 1.1 }}>Privacidade</h1>
				<p className="mt-4 text-[17px] leading-relaxed text-[#6E6E73]">O MotorCX trata dados de contato para a atividade de cobrança, com isolamento por empresa e sem expor dado pessoal na operação.</p>
				<div className="mt-10 space-y-8">
					{sections.map(s => (
						<div key={s.t}>
							<h2 className="text-[19px] font-semibold text-[#1D1D1F]">{s.t}</h2>
							<p className="mt-2 text-[15px] leading-relaxed text-[#6E6E73]">{s.p}</p>
						</div>
					))}
				</div>
				<p className="mt-12 text-[13px] text-[#6E6E73]">© {new Date().getFullYear()} MotorCX</p>
			</div>
		</main>
	);
}
