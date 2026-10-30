import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { Chave } from './chave';

/** Canais na ordem pedida: SMS, WhatsApp, RCS, E-mail. */
const CANAIS = [
	{ id: 'sms', nome: 'SMS' },
	{ id: 'whatsapp', nome: 'WhatsApp' },
	{ id: 'rcs', nome: 'RCS' },
	{ id: 'email', nome: 'E-mail' },
];

/** Cor da área Mensageria. */
export const MENSAGEM_COR = '#7A4FB0';

export type Fornecedor = Row;

/**
 * Gaveta única de Novo/Editar fornecedor.
 * Código travado ao editar; "Faz consulta de operadora" só aparece com SMS.
 */
export function FornecedorDrawer({ fornecedor, novo, onClose, onSaved }: {
	fornecedor: Fornecedor | null; novo: boolean; onClose: () => void; onSaved: () => void;
}) {
	const [codigo, setCodigo] = useState(fornecedor ? String(fornecedor.codigo ?? '') : '');
	const [nome, setNome] = useState(fornecedor ? String(fornecedor.nome ?? '') : '');
	const [canais, setCanais] = useState<string[]>(fornecedor && Array.isArray(fornecedor.canais) ? (fornecedor.canais as string[]) : []);
	const [consulta, setConsulta] = useState(fornecedor ? !!fornecedor.consulta_operadora : false);
	const [segredo, setSegredo] = useState(fornecedor ? String(fornecedor.segredo_ref ?? '') : '');
	const [ativo, setAtivo] = useState(fornecedor ? fornecedor.ativo !== false : true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	}, [onClose]);

	// Sem SMS, a consulta de operadora não se aplica.
	const temSms = canais.includes('sms');

	async function salvar() {
		if (!supabase) return;
		setError('');
		if (novo && !/^[a-z0-9_]+$/.test(codigo.trim())) { setError('Código: só letras minúsculas, números e _.'); return; }
		if (nome.trim().length < 2) { setError('Informe o nome (2+ letras).'); return; }
		setBusy(true);
		const payload = {
			codigo: codigo.trim(),
			nome: nome.trim(),
			canais,
			consulta_operadora: temSms ? consulta : false,
			segredo_ref: segredo.trim() || null,
			ativo,
		};
		const res = fornecedor
			? supabase.from('mensageria_fornecedores').update(payload).eq('id', fornecedor.id)
			: supabase.from('mensageria_fornecedores').insert(payload);
		const { error: e } = await res;
		setBusy(false);
		if (e) { setError(friendlyError(e)); return; }
		onSaved();
	}

	return (
		<div className="fixed inset-0 z-[100] flex justify-end bg-black/40" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="flex h-full w-full max-w-[440px] flex-col bg-white" style={{ boxShadow: '-12px 0 40px -8px rgba(0,0,0,.3)' }} onClick={e => e.stopPropagation()}>
				<div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#E5E5EA] px-5">
					<h2 className="text-[17px] font-semibold text-[#1D1D1F]">{novo ? 'Novo fornecedor' : 'Editar fornecedor'}</h2>
					<button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={20} /></button>
				</div>

				<div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Código</span>
						<input value={codigo} disabled={!novo} onChange={e => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); setCodigo(v); }} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 font-mono text-[14px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]" />
						{!novo && <p className="mt-1 text-[12px] text-[#8E8E93]">O código não muda depois de criado.</p>}
					</label>

					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Nome *</span>
						<input value={nome} onChange={e => setNome(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
					</label>

					<div>
						<span className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Canais</span>
						<div className="flex flex-wrap gap-3">
							{CANAIS.map(c => (
								<label key={c.id} className="flex items-center gap-1.5 text-[14px] text-[#1D1D1F]">
									<input type="checkbox" checked={canais.includes(c.id)} onChange={e => setCanais(prev => e.target.checked ? [...new Set([...prev, c.id])] : prev.filter(x => x !== c.id))} />
									{c.nome}
								</label>
							))}
						</div>
					</div>

					{temSms && (
						<Chave
							label={<span className="text-[15px] font-medium text-[#1D1D1F]">Faz consulta de operadora</span>}
							desc="Valida o número e a operadora antes do SMS."
							checked={consulta}
							on={setConsulta}
						/>
					)}

					<label className="block">
						<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Nome do segredo da credencial</span>
						<input value={segredo} onChange={e => setSegredo(e.target.value)} placeholder="ex.: sms/zenvia" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 font-mono text-[14px] outline-none focus:border-[#1D1D1F]" />
						<p className="mt-1 rounded-lg bg-[#FFF8E1] px-2 py-1.5 text-[12px] leading-relaxed text-[#9a631b]">Só o NOME do segredo. A senha/chave fica no cofre (Supabase Secrets ou Google Secret Manager), nunca aqui.</p>
					</label>

					<Chave
						label={<span className="text-[15px] font-medium text-[#1D1D1F]">Ativo</span>}
						checked={ativo}
						on={setAtivo}
					/>
				</div>

				{error && <p role="alert" className="px-5 pb-2 text-[14px] text-[#FF3B30]">{error}</p>}
				<div className="flex shrink-0 justify-end gap-3 border-t border-[#E5E5EA] px-5 py-4">
					<button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
					<button onClick={salvar} disabled={busy} className="h-10 rounded-lg px-6 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: MENSAGEM_COR }}>{busy ? 'Salvando...' : 'Salvar'}</button>
				</div>
			</div>
		</div>
	);
}
