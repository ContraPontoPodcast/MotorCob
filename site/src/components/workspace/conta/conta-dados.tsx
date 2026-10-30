import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { formatTelefone } from '@/lib/empresa-helpers';
import { ContaShell, cardShadow } from './conta-shell';

export function ContaDadosPage() {
  const { session, perfil, refresh } = useMotorAuth();
  const [nome, setNome] = useState('');
  const [sobrenome, setSobrenome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [setor, setSetor] = useState('');
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [fotoPath, setFotoPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!perfil) return;
    setNome(perfil.nome ?? '');
    setSobrenome((perfil as Row).sobrenome ?? '');
    setTelefone((perfil as Row).telefone ? formatTelefone((perfil as Row).telefone) : '');
    setSetor((perfil as Row).setor ?? '');
    setFotoPath((perfil as Row).foto ?? null);
  }, [perfil?.id]);

  // Busca URL assinada da foto.
  useEffect(() => {
    if (!supabase || !fotoPath) { setFotoUrl(null); return; }
    let active = true;
    supabase.storage.from('fotos').createSignedUrl(fotoPath, 3600).then(({ data }) => {
      if (active && data?.signedUrl) setFotoUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [fotoPath]);

  function initials() { const p = (nome || 'U').trim().split(/\s+/); return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || 'U'; }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !supabase || !session) return;
    setError('');
    const okType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
    if (!okType || file.size > 2 * 1024 * 1024) { setError('Use JPG, PNG ou WebP de até 2 MB.'); e.target.value = ''; return; }
    setBusy(true);
    try {
      // Center-crop quadrado e redimensiona para 512px.
      const blob = await cropTo512(file);
      const path = `${session.user.id}/foto-${Date.now()}.jpg`;
      // Apaga a foto anterior.
      if (fotoPath) { try { await supabase.storage.from('fotos').remove([fotoPath]); } catch { /* ignora */ } }
      const { error: upErr } = await supabase.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (upErr) { setError(friendlyError(upErr)); setBusy(false); return; }
      setFotoPath(path);
      const { data } = await supabase.storage.from('fotos').createSignedUrl(path, 3600);
      if (data?.signedUrl) setFotoUrl(data.signedUrl);
    } catch { setError('Não foi possível processar a imagem.'); }
    setBusy(false);
    e.target.value = '';
  }

  async function removerFoto() {
    if (!supabase || !fotoPath) return;
    setBusy(true);
    try { await supabase.storage.from('fotos').remove([fotoPath]); } catch { /* ignora */ }
    setFotoPath(null); setFotoUrl(null);
    setBusy(false);
  }

  async function salvar() {
    if (!supabase) return;
    setError(''); setOk(false);
    if (nome.trim().length < 2) { setError('Informe o seu nome.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('atualizar_meu_perfil', { p_nome: nome.trim(), p_sobrenome: sobrenome.trim() || null, p_telefone: telefone.replace(/\D/g, '') || null, p_setor: setor.trim() || null, p_foto: fotoPath });
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    setOk(true); void refresh();
  }

  return (
    <ContaShell>
      <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
        {/* Foto */}
        <div className="mb-6 flex items-center gap-5">
          <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full bg-[#3A3A3C] text-[28px] font-semibold text-white">
            {fotoUrl ? <img src={fotoUrl} alt="" className="h-full w-full object-cover" /> : initials()}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85 disabled:opacity-50"><Camera size={15} /> Trocar foto</button>
            {fotoPath && <button onClick={removerFoto} disabled={busy} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50"><Trash2 size={15} /> Remover</button>}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Nome*</span><input value={nome} onChange={e => setNome(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Sobrenome</span><input value={sobrenome} onChange={e => setSobrenome(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Telefone</span><input value={telefone} onChange={e => setTelefone(formatTelefone(e.target.value))} placeholder="(11) 99999-9999" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Setor</span><input value={setor} onChange={e => setSetor(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block sm:col-span-2"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">E-mail</span><input value={perfil?.email ?? ''} disabled className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-[#F5F5F7] px-3 text-[15px] text-[#8E8E93]" /><p className="mt-1 text-[12px] text-[#8E8E93]">Para trocar o e-mail, fale com o Admin da sua empresa.</p></label>
        </div>

        {error && <p role="alert" className="mt-4 text-[14px] text-[#FF3B30]">{error}</p>}
        {ok && <p className="mt-4 text-[14px] text-[#248A3D]">Dados salvos.</p>}
        <div className="mt-5 flex justify-end">
          <button onClick={salvar} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </section>
    </ContaShell>
  );
}

/** Center-crop quadrado e redimensiona para 512px, retornando um Blob JPEG. */
function cropTo512(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas')); return; }
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 512, 512);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('blob')), 'image/jpeg', 0.9);
    };
    img.onerror = () => reject(new Error('img'));
    img.src = URL.createObjectURL(file);
  });
}
