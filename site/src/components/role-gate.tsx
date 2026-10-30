import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, type Row } from '@/lib/supabase';

const PAPEL_LABEL: Record<string, string> = { admin: 'Administrador', planejamento: 'Planejamento', operacao: 'Operação', gestao: 'Gestão' };
const PAPEIS = ['admin', 'planejamento', 'operacao', 'gestao'] as const;

export function RoleGate({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { perfil } = useMotorAuth();
  return perfil && roles.includes(perfil.papel) ? <>{children}</> : <SemPermissao />;
}

/** Porta por permissão (no lugar do papel fixo). Sem o código, mostra aviso. */
export function PermissionGate({ perm, tela, children }: { perm: string; tela?: string; children: ReactNode }) {
  const { permissoes, loading } = useMotorAuth();
  if (loading) return null;
  if (!permissoes.includes(perm)) return <SemPermissao perm={perm} tela={tela} />;
  return <>{children}</>;
}

/** Página "Seu perfil não abre esta tela" — dentro da moldura, menu lateral da área continua. */
export function SemPermissao({ perm, tela }: { perm?: string; tela?: string }) {
  const { perfil } = useMotorAuth();
  const [perfisComPerm, setPerfisComPerm] = useState<string[] | null>(null);

  useEffect(() => {
    if (!supabase || !perm) { setPerfisComPerm(null); return; }
    let active = true;
    (async () => {
      try {
        const [{ data: padrao }, { data: ajustes }] = await Promise.all([
          supabase.from('permissoes_padrao').select('permissao,permitido').eq('permissao', perm).maybeSingle(),
          supabase.from('permissoes_papel').select('papel,permitido').eq('permissao', perm),
        ]);
        if (!active) return;
        const base = (padrao as Row | null)?.permitido === true;
        const map: Record<string, boolean> = {};
        for (const p of PAPEIS) map[p] = base;
        for (const r of (ajustes as Row[] | null) ?? []) {
          const papel = String(r.papel ?? '');
          if (PAPEIS.includes(papel as typeof PAPEIS[number])) map[papel] = r.permitido === true;
        }
        const lista = PAPEIS.filter(p => map[p]).map(p => PAPEL_LABEL[p]);
        setPerfisComPerm(lista.length ? lista : null);
      } catch { if (active) setPerfisComPerm(null); }
    })();
    return () => { active = false; };
  }, [perm]);

  const docTitle = typeof document !== 'undefined' ? document.title.replace(/\s*[·|]\s*MotorCX\s*$/, '').trim() : '';
  const nomeTela = tela ?? (docTitle || 'Esta tela');
  const perfilAtual = perfil ? (PAPEL_LABEL[perfil.papel] ?? perfil.papel) : '—';

  return (
    <div className="mx-auto max-w-[560px] px-4 py-12 text-center">
      <h1 className="text-[20px] font-semibold text-[#1D1D1F]">Seu perfil não abre esta tela.</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[#6E6E73]">
        {nomeTela} é do perfil {perfisComPerm ? perfisComPerm.join(', ') : 'quem tem a permissão'}. Você está como {perfilAtual}. Quem libera é o Admin da sua empresa, em Empresa › Pessoas e perfis.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link to="/inicio" className="inline-flex h-10 items-center rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85">Ir para o Início</Link>
        <Link to="/conta?aba=perfil" className="inline-flex h-10 items-center rounded-lg border border-[#D2D2D7] px-6 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Ver o que meu perfil pode</Link>
      </div>
    </div>
  );
}
