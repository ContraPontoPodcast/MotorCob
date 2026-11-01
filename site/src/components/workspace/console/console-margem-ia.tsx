// Margem dos itens de IA (SQL 61): a IA é revendida e todo item de IA precisa de %MC ≥ a MC mínima da IA (padrão 70%).
// Só o Master: custo real, preço mínimo (= custo ÷ (1 − impostos − MC mínima), para cima), preço de tabela, preços de
// empresa abaixo do mínimo e a margem do mês por empresa e item. O banco recusa preço abaixo do mínimo; aqui o botão
// já fica bloqueado com a mesma mensagem.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError, moneyBR, numberBR, type Row } from '@/lib/supabase';
import { ErrorDetail } from '@/components/error-detail';
import { useConsolePerms } from './console-perms';
import { cardShadow } from './console-shell';

const SIT_IA: Record<string, { label: string; cor: string; bg: string }> = {
  ok: { label: 'OK', cor: '#248A3D', bg: '#E8F8EC' },
  abaixo_minimo: { label: 'Abaixo do mínimo', cor: '#FF3B30', bg: '#FFE8E6' },
  sem_custo: { label: 'Sem custo', cor: '#9a631b', bg: '#FFF3E8' },
  sem_preco: { label: 'Sem preço', cor: '#8E8E93', bg: '#F5F5F7' },
  sem_receita: { label: 'Sem receita', cor: '#8E8E93', bg: '#F5F5F7' },
};
const ORIGEM: Record<string, string> = { tabela: 'Preço de tabela', minimo_catalogo: 'Mínimo do catálogo', empresa: 'Preço da empresa' };

/** Preço de IA: centavos a partir de R$ 0,10; abaixo disso, até 5 casas (a precisão dos preços). */
export function precoIA(v: unknown): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (n >= 0.1) return moneyBR(n);
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`;
}
/** Mesma mensagem do banco quando o preço fica abaixo do mínimo da IA. */
export function mensagemMinimoIA(minimo: unknown, unidade: unknown, mcMinima: unknown): string {
  return `Abaixo do mínimo da IA: o menor preço aceito é ${precoIA(minimo)} por ${unidade ?? 'unidade'} (MC mínima de ${Number(mcMinima ?? 70).toLocaleString('pt-BR')}%).`;
}
/** Número digitado: "1,50", "1.234,5" ou "1.50" (mesma regra da Contratação). */
function num(v: string): number {
  let s = String(v ?? '').trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function pct1(v: unknown) { return v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
/** Mensagens do guarda da IA são para a pessoa; o resto vira a mensagem genérica com o detalhe técnico. */
function erroIA(e: { message?: string } | null): string {
  const m = e?.message ?? '';
  return /item de IA|mínimo|custo|preço|Master|parâmetros/i.test(m) ? m : friendlyError(e);
}

export function MargemIa({ competencia, mcMinima, recarregar }: { competencia: string; mcMinima: unknown; recarregar: number }) {
  const { isMaster } = useConsolePerms();
  const [itens, setItens] = useState<Row[]>([]);
  const [margem, setMargem] = useState<Row[]>([]);
  const [abaixo, setAbaixo] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editar, setEditar] = useState<Row | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!supabase || !isMaster) return;
    let ativo = true;
    (async () => {
      setLoading(true); setError('');
      const [it, mg, ab] = await Promise.all([
        supabase.rpc('itens_ia'),
        supabase.rpc('margem_ia', { competencia }),
        supabase.rpc('ia_precos_abaixo_minimo'),
      ]);
      if (!ativo) return;
      const e = it.error ?? mg.error ?? ab.error;
      if (e) { setError(friendlyError(e)); setLoading(false); return; }
      setItens((it.data ?? []) as Row[]);
      setMargem((mg.data ?? []) as Row[]);
      setAbaixo((ab.data ?? []) as Row[]);
      setLoading(false);
    })();
    return () => { ativo = false; };
  }, [competencia, isMaster, recarregar, tick]);

  if (!isMaster) return null;

  const tot = margem.reduce((a, l) => ({ receita: a.receita + Number(l.receita ?? 0), mc: a.mc + Number(l.mc ?? 0) }), { receita: 0, mc: 0 });

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Itens de IA</h2>
        <p className="text-[13px] text-[#6E6E73]">MC mínima da IA: <strong className="text-[#1D1D1F]">{Number(mcMinima ?? 70).toLocaleString('pt-BR')}%</strong> · preço mínimo = custo ÷ (1 − impostos − MC mínima)</p>
      </div>
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}<ErrorDetail /></div>}
      {loading ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Carregando...</p> : (
        <div className="space-y-4">
          {abaixo.length > 0 && (
            <div role="alert" className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[13px] text-[#FF3B30]">
              <p className="font-semibold">{abaixo.length === 1 ? '1 preço de IA ficou abaixo do mínimo' : `${abaixo.length} preços de IA ficaram abaixo do mínimo`} (custo, impostos ou MC mínima mudaram). Nenhum preço foi alterado.</p>
              <ul className="mt-1 space-y-0.5">
                {abaixo.slice(0, 8).map((a, i) => (
                  <li key={i} className="break-words">
                    {a.nome} · {a.empresa ?? ORIGEM[a.origem as string] ?? a.origem}: {a.problema === 'mensalidade' ? 'mensalidade (use preço por unidade)' : a.problema === 'sem_custo' ? 'item sem custo cadastrado' : <>{precoIA(a.preco)} → mínimo {precoIA(a.preco_minimo_ia)}</>}
                  </li>
                ))}
                {abaixo.length > 8 && <li>e mais {abaixo.length - 8}.</li>}
              </ul>
            </div>
          )}

          <div className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-3 font-medium">Item</th><th className="pb-3 font-medium text-right">Custo</th><th className="pb-3 font-medium text-right">Preço mínimo</th><th className="pb-3 font-medium text-right">Tabela</th><th className="pb-3 font-medium text-right">%MC na tabela</th><th className="pb-3" /></tr></thead>
                <tbody className="divide-y divide-[#F0F0F2]">
                  {itens.map(it => {
                    const baixa = it.mc_tabela_pct != null && Number(it.mc_tabela_pct) < Number(mcMinima ?? 70);
                    return (
                      <tr key={it.codigo}>
                        <td className="py-2.5 pr-3"><p className="font-medium text-[#1D1D1F]">{it.nome}</p><p className="text-[11px] text-[#8E8E93]">por {it.unidade}{Number(it.precos_abaixo ?? 0) > 0 && <span className="ml-1 font-semibold text-[#FF3B30]">· {it.precos_abaixo} abaixo</span>}</p></td>
                        <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{it.custo_unitario == null ? <span className="text-[#9a631b]">sem custo</span> : precoIA(it.custo_unitario)}{it.moeda && it.moeda !== 'BRL' && <p className="text-[11px] text-[#8E8E93]">{it.moeda} {Number(it.custo_moeda).toLocaleString('pt-BR', { maximumFractionDigits: 6 })} × {Number(it.cotacao).toLocaleString('pt-BR')}</p>}</td>
                        <td className="py-2.5 pr-3 text-right tnum font-semibold text-[#1D1D1F]">{precoIA(it.preco_minimo_ia)}</td>
                        <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{precoIA(it.preco_tabela)}</td>
                        <td className="py-2.5 pr-3 text-right"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={baixa ? { color: '#FF3B30', backgroundColor: '#FFE8E6' } : { color: '#248A3D', backgroundColor: '#E8F8EC' }}>{pct1(it.mc_tabela_pct)}</span></td>
                        <td className="py-2.5 text-right"><button onClick={() => setEditar(it)} className="h-8 rounded-full border border-[#D2D2D7] px-3 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Editar</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[14px] font-semibold text-[#1D1D1F]">Margem da IA no mês</p>
              <p className="text-[13px] text-[#6E6E73]">Receita {moneyBR(tot.receita)} · MC {moneyBR(tot.mc)} · {pct1(tot.receita > 0 ? (tot.mc / tot.receita) * 100 : null)}</p>
            </div>
            {margem.length === 0 ? <p className="py-4 text-center text-[13px] text-[#8E8E93]">Sem uso de IA no mês.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-[13px]">
                  <thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-3 font-medium">Empresa</th><th className="pb-3 font-medium">Item</th><th className="pb-3 font-medium text-right">Qtd</th><th className="pb-3 font-medium text-right">Receita</th><th className="pb-3 font-medium text-right">Impostos</th><th className="pb-3 font-medium text-right">Custo</th><th className="pb-3 font-medium text-right">MC</th><th className="pb-3 font-medium text-right">%MC</th></tr></thead>
                  <tbody className="divide-y divide-[#F0F0F2]">
                    {margem.map((l, i) => {
                      const sit = SIT_IA[l.situacao as string] ?? SIT_IA.sem_receita;
                      return (
                        <tr key={i}>
                          <td className="py-2.5 pr-3 font-medium text-[#1D1D1F]">{l.empresa ?? '—'}</td>
                          <td className="py-2.5 pr-3 text-[#1D1D1F]">{l.nome}</td>
                          <td className="py-2.5 pr-3 text-right tnum text-[#6E6E73]">{numberBR(l.quantidade ?? 0)}</td>
                          <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{moneyBR(l.receita ?? 0)}</td>
                          <td className="py-2.5 pr-3 text-right tnum text-[#6E6E73]">{moneyBR(l.impostos ?? 0)}</td>
                          <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{moneyBR(l.custo ?? 0)}{!!l.custo_estimado && <span className="ml-1 text-[11px] text-[#8E8E93]">estimado</span>}</td>
                          <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{moneyBR(l.mc ?? 0)}</td>
                          <td className="py-2.5 text-right"><span title={sit.label} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: sit.cor, backgroundColor: sit.bg }}>{l.mc_pct == null ? sit.label : pct1(l.mc_pct)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {editar && <EditarItemIa item={editar} mcMinima={mcMinima} onClose={() => setEditar(null)} onSalvo={() => setTick(t => t + 1)} />}
    </section>
  );
}

function EditarItemIa({ item, mcMinima, onClose, onSalvo }: { item: Row; mcMinima: unknown; onClose: () => void; onSalvo: () => void }) {
  const [it, setIt] = useState<Row>(item);
  const [moeda, setMoeda] = useState<string>(String(item.moeda ?? 'BRL'));
  const [custo, setCusto] = useState(item.custo_moeda != null ? String(item.custo_moeda).replace('.', ',') : '');
  const [cotacao, setCotacao] = useState(item.cotacao != null ? String(item.cotacao).replace('.', ',') : '1');
  const [milTokens, setMilTokens] = useState(item.custo_mil_tokens != null ? String(item.custo_mil_tokens).replace('.', ',') : '');
  const [premissa, setPremissa] = useState(String(item.premissa ?? ''));
  const [tabela, setTabela] = useState(item.preco_tabela != null ? String(item.preco_tabela).replace('.', ',') : '');
  const [empresas, setEmpresas] = useState<Row[]>([]);
  const [empresa, setEmpresa] = useState('');
  const [precoEmp, setPrecoEmp] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ onde: string; erro?: string; ok?: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.from('empresas').select('id,nome').order('nome').then(({ data }) => setEmpresas((data ?? []) as Row[]));
  }, []);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  async function recarregarItem() {
    if (!supabase) return;
    const { data } = await supabase.rpc('itens_ia');
    const novo = ((data ?? []) as Row[]).find(x => x.codigo === it.codigo);
    if (novo) setIt(novo);
    onSalvo();
  }

  const minimo = it.preco_minimo_ia;
  const semCusto = minimo == null;
  const vTabela = num(tabela);
  const vEmp = num(precoEmp);
  const tabelaAbaixo = !semCusto && vTabela > 0 && vTabela < Number(minimo);
  const empAbaixo = !semCusto && vEmp > 0 && vEmp < Number(minimo);

  async function salvarCusto() {
    if (!supabase) return;
    setBusy('custo'); setMsg(null);
    const { data, error } = await supabase.rpc('salvar_custo_ia', {
      item: it.codigo, custo_unitario: num(custo), moeda, cotacao: moeda === 'BRL' ? 1 : num(cotacao),
      custo_mil_tokens: milTokens.trim() ? num(milTokens) : null, premissa: premissa.trim() || null,
    });
    setBusy('');
    if (error) { setMsg({ onde: 'custo', erro: erroIA(error) }); return; }
    const r = (data ?? {}) as Row;
    const abaixo = Number(r.precos_abaixo ?? 0);
    setMsg({ onde: 'custo', ok: `Custo salvo. Preço mínimo agora: ${precoIA(r.preco_minimo)}.${r.preco_padrao_aplicado ? ' O item ganhou o preço padrão (= o mínimo).' : ''}${abaixo > 0 ? ` ${abaixo} preço(s) ficaram abaixo do mínimo: nenhum foi alterado.` : ''}` });
    await recarregarItem();
  }
  async function salvarTabela() {
    if (!supabase || tabelaAbaixo) return;
    setBusy('tabela'); setMsg(null);
    const { error } = await supabase.rpc('salvar_preco_tabela_ia', { item: it.codigo, preco_tabela: vTabela });
    setBusy('');
    if (error) { setMsg({ onde: 'tabela', erro: erroIA(error) }); return; }
    setMsg({ onde: 'tabela', ok: 'Preço de tabela salvo.' });
    toast.success('Preço de tabela salvo.');
    await recarregarItem();
  }
  async function salvarEmpresa() {
    if (!supabase || !empresa || empAbaixo) return;
    setBusy('empresa'); setMsg(null);
    const { data, error } = await supabase.rpc('salvar_preco_vigencia', { empresa: Number(empresa), item: it.codigo, modelo: 'flat', preco: vEmp, minimo: 0, faixas: null, vigencia: 'proximo' });
    setBusy('');
    if (error) { setMsg({ onde: 'empresa', erro: erroIA(error) }); return; }
    const vale = (Array.isArray(data) ? data[0] : data) as Row | null;
    setMsg({ onde: 'empresa', ok: `Preço salvo${vale?.vale_desde ? ` (vale a partir do ciclo de ${String(vale.vale_desde).split('-').reverse().slice(1).join('/')})` : ''}.` });
    await recarregarItem();
  }

  const campo = 'h-9 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] tnum text-[#1D1D1F] outline-none focus:border-[#1D1D1F]';
  const Aviso = ({ onde }: { onde: string }) => msg?.onde === onde ? (msg.erro
    ? <p role="alert" className="mt-2 rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">{msg.erro}</p>
    : <p className="mt-2 text-[12px] text-[#248A3D]">{msg.ok}</p>) : null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Item de IA ${it.nome}`} className="h-full w-full max-w-[440px] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-[17px] font-semibold text-[#1D1D1F]">{it.nome}</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><X size={20} /></button>
        </div>
        <p className="mb-5 text-[13px] text-[#6E6E73]">Preço mínimo: <strong className="text-[#1D1D1F]">{semCusto ? 'cadastre o custo' : `${precoIA(minimo)} por ${it.unidade}`}</strong> (MC mínima de {Number(mcMinima ?? 70).toLocaleString('pt-BR')}%)</p>

        <div className="space-y-6">
          <div>
            <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Custo real por {it.unidade} <span className="font-normal text-[#8E8E93]">(vale a partir de hoje)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-1 block text-[12px] text-[#6E6E73]">Moeda</span>
                <select value={moeda} onChange={e => setMoeda(e.target.value)} className={campo}><option value="BRL">R$</option><option value="USD">US$</option><option value="EUR">€</option></select></label>
              <label className="block"><span className="mb-1 block text-[12px] text-[#6E6E73]">Custo</span><input inputMode="decimal" value={custo} onChange={e => setCusto(e.target.value)} className={campo} /></label>
              {moeda !== 'BRL' && <label className="block"><span className="mb-1 block text-[12px] text-[#6E6E73]">Cotação (R$)</span><input inputMode="decimal" value={cotacao} onChange={e => setCotacao(e.target.value)} className={campo} /></label>}
              <label className="block"><span className="mb-1 block text-[12px] text-[#6E6E73]">Por mil tokens (opcional)</span><input inputMode="decimal" value={milTokens} onChange={e => setMilTokens(e.target.value)} className={campo} /></label>
            </div>
            <label className="mt-2 block"><span className="mb-1 block text-[12px] text-[#6E6E73]">De onde vem o custo</span><input value={premissa} maxLength={300} onChange={e => setPremissa(e.target.value)} className={campo} placeholder="Contrato, tabela do fornecedor…" /></label>
            <button onClick={salvarCusto} disabled={busy !== '' || num(custo) <= 0 || (moeda !== 'BRL' && num(cotacao) <= 0)} className="mt-3 h-9 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy === 'custo' ? 'Salvando...' : 'Salvar custo'}</button>
            <p className="mt-1 text-[12px] text-[#8E8E93]">Custo novo não muda preço nenhum: o que ficar abaixo do mínimo aparece no aviso.</p>
            <Aviso onde="custo" />
          </div>

          <div className="border-t border-[#F0F0F2] pt-4">
            <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Preço de tabela</p>
            <div className="flex gap-2">
              <input inputMode="decimal" value={tabela} onChange={e => setTabela(e.target.value)} aria-invalid={tabelaAbaixo} className={`${campo} ${tabelaAbaixo ? 'border-[#FF3B30] text-[#FF3B30]' : ''}`} />
              <button onClick={salvarTabela} disabled={busy !== '' || vTabela <= 0 || tabelaAbaixo || semCusto} className="h-9 shrink-0 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy === 'tabela' ? '...' : 'Salvar'}</button>
            </div>
            {tabelaAbaixo && <p role="alert" className="mt-2 text-[12px] font-medium text-[#FF3B30]">{mensagemMinimoIA(minimo, it.unidade, mcMinima)}</p>}
            <Aviso onde="tabela" />
          </div>

          <div className="border-t border-[#F0F0F2] pt-4">
            <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Preço de uma empresa <span className="font-normal text-[#8E8E93]">(a partir do próximo ciclo)</span></p>
            <select value={empresa} onChange={e => setEmpresa(e.target.value)} className={campo}>
              <option value="">Escolha a empresa…</option>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <div className="mt-2 flex gap-2">
              <input inputMode="decimal" value={precoEmp} onChange={e => setPrecoEmp(e.target.value)} aria-invalid={empAbaixo} placeholder={`Preço por ${it.unidade}`} className={`${campo} ${empAbaixo ? 'border-[#FF3B30] text-[#FF3B30]' : ''}`} />
              <button onClick={salvarEmpresa} disabled={busy !== '' || !empresa || vEmp <= 0 || empAbaixo || semCusto} className="h-9 shrink-0 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy === 'empresa' ? '...' : 'Salvar'}</button>
            </div>
            {empAbaixo && <p role="alert" className="mt-2 text-[12px] font-medium text-[#FF3B30]">{mensagemMinimoIA(minimo, it.unidade, mcMinima)}</p>}
            {semCusto && <p className="mt-2 text-[12px] text-[#9a631b]">Sem custo cadastrado: o preço da empresa fica bloqueado até cadastrar o custo.</p>}
            <Aviso onde="empresa" />
          </div>
        </div>
      </div>
    </div>
  );
}
