import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Empty, Loading, Notice, useAllowed } from '@/components/app-shell';
import { EscolhaCarteira } from '@/components/escolha-carteira';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, numberBR, supabase, type CondicaoPersonaUsuario, type PersonaUsuario, type Row } from '@/lib/supabase';
import { ErrorDetail } from '@/components/error-detail';

const CORES = ['#0F4C5C', '#E9A23B', '#2E7D32', '#3B5BA9', '#A2552B', '#7A4FB0'];

const calculadosPersona = [
	{ nome: 'saldo', label: 'Saldo total', tipo: 'numero' },
	{ nome: 'dias_atraso', label: 'Dias de atraso', tipo: 'numero' },
	{ nome: 'qtd_contratos', label: 'Quantidade de contratos', tipo: 'numero' },
	{ nome: 'ddd', label: 'DDD', tipo: 'texto' },
	{ nome: 'tem_whatsapp', label: 'Tem WhatsApp', tipo: 'texto' },
	{ nome: 'tem_rcs', label: 'Tem RCS', tipo: 'texto' },
	{ nome: 'idade', label: 'Idade (anos)', tipo: 'numero' },
	{ nome: 'tem_email', label: 'Tem e-mail', tipo: 'texto' },
	{ nome: 'tem_celular', label: 'Tem celular', tipo: 'texto' },
	{ nome: 'so_fixo', label: 'Só fixo', tipo: 'texto' },
	{ nome: 'qtd_telefones', label: 'Qtd. de telefones', tipo: 'numero' },
];

const opsPersona = [
	{ id: '=', label: 'é igual a' },
	{ id: '!=', label: 'é diferente de' },
	{ id: '>', label: 'maior que' },
	{ id: '>=', label: 'maior ou igual a' },
	{ id: '<', label: 'menor que' },
	{ id: '<=', label: 'menor ou igual a' },
	{ id: 'em', label: 'é um destes' },
	{ id: 'nao_em', label: 'não é nenhum destes' },
	{ id: 'contem', label: 'contém' },
	{ id: 'vazio', label: 'está vazio' },
	{ id: 'preenchido', label: 'está preenchido' },
];

const opSimbolo: Record<string, string> = { '=': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤', em: '∈', nao_em: '∉', contem: 'contém', vazio: 'está vazio', preenchido: 'está preenchido' };

type Coluna = { nome: string; tipo: 'numero' | 'texto' };

function condFrase(conds: CondicaoPersonaUsuario[], colunas: Coluna[]): string {
	if (!conds || conds.length === 0) return 'Sem condições (vale para todos)';
	const label = (campo: string) => calculadosPersona.find(c => c.nome === campo)?.label ?? colunas.find(c => c.nome === campo)?.nome ?? campo;
	const valStr = (v: unknown) => Array.isArray(v) ? v.join('; ') : String(v ?? '');
	return conds.map(c => {
		if (c.op === 'vazio' || c.op === 'preenchido') return `${label(c.campo)} ${opSimbolo[c.op]}`;
		return `${label(c.campo)} ${opSimbolo[c.op] ?? c.op} ${valStr(c.valor)}`;
	}).join(' · ');
}

export function SuasPersonas() {
	const { empresa, credor } = useMotorAuth();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [lista, setLista] = useState<PersonaUsuario[]>([]);
	const [contagens, setContagens] = useState<Record<string, number>>({});
	const [semPersona, setSemPersona] = useState(0);
	const [colunas, setColunas] = useState<Coluna[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState('');
	const [editor, setEditor] = useState<PersonaUsuario | 'nova' | null>(null);

	async function reload() {
		if (!supabase || !empresa || !credor) { setLista([]); setLoading(false); return; }
		setLoading(true); setError('');
		const [p, e, emp] = await Promise.all([
			supabase.from('personas_usuario').select('*').eq('credor_id', credor.id).order('ordem', { ascending: true }),
			supabase.from('enquadramento').select('persona_usuario,clientes').eq('empresa_id', empresa.id).eq('credor_id', credor.id),
			supabase.from('empresas').select('colunas_base').eq('id', empresa.id).maybeSingle(),
		]);
		if (p.error || e.error) { setError(friendlyError()); setLoading(false); return; }
		setLista((p.data ?? []) as PersonaUsuario[]);
		// contagens por persona_usuario
		const map: Record<string, number> = {};
		let sem = 0;
		(e.data ?? []).forEach((r: Row) => {
			const nome = (r.persona_usuario as string | null)?.trim();
			const n = Number(r.clientes) || 0;
			if (nome) map[nome] = (map[nome] ?? 0) + n; else sem += n;
		});
		setContagens(map);
		setSemPersona(sem);
		const cb = (emp.data as Row | null)?.colunas_base;
		setColunas(Array.isArray(cb?.colunas) ? cb.colunas : []);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id, credor?.id]);

	async function mover(id: string, dir: -1 | 1) {
		if (!supabase) return;
		const db = supabase;
		const idx = lista.findIndex(p => p.id === id);
		const j = idx + dir;
		if (idx < 0 || j < 0 || j >= lista.length) return;
		const next = [...lista];
		[next[idx], next[j]] = [next[j], next[idx]];
		setBusy(id);
		// reordena gravando 10, 20, 30...
		const updates = next.map((p, i) => db.from('personas_usuario').update({ ordem: (i + 1) * 10 }).eq('id', p.id));
		await Promise.all(updates);
		toast.success('Ordem salva · Vale a partir da próxima rotina');
		void reload(); setBusy('');
	}

	async function toggleAtivo(p: PersonaUsuario) {
		if (!supabase) return;
		setBusy(p.id);
		const { error } = await supabase.from('personas_usuario').update({ ativo: !p.ativo }).eq('id', p.id);
		if (error) setError(friendlyError()); else { toast.success('Vale a partir da próxima rotina'); void reload(); }
		setBusy('');
	}

	async function apagar(p: PersonaUsuario) {
		if (!supabase) return;
		if (!window.confirm(`Apagar a persona "${p.nome}"?`)) return;
		setBusy(p.id);
		const { error } = await supabase.from('personas_usuario').delete().eq('id', p.id);
		if (error) setError(friendlyError()); else { toast.success('Persona apagada · Vale a partir da próxima rotina'); void reload(); }
		setBusy('');
	}

	if (!empresa) return null;
	if (!credor) return (
		<section className="mb-8 rounded-xl border border-[#dfe8ea] bg-white p-6">
			<h2 className="text-lg font-semibold text-[#163943]">Suas personas</h2>
			<EscolhaCarteira />
		</section>
	);

	return (
		<section className="mb-8 rounded-xl border border-[#dfe8ea] bg-white p-6">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-lg font-semibold text-[#163943]">Suas personas</h2>
				{canEdit && <button onClick={() => setEditor('nova')} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#0F4C5C] px-4 text-xs font-semibold text-white"><Plus size={14}/> Persona</button>}
			</div>
			<p className="mb-5 max-w-3xl text-sm leading-relaxed text-slate-500">Descreva os perfis de devedor desta carteira. Cada cliente fica na <strong>primeira</strong> persona que combina com ele.</p>

			{error && <div className="mb-4"><Notice>{error}</Notice></div>}
			{loading ? <Loading/> : lista.length === 0 ? <Empty>Nenhuma persona criada. {canEdit && 'Crie a primeira.'}</Empty> : (
				<div className="space-y-2">
					{lista.map((p, i) => (
						<div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[#e2eaec] bg-[#fafcfc] px-4 py-3">
							{canEdit && (
								<div className="flex flex-col">
									<button onClick={() => mover(p.id, -1)} disabled={i === 0 || !!busy} className="grid h-4 w-5 place-items-center text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-30" aria-label="Anterior"><ChevronLeft size={14}/></button>
									<button onClick={() => mover(p.id, 1)} disabled={i === lista.length - 1 || !!busy} className="grid h-4 w-5 place-items-center text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-30" aria-label="Próximo"><ChevronRight size={14}/></button>
								</div>
							)}
							<span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: p.cor }}/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm font-semibold text-[#163943]">{p.nome}</span>
									{!p.ativo && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Inativa</span>}
								</div>
								<p className="truncate text-xs text-slate-500">{condFrase(p.condicoes ?? [], colunas)}</p>
							</div>
							<span className="shrink-0 rounded-full bg-[#eaf2f3] px-2.5 py-0.5 text-[11px] font-bold text-[#0F4C5C]">{numberBR(contagens[p.nome] ?? 0)} clientes</span>
							{canEdit && (
								<div className="flex shrink-0 items-center gap-2">
									<button role="switch" aria-checked={p.ativo} disabled={busy === p.id} onClick={() => toggleAtivo(p)} className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${p.ativo ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${p.ativo ? 'left-[18px]' : 'left-0.5'}`}/></button>
									<button onClick={() => setEditor(p)} disabled={busy === p.id} className="grid h-8 w-8 place-items-center rounded text-slate-400 hover:bg-[#edf4f5] hover:text-[#0F4C5C]" aria-label="Editar"><Pencil size={14}/></button>
									<button onClick={() => apagar(p)} disabled={busy === p.id} className="grid h-8 w-8 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-[#C62828]" aria-label="Apagar"><Trash2 size={14}/></button>
								</div>
							)}
						</div>
					))}
					<div className="flex items-center gap-3 rounded-lg border border-dashed border-[#cbd9dd] bg-[#f5f7f8] px-4 py-3 text-slate-400">
						<span className="h-3.5 w-3.5 rounded-full bg-slate-300"/>
						<span className="flex-1 text-sm">Sem persona</span>
						<span className="text-[11px] font-bold">{numberBR(semPersona)} clientes</span>
					</div>
				</div>
			)}

			{editor && <PersonaEditor persona={editor === 'nova' ? null : editor} colunas={colunas} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void reload(); }} />}
		</section>
	);
}

function PersonaEditor({ persona, colunas, onClose, onSaved }: { persona: PersonaUsuario | null; colunas: Coluna[]; onClose: () => void; onSaved: () => void }) {
	const { credor } = useMotorAuth();
	const navigate = useNavigate();
	const [nome, setNome] = useState(persona?.nome ?? '');
	const [descricao, setDescricao] = useState(persona?.descricao ?? '');
	const [cor, setCor] = useState(persona?.cor ?? CORES[0]);
	const [condicoes, setCondicoes] = useState<CondicaoPersonaUsuario[]>(persona?.condicoes ?? []);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	function addCond() { setCondicoes(prev => [...prev, { campo: 'saldo', op: '>=', valor: '' }]); }
	function updCond(i: number, patch: Partial<CondicaoPersonaUsuario>) { setCondicoes(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c)); }
	function delCond(i: number) { setCondicoes(prev => prev.filter((_, idx) => idx !== i)); }

	async function submit() {
		if (!supabase || !credor) return;
		if (!nome.trim()) { setError('Informe o nome da persona.'); return; }
		setBusy(true); setError('');
		const payload = {
			credor_id: credor.id, nome: nome.trim(), descricao: descricao.trim() || null,
			cor, condicoes: condicoes as unknown as Record<string, unknown>,
			ativo: persona?.ativo ?? true,
			...(persona ? {} : { ordem: 9999 }),
		};
		const res = persona
			? await supabase.from('personas_usuario').update(payload).eq('id', persona.id)
			: await supabase.from('personas_usuario').insert(payload);
		if (res.error) { setError(friendlyError()); setBusy(false); return; }
		if (persona) toast.success('Vale a partir da próxima rotina');
		else toast.success('Persona criada · vale a partir da próxima rotina', { action: { label: 'Ir para a Orquestração', onClick: () => navigate('/orquestracao?montar=1') } });
		onSaved();
	}

	const semColunas = colunas.length === 0;

	return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
		<div role="dialog" aria-modal="true" aria-label="Persona" className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl sm:p-8" onClick={e => e.stopPropagation()}>
			<div className="mb-6 flex items-center justify-between"><h2 className="text-lg font-semibold">{persona ? 'Editar persona' : 'Nova persona'}</h2><button onClick={onClose} aria-label="Fechar"><X size={20}/></button></div>
			<div className="space-y-5">
				<div className="grid gap-4 sm:grid-cols-2">
					<div><label className="mb-2 block text-xs font-semibold">Nome</label><input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex. Digitais SP" className="h-11 w-full rounded-lg border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/></div>
					<div><label className="mb-2 block text-xs font-semibold">Cor</label><div className="flex h-11 items-center gap-2">{CORES.map(c => <button key={c} type="button" onClick={() => setCor(c)} className={`h-7 w-7 rounded-full transition-transform ${cor === c ? 'ring-2 ring-offset-2 ring-[#0F4C5C] scale-110' : ''}`} style={{ backgroundColor: c }} aria-label={`Cor ${c}`}/>)}</div></div>
				</div>
				<div><label className="mb-2 block text-xs font-semibold">Descrição (opcional)</label><textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2} placeholder="Para que serve esta persona..." className="w-full rounded-lg border border-[#d8e3e5] px-3 py-2 text-sm outline-none focus:border-[#0F4C5C]"/></div>

				<div>
					<div className="mb-2 flex items-center justify-between"><label className="text-xs font-semibold">Características (todas precisam ser verdade)</label><button type="button" onClick={addCond} className="flex items-center gap-1 text-xs font-bold text-[#0F4C5C] hover:underline"><Plus size={14}/> condição</button></div>
					{semColunas && <p className="mb-3 rounded-lg bg-[#fff7e8] p-3 text-xs text-[#80520f]">Envie a primeira base bruta para liberar as colunas da empresa. Enquanto isso, use os campos calculados.</p>}
					{condicoes.length === 0 && <p className="text-xs text-slate-400">Nenhuma condição — vale para todos os clientes.</p>}
					<div className="space-y-2">{condicoes.map((c, i) => {
						const noValor = c.op === 'vazio' || c.op === 'preenchido';
						const isLista = c.op === 'em' || c.op === 'nao_em';
						return <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-2">
							<select value={c.campo} onChange={e => updCond(i, { campo: e.target.value })} className="h-9 w-[180px] rounded border border-[#d8e3e5] bg-white px-2 text-xs outline-none focus:border-[#0F4C5C]">
								<optgroup label="Calculadas">{calculadosPersona.map(co => <option key={co.nome} value={co.nome}>{co.label}</option>)}</optgroup>
								{colunas.length > 0 && <optgroup label="Da carga">{colunas.map(co => <option key={co.nome} value={co.nome}>{co.nome}</option>)}</optgroup>}
							</select>
							<select value={c.op} onChange={e => updCond(i, { op: e.target.value })} className="h-9 w-[150px] rounded border border-[#d8e3e5] bg-white px-2 text-xs outline-none focus:border-[#0F4C5C]">{opsPersona.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
							{!noValor && (isLista
								? <input value={Array.isArray(c.valor) ? c.valor.join('; ') : String(c.valor ?? '')} onChange={e => updCond(i, { valor: e.target.value.split(';').map(s => s.trim()).filter(Boolean) })} placeholder="valores separados por ;" className="h-9 min-w-[180px] flex-1 rounded border border-[#d8e3e5] px-2 text-xs outline-none focus:border-[#0F4C5C]"/>
								: <input value={Array.isArray(c.valor) ? c.valor.join('; ') : String(c.valor ?? '')} onChange={e => updCond(i, { valor: e.target.value })} placeholder="valor" className="h-9 min-w-[120px] flex-1 rounded border border-[#d8e3e5] px-2 text-xs outline-none focus:border-[#0F4C5C]"/>)}
							<button type="button" onClick={() => delCond(i)} aria-label="Remover" className="grid h-9 w-9 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-[#C62828]"><Trash2 size={15}/></button>
						</div>;
					})}</div>
				</div>

				{error && <p role="alert" className="text-sm text-[#C62828]">{error}</p>}
				{error && <ErrorDetail/>}
				<div className="flex justify-end gap-3"><button onClick={onClose} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button><button onClick={submit} disabled={busy} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar persona'}</button></div>
			</div>
		</div>
	</div>;
}
