import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { supabase, friendlyError, dateBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { MODULOS_INFO, CANAIS_MSG } from '@/lib/empresa-helpers';
import { MensageriaModal } from '@/components/workspace/mensageria-modal';
import { EmpresaShell, cardShadow } from './empresa-shell';
import type { MensageriaModo } from '@/lib/mensageria';
import { LigarEnvioRealButton } from '@/components/workspace/console/ligar-envio-real';

export function ModulosPage() {
  const { empresa, perfil } = useMotorAuth();
  const [mods, setMods] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [mensageriaOpen, setMensageriaOpen] = useState(false);
  const [modoMsg, setModoMsg] = useState<MensageriaModo>('simulado');
  const [modoCarregado, setModoCarregado] = useState(false);
  const [pedidoAberto, setPedidoAberto] = useState(false);
  const [confirmarReal, setConfirmarReal] = useState(false);
  const [confirmarOrq, setConfirmarOrq] = useState(false);
  const [modoBusy, setModoBusy] = useState(false);
  const [modoErro, setModoErro] = useState('');
  const [rcsAgente, setRcsAgente] = useState<'nao_conversacional' | 'conversacional'>('nao_conversacional');
  const [planos, setPlanos] = useState<Row[]>([]);
  const [rotasEmpresa, setRotasEmpresa] = useState<Record<string, string | null>>({});
  const [rotaBusy, setRotaBusy] = useState('');
  const isEquipe = !!perfil?.equipe;
  const isEquipeAdmin = isEquipe && perfil?.papel === 'admin';
  const apiAtivo = !!mods['api']?.ativo;

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true);
    const { data, error } = await supabase.from('empresa_modulos').select('*').eq('empresa_id', empresa.id);
    if (error) setError(friendlyError(error));
    const map: Record<string, Row> = {};
    (data ?? []).forEach((r: Row) => { map[r.modulo as string] = r; });
    setMods(map);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  // Modo da mensageria (simulado / real) — só equipe admin altera.
  useEffect(() => {
    if (!supabase || !empresa) return;
    let active = true;
    (async () => {
      const [cfg, ped] = await Promise.all([
        supabase.from('mensageria_config').select('*').eq('empresa_id', empresa.id).maybeSingle(),
        supabase.from('pedidos_envio_real').select('situacao').eq('empresa_id', empresa.id).order('pedido_em', { ascending: false }).limit(1),
      ]);
      if (!active) return;
      setModoMsg((cfg.data as Row | null)?.modo === 'real' ? 'real' : 'simulado');
      setRcsAgente((cfg.data as Row | null)?.rcs_agente === 'conversacional' ? 'conversacional' : 'nao_conversacional');
      setModoCarregado(true);
      setPedidoAberto(((ped.data ?? [])[0] as Row | undefined)?.situacao === 'aberto');
    })();
    return () => { active = false; };
  }, [empresa?.id]);

  // Planos de rota e rota atual da empresa (só equipe admin).
  useEffect(() => {
    if (!supabase || !empresa || !isEquipeAdmin) return;
    let active = true;
    (async () => {
      const [pl, re] = await Promise.all([
        supabase.from('mensageria_planos_rota').select('id,nome,canal,padrao,ativo').eq('ativo', true),
        supabase.from('mensageria_rota_empresa').select('canal,plano_id').eq('empresa_id', empresa.id),
      ]);
      if (!active) return;
      setPlanos((pl.data ?? []) as Row[]);
      const map: Record<string, string | null> = {};
      ((re.data ?? []) as Row[]).forEach(r => { map[r.canal as string] = (r.plano_id as string) ?? null; });
      setRotasEmpresa(map);
    })();
    return () => { active = false; };
  }, [empresa?.id, isEquipeAdmin]);

  async function aplicarModo(modo: MensageriaModo) {
    if (!supabase || !empresa) return;
    setModoBusy(true); setModoErro('');
    const { error } = await supabase.from('mensageria_config').upsert({ empresa_id: empresa.id, modo }, { onConflict: 'empresa_id' });
    setModoBusy(false);
    if (error) { setModoErro(friendlyError(error)); return; }
    setModoMsg(modo);
  }

  async function aplicarRcsAgente(valor: 'nao_conversacional' | 'conversacional') {
    if (!supabase || !empresa) return;
    const anterior = rcsAgente;
    setRcsAgente(valor);
    const { error } = await supabase.from('mensageria_config').upsert({ empresa_id: empresa.id, rcs_agente: valor }, { onConflict: 'empresa_id' });
    if (error) { setRcsAgente(anterior); toast.error(friendlyError(error)); }
  }

  async function definirRota(canal: string, planoId: string | null) {
    if (!supabase || !empresa) return;
    setRotaBusy(canal);
    const { error } = await supabase.rpc('definir_rota_empresa', { empresa: empresa.id, canal, plano: planoId });
    setRotaBusy('');
    if (error) { toast.error(friendlyError(error)); return; }
    setRotasEmpresa(prev => ({ ...prev, [canal]: planoId }));
  }

  async function toggleModulo(id: string, ativo: boolean) {
    if (!supabase || !empresa) return;
    if (id === 'orquestracao' && !ativo) { setConfirmarOrq(true); return; }
    setBusy(id);
    const { error } = await supabase.from('empresa_modulos').upsert({ empresa_id: empresa.id, modulo: id, ativo, canais: mods[id]?.canais ?? [] }, { onConflict: 'empresa_id,modulo' });
    if (error) setError(friendlyError(error)); else void reload();
    setBusy('');
  }

  async function toggleCanal(modId: string, canal: string, on: boolean) {
    if (!supabase || !empresa) return;
    setBusy(`${modId}-${canal}`);
    const atuais: string[] = Array.isArray(mods[modId]?.canais) ? (mods[modId].canais as string[]) : [];
    const canais = on ? [...new Set([...atuais, canal])] : atuais.filter(c => c !== canal);
    const { error } = await supabase.from('empresa_modulos').upsert({ empresa_id: empresa.id, modulo: modId, ativo: mods[modId]?.ativo ?? true, canais }, { onConflict: 'empresa_id,modulo' });
    if (error) setError(friendlyError(error)); else void reload();
    setBusy('');
  }

  return (
    <EmpresaShell>
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        {MODULOS_INFO.filter(m => m.id === 'orquestracao' || m.id === 'mensageria').map(m => {
          const rec = mods[m.id];
          const ativo = !!rec?.ativo;
          const canais: string[] = Array.isArray(rec?.canais) ? (rec.canais as string[]) : [];
          return (
            <div key={m.id} className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold text-[#1D1D1F]">{m.nome}</p>
                  <p className="mt-0.5 text-[13px] text-[#6E6E73]">{m.desc}</p>
                </div>
                {isEquipe ? (
                  <button role="switch" aria-checked={ativo} disabled={busy === m.id} onClick={() => toggleModulo(m.id, !ativo)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${ativo ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}>
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${ativo ? 'left-6' : 'left-1'}`} />
                  </button>
                ) : (
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${ativo ? 'bg-[#E8F8EC] text-[#248A3D]' : 'bg-[#F5F5F7] text-[#8E8E93]'}`}>{ativo ? 'Ativo' : 'Desligado'}</span>
                )}
              </div>
              {rec?.desde && <p className="mt-3 text-[12px] text-[#8E8E93]">desde {dateBR(rec.desde)}</p>}
              {m.canais && (
                <div className="mt-4">
                  <p className="mb-2 text-[12px] font-semibold text-[#6E6E73]">Canais liberados</p>
                  <div className="flex flex-wrap gap-2">
                    {CANAIS_MSG.map(c => {
                      const on = canais.includes(c.id);
                      return (
                        <button key={c.id} disabled={!isEquipe || busy === `${m.id}-${c.id}`} onClick={() => toggleCanal(m.id, c.id, !on)} className={`rounded-full px-3 py-1 text-[12px] font-semibold transition disabled:opacity-50 ${on ? 'text-white' : 'bg-[#F5F5F7] text-[#8E8E93]'}`} style={on ? { backgroundColor: c.cor } : undefined}>{c.nome}</button>
                      );
                    })}
                  </div>
                </div>
              )}
              {m.id === 'mensageria' && isEquipeAdmin && modoCarregado && (
                <div className="mt-4">
                  <p className="mb-2 text-[12px] font-semibold text-[#6E6E73]">Modo de envio</p>
                  <div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F5F5F7] p-1">
                    <button onClick={() => aplicarModo('simulado')} disabled={modoBusy} className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors ${modoMsg === 'simulado' ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>Simulação</button>
                    <button onClick={() => modoMsg === 'real' ? aplicarModo('simulado') : setConfirmarReal(true)} disabled={modoBusy} className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors ${modoMsg === 'real' ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>Envio real</button>
                  </div>
                  {modoErro && <p className="mt-2 text-[12px] text-[#FF3B30]">{modoErro}</p>}
                </div>
              )}
              {m.id === 'mensageria' && isEquipe && pedidoAberto && (
                <div className="mt-4 rounded-xl bg-[#FFF7E8] p-3">
                  <p className="mb-2 text-[12px] font-semibold text-[#9a631b]">Pedido de envio real em aberto</p>
                  <LigarEnvioRealButton empresaId={empresa!.id} empresaNome={empresa!.nome} onDone={() => { setPedidoAberto(false); void reload(); }} size="sm" />
                </div>
              )}
              {m.id === 'mensageria' && canais.includes('rcs') && (
                <div className="mt-4">
                  <p className="mb-2 text-[12px] font-semibold text-[#6E6E73]">Agente RCS</p>
                  {isEquipe ? (
                    <div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F5F5F7] p-1">
                      <button onClick={() => aplicarRcsAgente('nao_conversacional')} className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors ${rcsAgente === 'nao_conversacional' ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>Não conversacional</button>
                      <button onClick={() => aplicarRcsAgente('conversacional')} className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors ${rcsAgente === 'conversacional' ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>Conversacional</button>
                    </div>
                  ) : (
                    <span className="rounded-full bg-[#F5F5F7] px-3 py-1 text-[13px] font-medium text-[#1D1D1F]">{rcsAgente === 'conversacional' ? 'Conversacional' : 'Não conversacional'}</span>
                  )}
                  <p className="mt-2 text-[12px] text-[#8E8E93]">Conversacional: a resposta do cliente transforma o envio em sessão Conversacional (cobrada como tal) e, por 24 h, novas mensagens para o mesmo número não têm custo extra.</p>
                </div>
              )}
              {m.id === 'mensageria' && isEquipeAdmin && canais.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-[12px] font-semibold text-[#6E6E73]">Plano de rota por canal</p>
                  <div className="space-y-2">
                    {canais.map(c => {
                      const planosCanal = planos.filter(p => p.canal === c);
                      const padrao = planosCanal.find(p => p.padrao);
                      const atual = rotasEmpresa[c] ?? null;
                      return (
                        <div key={c} className="flex items-center gap-2">
                          <span className="w-20 shrink-0 text-[13px] text-[#1D1D1F]">{CANAIS_MSG.find(x => x.id === c)?.nome ?? c}</span>
                          <select value={atual ?? ''} disabled={rotaBusy === c} onChange={e => definirRota(c, e.target.value || null)} className="h-9 flex-1 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]">
                            <option value="">{padrao ? `Padrão (${padrao.nome})` : 'Padrão'}</option>
                            {planosCanal.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <section className="mt-4 rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[16px] font-semibold text-[#1D1D1F]">Acesso à API</p>
            <p className="mt-0.5 text-[13px] text-[#6E6E73]">Libera o envio de cargas e a leitura da Lista do dia pelo sistema da sua empresa.</p>
          </div>
          <div className="flex items-center gap-4">
            {isEquipe ? (
              <button role="switch" aria-checked={apiAtivo} disabled={busy === 'api'} onClick={() => toggleModulo('api', !apiAtivo)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${apiAtivo ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}>
                <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${apiAtivo ? 'left-6' : 'left-1'}`} />
              </button>
            ) : (
              <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${apiAtivo ? 'bg-[#E8F8EC] text-[#248A3D]' : 'bg-[#F5F5F7] text-[#8E8E93]'}`}>{apiAtivo ? 'Liberado' : 'Não liberado'}</span>
            )}
            <Link to="/documentacao" className="text-[13px] font-medium text-[#0A60D0] hover:underline">Ver documentação</Link>
          </div>
        </div>
      </section>

      {!isEquipe && (
        <div className="mt-6 rounded-2xl bg-[#F5F5F7] p-6 text-center" style={{ boxShadow: cardShadow }}>
          <p className="text-[14px] text-[#6E6E73]">Para incluir um módulo, fale com o comercial.</p>
          <button onClick={() => setMensageriaOpen(true)} className="mt-4 inline-flex h-9 items-center rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Quero conhecer</button>
        </div>
      )}
      <MensageriaModal open={mensageriaOpen} onClose={() => setMensageriaOpen(false)} />
      {confirmarOrq && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={() => setConfirmarOrq(false)}>
          <div className="w-full max-w-[420px] rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
            <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Desligar a Orquestração?</h2>
            <p className="mt-2 text-[14px] text-[#6E6E73]">Com a Orquestração desligada, o MotorCX não roda a rotina do dia desta empresa e a mensalidade da Orquestração sai da fatura.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmarOrq(false)} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Voltar</button>
              <button onClick={() => { setConfirmarOrq(false); void toggleModulo('orquestracao', false); }} disabled={busy === 'orquestracao'} className="h-10 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">Desligar</button>
            </div>
          </div>
        </div>
      )}
      {confirmarReal && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={() => setConfirmarReal(false)}>
          <div className="w-full max-w-[400px] rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
            <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Ligar envio real?</h2>
            <p className="mt-2 text-[14px] text-[#6E6E73]">Só ligue quando o fornecedor da rota estiver integrado. Envio real entra no consumo e na fatura.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmarReal(false)} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Voltar</button>
              <button onClick={() => { setConfirmarReal(false); void aplicarModo('real'); }} disabled={modoBusy} className="h-10 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">Ligar envio real</button>
            </div>
          </div>
        </div>
      )}
    </EmpresaShell>
  );
}
