import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateBR, type Row } from '@/lib/supabase';
import { SEGMENTOS, formatCNPJ, formatCEP, validarCNPJ } from '@/lib/empresa-helpers';
import { EmpresaShell, cardShadow } from './empresa-shell';

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-[12px] text-[#6E6E73]">{label}</p>
      <p className="mt-0.5 text-[15px] text-[#1D1D1F]">{value || value === 0 ? value : '—'}</p>
    </div>
  );
}

function Input({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} {...rest} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
    </label>
  );
}

export function VisaoGeralPage() {
  const { empresa, perfil, refresh } = useMotorAuth();
  const [emp, setEmp] = useState<Row | null>(null);
  const [vendedor, setVendedor] = useState<string>('');
  const [gerente, setGerente] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true);
    const { data, error } = await supabase.from('empresas').select('*').eq('id', empresa.id).maybeSingle();
    if (error || !data) { setLoading(false); return; }
    setEmp(data);
    const [v, g] = await Promise.all([
      data.vendedor_id ? supabase.from('perfis').select('nome').eq('id', data.vendedor_id).maybeSingle() : Promise.resolve({ data: null }),
      data.gerente_id ? supabase.from('perfis').select('nome').eq('id', data.gerente_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setVendedor((v.data as Row)?.nome ?? '');
    setGerente((g.data as Row)?.nome ?? '');
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  const isEquipeAdmin = !!perfil?.equipe && perfil?.papel === 'admin';

  if (loading) return <EmpresaShell><p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p></EmpresaShell>;
  if (!emp) return <EmpresaShell><p className="py-10 text-center text-[14px] text-[#8E8E93]">Empresa não encontrada.</p></EmpresaShell>;

  const endereco = [emp.logradouro, emp.numero && `, ${emp.numero}`, emp.complemento, emp.bairro, [emp.municipio, emp.uf].filter(Boolean).join('/'), formatCEP(emp.cep)].filter(Boolean).join(' · ');

  return (
    <EmpresaShell onEdit={isEquipeAdmin ? () => setEditOpen(true) : undefined}>
      <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
        <h2 className="mb-5 text-[17px] font-semibold text-[#1D1D1F]">Ficha da empresa</h2>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Field label="Razão social" value={emp.razao_social} />
          <Field label="Nome fantasia" value={emp.nome} />
          <Field label="CNPJ" value={emp.cnpj ? formatCNPJ(emp.cnpj) : ''} />
          <Field label="Inscrição estadual" value={emp.inscricao_estadual} />
          <Field label="Inscrição municipal" value={emp.inscricao_municipal} />
          <Field label="Segmento" value={SEGMENTOS[emp.segmento as string] ?? '—'} />
          <div className="sm:col-span-2"><Field label="Endereço" value={endereco} /></div>
          <Field label="Cliente desde" value={emp.cliente_desde ? dateBR(emp.cliente_desde) : ''} />
          <Field label="Responsável pela venda" value={vendedor} />
          <Field label="Gerente da conta" value={gerente} />
        </div>
      </section>

      {editOpen && <EditModal emp={emp} onClose={() => setEditOpen(false)} onSaved={async () => { await reload(); await refresh(); setEditOpen(false); }} />}
    </EmpresaShell>
  );
}

function EditModal({ emp, onClose, onSaved }: { emp: Row; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>({
    razao_social: emp.razao_social ?? '', nome: emp.nome ?? '', cnpj: emp.cnpj ? formatCNPJ(emp.cnpj) : '',
    inscricao_estadual: emp.inscricao_estadual ?? '', inscricao_municipal: emp.inscricao_municipal ?? '',
    segmento: emp.segmento ?? '', cep: emp.cep ? formatCEP(emp.cep) : '', logradouro: emp.logradouro ?? '',
    numero: emp.numero ?? '', complemento: emp.complemento ?? '', bairro: emp.bairro ?? '', municipio: emp.municipio ?? '',
    uf: emp.uf ?? '', cliente_desde: emp.cliente_desde ?? '', vendedor_id: emp.vendedor_id ?? '', gerente_id: emp.gerente_id ?? '',
  });
  const [equipe, setEquipe] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.from('perfis').select('id,nome').eq('equipe', true).order('nome').then(({ data }) => setEquipe(data ?? []));
  }, []);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  function set(k: string, v: string) { setF(prev => ({ ...prev, [k]: v })); }

  async function salvar() {
    if (!supabase) return;
    setError('');
    const cnpjDigits = f.cnpj.replace(/\D/g, '');
    const cepDigits = f.cep.replace(/\D/g, '');
    if (cnpjDigits && !validarCNPJ(cnpjDigits)) { setError('CNPJ inválido.'); return; }
    if (f.uf && f.uf.length !== 2) { setError('UF deve ter 2 letras.'); return; }
    setBusy(true);
    const payload: Record<string, unknown> = {
      razao_social: f.razao_social.trim() || null, nome: f.nome.trim() || null,
      cnpj: cnpjDigits || null, inscricao_estadual: f.inscricao_estadual.trim() || null,
      inscricao_municipal: f.inscricao_municipal.trim() || null, segmento: f.segmento || null,
      cep: cepDigits || null, logradouro: f.logradouro.trim() || null, numero: f.numero.trim() || null,
      complemento: f.complemento.trim() || null, bairro: f.bairro.trim() || null, municipio: f.municipio.trim() || null,
      uf: f.uf.toUpperCase() || null, cliente_desde: f.cliente_desde || null,
      vendedor_id: f.vendedor_id || null, gerente_id: f.gerente_id || null,
    };
    const { error: e } = await supabase.from('empresas').update(payload).eq('id', emp.id);
    setBusy(false);
    if (e) {
      const msg = (e.message || '').toLowerCase();
      if (msg.includes('23505') || msg.includes('duplicate') || msg.includes('unique')) setError('Este CNPJ já está cadastrado em outra empresa.');
      else setError(friendlyError(e));
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[640px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-[#1D1D1F]">Editar empresa</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={20} /></button>
        </div>
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
          <Input label="Razão social*" value={f.razao_social} onChange={v => set('razao_social', v)} />
          <Input label="Nome fantasia*" value={f.nome} onChange={v => set('nome', v)} />
          <Input label="CNPJ" value={f.cnpj} onChange={v => set('cnpj', formatCNPJ(v))} placeholder="00.000.000/0000-00" />
          <Input label="Inscrição estadual" value={f.inscricao_estadual} onChange={v => set('inscricao_estadual', v)} placeholder="Isento" />
          <Input label="Inscrição municipal" value={f.inscricao_municipal} onChange={v => set('inscricao_municipal', v)} />
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Segmento</span>
            <select value={f.segmento} onChange={e => set('segmento', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
              <option value="">—</option>
              {Object.entries(SEGMENTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <Input label="CEP" value={f.cep} onChange={v => set('cep', formatCEP(v))} placeholder="00000-000" />
          <Input label="Logradouro" value={f.logradouro} onChange={v => set('logradouro', v)} />
          <Input label="Número" value={f.numero} onChange={v => set('numero', v)} />
          <Input label="Complemento" value={f.complemento} onChange={v => set('complemento', v)} />
          <Input label="Bairro" value={f.bairro} onChange={v => set('bairro', v)} />
          <Input label="Município" value={f.municipio} onChange={v => set('municipio', v)} />
          <Input label="UF" value={f.uf} onChange={v => set('uf', v.toUpperCase().slice(0, 2))} maxLength={2} />
          <Input label="Cliente desde" value={f.cliente_desde} onChange={v => set('cliente_desde', v)} type="date" />
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Responsável pela venda</span>
            <select value={f.vendedor_id} onChange={e => set('vendedor_id', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
              <option value="">—</option>
              {equipe.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Gerente da conta</span>
            <select value={f.gerente_id} onChange={e => set('gerente_id', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
              <option value="">—</option>
              {equipe.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
        </div>
        {error && <p role="alert" className="mt-4 text-[14px] text-[#FF3B30]">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
          <button onClick={salvar} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}
