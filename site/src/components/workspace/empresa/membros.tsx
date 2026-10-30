import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { UserPlus, ShieldCheck } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateTimeBR, type Perfil } from '@/lib/supabase';
import { EmpresaShell, cardShadow } from './empresa-shell';

const roleName: Record<string, string> = { admin: 'Administrador', planejamento: 'Planejamento', operacao: 'Operação', gestao: 'Gestão' };

export function MembrosPage() {
  const { empresa, perfil } = useMotorAuth();
  const [users, setUsers] = useState<Perfil[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true);
    const { data, error } = await supabase.from('perfis').select('id,nome,email,papel,ativo,empresa_id,equipe,ultimo_acesso').eq('empresa_id', empresa.id).order('nome');
    if (error) setError(friendlyError(error)); else setUsers((data ?? []) as Perfil[]);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  function initials(nome?: string) { const p = (nome ?? '').trim().split(/\s+/); return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || 'U'; }

  return (
    <EmpresaShell>
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
      <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Pessoas e perfis</h2>
          <div className="flex gap-2">
            <Link to="/usuarios" className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><UserPlus size={16} /> Convidar pessoa</Link>
            <Link to="/usuarios" className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><ShieldCheck size={16} /> Gerenciar</Link>
          </div>
        </div>
        {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
          users.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhum membro.</p> :
          <div className="divide-y divide-[#F0F0F2]">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 py-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#3A3A3C] text-[14px] font-semibold text-white">{initials(u.nome)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-[#1D1D1F]">{u.nome || '—'}{!u.ultimo_acesso && <span className="ml-2 rounded-full bg-[#FFF3E8] px-2 py-0.5 text-[10px] font-bold uppercase text-[#9a631b]">Convite enviado</span>}</p>
                  <p className="truncate text-[13px] text-[#6E6E73]">{u.email}</p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="text-[13px] text-[#1D1D1F]">{roleName[u.papel] ?? u.papel}</p>
                  <p className="text-[12px] text-[#8E8E93]">{u.ultimo_acesso ? dateTimeBR(u.ultimo_acesso) : 'sem acesso'}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${u.ativo ? 'bg-[#E8F8EC] text-[#248A3D]' : 'bg-[#F5F5F7] text-[#8E8E93]'}`}>{u.ativo ? 'Ativo' : 'Inativo'}</span>
              </div>
            ))}
          </div>}
      </section>
    </EmpresaShell>
  );
}
