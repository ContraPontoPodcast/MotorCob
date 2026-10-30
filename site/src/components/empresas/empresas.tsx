import { useEffect, useState } from 'react';
import { Building2, Plus, X } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, slugify, supabase, type Empresa } from '@/lib/supabase';

export function Empresas() {
  const { perfil, refresh } = useMotorAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(''); const [formOpen, setFormOpen] = useState(false);
  const [nome, setNome] = useState(''); const [slug, setSlug] = useState(''); const [slugTouched, setSlugTouched] = useState(false); const [formError, setFormError] = useState('');

  async function reload() { if (!supabase) return; const { data, error } = await supabase.from('empresas').select('id,slug,nome,ativa').order('nome'); if (error) setError(friendlyError()); else setEmpresas((data ?? []) as Empresa[]); setLoading(false); }
  useEffect(() => { void reload(); }, []);
  if (!perfil?.equipe || perfil.papel !== 'admin') return <Notice>Acesso não autorizado para este perfil.</Notice>;

  async function toggleAtiva(e: Empresa) { if (!supabase) return; setBusy(e.id); const { error } = await supabase.from('empresas').update({ ativa: !e.ativa }).eq('id', e.id); if (error) setError(friendlyError()); else { setSuccess('Alteração salva com sucesso.'); void reload(); void refresh(); } setBusy(''); }
  async function create() { if (!supabase) return; setFormError('');
    const s = slug.trim().toLowerCase();
    if (nome.trim().length < 2) { setFormError('Informe o nome da empresa.'); return; }
    if (!/^[a-z0-9-]{2,40}$/.test(s)) { setFormError('Slug: 2 a 40 caracteres, só a-z, 0-9 e hífen.'); return; }
    setBusy('new'); const { error } = await supabase.from('empresas').insert({ nome: nome.trim(), slug: s, ativa: true }); if (error) { setFormError(friendlyError()); setBusy(''); return; }
    setSuccess('Empresa criada com sucesso.'); setFormOpen(false); setNome(''); setSlug(''); setSlugTouched(false); void reload(); void refresh(); setBusy('');
  }

  return <><PageHeading eyebrow="ADMINISTRAÇÃO / EMPRESAS" title="Empresas" description="Cadastre e gerencie as empresas clientes do MotorCX." actions={<button onClick={() => { setFormError(''); setFormOpen(true); }} className="flex h-11 items-center gap-2 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white"><Plus size={16}/> Nova empresa</button>}/>
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#d9e5e8] bg-[#eaf2f3] p-5 text-sm text-[#315d68]"><Building2 size={19} className="shrink-0"/><p>Depois de criar, mande para o MotorCX o cabeçalho (primeira linha) da base e do arquivo de ocorrências desta empresa, e a lista de ocorrências que ela usa, para configurar a leitura.</p></div>
    {error && <div className="mb-5"><Notice>{error}</Notice></div>}{success && <div className="mb-5"><Notice variant="success">{success}</Notice></div>}
    <section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">{loading ? <Loading/> : empresas.length === 0 ? <Empty>Nenhuma empresa cadastrada.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b border-[#e4ebed] text-xs text-slate-400"><th className="pb-4 font-medium">Nome</th><th className="pb-4 font-medium">Slug</th><th className="pb-4 font-medium">Ativa</th></tr></thead><tbody className="divide-y divide-[#e9eff0]">{empresas.map(e => <tr key={e.id}><td className="py-4 font-semibold">{e.nome}</td><td className="py-4 font-mono text-xs text-slate-500">{e.slug}</td><td className="py-4"><button role="switch" aria-label={`Ativar ${e.nome}`} aria-checked={e.ativa} disabled={busy === e.id} onClick={() => toggleAtiva(e)} className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${e.ativa ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${e.ativa ? 'left-6' : 'left-1'}`}/></button></td></tr>)}</tbody></table></div>}</section>

    {formOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={() => setFormOpen(false)}><div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Nova empresa</h2><button onClick={() => setFormOpen(false)} aria-label="Fechar"><X size={20}/></button></div><div className="space-y-4"><div><label className="mb-2 block text-xs font-semibold">Nome</label><input value={nome} onChange={e => { setNome(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} className="h-11 w-full rounded-lg border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]" placeholder="Nome da empresa"/></div><div><label className="mb-2 block text-xs font-semibold">Slug</label><input value={slug} onChange={e => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} className="h-11 w-full rounded-lg border border-[#d8e3e5] px-3 font-mono text-sm outline-none focus:border-[#0F4C5C]" placeholder="nome-da-empresa"/><p className="mt-1 text-xs text-slate-400">Minúsculas, sem acento, espaços viram hífen. 2 a 40 caracteres.</p></div>{formError && <p role="alert" className="text-sm text-[#C62828]">{formError}</p>}<div className="flex justify-end gap-3"><button onClick={() => setFormOpen(false)} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button><button onClick={create} disabled={!!busy} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Criando...' : 'Criar empresa'}</button></div></div></div></div>}
  </>;
}
