// Margem dos itens de IA (SQL 61): a IA é revendida e todo item de IA precisa de %MC ≥ a MC mínima da IA (padrão 70%).
// Só o Master: custo real, preço mínimo (= custo ÷ (1 − impostos − MC mínima), para cima), preço de tabela, preços de
// empresa abaixo do mínimo e a margem do mês por empresa e item. O banco recusa preço abaixo do mínimo; aqui o botão
// já fica bloqueado com a mesma mensagem.
// Redesign v2: 4 KPIs (receita, margem, preços abaixo do mínimo, itens sem custo), um aviso com "Ver lista", "Revisar N
// preços" como ação principal, tabela de preços com 5 colunas, a fórmula em "Como calculamos", a margem do mês com 5
// colunas e a gaveta de edição com um seletor de seção e um botão de salvar só. Só tokens do tema.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Aviso, Botao, Cartao, Detalhes, Estado, Gaveta, Kpis, ListaRegras, ListaValores, Pilula, Rotulo, Segmentos, Tabela, campoCls, campoStyle, type Tom } from '@/components/ds';
import { supabase, friendlyError, moneyBR, numberBR, type Row } from '@/lib/supabase';
import { ErrorDetail } from '@/components/error-detail';
import { useConsolePerms } from './console-perms';

const SIT_IA: Record<string, { label: string; tom: Tom }> = {
  ok: { label: 'OK', tom: 'ok' },
  abaixo_minimo: { label: 'Abaixo do mínimo', tom: 'erro' },
  sem_custo: { label: 'Sem custo', tom: 'atencao' },
  sem_preco: { label: 'Sem preço', tom: 'neutro' },
  sem_receita: { label: 'Sem receita', tom: 'neutro' },
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
  const [editar, setEditar] = useState<{ item: Row; secao?: Secao; empresa?: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [parte, setParte] = useState<'precos' | 'mes'>('precos');
  const [revisar, setRevisar] = useState(false);
  const [como, setComo] = useState(false);
  const [linhaMes, setLinhaMes] = useState<Row | null>(null);
  const [filtroEmp, setFiltroEmp] = useState('');

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

  const mcMin = Number(mcMinima ?? 70);
  const tot = margem.reduce((a, l) => ({ receita: a.receita + Number(l.receita ?? 0), mc: a.mc + Number(l.mc ?? 0) }), { receita: 0, mc: 0 });
  const pctTot = tot.receita > 0 ? (tot.mc / tot.receita) * 100 : null;
  const semCusto = itens.filter(it => it.custo_unitario == null).length;
  const empresasMes = [...new Set(margem.map(l => String(l.empresa ?? '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const margemVis = filtroEmp ? margem.filter(l => String(l.empresa ?? '') === filtroEmp) : margem;
  const itemDe = (codigo: unknown) => itens.find(x => x.codigo === codigo) ?? null;
  const mcTabela = (it: Row) => { const baixa = it.mc_tabela_pct != null && Number(it.mc_tabela_pct) < mcMin; return <Pilula tom={it.mc_tabela_pct == null ? 'neutro' : baixa ? 'erro' : 'ok'}>{pct1(it.mc_tabela_pct)}</Pilula>; };
  const mcMes = (l: Row) => { const sit = SIT_IA[l.situacao as string] ?? SIT_IA.sem_receita; return <Pilula tom={sit.tom} title={sit.label}>{l.mc_pct == null ? sit.label : pct1(l.mc_pct)}</Pilula>; };
  const problema = (a: Row) => a.problema === 'mensalidade' ? 'mensalidade (use preço por unidade)' : a.problema === 'sem_custo' ? 'item sem custo cadastrado' : `${precoIA(a.preco)} → mínimo ${precoIA(a.preco_minimo_ia)}`;

  if (error) return <Estado tipo="erro" titulo="Não deu para carregar os itens de IA.">{error}<ErrorDetail /></Estado>;
  if (loading) return <Estado tipo="carregando" />;

  return (
    <div className="space-y-4">
      <Kpis itens={[
        { rotulo: 'Receita de IA no mês', valor: moneyBR(tot.receita) },
        { rotulo: 'Margem da IA', valor: pct1(pctTot), detalhe: `MC ${moneyBR(tot.mc)} · mínimo ${mcMin.toLocaleString('pt-BR')}%`, tom: pctTot != null && pctTot < mcMin ? 'alerta' : undefined },
        { rotulo: 'Preços abaixo do mínimo', valor: numberBR(abaixo.length), tom: abaixo.length ? 'alerta' : undefined, detalhe: 'nenhum foi alterado' },
        { rotulo: 'Itens sem custo', valor: numberBR(semCusto), tom: semCusto ? 'atencao' : undefined },
      ]} />
      {abaixo.length > 0 && <Aviso tom="erro" titulo={abaixo.length === 1 ? '1 preço de IA está abaixo do mínimo.' : `${abaixo.length} preços de IA estão abaixo do mínimo.`}
        acao={<Botao pequeno onClick={() => setRevisar(true)}>Revisar {abaixo.length} {abaixo.length === 1 ? 'preço' : 'preços'}</Botao>}>Custo, impostos ou MC mínima mudaram; o banco não mexe em preço sozinho.</Aviso>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmentos rotulo="Itens de IA" itens={[{ v: 'precos', n: 'Preços' }, { v: 'mes', n: 'Margem do mês' }]} valor={parte} onTrocar={setParte} />
        <Botao tipo="fantasma" pequeno onClick={() => setComo(true)}>Como calculamos</Botao>
      </div>

      {parte === 'precos' ? (
        <Cartao semPadding>
          <Tabela rotulo="Preços dos itens de IA" linhas={itens} chave={it => String(it.codigo)} onAbrir={it => setEditar({ item: it })} selecionada={editar ? String(editar.item.codigo) : null}
            vazio="Nenhum item de IA no catálogo."
            colunas={[
              { id: 'item', titulo: 'Item', celula: it => <span><b className="font-medium">{String(it.nome)}</b><small className="block text-[11.5px] text-[var(--base-texto-3)]">por {String(it.unidade)}{Number(it.precos_abaixo ?? 0) > 0 && <span className="ml-1 font-semibold text-[var(--estado-erro-texto)]">· {String(it.precos_abaixo)} abaixo</span>}</small></span> },
              { id: 'custo', titulo: 'Custo', num: true, celula: it => it.custo_unitario == null ? <span className="text-[var(--estado-atencao-texto)]">sem custo</span> : precoIA(it.custo_unitario) },
              { id: 'min', titulo: 'Preço mínimo', num: true, celula: it => <b>{precoIA(it.preco_minimo_ia)}</b> },
              { id: 'tab', titulo: 'Tabela', num: true, celula: it => precoIA(it.preco_tabela) },
              { id: 'mc', titulo: 'Margem na tabela', num: true, celula: mcTabela },
            ]}
            celular={it => ({ titulo: String(it.nome), valor: mcTabela(it), resumo: `mínimo ${precoIA(it.preco_minimo_ia)} · tabela ${precoIA(it.preco_tabela)}` })} />
        </Cartao>
      ) : (
        <Cartao semPadding titulo="Margem da IA no mês" direita={empresasMes.length > 1 ? <select aria-label="Empresa" value={filtroEmp} onChange={e => setFiltroEmp(e.target.value)} className={campoCls} style={campoStyle}><option value="">Todas as empresas</option>{empresasMes.map(e => <option key={e} value={e}>{e}</option>)}</select> : undefined}>
          <Tabela rotulo="Margem da IA no mês" linhas={margemVis} chave={l => `${String(l.empresa_id ?? l.empresa)}-${String(l.item ?? l.nome)}`} onAbrir={setLinhaMes}
            vazio="Sem uso de IA no mês."
            colunas={[
              { id: 'emp', titulo: 'Empresa', celula: l => <span className="font-medium">{String(l.empresa ?? '—')}</span> },
              { id: 'item', titulo: 'Item', celula: l => <span>{String(l.nome)}<small className="block text-[11.5px] text-[var(--base-texto-3)]">{numberBR(l.quantidade ?? 0)}{Number(l.quantidade ?? 0) > 0 ? ` × ${precoIA(Number(l.receita ?? 0) / Number(l.quantidade))}` : ''}</small></span> },
              { id: 'rec', titulo: 'Receita', num: true, celula: l => moneyBR(l.receita ?? 0) },
              { id: 'mc', titulo: 'Margem', num: true, celula: l => moneyBR(l.mc ?? 0) },
              { id: 'pct', titulo: 'MC %', num: true, celula: mcMes },
            ]}
            celular={l => ({ titulo: String(l.empresa ?? '—'), valor: mcMes(l), resumo: `${String(l.nome)} · ${moneyBR(l.receita ?? 0)}` })}
            rodape={margemVis.length ? <><span>Total{filtroEmp ? ` · ${filtroEmp}` : ''}</span><b className="tnum text-[var(--base-texto)]">Receita {moneyBR(margemVis.reduce((t, l) => t + Number(l.receita ?? 0), 0))} · MC {moneyBR(margemVis.reduce((t, l) => t + Number(l.mc ?? 0), 0))}</b></> : undefined} />
        </Cartao>
      )}

      <Gaveta aberta={revisar} onFechar={() => setRevisar(false)} titulo="Preços abaixo do mínimo" subtitulo="Nenhum preço foi alterado. Corrija um a um.">
        <ul className="divide-y [&>*]:border-[var(--base-borda)]">
          {abaixo.map((a, i) => {
            const it = itemDe(a.item ?? a.codigo);
            return (
              <li key={i} className="flex items-start justify-between gap-3 py-2.5 text-[13px]">
                <span className="min-w-0"><b className="font-semibold">{String(a.nome)}</b><small className="block text-[12px] text-[var(--base-texto-2)]">{String(a.empresa ?? ORIGEM[a.origem as string] ?? a.origem)} · {problema(a)}</small></span>
                {it && <Botao pequeno tipo="secundario" onClick={() => { setRevisar(false); setEditar({ item: it, secao: a.origem === 'empresa' ? 'empresa' : a.problema === 'sem_custo' ? 'custo' : 'tabela', empresa: a.origem === 'empresa' && a.empresa_id != null ? String(a.empresa_id) : undefined }); }}>Corrigir</Botao>}
              </li>
            );
          })}
        </ul>
      </Gaveta>
      <Gaveta aberta={como} onFechar={() => setComo(false)} titulo="Como calculamos">
        <p className="rounded-xl bg-[var(--base-fill)] px-3 py-2 text-[13px] text-[var(--base-texto)]">Preço mínimo = custo ÷ (1 − impostos − MC mínima), arredondado para cima.</p>
        <ListaRegras regras={[
          { titulo: `Todo item de IA precisa de margem de contribuição (MC) de pelo menos ${mcMin.toLocaleString('pt-BR')}%`, texto: 'A IA é revendida: o mínimo vale para o preço de tabela e para o preço de cada empresa.' },
          { titulo: 'O banco recusa preço abaixo do mínimo', texto: 'Aqui o botão já fica bloqueado com a mesma mensagem.' },
          { titulo: 'Custo novo não muda preço nenhum', texto: 'O que ficar abaixo do mínimo aparece em "Revisar preços".' },
          { titulo: 'Só o Master vê e muda', texto: 'Custo real, preços e a margem por empresa.' },
        ]} />
      </Gaveta>
      <Gaveta aberta={!!linhaMes} onFechar={() => setLinhaMes(null)} titulo={linhaMes ? `${String(linhaMes.empresa ?? '—')} · ${String(linhaMes.nome)}` : ''} subtitulo={linhaMes ? (SIT_IA[linhaMes.situacao as string] ?? SIT_IA.sem_receita).label : undefined}
        rodape={linhaMes && itemDe(linhaMes.item ?? linhaMes.codigo) ? <Botao onClick={() => { const it = itemDe(linhaMes.item ?? linhaMes.codigo)!; const emp = linhaMes.empresa_id != null ? String(linhaMes.empresa_id) : undefined; setLinhaMes(null); setEditar({ item: it, secao: 'empresa', empresa: emp }); }}>Ajustar preço desta empresa</Botao> : undefined}>
        {linhaMes && <ListaValores itens={[
          ['Quantidade', numberBR(linhaMes.quantidade ?? 0)],
          ['Receita', moneyBR(linhaMes.receita ?? 0)],
          ['Impostos', moneyBR(linhaMes.impostos ?? 0)],
          ['Custo', <span key="c">{moneyBR(linhaMes.custo ?? 0)}{!!linhaMes.custo_estimado && <small className="ml-1 font-normal text-[var(--base-texto-3)]">estimado</small>}</span>],
          ['MC', moneyBR(linhaMes.mc ?? 0)],
          ['MC %', linhaMes.mc_pct == null ? '—' : pct1(linhaMes.mc_pct)],
        ]} />}
      </Gaveta>
      {editar && <EditarItemIa key={String(editar.item.codigo)} item={editar.item} secaoInicial={editar.secao} empresaInicial={editar.empresa} mcMinima={mcMinima} onClose={() => setEditar(null)} onSalvo={() => setTick(t => t + 1)} />}
    </div>
  );
}

type Secao = 'custo' | 'tabela' | 'empresa';

function EditarItemIa({ item, mcMinima, onClose, onSalvo, secaoInicial, empresaInicial }: { item: Row; mcMinima: unknown; onClose: () => void; onSalvo: () => void; secaoInicial?: Secao; empresaInicial?: string }) {
  const [secao, setSecao] = useState<Secao>(secaoInicial ?? 'custo');
  const [it, setIt] = useState<Row>(item);
  const [moeda, setMoeda] = useState<string>(String(item.moeda ?? 'BRL'));
  const [custo, setCusto] = useState(item.custo_moeda != null ? String(item.custo_moeda).replace('.', ',') : '');
  const [cotacao, setCotacao] = useState(item.cotacao != null ? String(item.cotacao).replace('.', ',') : '1');
  const [milTokens, setMilTokens] = useState(item.custo_mil_tokens != null ? String(item.custo_mil_tokens).replace('.', ',') : '');
  const [premissa, setPremissa] = useState(String(item.premissa ?? ''));
  const [tabela, setTabela] = useState(item.preco_tabela != null ? String(item.preco_tabela).replace('.', ',') : '');
  const [empresas, setEmpresas] = useState<Row[]>([]);
  const [empresa, setEmpresa] = useState(empresaInicial ?? '');
  const [precoEmp, setPrecoEmp] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ onde: string; erro?: string; ok?: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.from('empresas').select('id,nome').order('nome').then(({ data }) => setEmpresas((data ?? []) as Row[]));
  }, []);

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

  const campo = `${campoCls} w-full tnum`;
  const msgDe = (onde: Secao) => msg?.onde === onde ? (msg.erro ? <Aviso tom="erro">{msg.erro}</Aviso> : <Aviso tom="ok">{msg.ok}</Aviso>) : null;
  const podeCusto = busy === '' && num(custo) > 0 && (moeda === 'BRL' || num(cotacao) > 0);
  const podeTabela = busy === '' && vTabela > 0 && !tabelaAbaixo && !semCusto;
  const podeEmpresa = busy === '' && !!empresa && vEmp > 0 && !empAbaixo && !semCusto;
  const salvarAtual = secao === 'custo' ? <Botao onClick={() => void salvarCusto()} disabled={!podeCusto}>{busy === 'custo' ? 'Salvando...' : 'Salvar custo'}</Botao>
    : secao === 'tabela' ? <Botao onClick={() => void salvarTabela()} disabled={!podeTabela}>{busy === 'tabela' ? 'Salvando...' : 'Salvar preço de tabela'}</Botao>
    : <Botao onClick={() => void salvarEmpresa()} disabled={!podeEmpresa}>{busy === 'empresa' ? 'Salvando...' : 'Salvar preço da empresa'}</Botao>;
  const vermelho = { borderColor: 'var(--estado-erro)', color: 'var(--estado-erro-texto)' };

  return (
    <Gaveta aberta onFechar={onClose} rotulo={`Item de IA ${String(it.nome)}`} titulo={String(it.nome)}
      subtitulo={<>Preço mínimo: <b className="text-[var(--base-texto)]">{semCusto ? 'cadastre o custo' : `${precoIA(minimo)} por ${String(it.unidade)}`}</b> (MC mínima de {Number(mcMinima ?? 70).toLocaleString('pt-BR')}%)</>}
      rodape={<><Botao tipo="secundario" onClick={onClose}>Fechar</Botao>{salvarAtual}</>}>
      <Segmentos rotulo="Seção" itens={[{ v: 'custo', n: 'Custo' }, { v: 'tabela', n: 'Preço de tabela' }, { v: 'empresa', n: 'Preço de uma empresa' }]} valor={secao} onTrocar={v => { setSecao(v); setMsg(null); }} />
      {secao === 'custo' && <>
        <p className="text-[12.5px] text-[var(--base-texto-2)]">Custo real por {String(it.unidade)}, vale a partir de hoje. Custo novo não muda preço nenhum.</p>
        <div className="grid grid-cols-2 gap-2">
          <Rotulo texto="Moeda"><select value={moeda} onChange={e => setMoeda(e.target.value)} className={campo} style={campoStyle}><option value="BRL">R$</option><option value="USD">US$</option><option value="EUR">€</option></select></Rotulo>
          <Rotulo texto="Custo"><input inputMode="decimal" value={custo} onChange={e => setCusto(e.target.value)} className={campo} style={campoStyle} /></Rotulo>
          {moeda !== 'BRL' && <Rotulo texto="Cotação (R$)"><input inputMode="decimal" value={cotacao} onChange={e => setCotacao(e.target.value)} className={campo} style={campoStyle} /></Rotulo>}
        </div>
        <Rotulo texto="De onde vem o custo"><input value={premissa} maxLength={300} onChange={e => setPremissa(e.target.value)} className={`${campoCls} w-full`} style={campoStyle} placeholder="Contrato, tabela do fornecedor…" /></Rotulo>
        <Detalhes resumo="Custo por mil tokens (opcional)">
          <input aria-label="Custo por mil tokens" inputMode="decimal" value={milTokens} onChange={e => setMilTokens(e.target.value)} className={campo} style={campoStyle} />
        </Detalhes>
        {msgDe('custo')}
      </>}
      {secao === 'tabela' && <>
        <Rotulo texto={`Preço de tabela por ${String(it.unidade)}`}><input inputMode="decimal" value={tabela} onChange={e => setTabela(e.target.value)} aria-invalid={tabelaAbaixo} className={campo} style={tabelaAbaixo ? vermelho : campoStyle} /></Rotulo>
        {tabelaAbaixo && <Aviso tom="erro">{mensagemMinimoIA(minimo, it.unidade, mcMinima)}</Aviso>}
        {semCusto && <Aviso tom="atencao">Sem custo cadastrado: o preço fica bloqueado até cadastrar o custo.</Aviso>}
        {msgDe('tabela')}
      </>}
      {secao === 'empresa' && <>
        <p className="text-[12.5px] text-[var(--base-texto-2)]">Vale a partir do próximo ciclo da empresa.</p>
        <Rotulo texto="Empresa"><select value={empresa} onChange={e => setEmpresa(e.target.value)} className={`${campoCls} w-full`} style={campoStyle}>
          <option value="">Escolha a empresa…</option>
          {empresas.map(e => <option key={String(e.id)} value={String(e.id)}>{String(e.nome)}</option>)}
        </select></Rotulo>
        <Rotulo texto={`Preço por ${String(it.unidade)}`}><input inputMode="decimal" value={precoEmp} onChange={e => setPrecoEmp(e.target.value)} aria-invalid={empAbaixo} className={campo} style={empAbaixo ? vermelho : campoStyle} /></Rotulo>
        {empAbaixo && <Aviso tom="erro">{mensagemMinimoIA(minimo, it.unidade, mcMinima)}</Aviso>}
        {semCusto && <Aviso tom="atencao">Sem custo cadastrado: o preço da empresa fica bloqueado até cadastrar o custo.</Aviso>}
        {msgDe('empresa')}
      </>}
    </Gaveta>
  );
}
