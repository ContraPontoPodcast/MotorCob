import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Plus, X, Trash2 } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { isCanalValido, TIPO_LISTA, mascararDestino } from '@/lib/mensageria-produtos';
import { CANAL_NOME } from '@/lib/mensageria';

const POR_PAGINA = 50;

export function ListasContato() {
	const { canal } = useParams();
	const { empresa, permissoes } = useMotorAuth();
	const canEdit = permissoes.includes('editar_canais');
	const [aba, setAba] = useState('bloqueio');
	const [lista, setLista] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [sucesso, setSucesso] = useState('');
	const [pagina, setPagina] = useState(0);
	const [modal, setModal] = useState(false);

	async function reload() {
		if (!supabase || !empresa || !isCanalValido(canal)) return;
		setLoading(true);
		const { data, error } = await supabase.from('mensageria_listas_contato').select('*').eq('empresa_id', empresa.id).eq('tipo', aba).order('criado_em', { ascending: false });
		if (error) { setErro(friendlyError(error)); setLoading(false); return; }
		setLista(data ?? []); setErro(''); setLoading(false);
	}
	useEffect(() => { void reload(); setPagina(0); }, [empresa?.id, canal, aba]);

	async function remover(destino_hash: string) {
		if (!supabase || !empresa) return;
		if (!confirm('Remover este contato da lista?')) return;
		const { error } = await supabase.rpc('remover_lista_contato', { empresa: empresa.id, tipo: aba, canal: canal ?? '', destino_hash });
		if (error) setErro(friendlyError(error)); else void reload();
	}

	if (!isCanalValido(canal)) return null;
	const inicio = pagina * POR_PAGINA;
	const visiveis = lista.slice(inicio, inicio + POR_PAGINA);
	const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));

	return (
		<div className="space-y-4">
			<div className="flex justify-end">
				{canEdit && <button onClick={() => setModal(true)} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><Plus size={15} /> Adicionar</button>}
			</div>

			<div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F5F5F7] p-1">
				{Object.entries(TIPO_LISTA).map(([id, t]) => <button key={id} onClick={() => setAba(id)} className={`rounded-[7px] px-3 py-1.5 text-[14px] font-medium ${aba === id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F]'}`}>{t.label}</button>)}
			</div>
			<p className="text-[13px] text-[#6E6E73]">{TIPO_LISTA[aba].descricao}</p>

			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}
			{sucesso && <div className="rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">{sucesso}</div>}

			{loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
				visiveis.length === 0 ? (
					<div className="rounded-2xl bg-white p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>Nenhum contato nesta lista.</div>
				) : (
					<div className="overflow-x-auto rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<table className="w-full border-collapse text-[14px]">
							<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
								<th className="px-5 py-3">Destino</th><th className="px-5 py-3">Canal</th><th className="px-5 py-3">Motivo</th><th className="px-5 py-3">Incluído em</th>{canEdit && <th className="px-5 py-3 text-right">Remover</th>}
							</tr></thead>
							<tbody>
								{visiveis.map(r => (
									<tr key={r.id} className="border-b border-[#F0F0F2]">
										<td className="px-5 py-3 tnum text-[#1D1D1F]">{r.destino_mascara ?? mascararDestino(r.destino_hash ?? '')}</td>
										<td className="px-5 py-3 text-[#6E6E73]">{r.canal ? (CANAL_NOME[r.canal as string] ?? r.canal) : 'Todos os canais'}</td>
										<td className="px-5 py-3 text-[#6E6E73]">{r.motivo ?? '—'}</td>
										<td className="px-5 py-3 tnum text-[#6E6E73]">{dateTimeBR(r.criado_em)}</td>
										{canEdit && <td className="px-5 py-3 text-right"><button onClick={() => remover(r.destino_hash)} className="grid h-8 w-8 place-items-center rounded-lg text-[#FF3B30] hover:bg-[#FFE8E6] ml-auto"><Trash2 size={15} /></button></td>}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

			{totalPaginas > 1 && (
				<div className="flex items-center justify-between">
					<p className="text-[13px] text-[#8E8E93]">{inicio + 1}–{Math.min(inicio + POR_PAGINA, lista.length)} de {lista.length}</p>
					<div className="flex gap-2">
						<button disabled={pagina === 0} onClick={() => setPagina(p => p - 1)} className="h-9 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] disabled:opacity-50 hover:bg-[#F5F5F7]">Anterior</button>
						<button disabled={pagina >= totalPaginas - 1} onClick={() => setPagina(p => p + 1)} className="h-9 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] disabled:opacity-50 hover:bg-[#F5F5F7]">Próxima</button>
					</div>
				</div>
			)}

			{modal && empresa && <AdicionarModal tipo={aba} canal={canal} onClose={() => setModal(false)} onDone={msg => { setSucesso(msg); setModal(false); void reload(); }} />}
		</div>
	);
}

function AdicionarModal({ tipo, canal, onClose, onDone }: { tipo: string; canal: string; onClose: () => void; onDone: (msg: string) => void }) {
	const { empresa } = useMotorAuth();
	const [canalSel, setCanalSel] = useState(canal);
	const [motivo, setMotivo] = useState('');
	const [destinos, setDestinos] = useState('');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');

	async function salvar() {
		if (!supabase || !empresa) return;
		const linhas = destinos.split('\n').map(l => l.trim()).filter(Boolean);
		if (!linhas.length) { setErro('Cole ao menos um telefone ou e-mail.'); return; }
		setBusy(true); setErro('');
		let total = 0;
		for (let i = 0; i < linhas.length; i += 5000) {
			const bloco = linhas.slice(i, i + 5000);
			const { error } = await supabase.rpc('adicionar_lista_contato', { empresa: empresa.id, tipo, canal: canalSel, destinos: bloco, motivo: motivo.trim() || null });
			if (error) { setErro(friendlyError(error)); setBusy(false); return; }
			total += bloco.length;
		}
		setBusy(false);
		setDestinos(''); setMotivo('');
		onDone(`${total.toLocaleString('pt-BR')} incluídos.`);
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={onClose}>
			<div className="w-full max-w-[480px] rounded-2xl bg-white p-6" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-[17px] font-semibold text-[#1D1D1F]">Adicionar à lista · {TIPO_LISTA[tipo].label}</h2>
					<button onClick={onClose} aria-label="Fechar"><X size={20} className="text-[#8E8E93]" /></button>
				</div>
				<div className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Canal</label>
							<select value={canalSel} onChange={e => setCanalSel(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">
								<option value="all">Todos os canais</option>
								<option value="sms">SMS</option><option value="email">E-mail</option><option value="rcs">RCS</option><option value="whatsapp">WhatsApp</option>
							</select>
						</div>
						<div>
							<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Motivo</label>
							<input value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={120} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" />
						</div>
					</div>
					<div>
						<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Telefones ou e-mails (um por linha)</label>
						<textarea value={destinos} onChange={e => setDestinos(e.target.value)} rows={6} placeholder="(11) 99999-9999&#10;nome@exemplo.com" className="w-full rounded-lg border border-[#D2D2D7] p-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
					</div>
					{erro && <p className="text-[13px] text-[#FF3B30]">{erro}</p>}
					<div className="flex justify-end gap-2">
						<button onClick={onClose} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
						<button onClick={salvar} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Incluindo...' : 'Incluir'}</button>
					</div>
				</div>
			</div>
		</div>
	);
}
