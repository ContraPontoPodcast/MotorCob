import { useEffect, useState } from 'react';
import { Landmark, Plus, Pencil, X } from 'lucide-react';
import { Empty, Loading, Notice, useAllowed } from '@/components/app-shell';
import { useJornadaCarteira, JornadaHeading } from '@/components/jornada/jornada-shell';
import { dateBR, friendlyError, slugify, supabase, type Credor, type Row } from '@/lib/supabase';

type Estrategia = { id: string; nome: string; padrao: boolean };

export function JornadaCarteiras() {
	const { empresa } = useJornadaCarteira();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [lista, setLista] = useState<Credor[]>([]);
	const [estrategias, setEstrategias] = useState<Estrategia[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [busy, setBusy] = useState('');
	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Credor | null>(null);
	const [nome, setNome] = useState('');
	const [codigo, setCodigo] = useState('');
	const [codigoTouched, setCodigoTouched] = useState(false);
	const [estrategiaId, setEstrategiaId] = useState('');
	const [formError, setFormError] = useState('');

	async function reload() {
		if (!supabase || !empresa) return;
		setLoading(true); setError('');
		const [c, e] = await Promise.all([
			supabase.from('credores').select('*').eq('empresa_id', empresa.id).order('nome'),
			supabase.from('estrategias').select('id,nome,padrao,frente').eq('empresa_id', empresa.id).order('nome'),
		]);
		if (c.error || e.error) { setError(friendlyError()); setLoading(false); return; }
		setLista(((c.data ?? []) as Row[]).filter(r => r.frente === 'motorcli') as unknown as Credor[]);
		setEstrategias(((e.data ?? []) as Row[]).filter(r => r.frente === 'motorcli') as unknown as Estrategia[]);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id]);

	function openNew() { setEditing(null); setNome(''); setCodigo(''); setCodigoTouched(false); setEstrategiaId(''); setFormError(''); setFormOpen(true); }
	function openEdit(c: Credor) { setEditing(c); setNome(c.nome); setCodigo(c.codigo); setCodigoTouched(true); setEstrategiaId(c.estrategia_id ?? ''); setFormError(''); setFormOpen(true); }

	async function submit() {
		if (!supabase || !empresa) return;
		setFormError('');
		if (nome.trim().length < 2) { setFormError('Informe o nome da carteira.'); return; }
		if (editing) {
			setBusy(editing.id);
			const { error } = await supabase.from('credores').update({ nome: nome.trim(), estrategia_id: estrategiaId || null }).eq('id', editing.id);
			if (error) setFormError(friendlyError()); else { setSuccess('Carteira atualizada.'); setFormOpen(false); void reload(); }
			setBusy(''); return;
		}
		const code = codigo.trim().toLowerCase();
		if (!/^[a-z0-9-]{2,40}$/.test(code)) { setFormError('Código: 2 a 40 caracteres, só a-z, 0-9 e hífen.'); return; }
		setBusy('new');
		const { error } = await supabase.from('credores').insert({ empresa_id: empresa.id, nome: nome.trim(), codigo: code, estrategia_id: estrategiaId || null, entrada_carga: 'arquivo', ativo: true, frente: 'motorcli' });
		if (error) {
			const msg = (error.message || '').toLowerCase();
			if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('repetido')) setFormError('Já existe uma carteira com este código.');
			else setFormError(friendlyError());
			setBusy(''); return;
		}
		setSuccess('Carteira criada.'); setFormOpen(false); void reload(); setBusy('');
	}

	async function toggleAtivo(c: Credor) {
		if (!supabase) return;
		setBusy(c.id);
		const { error } = await supabase.from('credores').update({ ativo: !c.ativo }).eq('id', c.id);
		if (error) setError(friendlyError()); else { setSuccess('Alteração salva.'); void reload(); }
		setBusy('');
	}

	const estrNome = (id: string | null) => id ? (estrategias.find(e => e.id === id)?.nome ?? '—') : 'Padrão da frente';

	return (
		<>
			<JornadaHeading title="Carteiras" actions={canEdit && empresa ? <button onClick={openNew} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[13px] font-medium text-white hover:opacity-85"><Plus size={15} /> Nova carteira</button> : null} />
			<div className="mb-6 rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] p-5 text-[13px] leading-relaxed text-[#6E6E73]"><p>Cada carteira é um credor da frente Jornada do Cliente. Os clientes da jornada e os contatos enviados pertencem a uma carteira, que tem a sua estratégia de momentos.</p></div>
			{error && <div className="mb-5"><Notice>{error}</Notice></div>}
			{success && <div className="mb-5"><Notice variant="success">{success}</Notice></div>}
			{!empresa ? <Notice variant="warning">Escolha a empresa no topo.</Notice> : loading ? <Loading /> : lista.length === 0 ? <Empty>Nenhuma carteira da Jornada. {canEdit && 'Crie a primeira.'}</Empty> : (
				<section className="rounded-2xl border border-[#E5E5EA] bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[640px] text-left text-[13px]">
							<thead><tr className="border-b border-[#E5E5EA] text-[11px] uppercase tracking-wide text-[#8E8E93]"><th className="pb-4 font-medium">Carteira</th><th className="pb-4 font-medium">Estratégia</th><th className="pb-4 font-medium">Ativa</th><th className="pb-4 font-medium">Criada em</th>{canEdit && <th className="pb-4"></th>}</tr></thead>
							<tbody className="divide-y divide-[#F0F0F2]">
								{lista.map(c => (
									<tr key={c.id} className="hover:bg-[#FAFAFC]">
										<td className="py-4"><div className="flex items-center gap-2"><Landmark size={15} className="text-[#8E8E93]" /><span className="font-semibold text-[#1D1D1F]">{c.nome}</span><span className="rounded-full bg-[#F2F2F7] px-2 py-0.5 font-mono text-[11px] text-[#6E6E73]">{c.codigo}</span></div></td>
										<td className="py-4 text-[#6E6E73]">{estrNome(c.estrategia_id)}</td>
										<td className="py-4"><button role="switch" aria-label={`Ativa ${c.nome}`} aria-checked={c.ativo} disabled={!canEdit || !!busy} onClick={() => toggleAtivo(c)} className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${c.ativo ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${c.ativo ? 'left-[18px]' : 'left-0.5'}`} /></button></td>
										<td className="py-4 text-[#8E8E93]">{dateBR(c.criado_em)}</td>
										{canEdit && <td className="py-4 text-right"><button onClick={() => openEdit(c)} className="flex h-8 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><Pencil size={13} /> Editar</button></td>}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			{formOpen && (
				<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
					<div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6" style={{ boxShadow: '0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
						<div className="mb-5 flex items-center justify-between"><h2 className="text-[16px] font-semibold">{editing ? 'Editar carteira' : 'Nova carteira'}</h2><button onClick={() => setFormOpen(false)} aria-label="Fechar"><X size={20} /></button></div>
						<div className="space-y-4">
							<div><label className="mb-2 block text-[12px] font-semibold">Nome</label><input value={nome} onChange={e => { setNome(e.target.value); if (!codigoTouched) setCodigo(slugify(e.target.value)); }} className="h-11 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="Nome da carteira" /></div>
							<div><label className="mb-2 block text-[12px] font-semibold">Código</label><input value={codigo} onChange={e => { setCodigoTouched(true); setCodigo(slugify(e.target.value)); }} disabled={!!editing} className="h-11 w-full rounded-lg border border-[#D2D2D7] px-3 font-mono text-[14px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]" placeholder="nome-da-carteira" /><p className="mt-1 text-[11px] text-[#8E8E93]">Minúsculas, sem acento, espaços viram hífen.</p></div>
							<div><label className="mb-2 block text-[12px] font-semibold">Estratégia</label><select value={estrategiaId} onChange={e => setEstrategiaId(e.target.value)} className="h-11 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]"><option value="">Padrão da frente</option>{estrategias.map(es => <option key={es.id} value={es.id}>{es.nome}{es.padrao ? ' (padrão)' : ''}</option>)}</select></div>
							{formError && <p role="alert" className="text-[13px] text-[#FF3B30]">{formError}</p>}
							<div className="flex justify-end gap-3"><button onClick={() => setFormOpen(false)} className="h-11 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button><button onClick={submit} disabled={!!busy} className="h-11 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white disabled:opacity-50">{busy ? 'Salvando...' : editing ? 'Salvar' : 'Criar carteira'}</button></div>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
