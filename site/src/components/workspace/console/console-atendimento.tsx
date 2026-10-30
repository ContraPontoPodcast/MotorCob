import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Paperclip, Upload, Send, UserCheck, Inbox, Clock, CheckCircle2, X } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateTimeBR, safeFileName, type Row } from '@/lib/supabase';
import { sitChamadoLabel, haQuanto } from '@/lib/empresa-helpers';
import { ConsoleShell, cardShadow } from './console-shell';
import { useConsolePerms } from './console-perms';
import { LigarEnvioRealButton } from './ligar-envio-real';

const MAX_SIZE = 10 * 1024 * 1024;
const ACEITOS = ['.csv', '.txt', '.pdf', '.jpg', '.png', '.zip', '.xls', '.xlsx'];

/** Chamado que o cliente respondeu por último e a equipe ainda não viu. */
function chamadoNaoVisto(c: Row): boolean {
  if (c.ultima_de !== 'cliente') return false;
  if (!c.ultima_em) return false;
  if (!c.visto_equipe_em) return true;
  return new Date(String(c.visto_equipe_em)).getTime() < new Date(String(c.ultima_em)).getTime();
}

// Prazo em horas úteis (seg-sex 9-18, São Paulo) a partir de criado_em.
function prazoChamado(criado: string, prioridade: string): { label: string; cor: string } | null {
  if (!criado) return null;
  const start = new Date(criado).getTime();
  const horasTotal = prioridade === 'alta' ? 4 : 8; // 4h útil alta, 1 dia útil = 8h
  let restanteMs = horasTotal * 3600 * 1000;
  const now = Date.now();
  let t = start;
  // avança em passos de 1h útil
  while (restanteMs > 0 && t < now) {
    const d = new Date(t);
    const dia = d.getDay();
    const hora = d.getHours();
    if (dia >= 1 && dia <= 5 && hora >= 9 && hora < 18) {
      const passo = Math.min(3600 * 1000, restanteMs);
      t += passo; restanteMs -= passo;
    } else {
      t += 3600 * 1000;
    }
  }
  if (restanteMs <= 0) {
    // venceu
    return t < now ? { label: 'atrasado', cor: '#FF3B30' } : { label: `vence em ${Math.ceil(restanteMs / -3600000)}h`, cor: '#FF9500' };
  }
  const restanteHoras = Math.ceil(restanteMs / 3600000);
  if (restanteHoras <= 2) return { label: `vence em ${restanteHoras}h`, cor: '#FF9500' };
  return { label: `${restanteHoras}h útil`, cor: '#8E8E93' };
}

export function ConsoleAtendimentoPage() {
  const { perfil } = useMotorAuth();
  const { can } = useConsolePerms();
  const podeResponder = can('responder_chamados');
  const [searchParams, setSearchParams] = useSearchParams();
  const empresaFiltro = searchParams.get('empresa');
  const [chamados, setChamados] = useState<Row[]>([]);
  const [fila, setFila] = useState<'minha' | 'sem_resp' | 'aguardando' | 'resolvidos' | 'assistente'>('minha');
  const [selId, setSelId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Row[]>([]);
  const [texto, setTexto] = useState('');
  const [tipoResp, setTipoResp] = useState<'equipe' | 'nota'>('equipe');
  const [sitAcao, setSitAcao] = useState<'aguardando_cliente' | 'em_atendimento' | 'resolvido'>('em_atendimento');
  const [anexos, setAnexos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [naoResolvidos, setNaoResolvidos] = useState(0);

  async function reload() {
    if (!supabase || !perfil) return;
    const { data } = await supabase.from('chamados').select('*, empresas(nome)').order('atualizado_em', { ascending: false });
    setChamados((data ?? []) as Row[]);
    setNaoResolvidos((data ?? []).filter((r: Row) => r.situacao !== 'resolvido').length);
  }
  useEffect(() => { void reload(); const t = setInterval(() => void reload(), 30000); return () => clearInterval(t); }, [perfil?.id]);

  // Abre o chamado indicado por ?id= (link dos avisos da equipe: /console/chamados?id=...).
  const chamadoIdUrl = searchParams.get('id');
  useEffect(() => {
    if (chamadoIdUrl && !selId && chamados.some(c => c.id === chamadoIdUrl)) {
      setSelId(chamadoIdUrl);
    }
  }, [chamadoIdUrl, chamados, selId]);

  const filtrados = chamados.filter(c => {
    if (empresaFiltro && c.empresa_id !== empresaFiltro) return false;
    if (fila === 'minha') return c.responsavel === perfil?.id && c.situacao !== 'resolvido';
    if (fila === 'sem_resp') return c.situacao === 'aberto' && !c.responsavel;
    if (fila === 'aguardando') return c.situacao === 'aguardando_cliente';
    if (fila === 'resolvidos') return c.situacao === 'resolvido';
    return true;
  }).sort((a, b) => {
    // Não vistos primeiro.
    const na = chamadoNaoVisto(a) ? 0 : 1;
    const nb = chamadoNaoVisto(b) ? 0 : 1;
    if (na !== nb) return na - nb;
    return 0;
  });
  const empresaFiltroNome = empresaFiltro ? (chamados.find(c => c.empresa_id === empresaFiltro)?.empresas as Row | undefined)?.nome ?? null : null;

  async function abrirMsgs(id: string) {
    setSelId(id);
    if (!supabase) return;
    const { data } = await supabase.from('chamado_mensagens').select('*').eq('chamado_id', id).order('criado_em');
    setMsgs(data ?? []);
    // Marca como visto pela equipe e atualiza o contador do menu.
    const { error } = await supabase.rpc('marcar_chamado_visto', { cid: id });
    if (!error) {
      const agora = new Date().toISOString();
      setChamados(prev => prev.map(c => c.id === id ? { ...c, visto_equipe_em: agora } : c));
      window.dispatchEvent(new CustomEvent('mc:atendimento-visto'));
    }
  }
  useEffect(() => { if (selId) void abrirMsgs(selId); }, [selId]);

  async function assumir(c: Row) {
    if (!supabase || !perfil) return;
    const { error } = await supabase.from('chamados').update({ responsavel: perfil.id, situacao: 'em_atendimento' }).eq('id', c.id);
    if (error) { setError(friendlyError(error)); setSendError(error.message); } else { setSendError(''); void reload(); }
  }

  async function responder() {
    if (!supabase || !selId || !perfil) return;
    if (tipoResp === 'equipe' && !texto.trim() && anexos.length === 0) return;
    setBusy(true); setError(''); setSendError('');
    const c = chamados.find(x => x.id === selId);
    const anexosData: { caminho: string; nome: string; tamanho: number }[] = [];
    if (c?.empresa_id) {
      for (const f of anexos) {
        const path = `${c.empresa_id}/${selId}/${Date.now()}-${safeFileName(f.name)}`;
        const { error: ue } = await supabase.storage.from('chamados').upload(path, f);
        if (!ue) anexosData.push({ caminho: path, nome: f.name, tamanho: f.size });
      }
    }
    if (tipoResp === 'nota') {
      const { error } = await supabase.from('chamado_mensagens').insert({ chamado_id: selId, tipo: 'nota', texto: texto.trim() || null, anexos: anexosData });
      if (error) { setError(friendlyError(error)); setSendError(error.message); setBusy(false); return; }
    } else {
      const { error } = await supabase.from('chamado_mensagens').insert({ chamado_id: selId, tipo: 'equipe', texto: texto.trim() || null, anexos: anexosData });
      if (error) { setError(friendlyError(error)); setSendError(error.message); setBusy(false); return; }
      const { error: ue } = await supabase.from('chamados').update({ situacao: sitAcao, responsavel: perfil.id }).eq('id', selId);
      if (ue) { setError(friendlyError(ue)); setSendError(ue.message); setBusy(false); return; }
    }
    setBusy(false); setTexto(''); setAnexos([]);
    void abrirMsgs(selId); void reload();
  }

  const sel = chamados.find(c => c.id === selId);
  const filas = [
    { id: 'minha' as const, label: 'Minha fila', icon: UserCheck, count: chamados.filter(c => c.responsavel === perfil?.id && c.situacao !== 'resolvido').length },
    { id: 'sem_resp' as const, label: 'Sem responsável', icon: Inbox, count: chamados.filter(c => c.situacao === 'aberto' && !c.responsavel).length },
    { id: 'aguardando' as const, label: 'Aguardando cliente', icon: Clock, count: chamados.filter(c => c.situacao === 'aguardando_cliente').length },
    { id: 'resolvidos' as const, label: 'Resolvidos', icon: CheckCircle2, count: chamados.filter(c => c.situacao === 'resolvido').length },
  ];

  return (
    <ConsoleShell naoResolvidos={naoResolvidos}>
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
      {empresaFiltroNome && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-[#F5F5F7] px-4 py-2.5 text-[13px] text-[#1D1D1F]">
          <span>Filtrando por <strong>{empresaFiltroNome}</strong></span>
          <button onClick={() => setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('empresa'); return n; }, { replace: true })} className="ml-1 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[12px] font-medium text-[#6E6E73] hover:bg-[#E5E5EA]"><X size={12} /> limpar</button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        {/* Filas */}
        <div className="space-y-1">
          {filas.map(fl => { const Icon = fl.icon; return (
            <button key={fl.id} onClick={() => setFila(fl.id)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] ${fila === fl.id ? 'bg-[#1D1D1F] text-white' : 'text-[#1D1D1F] hover:bg-[#F5F5F7]'}`}>
              <Icon size={15} /> <span className="flex-1">{fl.label}</span> {fl.count > 0 && <span className={`rounded-full px-1.5 text-[11px] font-bold ${fila === fl.id ? 'bg-white/20' : 'bg-[#E5E5EA] text-[#1D1D1F]'}`}>{fl.count}</span>}
            </button>
          ); })}
          <Link to="/console/assistente" className="mt-2 flex items-center gap-2 rounded-lg border border-[#E5E5EA] px-3 py-2 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Agora em Console › Assistente</Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Lista */}
        <div className="rounded-2xl bg-white p-3" style={{ boxShadow: cardShadow }}>
          {filtrados.length === 0 ? <p className="py-8 text-center text-[13px] text-[#8E8E93]">Nenhum chamado.</p> :
            <div className="space-y-1">
              {filtrados.map(c => {
                const sit = sitChamadoLabel(c.situacao as string, c.responsavel_nome);
                const prazo = c.situacao === 'resolvido' ? { label: 'resolvido', cor: '#248A3D' } : prazoChamado(c.criado_em, c.prioridade);
                const naoVisto = chamadoNaoVisto(c);
                const novo = c.situacao === 'aberto' && !c.responsavel;
                return (
                  <button key={c.id} onClick={() => setSelId(c.id)} className={`w-full rounded-lg px-3 py-2.5 text-left ${selId === c.id ? 'bg-[#F5F5F7]' : 'hover:bg-[#F5F5F7]'}`}>
                    <div className="flex items-center justify-between gap-2"><span className={`truncate text-[13px] ${naoVisto ? 'font-bold text-[#1D1D1F]' : 'font-semibold text-[#1D1D1F]'}`}>{c.assunto}</span><span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span></div>
                    <p className="mt-0.5 truncate text-[12px] text-[#8E8E93] tnum">{c.protocolo} · {(c.empresas as Row)?.nome ?? ''} · {haQuanto(c.atualizado_em ?? c.criado_em)}</p>
                    {(naoVisto || novo || prazo) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {naoVisto && <span className="rounded-full bg-[#0A60D0] px-1.5 py-0.5 text-[10px] font-semibold text-white">Cliente respondeu</span>}
                        {novo && <span className="rounded-full bg-[#34C759] px-1.5 py-0.5 text-[10px] font-semibold text-white">Novo</span>}
                        {prazo && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: prazo.cor }}>{prazo.label}</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>}
        </div>

        {/* Conversa */}
        <div className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
          {!sel ? <p className="py-12 text-center text-[14px] text-[#8E8E93]">Selecione um chamado.</p> : (
            <div className="flex h-full flex-col">
              <div className="mb-3 border-b border-[#F0F0F2] pb-3">
                <p className="text-[15px] font-semibold text-[#1D1D1F]">{sel.assunto}</p>
                <p className="text-[12px] text-[#8E8E93] tnum">{sel.protocolo} · {(sel.empresas as Row)?.nome ?? ''}</p>
                {!sel.responsavel && podeResponder && <button onClick={() => assumir(sel)} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-3 text-[12px] font-medium text-white hover:opacity-85"><UserCheck size={13} /> Assumir</button>}
                {sel.empresa_id && /envio real/i.test(String(sel.assunto ?? '')) && sel.situacao !== 'resolvido' && (
                  <div className="mt-2"><LigarEnvioRealButton empresaId={String(sel.empresa_id)} empresaNome={(sel.empresas as Row)?.nome ?? ''} onDone={() => { void reload(); if (selId) void abrirMsgs(selId); }} size="sm" /></div>
                )}
              </div>
              <div className="mb-3 max-h-[280px] flex-1 space-y-2 overflow-y-auto">
                {msgs.map(m => {
                  const nota = m.tipo === 'nota';
                  const equipe = m.tipo === 'equipe';
                  const cliente = m.tipo === 'cliente';
                  const autor = nota
                    ? `${m.autor_nome || 'Suporte MotorCX'} · nota interna`
                    : equipe
                      ? `${m.autor_nome || 'Suporte MotorCX'} · Suporte MotorCX`
                      : (m.autor_nome || 'Você');
                  const nomeCor = nota ? 'text-[#9a631b]' : equipe ? 'text-[#1D1D1F]' : 'text-white/80';
                  const horaCor = nota ? 'text-[#9a631b]' : equipe ? 'text-[#AEAEB2]' : 'text-white/50';
                  return (
                    <div key={m.id} className={`flex ${cliente ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${nota ? 'bg-[#FFF8E1] border border-[#FFE08A]' : equipe ? 'bg-white border border-[#E5E5EA]' : 'bg-[#1D1D1F] text-white'}`} style={!nota && !equipe ? undefined : { boxShadow: cardShadow }}>
                        <div className="mb-0.5 flex items-baseline gap-2">
                          <span className={`text-[13px] font-semibold ${nomeCor}`}>{autor}</span>
                          <span className={`text-[10px] ${horaCor}`}>{dateTimeBR(m.criado_em)}</span>
                        </div>
                        {m.texto && <p className="whitespace-pre-wrap text-[13px]">{m.texto}</p>}
                        {Array.isArray(m.anexos) && (m.anexos as Row[]).map((a, i) => <AnexoBtn key={i} anexo={a} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
              {podeResponder ? (
              <div className="space-y-2">
                <div className="flex rounded-[12px] bg-[#F5F5F7] p-1">{(['equipe', 'nota'] as const).map(t => <button key={t} onClick={() => setTipoResp(t)} className={`flex-1 rounded-[9px] py-1.5 text-[12px] font-medium transition-colors ${tipoResp === t ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{t === 'equipe' ? 'Responder ao cliente' : 'Nota interna'}</button>)}</div>
                {tipoResp === 'equipe' && (
                  <select value={sitAcao} onChange={e => setSitAcao(e.target.value as typeof sitAcao)} className="h-9 w-full rounded-lg border border-[#D2D2D7] bg-white px-2 text-[13px] outline-none focus:border-[#1D1D1F]">
                    <option value="aguardando_cliente">Enviar e aguardar cliente</option>
                    <option value="em_atendimento">Enviar e manter em atendimento</option>
                    <option value="resolvido">Enviar e resolver</option>
                  </select>
                )}
                {tipoResp === 'equipe' && (
                  <select onChange={e => setTexto(e.target.value)} value="" className="h-9 w-full rounded-lg border border-[#D2D2D7] bg-white px-2 text-[13px] text-[#8E8E93] outline-none">
                    <option value="">Resposta pronta...</option>
                    <option value="Reenvie o arquivo, por favor, e nos avise quando subir.">Reenvie o arquivo, por favor...</option>
                    <option value="Ajustamos o mapeamento. Pode reenviar a carga?">Ajustamos o mapeamento...</option>
                    <option value="Encaminhamos ao time técnico. Retornamos em até 4 horas úteis.">Encaminhamos ao time técnico...</option>
                  </select>
                )}
                <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="Escreva..." />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Upload size={13} /> Anexar<input type="file" multiple accept={ACEITOS.join(',')} className="hidden" onChange={e => { const fs = Array.from(e.target.files ?? []).filter(f => f.size <= MAX_SIZE && ACEITOS.includes('.' + (f.name.split('.').pop() ?? '').toLowerCase())); setAnexos(prev => [...prev, ...fs].slice(0, 5)); }} /></label>
                  <button onClick={responder} disabled={busy} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50"><Send size={14} /> Enviar</button>
                </div>
                {sendError && <p className="mt-2 text-[12px] text-[#FF3B30]">{sendError}</p>}
              </div>
              ) : (
                <p className="rounded-lg bg-[#F5F5F7] px-3 py-3 text-[13px] text-[#8E8E93]">Seu perfil não responde chamados. Acompanhe a conversa abaixo.</p>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </ConsoleShell>
  );
}

function AnexoBtn({ anexo }: { anexo: Row }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (supabase && anexo.caminho) supabase.storage.from('chamados').createSignedUrl(String(anexo.caminho), 300).then(({ data }) => data?.signedUrl && setUrl(data.signedUrl)); }, [anexo.caminho]);
  return <a href={url ?? '#'} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 rounded-full bg-black/10 px-2 py-0.5 text-[11px] hover:underline"><Paperclip size={10} /> {anexo.nome ?? 'anexo'}</a>;
}
