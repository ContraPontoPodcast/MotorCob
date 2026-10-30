import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, CornerDownLeft } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { PERM } from '@/lib/permissoes';

export type Atalho = { id: string; label: string; to: string; perm?: string; keywords: string };

/** Lista fixa de atalhos do Workspace, usada pela busca da página inicial e pelo ⌘K. */
export const ATALHOS: Atalho[] = [
	{ id: 'lista', label: 'Abrir a Lista do dia', to: '/fila', keywords: 'lista dia fila clientes ação hoje' },
	{ id: 'chamado-novo', label: 'Abrir chamado', to: '/suporte/novo', keywords: 'chamado suporte novo ticket abrir' },
	{ id: 'chamados', label: 'Meus chamados', to: '/suporte', keywords: 'chamados suporte tickets meus' },
	{ id: 'convidar', label: 'Convidar membro', to: '/empresa/pessoas?aba=pessoas', keywords: 'convidar membro usuário equipe' },
	{ id: 'contatos', label: 'Contatos da empresa', to: '/empresa/contatos', keywords: 'contatos empresa' },
	{ id: 'faturas', label: 'Faturas', to: '/empresa/faturamento', perm: PERM.verFaturamento, keywords: 'faturas faturamento boleto nota' },
	{ id: 'conta', label: 'Minha conta', to: '/conta', keywords: 'conta perfil minha' },
	{ id: '2fa', label: 'Verificação em duas etapas', to: '/conta?aba=seguranca', keywords: 'verificação duas etapas segurança mfa autenticador' },
	{ id: 'docs', label: 'Documentação', to: '/docs', keywords: 'documentação docs ajuda manual' },
];

/** Filtra os atalhos pela permissão do usuário e pelo texto digitado. */
export function filtrarAtalhos(atalhos: Atalho[], q: string, permissoes: string[]): Atalho[] {
	const query = q.trim().toLowerCase();
	return atalhos.filter(a => {
		if (a.perm && !permissoes.includes(a.perm)) return false;
		if (!query) return true;
		return (a.label + ' ' + a.keywords).toLowerCase().includes(query);
	});
}

/** Palette de comandos aberta por ⌘K / Ctrl+K em qualquer tela do Workspace. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
	const navigate = useNavigate();
	const { permissoes } = useMotorAuth();
	const [q, setQ] = useState('');
	const [sel, setSel] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const lista = useMemo(() => filtrarAtalhos(ATALHOS, q, permissoes), [q, permissoes]);

	useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
	useEffect(() => { setSel(0); }, [q]);

	if (!open) return null;

	function go(a: Atalho) { onClose(); navigate(a.to); }
	function onKey(e: React.KeyboardEvent) {
		if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, lista.length - 1)); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
		else if (e.key === 'Enter') { e.preventDefault(); if (lista[sel]) go(lista[sel]); }
		else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
	}

	return (
		<div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onClick={onClose}>
			<div className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-white" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<div className="flex items-center gap-3 border-b border-[#E5E5EA] px-4">
					<Search size={18} className="text-[#8E8E93]" />
					<input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="O que você quer fazer?" className="h-12 flex-1 bg-transparent text-[15px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93]" />
					<kbd className="rounded bg-[#F2F2F7] px-1.5 py-0.5 text-[11px] text-[#8E8E93]">ESC</kbd>
				</div>
				<div className="max-h-[320px] overflow-y-auto p-2">
					{lista.length === 0 ? (
						<p className="px-3 py-6 text-center text-[14px] text-[#8E8E93]">Tente “chamado”, “faturas” ou “membros”.</p>
					) : lista.map((a, i) => (
						<button key={a.id} onMouseEnter={() => setSel(i)} onClick={() => go(a)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[14px] ${i === sel ? 'bg-[#F5F5F7] text-[#1D1D1F]' : 'text-[#1D1D1F]'}`}>
							<span>{a.label}</span>
							{i === sel && <CornerDownLeft size={14} className="text-[#8E8E93]" />}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
