import { Mail, Phone, Building2 } from 'lucide-react';
import { dateTimeBR } from '@/lib/supabase';
import { ConsoleShell, cardShadow } from './console-shell';
import { TabelaResponsiva, type LinhaTabela } from '@/components/comuns/tabela-responsiva';

export type ContatoSite = {
	id: string;
	nome: string;
	empresa: string | null;
	email: string;
	telefone: string | null;
	mensagem: string | null;
	origem: string | null;
	criado_em: string;
};

export function ConsoleContatosSitePage({ loaderData }: { loaderData: { contatos: ContatoSite[] } }) {
	const contatos = loaderData.contatos;
	const linhas: LinhaTabela[] = contatos.map(c => {
		const celulas: React.ReactNode[] = [];
		celulas.push(<span className="tnum text-[#6E6E73] whitespace-nowrap">{c.criado_em ? dateTimeBR(c.criado_em) : '—'}</span>);
		celulas.push(<div className="min-w-0"><p className="font-medium text-[#1D1D1F]">{c.nome || '—'}</p><p className="flex items-center gap-1 text-[12px] text-[#8E8E93]"><Building2 size={11} /> {c.empresa || '—'}</p></div>);
		celulas.push(<a href={`mailto:${c.email}`} className="flex items-center gap-1 text-[#0A60D0] hover:underline"><Mail size={12} /> {c.email || '—'}</a>);
		celulas.push(<span className="flex items-center gap-1 text-[#6E6E73]"><Phone size={12} /> {c.telefone || '—'}</span>);
		celulas.push(<span className="text-[#6E6E73] line-clamp-2 max-w-[320px]">{c.mensagem || '—'}</span>);
		return { celulas };
	});

	return (
		<ConsoleShell>
			<section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
				<div className="mb-4 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-[17px] font-semibold text-[#1D1D1F]">Contatos do site</h2>
						<p className="mt-0.5 text-[13px] text-[#6E6E73]">Quem pediu contato pelo formulário do site público.</p>
					</div>
					<span className="rounded-full bg-[#F5F5F7] px-2.5 py-0.5 text-[12px] font-semibold text-[#6E6E73] tnum">{contatos.length}</span>
				</div>
				{contatos.length === 0 ? (
					<p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhum contato ainda.</p>
				) : (
					<TabelaResponsiva cabecalho={['Quando', 'Nome', 'E-mail', 'Telefone', 'Mensagem']} linhas={linhas} destaque={[1, 2, 3]} />
				)}
			</section>
		</ConsoleShell>
	);
}
