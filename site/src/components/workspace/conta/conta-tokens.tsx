import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Code, Copy, Check, Plus, X, ShieldAlert } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, dateBR, dateTimeBR, friendlyError, type ApiToken, type Credor } from '@/lib/supabase';
import { ContaShell, cardShadow } from './conta-shell';

const ESCOPOS: { id: string; label: string }[] = [
  { id: 'cargas:enviar', label: 'Enviar cargas' },
  { id: 'cargas:status', label: 'Acompanhar cargas' },
  { id: 'lista:ler', label: 'Ler a Lista do dia' },
];
const escopoLabel = (id: string) => ESCOPOS.find(e => e.id === id)?.label ?? id;
const VALIDADES = [30, 90, 180, 365];

function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1800); }
    catch { /* ignora */ }
  }
  return (
    <button onClick={copy} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
      {ok ? <Check size={13} className="text-[#248A3D]" /> : <Copy size={13} />} {ok ? 'Copiado' : label}
    </button>
  );
}

function diasAte(v: string): number {
  return Math.floor((new Date(v).getTime() - Date.now()) / 86400000);
}

function situacao(t: ApiToken): { label: string; cor: string; bg: string } {
  if (t.revogado_em) return { label: 'Revogado', cor: '#FF3B30', bg: '#FFE8E6' };
  if (new Date(t.expira_em).getTime() < Date.now()) return { label: 'Vencido', cor: '#8E8E93', bg: '#F5F5F7' };
  return { label: 'Ativo', cor: '#248A3D', bg: '#E8F8EC' };
}

export function ContaTokensPage() {
  const { empresa, credores, permissoes } = useMotorAuth();
  const podeGerenciar = permissoes.includes('gerenciar_api');

  const [moduloAtivo, setModuloAtivo] = useState<boolean | null>(null);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  // Modal de criação
  const [formOpen, setFormOpen] = useState(false);
  const [nome, setNome] = useState('');
  const [escoposSel, setEscoposSel] = useState<string[]>([]);
  const [credorSel, setCredorSel] = useState<string[]>([]);
  const [dias, setDias] = useState(90);
  const [formError, setFormError] = useState('');

  // Token recém-criado (mostrado uma vez)
  const [novoToken, setNovoToken] = useState<{ token: string; nome: string } | null>(null);

  // Confirmação de revogação na linha
  const [confirmaId, setConfirmaId] = useState<string | null>(null);

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true); setError('');
    const [m, t] = await Promise.all([
      supabase.from('empresa_modulos').select('ativo').eq('empresa_id', empresa.id).eq('modulo', 'api').maybeSingle(),
      supabase.from('api_tokens').select('id,nome,prefixo,escopos,credor_ids,criado_em,expira_em,ultimo_uso,revogado_em').eq('empresa_id', empresa.id).order('criado_em', { ascending: false }),
    ]);
    if (m.error || t.error) { setError(friendlyError()); setLoading(false); return; }
    setModuloAtivo(!!(m.data as { ativo?: boolean } | null)?.ativo);
    setTokens((t.data ?? []) as ApiToken[]);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  function openNew() {
    setNome(''); setEscoposSel([]); setCredorSel([]); setDias(90); setFormError(''); setFormOpen(true);
  }

  function toggleEscopo(id: string) {
    setEscoposSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }
  function toggleCredor(id: string) {
    setCredorSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  async function criar() {
    if (!supabase || !empresa) return;
    setFormError('');
    if (nome.trim().length < 2 || nome.trim().length > 60) { setFormError('Nome: 2 a 60 caracteres.'); return; }
    if (escoposSel.length === 0) { setFormError('Selecione ao menos um escopo.'); return; }
    setBusy('criar');
    const { data, error: rpcError } = await supabase.rpc('criar_token_api', {
      p_empresa: empresa.id, p_nome: nome.trim(), p_escopos: escoposSel,
      p_credores: credorSel.length > 0 ? credorSel : null, p_dias: dias,
    });
    if (rpcError) {
      const msg = String((rpcError as { message?: string }).message ?? '').toLowerCase();
      if (msg.includes('limite')) setFormError('Limite de 10 tokens ativos: revogue um antes.');
      else if (msg.includes('módulo') || msg.includes('modulo')) setFormError('O módulo API não está ativo nesta empresa.');
      else if (msg.includes('permissão')) setFormError('Seu perfil não tem permissão para gerenciar tokens de API.');
      else setFormError(friendlyError(rpcError));
      setBusy(''); return;
    }
    const r = data as { token: string; nome: string } | null;
    setFormOpen(false);
    setNovoToken(r ? { token: r.token, nome: r.nome } : null);
    void reload();
    setBusy('');
  }

  async function revogar(id: string) {
    if (!supabase) return;
    setBusy(id);
    const { error: rpcError } = await supabase.rpc('revogar_token_api', { p_token_id: id });
    if (rpcError) setError(friendlyError(rpcError));
    else { setConfirmaId(null); void reload(); }
    setBusy('');
  }

  const credorNome = (id: string) => credores.find((c: Credor) => c.id === id)?.nome ?? '—';
  const credoresTexto = (t: ApiToken) => {
    const ids = (t.credor_ids ?? []).filter(Boolean);
    if (ids.length === 0) return 'Todos';
    return ids.map(credorNome).join(', ');
  };

  // --- Sem o módulo API ativo: card atual com "Quero ser avisado" ---
  if (moduloAtivo === false) {
    return (
      <ContaShell>
        <section className="rounded-2xl bg-[#F5F5F7] p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
          <div className="flex items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-[#1D1D1F]"><Code size={22} /></div>
            <div className="flex-1">
              <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Tokens de API</h2>
              <p className="mt-1 text-[14px] text-[#6E6E73]">Os tokens de API chegam com o módulo API. Com eles, o sistema da sua empresa envia cargas e lê a Lista do dia sem passar pelo site.</p>
              <Link to="/suporte/novo?motivo=integracao&assunto=Interesse%20na%20API" className="mt-4 inline-flex h-9 items-center rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Quero ser avisado</Link>
            </div>
          </div>
        </section>
      </ContaShell>
    );
  }

  // --- Sem a permissão: só o aviso ---
  if (!podeGerenciar) {
    return (
      <ContaShell>
        <section className="rounded-2xl bg-[#F5F5F7] p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
          <div className="flex items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-[#1D1D1F]"><ShieldAlert size={22} /></div>
            <div className="flex-1">
              <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Tokens de API</h2>
              <p className="mt-1 text-[14px] text-[#6E6E73]">Quem cria tokens é o Admin da sua empresa.</p>
            </div>
          </div>
        </section>
      </ContaShell>
    );
  }

  return (
    <ContaShell>
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

      <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Tokens de API</h2>
            <p className="mt-1 max-w-[520px] text-[14px] text-[#6E6E73]">O sistema da sua empresa usa o token para enviar cargas e ler a Lista do dia. Guarde-o num cofre de segredos.</p>
            <Link to="/docs/api" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-[#0A60D0] hover:underline">Ver a documentação da API</Link>
          </div>
          <button onClick={openNew} className="inline-flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85"><Plus size={16} /> Criar token</button>
        </div>

        {loading ? (
          <p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando tokens...</p>
        ) : tokens.length === 0 ? (
          <div className="mt-6 rounded-xl bg-[#F5F5F7] px-6 py-10 text-center text-[14px] text-[#6E6E73]">Nenhum token criado. Crie o primeiro com “Criar token”.</div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]">
                  <th className="pb-3 pr-4 font-medium">Nome</th>
                  <th className="pb-3 pr-4 font-medium">Token</th>
                  <th className="pb-3 pr-4 font-medium">Escopos</th>
                  <th className="pb-3 pr-4 font-medium">Credores</th>
                  <th className="pb-3 pr-4 font-medium">Criado</th>
                  <th className="pb-3 pr-4 font-medium">Vence</th>
                  <th className="pb-3 pr-4 font-medium">Último uso</th>
                  <th className="pb-3 pr-4 font-medium">Situação</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {tokens.map(t => {
                  const sit = situacao(t);
                  const ativo = !t.revogado_em && new Date(t.expira_em).getTime() >= Date.now();
                  const venceProximo = ativo && diasAte(t.expira_em) < 15;
                  return (
                    <tr key={t.id} className="align-top">
                      <td className="py-3 pr-4 font-medium text-[#1D1D1F]">{t.nome}</td>
                      <td className="py-3 pr-4"><span className="tnum font-mono text-[12px] text-[#6E6E73]">{t.prefixo}…</span></td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {(t.escopos ?? []).map(e => <span key={e} className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[11px] font-medium text-[#1D1D1F]">{escopoLabel(e)}</span>)}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-[#6E6E73]">{credoresTexto(t)}</td>
                      <td className="py-3 pr-4 text-[#6E6E73]">{dateBR(t.criado_em)}</td>
                      <td className="py-3 pr-4"><span className={venceProximo ? 'font-medium text-[#FF9500]' : 'text-[#6E6E73]'}>{dateBR(t.expira_em)}</span></td>
                      <td className="py-3 pr-4 text-[#6E6E73]">{t.ultimo_uso ? dateTimeBR(t.ultimo_uso) : 'nunca'}</td>
                      <td className="py-3 pr-4"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: sit.cor, backgroundColor: sit.bg }}>{sit.label}</span></td>
                      <td className="py-3 text-right">
                        {ativo && (
                          confirmaId === t.id ? (
                            <div className="flex flex-col items-end gap-1.5">
                              <span className="text-[11px] text-[#6E6E73]">O sistema que usa este token para de funcionar na hora.</span>
                              <div className="flex gap-1.5">
                                <button onClick={() => setConfirmaId(null)} className="h-7 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
                                <button onClick={() => void revogar(t.id)} disabled={busy === t.id} className="h-7 rounded-full bg-[#FF3B30] px-3 text-[12px] font-medium text-white disabled:opacity-50">{busy === t.id ? 'Revogando...' : 'Revogar'}</button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmaId(t.id)} className="h-7 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#FF3B30] hover:bg-[#FFE8E6]">Revogar</button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal de criação */}
      {formOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Criar token</h2>
              <button onClick={() => setFormOpen(false)} aria-label="Fechar"><X size={20} className="text-[#8E8E93]" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-[12px] font-semibold text-[#6E6E73]">Nome</label>
                <input value={nome} onChange={e => setNome(e.target.value)} maxLength={60} placeholder="Ex.: ERP Financeiro" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" />
              </div>
              <div>
                <label className="mb-2 block text-[12px] font-semibold text-[#6E6E73]">Escopos</label>
                <div className="space-y-2">
                  {ESCOPOS.map(e => (
                    <label key={e.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
                      <input type="checkbox" checked={escoposSel.includes(e.id)} onChange={() => toggleEscopo(e.id)} className="h-4 w-4 rounded border-[#D2D2D7] accent-[#1D1D1F]" />
                      <span className="text-[14px] text-[#1D1D1F]">{e.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-[12px] font-semibold text-[#6E6E73]">Credores <span className="font-normal text-[#8E8E93]">(vazio = todos)</span></label>
                <div className="max-h-[140px] space-y-1.5 overflow-y-auto rounded-lg bg-[#F5F5F7] p-2">
                  {credores.length === 0 ? <p className="px-1 py-2 text-[13px] text-[#8E8E93]">Nenhum credor cadastrado.</p> :
                    credores.map(c => (
                      <label key={c.id} className="flex items-center gap-2.5 rounded px-1 py-1">
                        <input type="checkbox" checked={credorSel.includes(c.id)} onChange={() => toggleCredor(c.id)} className="h-4 w-4 rounded border-[#D2D2D7] accent-[#1D1D1F]" />
                        <span className="text-[14px] text-[#1D1D1F]">{c.nome}</span>
                      </label>
                    ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-[12px] font-semibold text-[#6E6E73]">Validade</label>
                <div className="flex rounded-lg bg-[#F5F5F7] p-1">
                  {VALIDADES.map(d => (
                    <button key={d} type="button" onClick={() => setDias(d)} className={`flex-1 rounded-md py-2 text-[13px] font-medium ${dias === d ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>{d} dias</button>
                  ))}
                </div>
              </div>
              {formError && <p role="alert" className="text-[13px] text-[#FF3B30]">{formError}</p>}
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setFormOpen(false)} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
                <button onClick={() => void criar()} disabled={busy === 'criar'} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white disabled:opacity-50">{busy === 'criar' ? 'Criando...' : 'Criar token'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Token recém-criado — mostrado uma vez */}
      {novoToken && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setNovoToken(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Token criado</h2>
            <p className="mt-1 text-[13px] text-[#6E6E73]">{novoToken.nome}</p>
            <div className="mt-4 rounded-lg bg-[#1D1D1F] p-3">
              <code className="block break-all font-mono text-[13px] text-[#F5F5F7]">{novoToken.token}</code>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <CopyButton value={novoToken.token} label="Copiar" />
              <button onClick={() => setNovoToken(null)} className="h-7 rounded-full bg-[#1D1D1F] px-4 text-[12px] font-medium text-white hover:opacity-85">Já copiei</button>
            </div>
            <p className="mt-3 rounded-lg bg-[#FFF3E8] px-3 py-2 text-[12px] text-[#9a631b]">Copie agora: por segurança, este token não aparece de novo.</p>
          </div>
        </div>
      )}
    </ContaShell>
  );
}
