import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle, Upload, X, Paperclip } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, safeFileName, type Row } from '@/lib/supabase';
import { MOTIVOS_CHAMADO } from '@/lib/empresa-helpers';
import { WorkspaceHeading } from '@/components/workspace/workspace-shell';
import { CHAMADO_ASSISTENTE_KEY, type ChamadoAssistente } from '@/lib/assistente';

const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';
const MAX_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const ACEITOS = ['.csv', '.txt', '.pdf', '.jpg', '.png', '.zip', '.xls', '.xlsx'];

function fmtTamanho(b: number) { return b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`; }

/** O aviso "quer conhecer a área" (SQL 55) traz ?assunto=conhecer-<área>: vira o assunto em texto. */
const CONHECER: Record<string, string> = { 'conhecer-cobranca': 'Quero conhecer Cobrança', 'conhecer-jornada': 'Quero conhecer Jornada do Cliente', 'conhecer-mensageria': 'Quero conhecer Mensageria' };
function assuntoDoLink(a: string | null): string {
  if (!a) return '';
  return CONHECER[a] ?? a;
}

export function SuporteNovoPage() {
  const { empresa, perfil } = useMotorAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Chamado pré-preenchido pelo Assistente (sessionStorage quando ?assistente=1).
  const [assistentePayload] = useState<ChamadoAssistente | null>(() => {
    if (params.get('assistente') !== '1') return null;
    try {
      const raw = sessionStorage.getItem(CHAMADO_ASSISTENTE_KEY);
      return raw ? (JSON.parse(raw) as ChamadoAssistente) : null;
    } catch { return null; }
  });
  const [anexarConversa, setAnexarConversa] = useState(true);
  const [motivo, setMotivo] = useState(assistentePayload?.motivo ?? params.get('motivo') ?? 'acesso');
  const [motivoOutro, setMotivoOutro] = useState('');
  const [assunto, setAssunto] = useState(assistentePayload?.assunto ?? assuntoDoLink(params.get('assunto')));
  const [prioridade, setPrioridade] = useState<'normal' | 'alta'>('normal');
  const [descricao, setDescricao] = useState('');
  const [anexos, setAnexos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ok, setOk] = useState<{ id: string; protocolo: string } | null>(null);

  if (!empresa) return <div className="mx-auto max-w-[640px] px-4 py-10"><div className="rounded-2xl bg-white p-10 text-center text-[#6E6E73]" style={{ boxShadow: cardShadow }}>Escolha a empresa no topo.</div></div>;

  function onFiles(files: FileList | null) {
    if (!files) return;
    const novos = [...anexos];
    for (const f of Array.from(files)) {
      if (novos.length >= MAX_FILES) break;
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
      if (!ACEITOS.includes(ext)) { setErrors(p => ({ ...p, anexos: `Tipo não aceito: ${f.name}` })); continue; }
      if (f.size > MAX_SIZE) { setErrors(p => ({ ...p, anexos: 'Arquivo acima de 10 MB.' })); continue; }
      novos.push(f);
    }
    setAnexos(novos);
  }
  function removerAnexo(i: number) { setAnexos(anexos.filter((_, j) => j !== i)); }

  function validar(): boolean {
    const e: Record<string, string> = {};
    if (!motivo) e.motivo = 'Escolha o motivo.';
    if (motivo === 'outro' && motivoOutro.trim().length < 2) e.motivoOutro = 'Escreva qual é o motivo.';
    if (motivo === 'outro' && motivoOutro.trim().length > 80) e.motivoOutro = 'Até 80 caracteres.';
    if (assunto.trim().length < 3) e.assunto = 'Escreva o assunto.';
    if (assunto.trim().length > 120) e.assunto = 'Assunto até 120 caracteres.';
    if (descricao.trim().length < 10) e.descricao = 'Conte o que está acontecendo (pelo menos uma frase).';
    if (descricao.length > 10000) e.descricao = 'Descrição até 10.000 caracteres.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!supabase || !empresa) return;
    if (!validar()) return;
    setBusy(true);
    // 1. insert chamado (leva assistente_pergunta_id quando vem do Assistente)
    const chamadoInsert: Record<string, unknown> = { empresa_id: empresa.id, motivo, motivo_outro: motivo === 'outro' ? motivoOutro.trim() : null, assunto: assunto.trim(), prioridade };
    if (assistentePayload?.assistente_pergunta_id) {
      chamadoInsert.assistente_pergunta_id = assistentePayload.assistente_pergunta_id;
    }
    const { data: ch, error: e1 } = await supabase.from('chamados').insert(chamadoInsert).select('id, protocolo').single();
    if (e1 || !ch) { setErrors({ geral: friendlyError(e1) }); setBusy(false); return; }
    const id = (ch as Row).id;
    const protocolo = (ch as Row).protocolo;
    // 2. upload anexos
    const anexosData: { caminho: string; nome: string; tamanho: number }[] = [];
    for (const f of anexos) {
      const path = `${empresa.id}/${id}/${Date.now()}-${safeFileName(f.name)}`;
      const { error: ue } = await supabase.storage.from('chamados').upload(path, f);
      if (!ue) anexosData.push({ caminho: path, nome: f.name, tamanho: f.size });
    }
    // 3. insert mensagem — a conversa do Assistente vai como 1ª mensagem quando marcada.
    if (anexarConversa && assistentePayload?.conversa) {
      await supabase.from('chamado_mensagens').insert({ chamado_id: id, tipo: 'cliente', texto: assistentePayload.conversa, anexos: [] });
    }
    const { error: e2 } = await supabase.from('chamado_mensagens').insert({ chamado_id: id, tipo: 'cliente', texto: descricao.trim(), anexos: anexosData });
    setBusy(false);
    if (e2) { setErrors({ geral: friendlyError(e2) }); return; }
    try { sessionStorage.removeItem(CHAMADO_ASSISTENTE_KEY); } catch { /* ignore */ }
    setOk({ id, protocolo });
  }

  if (ok) {
    return (
      <div className="mx-auto max-w-[480px] px-4 py-16 text-center">
        <CheckCircle size={56} className="mx-auto text-[#34C759]" />
        <h1 className="mt-5 text-[26px] font-bold tracking-tight text-[#1D1D1F]">Chamado aberto</h1>
        <p className="mt-2 text-[20px] font-semibold tracking-widest text-[#1D1D1F] tnum">{ok.protocolo}</p>
        <p className="mt-3 text-[14px] text-[#6E6E73]">Você recebe a resposta aqui e por e-mail.</p>
        <button onClick={() => navigate(`/suporte/${ok.id}`)} className="mt-6 inline-flex h-10 items-center rounded-full bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85">Ver chamado</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px] px-4 py-8">
      <WorkspaceHeading title="Abrir chamado" />
      {errors.geral && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{errors.geral}</div>}
      <form onSubmit={submit} className="space-y-5 rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Motivo*</label>
          <select value={motivo} onChange={e => setMotivo(e.target.value)} className="h-11 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]">
            {MOTIVOS_CHAMADO.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {motivo === 'outro' && <input value={motivoOutro} onChange={e => setMotivoOutro(e.target.value)} maxLength={80} placeholder="Qual é o motivo?" className="mt-2 h-11 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />}
          {errors.motivo && <p className="mt-1 text-[13px] text-[#FF3B30]">{errors.motivo}</p>}
          {errors.motivoOutro && <p className="mt-1 text-[13px] text-[#FF3B30]">{errors.motivoOutro}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Assunto*</label>
          <input value={assunto} onChange={e => setAssunto(e.target.value)} maxLength={120} className="h-11 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
          {errors.assunto && <p className="mt-1 text-[13px] text-[#FF3B30]">{errors.assunto}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Prioridade</label>
          <div className="flex rounded-[12px] bg-[#F5F5F7] p-1">
            {(['normal', 'alta'] as const).map(p => <button type="button" key={p} onClick={() => setPrioridade(p)} className={`flex-1 rounded-[9px] py-2 text-[14px] font-medium transition-colors ${prioridade === p ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{p === 'normal' ? 'Normal' : 'Alta'}</button>)}
          </div>
          <p className="mt-1 text-[12px] text-[#8E8E93]">Alta: a operação parou.</p>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Descrição*</label>
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={6} maxLength={10000} className="w-full rounded-lg border border-[#D2D2D7] px-3 py-2 text-[15px] outline-none focus:border-[#1D1D1F]" />
          {errors.descricao && <p className="mt-1 text-[13px] text-[#FF3B30]">{errors.descricao}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Anexos</label>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#D2D2D7] px-4 py-6 text-center hover:bg-[#F5F5F7]">
            <Upload size={22} className="text-[#8E8E93]" />
            <span className="mt-2 text-[13px] text-[#6E6E73]">Arraste arquivos ou clique para escolher</span>
            <span className="text-[12px] text-[#8E8E93]">Até 5 arquivos de 10 MB · CSV, TXT, PDF, JPG, PNG, ZIP, XLS, XLSX</span>
            <input type="file" multiple accept={ACEITOS.join(',')} className="hidden" onChange={e => onFiles(e.target.files)} />
          </label>
          {errors.anexos && <p className="mt-1 text-[13px] text-[#FF3B30]">{errors.anexos}</p>}
          {anexos.length > 0 && (
            <div className="mt-3 space-y-2">
              {anexos.map((f, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-[#F5F5F7] px-3 py-2">
                  <Paperclip size={14} className="text-[#6E6E73]" />
                  <span className="flex-1 truncate text-[13px] text-[#1D1D1F]">{f.name}</span>
                  <span className="text-[12px] text-[#8E8E93]">{fmtTamanho(f.size)}</span>
                  <button type="button" onClick={() => removerAnexo(i)} className="text-[#8E8E93] hover:text-[#FF3B30]"><X size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        {assistentePayload?.conversa && (
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Conversa com o Assistente (anexada)</label>
            <pre className="max-h-[180px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#F5F5F7] px-3 py-2.5 text-[13px] leading-relaxed text-[#1D1D1F]">{assistentePayload.conversa}</pre>
            <label className="mt-2 flex items-center gap-2 text-[13px] text-[#1D1D1F]">
              <input type="checkbox" checked={anexarConversa} onChange={e => setAnexarConversa(e.target.checked)} className="h-4 w-4 rounded border-[#D2D2D7]" />
              Anexar a conversa
            </label>
          </div>
        )}
        <button type="submit" disabled={busy} className="h-11 w-full rounded-full bg-[#1D1D1F] text-[15px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Enviando...' : 'Enviar chamado'}</button>
      </form>
    </div>
  );
}
