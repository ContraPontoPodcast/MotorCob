import { SecaoDupla } from './secao-dupla';

const itens = [
	{ nome: 'Membros e perfis', texto: 'Convite, perfil por produto e verificação em duas etapas.' },
	{ nome: 'Suporte por chamado', texto: 'Protocolo, anexos e resposta na plataforma.' },
	{ nome: 'Faturas e consumo', texto: 'Mensalidade, uso do mês, boleto e nota fiscal.' },
	{ nome: 'Documentação e dicas', texto: 'Respostas rápidas sem sair da tela.' },
];

export function WorkspaceSite() {
	return (
		<SecaoDupla
			id="workspace-site"
			bg="#F5F5F7"
			rotulo="Workspace"
			titulo="Tudo da sua empresa em um lugar."
			texto="Um início que mostra só o que pede atenção, e o resto a um atalho de distância."
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
