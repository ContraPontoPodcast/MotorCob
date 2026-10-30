import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateBR, type Row } from '@/lib/supabase';
import { resumoNavegador } from '@/lib/empresa-helpers';
import { ContaShell, cardShadow } from './conta-shell';
import DuasEtapas from '@/components/DuasEtapas';

export function ContaSegurancaPage() {
  const { session, perfil } = useMotorAuth();
  return (
    <ContaShell>
      <div className="space-y-6">
        <SenhaCard email={session?.user.email ?? ''} />
        <MfaCard isAdmin={perfil?.papel === 'admin'} />
        <SessoesCard />
      </div>
    </ContaShell>
  );
}

function SenhaCard({ email }: { email: string }) {
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');
  const [etapa, setEtapa] = useState<'form' | 'codigo' | 'ok'>('form');
  const [codigo, setCodigo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const regras = [
    { ok: nova.length >= 12, label: '12 caracteres ou mais' },
    { ok: /[a-zA-Z]/.test(nova), label: 'uma letra' },
    { ok: /\d/.test(nova), label: 'um número' },
    { ok: nova.length > 0 && nova === repetir, label: 'igual nos dois campos' },
  ];

  async function enviarCodigo() {
    if (!supabase) return;
    setBusy(true); setError('');
    const { error } = await supabase.auth.reauthenticate();
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    setEtapa('codigo');
  }
  async function confirmar() {
    if (!supabase) return;
    setBusy(true); setError('');
    const { error } = await supabase.auth.updateUser({ password: nova, nonce: codigo.trim() });
    setBusy(false);
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('nonce') || msg.includes('code') || msg.includes('otp')) setError('Código inválido. Peça outro.');
      else setError(friendlyError(error));
      return;
    }
    setEtapa('ok'); setNova(''); setRepetir(''); setCodigo('');
  }

  return (
    <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
      <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Senha</h2>
      {etapa === 'ok' ? (
        <p className="mt-4 text-[14px] text-[#248A3D]">Senha alterada. As outras sessões continuam até você encerrá-las abaixo.</p>
      ) : etapa === 'codigo' ? (
        <div className="mt-4">
          <p className="text-[14px] text-[#1D1D1F]">Enviamos um código para {email}.</p>
          <input value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Código" maxLength={6} className="mt-3 h-10 w-full max-w-[200px] rounded-lg border border-[#D2D2D7] px-3 text-[15px] tracking-widest outline-none focus:border-[#1D1D1F]" />
          {error && <p role="alert" className="mt-2 text-[14px] text-[#FF3B30]">{error}</p>}
          <div className="mt-4 flex gap-3">
            <button onClick={() => setEtapa('form')} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Voltar</button>
            <button onClick={confirmar} disabled={busy || !codigo.trim()} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Confirmando...' : 'Confirmar'}</button>
            <button onClick={enviarCodigo} className="text-[13px] font-semibold text-[#1D1D1F] hover:underline self-center">Pedir outro</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Nova senha</span><input value={nova} onChange={e => setNova(e.target.value)} type="password" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Repetir</span><input value={repetir} onChange={e => setRepetir(e.target.value)} type="password" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <ul className="sm:col-span-2 space-y-1">
            {regras.map((r, i) => <li key={i} className="flex items-center gap-2 text-[13px]"><span className={r.ok ? 'text-[#248A3D]' : 'text-[#AEAEB2]'}>{r.ok ? '✓' : '○'}</span> <span className={r.ok ? 'text-[#1D1D1F]' : 'text-[#8E8E93]'}>{r.label}</span></li>)}
          </ul>
          {error && <p role="alert" className="text-[14px] text-[#FF3B30] sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2"><button onClick={enviarCodigo} disabled={busy || !regras.every(r => r.ok)} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Enviando...' : 'Alterar senha'}</button></div>
        </div>
      )}
    </section>
  );
}

function MfaCard({ isAdmin }: { isAdmin: boolean }) {
  const [factors, setFactors] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function recarregar() {
    if (!supabase) return;
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors([...(data?.totp ?? []), ...(data?.all ?? [])] as Row[]);
  }

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!active) return;
      const all = [...(data?.totp ?? []), ...(data?.all ?? [])] as Row[];
      setFactors(all); setLoading(false);
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const ativo = factors.some(f => f.status === 'verified' || f.verified);
  const fatorAtivo = factors.find(f => f.status === 'verified' || f.verified);

  async function desligar() {
    if (!supabase || !fatorAtivo) return;
    if (isAdmin) { setError('Para Admin a verificação é obrigatória.'); return; }
    if (!window.confirm('Desligar a verificação em duas etapas?')) return;
    setBusy(true); setError('');
    const { error } = await supabase.auth.mfa.unenroll({ factorId: fatorAtivo.id });
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    setFactors(factors.filter(f => f.id !== fatorAtivo.id));
  }

  return (
    <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Verificação em duas etapas</h2>
          {loading ? <p className="mt-1 text-[13px] text-[#8E8E93]">Verificando...</p> :
            ativo ? <p className="mt-1 text-[13px] text-[#6E6E73]">Aplicativo autenticador · desde {dateBR(fatorAtivo?.created_at ?? fatorAtivo?.friendly_name)}</p> :
            <p className="mt-1 text-[13px] text-[#6E6E73]">Inativo. Ligue para pedir o código a cada entrada.</p>}
        </div>
        {ativo && <span className="rounded-full bg-[#E8F8EC] px-3 py-1 text-[12px] font-semibold text-[#248A3D]">Ligada</span>}
      </div>
      {error && <p role="alert" className="mt-3 text-[14px] text-[#FF3B30]">{error}</p>}
      {ok && <p className="mt-3 text-[14px] text-[#248A3D]">{ok}</p>}
      <div className="mt-4">
        {ativo ? <button onClick={desligar} disabled={busy} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#FF3B30] hover:bg-[#FFE8E6] disabled:opacity-50">Desligar</button>
        : <button onClick={() => { setError(''); setOk(''); setModal(true); }} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85">Ligar</button>}
      </div>
      {modal && supabase && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/40 px-4 py-8" onClick={() => setModal(false)}>
          <div className="w-full max-w-[420px] rounded-2xl bg-white p-8" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
            <DuasEtapas
              supabase={supabase}
              passo={{ etapa: 'cadastro' }}
              onPronto={async () => { setModal(false); setOk('Verificação em duas etapas ligada.'); await recarregar(); }}
              onSair={() => setModal(false)}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function SessoesCard() {
  const { refresh } = useMotorAuth();
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');
  const dispositivo = resumoNavegador();

  async function sairOutros() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setBusy(false);
    if (error) return;
    setOk('Pronto. Os outros dispositivos vão pedir login de novo.');
  }
  async function sairEste() {
    if (!supabase) return;
    await supabase.auth.signOut();
    void refresh();
  }

  return (
    <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
      <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Sessões</h2>
      <div className="mt-4 flex items-center gap-3 rounded-lg bg-[#F5F5F7] px-4 py-3">
        <Monitor size={18} className="text-[#6E6E73]" />
        <div className="flex-1"><p className="text-[14px] font-medium text-[#1D1D1F]">Este dispositivo</p><p className="text-[13px] text-[#6E6E73]">{dispositivo || 'Navegador atual'}</p></div>
        <span className="rounded-full bg-[#E8F8EC] px-2.5 py-0.5 text-[11px] font-semibold text-[#248A3D]">Ativa agora</span>
      </div>
      {ok && <p className="mt-3 text-[14px] text-[#248A3D]">{ok}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={sairOutros} disabled={busy} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">Sair de todos os outros dispositivos</button>
        <button onClick={sairEste} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#FF3B30] hover:bg-[#FFE8E6]">Sair deste dispositivo</button>
      </div>
    </section>
  );
}
