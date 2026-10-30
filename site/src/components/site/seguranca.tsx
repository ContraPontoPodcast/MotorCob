const items = [
	{ t: 'Isolamento por empresa', p: 'Garantido no banco de dados, não só na tela.' },
	{ t: 'Telas sem dado pessoal', p: 'O site mostra o ID do cliente, nunca CPF ou telefone completo.' },
	{ t: 'Permissões e histórico', p: 'Cada perfil vê o que deve. Cada alteração fica registrada.' },
	{ t: 'Duas etapas e sessões', p: 'Código do autenticador, sessões visíveis e encerráveis.' },
	{ t: 'Tokens com escopo', p: 'A API só faz o que o token permite, e expira.' },
	{ t: 'Anexos e fotos privados', p: 'Arquivos de suporte e fotos ficam só para a empresa.' },
];

export function Seguranca() {
	return (
		<section id="seguranca" className="scroll-mt-[92px] bg-[#F5F5F7] px-5 py-20 md:scroll-mt-[64px] md:py-28">
			<div className="mx-auto max-w-[980px]">
				<h2 className="ls-tight max-w-[820px] font-bold text-[#1D1D1F]" style={{ fontSize: 'clamp(30px, 5vw, 56px)', lineHeight: 1.1 }}>
					Dado de devedor não é planilha compartilhada. <span className="text-[#AEAEB2]">Nunca foi.</span>
				</h2>
				<div className="mt-12 grid gap-8 md:grid-cols-3 md:gap-6">
					{items.map(i => (
						<div key={i.t}>
							<h3 className="text-[17px] font-semibold text-[#1D1D1F]">{i.t}</h3>
							<p className="mt-2 text-[15px] leading-relaxed text-[#6E6E73]">{i.p}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
