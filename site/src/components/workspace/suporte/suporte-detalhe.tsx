import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Paperclip, Upload, X, CheckCircle2 } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateTimeBR, safeFileName, type Row } from '@/lib/supabase';
import { MOTIVOS_CHAMADO } from '@/lib/empresa-helpers';

const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';
const MAX_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const ACEITOS = ['.csv', '.txt', '.pdf', '.jpg', '.png', '.zip', '.xls', '.xlsx'];

/** Hora (HH:MM) no fuso de São Paulo a partir de um valor ISO. */
function horaBR(v: unknown): string {
  if (!v) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(String(v)));
  } catch { return ''; }
}

const PASSOS = ['Aberto', 'Em atendimento', 'Aguardando você', 'Resolvido'] as const;
function passoAtual(situacao: string): number {
  if (situacao === 'resolvido') return 3;
  if (situacao === 'aguardando_cliente') return 2;
  if (situacao === 'em_atendimento') return 1;
  return 0;
}

export function SuporteDetalhePage() {
  const { id } = useParams();
  const { empresa } = useMotorAuth();
  const [chamado, setChamado] = useState<Row | null>(null);
  const [msgs, setMsgs] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [confirmandoResolucao, setConfirmandoResolucao] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function reloadMsgs() {
    if (!supabase || !id) return;
    const { data } = await supabase.from('chamado_mensagens').select('*').eq('chamado_id', id).order('criado_em');
    setMsgs(data ?? []);
  }
  async function reload() {
    if (!supabase || !id) return;
    setLoading(true);
    const { data: c, error: ce } = await supabase.from('chamados').select('*').eq('id', id).maybeSingle();
    if (ce || !c) { setError(friendlyError(ce)); setLoading(false); return; }
    setChamado(c);
    await reloadMsgs();
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [id]);

  // Marca o chamado como visto pelo cliente e atualiza o contador do menu.
  useEffect(() => {
    if (!supabase || !id) return;
    let active = true;
    (async () => {
      const { error } = await supabase.rpc('marcar_chamado_visto', { cid: id });
      if (!active) return;
      if (!error) {
        window.dispatchEvent(new CustomEvent('mc:suporte-visto'));
        setChamado(prev => prev ? { ...prev, visto_cliente_em: new Date().toISOString() } : prev);
      }
    })();
    return () => { active = false; };
  }, [id]);

  // Polling a cada 30s quando a aba está visível.
  useEffect(() => {
    function tick() { if (!document.hidden) void reloadMsgs(); }
    const t = window.setInterval(tick, 30000);
    function onVis() { if (!document.hidden) void reloadMsgs(); }
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [msgs]);

  // Mensagens visíveis ao cliente: notas internas (tipo 'nota') nunca aparecem.
  const msgsVisiveis = useMemo(() => msgs.filter(m => m.tipo !== 'nota'), [msgs]);

  // Timestamps da linha do tempo.
  const primeiroEquipe = useMemo(() => msgsVisiveis.find(m => m.tipo === 'equipe'), [msgsVisiveis]);
  const tempos = useMemo(() => {
    const c = chamado ?? ({} as Row);
    return [
      c.criado_em ? horaBR(c.criado_em) : '',
      primeiroEquipe?.criado_em ? horaBR(primeiroEquipe.criado_em) : '',
      (c.ultima_de === 'equipe' && c.ultima_em) ? horaBR(c.ultima_em) : '',
      c.situacao === 'resolvido' ? (c.atualizado_em ? horaBR(c.atualizado_em) : (c.ultima_em ? horaBR(c.ultima_em) : '')) : '',
    ];
  }, [chamado, primeiroEquipe]);

  function onFiles(files: FileList | null) {
    if (!files) return;
    const novos = [...anexos];
    for (const f of Array.from(files)) {
      if (novos.length >= MAX_FILES) break;
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
      if (!ACEITOS.includes(ext) || f.size > MAX_SIZE) continue;
      novos.push(f);
    }
    setAnexos(novos);
  }

  async function responder(ev: FormEvent) {
    ev.preventDefault();
    if (!supabase || !id || (!texto.trim() && anexos.length === 0)) return;
    setBusy(true); setError('');
    const anexosData: { caminho: string; nome: string; tamanho: number }[] = [];
    if (empresa) {
      for (const f of anexos) {
        const path = `${empresa.id}/${id}/${Date.now()}-${safeFileName(f.name)}`;
        const { error: ue } = await supabase.storage.from('chamados').upload(path, f);
        if (!ue) anexosData.push({ caminho: path, nome: f.name, tamanho: f.size });
      }
    }
    const { data, error: e } = await supabase.from('chamado_mensagens').insert({ chamado_id: id, tipo: 'cliente', texto: texto.trim() || null, anexos: anexosData }).select('*').single();
    setBusy(false);
    if (e) { setError(friendlyError(e)); setSendError(e.message); return; }
    setMsgs(prev => [...prev, data as Row]);
    setTexto(''); setAnexos([]); setSendError('');
    void reload();
  }

  async function resolver() {
    if (!supabase || !id) return;
    const { error } = await supabase.rpc('resolver_chamado', { cid: id });
    setConfirmandoResolucao(false);
    if (error) { setError(friendlyError(error)); setSendError(error.message); } else { setSendError(''); void reload(); }
  }

  if (loading) return <div className="mx-auto max-w-[760px] px-4 py-10"><p className="text-[14px] text-[#8E8E93]">Carregando...</p></div>;
  if (!chamado) return <div className="mx-auto max-w-[760px] px-4 py-10">{error ? <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div> : <p>Chamado não encontrado.</p>}</div>;

  const situacao = String(chamado.situacao ?? 'aberto');
  const atual = passoAtual(situacao);
  const motivo = MOTIVOS_CHAMADO.find(m => m.id === chamado.motivo)?.label ?? chamado.motivo;
  const resolvido = situacao === 'resolvido';
  const aguardando = situacao === 'aguardando_cliente';

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8">
      <Link to="/suporte" className="text-[14px] text-[#6E6E73] hover:underline">‹ Meus chamados</Link>
      <div className="mt-3 mb-5">
        <h1 className="text-[22px] font-bold tracking-tight text-[#1D1D1F]">{chamado.assunto}</h1>
        <p className="text-[13px] text-[#8E8E93] tnum">{chamado.protocolo} · {motivo} · aberto em {dateTimeBR(chamado.criado_em)}</p>
      </div>
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

      {/* Linha do tempo */}
      <div className="mb-5 rounded-2xl bg-white p-5" style={{ boxShadow: cardShadow }}>
        <ol className="flex items-center">
          {PASSOS.map((label, i) => {
            const reached = i <= atual;
            const isCurrent = i === atual;
            const t = tempos[i];
            return (
              <li key={label} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-semibold transition-colors ${isCurrent ? 'bg-[#1D1D1F] text-white' : reached ? 'bg-[#E8F8EC] text-[#248A3D]' : 'bg-[#F5F5F7] text-[#8E8E93]'}`}>
                    {reached && !isCurrent ? <CheckCircle2 size={15} /> : i + 1}
                  </span>
                  <span className={`text-center text-[11px] leading-tight ${isCurrent ? 'font-semibold text-[#1D1D1F]' : reached ? 'text-[#6E6E73]' : 'text-[#8E8E93]'}`}>{label}</span>
                  {t && <span className="text-[10px] text-[#8E8E93] tnum">{t}</span>}
                </div>
                {i < PASSOS.length - 1 && <span className={`mx-1 h-px flex-1 self-start mt-3.5 ${i < atual ? 'bg-[#248A3D]' : 'bg-[#E5E5EA]'}`} />}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Conversa */}
      <div ref={scrollRef} className="mb-5 max-h-[460px] space-y-3 overflow-y-auto rounded-2xl bg-[#F5F5F7] p-4" style={{ boxShadow: cardShadow }}>
        {msgsVisiveis.length === 0 && <p className="py-6 text-center text-[14px] text-[#8E8E93]">Nenhuma mensagem ainda.</p>}
        {msgsVisiveis.map(m => {
          const equipe = m.tipo === 'equipe';
          const autor = equipe
            ? `${m.autor_nome || 'Suporte MotorCX'} · Suporte MotorCX`
            : (m.autor_nome || 'Você');
          return (
            <div key={m.id} className={`flex ${equipe ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${equipe ? 'bg-white' : 'bg-[#1D1D1F] text-white'}`} style={equipe ? { boxShadow: cardShadow } : undefined}>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className={`text-[13px] font-semibold ${equipe ? 'text-[#1D1D1F]' : 'text-white/80'}`}>{autor}</span>
                  <span className={`text-[11px] ${equipe ? 'text-[#AEAEB2]' : 'text-white/50'}`}>{horaBR(m.criado_em)}</span>
                </div>
                {m.texto && <p className="whitespace-pre-wrap text-[14px]">{m.texto}</p>}
                {Array.isArray(m.anexos) && (m.anexos as Row[]).length > 0 && (
                  <div className="mt-2 space-y-1">
                    {(m.anexos as Row[]).map((a, i) => <AnexoPill key={i} anexo={a} />)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Resposta */}
      <form onSubmit={responder} className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
        {aguardando && (
          <div className="mb-3 rounded-lg bg-[#FFF7E8] px-3 py-2.5 text-[13px] text-[#9a631b]">
            O Suporte espera sua resposta. Sem resposta em 7 dias, o chamado fecha sozinho (você recebe um aviso 2 dias antes).
          </div>
        )}
        {resolvido && (
          <p className="mb-2 text-[13px] text-[#8E8E93]">Responder reabre o chamado.</p>
        )}
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="Escreva uma resposta..." />
        {anexos.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {anexos.map((f, i) => (
              <span key={i} className="flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3 py-1 text-[12px] text-[#1D1D1F]"><Paperclip size={12} /> {f.name} <button type="button" onClick={() => setAnexos(anexos.filter((_, j) => j !== i))}><X size={12} /></button></span>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[#D2D2D7] px-3 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
            <Upload size={15} /> Anexar (até 5 · 10 MB)
            <input type="file" multiple accept={ACEITOS.join(',')} className="hidden" onChange={e => onFiles(e.target.files)} />
          </label>
          <div className="flex gap-2">
            {!resolvido && (
              confirmandoResolucao ? (
                <>
                  <button type="button" onClick={() => setConfirmandoResolucao(false)} className="h-9 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
                  <button type="button" onClick={() => void resolver()} className="flex h-9 items-center gap-2 rounded-lg bg-[#248A3D] px-4 text-[13px] font-semibold text-white hover:opacity-90"><CheckCircle2 size={15} /> Confirmar</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmandoResolucao(true)} className="flex h-9 items-center gap-2 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><CheckCircle2 size={15} /> Marcar como resolvido</button>
              )
            )}
            <button type="submit" disabled={busy || (!texto.trim() && anexos.length === 0)} className="h-9 rounded-full bg-[#1D1D1F] px-5 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Enviando...' : 'Enviar'}</button>
          </div>
        </div>
        {sendError && <p className="mt-2 text-[12px] text-[#FF3B30]">{sendError}</p>}
      </form>
    </div>
  );
}

function AnexoPill({ anexo }: { anexo: Row }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!supabase || !anexo.caminho) return;
    let active = true;
    supabase.storage.from('chamados').createSignedUrl(String(anexo.caminho), 300).then(({ data }) => { if (active && data?.signedUrl) setUrl(data.signedUrl); });
    return () => { active = false; };
  }, [anexo.caminho]);
  return (
    <a href={url ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[12px] text-[#1D1D1F] hover:underline">
      <Paperclip size={11} /> {anexo.nome ?? 'anexo'}
    </a>
  );
}
