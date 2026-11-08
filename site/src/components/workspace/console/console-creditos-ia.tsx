// Console › Margem › IA › Créditos (SQL 78; SPEC do Especialista §11.6). Só o Master: por empresa, créditos usados,
// franquia, excedente faturado, receita do excedente, custo real dos créditos do cliente, custo da IA do sistema
// (standby, pré-análise), custo da franquia (vai na mensalidade), MC do excedente (contra a MC mínima da IA) e %MC do
// conjunto; na gaveta, a franquia e o teto opcional da empresa
// (salvar_limites_creditos_ia). O cliente nunca vê nada disto: ele vê só quantidade em Empresa › Uso de IA.
import { useEffect, useState } from 'react';
import { Aviso, Botao, Cartao, Estado, Gaveta, ListaValores, Pilula, Rotulo, Tabela, campoCls, campoStyle } from '@/components/ds';
import { ErrorDetail } from '@/components/error-detail';
import { supabase, friendlyError, moneyBR, numberBR, type Row } from '@/lib/supabase';
import { precoCredito } from '@/lib/creditos-ia';

function pct1(v: unknown) { return v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
/** Inteiro digitado ("1.000" = mil); vazio = nulo. */
export function inteiroDigitado(v: string): number | null {
	const s = String(v ?? '').replace(/\./g, '').trim();
	if (!s) return null;
	return /^\d+$/.test(s) ? Number(s) : NaN;
}

export function CreditosIaMaster({ competencia, mcMinima, recarregar }: { competencia: string; mcMinima: unknown; recarregar: number }) {
	const [linhas, setLinhas] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [aberta, setAberta] = useState<Row | 'nova' | null>(null);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		setErro('');   // recarregar depois de salvar não desmonta a gaveta: o esqueleto é só da 1ª carga
		void supabase.rpc('margem_creditos_ia', { competencia }).then(({ data, error }) => {
			if (!ativo) return;
			if (error) { setErro(friendlyError(error)); setLoading(false); return; }
			setLinhas((data ?? []) as Row[]);
			setLoading(false);
		});
		return () => { ativo = false; };
	}, [competencia, recarregar, tick]);

	if (erro) return <Estado tipo="erro" titulo="Não deu para carregar os créditos de IA.">{erro}<ErrorDetail /></Estado>;
	if (loading) return <Estado tipo="carregando" />;

	const mcMin = Number(mcMinima ?? 70);
	const mc = (l: Row) => <Pilula tom={l.mc_excedente_pct == null ? 'neutro' : Number(l.mc_excedente_pct) < mcMin ? 'erro' : 'ok'}>{l.mc_excedente_pct == null ? 'sem excedente' : pct1(l.mc_excedente_pct)}</Pilula>;

	return (
		<>
			<Cartao semPadding titulo="Créditos de IA no mês" linha="Franquia incluída (custo na mensalidade), excedente faturado e a margem do excedente por empresa. O cliente vê só a quantidade."
				direita={<Botao tipo="secundario" pequeno onClick={() => setAberta('nova')}>Franquia ou teto de uma empresa</Botao>}>
				<Tabela rotulo="Créditos de IA por empresa" linhas={linhas} chave={l => String(l.empresa_id)} onAbrir={setAberta}
					selecionada={aberta && aberta !== 'nova' ? String(aberta.empresa_id) : null}
					vazio="Nenhuma empresa usou créditos de IA neste mês."
					colunas={[
						{ id: 'emp', titulo: 'Empresa', celula: l => <span><b className="font-medium">{String(l.empresa)}</b>{l.teto != null && <small className="block text-[11.5px] text-[var(--base-texto-3)]">teto {numberBR(l.teto)}</small>}</span> },
						{ id: 'uso', titulo: 'Usados', num: true, celula: l => <span className="tnum">{numberBR(l.usados)} de {numberBR(l.franquia)}</span> },
						{ id: 'exc', titulo: 'Excedente', num: true, celula: l => <span className="tnum">{numberBR(l.excedente)}</span> },
						{ id: 'rec', titulo: 'Receita', num: true, celula: l => moneyBR(l.receita ?? 0) },
						{ id: 'franquia', titulo: 'Custo da franquia', num: true, celula: l => moneyBR(l.custo_franquia ?? 0) },
						{ id: 'mc', titulo: 'MC do excedente', num: true, celula: mc },
					]}
					celular={l => ({ titulo: String(l.empresa), valor: mc(l), resumo: `${numberBR(l.usados)} de ${numberBR(l.franquia)} · excedente ${numberBR(l.excedente)} · franquia ${moneyBR(l.custo_franquia ?? 0)}` })} />
			</Cartao>
			{aberta && <LimitesCreditos linha={aberta === 'nova' ? null : aberta} onClose={() => setAberta(null)} onSalvo={() => setTick(t => t + 1)} />}
		</>
	);
}

function LimitesCreditos({ linha, onClose, onSalvo }: { linha: Row | null; onClose: () => void; onSalvo: () => void }) {
	const [empresas, setEmpresas] = useState<Row[]>([]);
	const [empresa, setEmpresa] = useState(linha ? String(linha.empresa_id) : '');
	const [franquia, setFranquia] = useState(linha && linha.franquia_propria ? String(linha.franquia ?? '') : '');
	const [teto, setTeto] = useState(linha?.teto != null ? String(linha.teto) : '');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<{ erro?: string; ok?: string } | null>(null);

	useEffect(() => {
		if (!supabase || linha) return;
		void supabase.from('empresas').select('id,nome').order('nome').then(({ data }) => setEmpresas((data ?? []) as Row[]));
	}, [linha]);

	const vFranquia = inteiroDigitado(franquia);
	const vTeto = inteiroDigitado(teto);
	const invalido = Number.isNaN(vFranquia) || Number.isNaN(vTeto) || (vTeto != null && vTeto < 1);

	async function salvar() {
		if (!supabase || !empresa || invalido) return;
		setBusy(true); setMsg(null);
		const { error } = await supabase.rpc('salvar_limites_creditos_ia', { empresa: Number(empresa), franquia: vFranquia, teto: vTeto });
		setBusy(false);
		if (error) { setMsg({ erro: /Master|franquia|teto|preço|mínimo|custo/i.test(error.message ?? '') ? error.message : friendlyError(error) }); return; }
		setMsg({ ok: 'Salvo. Vale a partir do ciclo de hoje da empresa.' });
		onSalvo();
	}

	return (
		<Gaveta aberta onFechar={onClose} titulo={linha ? String(linha.empresa) : 'Franquia ou teto de uma empresa'}
			subtitulo="Franquia vazia = a padrão do item (100). Teto vazio = nunca bloqueia."
			rodape={<><Botao tipo="secundario" onClick={onClose}>Fechar</Botao><Botao onClick={() => void salvar()} disabled={busy || !empresa || invalido}>{busy ? 'Salvando...' : 'Salvar'}</Botao></>}>
			{linha ? <ListaValores itens={[
				['Créditos usados', `${numberBR(linha.usados)} de ${numberBR(linha.franquia)}`],
				['Excedente faturado', `${numberBR(linha.excedente)} × ${precoCredito(linha.preco_excedente as number)}`],
				['Receita do excedente', moneyBR(linha.receita ?? 0)],
				['Impostos', moneyBR(linha.impostos ?? 0)],
				['Custo real dos créditos do cliente', moneyBR(linha.custo_cliente ?? 0)],
				['Custo da IA do sistema (standby, pré-análise)', `${moneyBR(linha.custo_sistema ?? 0)} · ${numberBR(linha.usos_sistema ?? 0)} usos`],
				['Custo da franquia + sistema (na mensalidade)', moneyBR(linha.custo_franquia ?? 0)],
				['MC do excedente', `${moneyBR(linha.mc_excedente ?? 0)} · ${pct1(linha.mc_excedente_pct)}`],
				['MC do conjunto (com a franquia)', `${moneyBR(linha.mc ?? 0)} · ${pct1(linha.mc_pct)}`],
			]} /> : (
				<Rotulo texto="Empresa"><select value={empresa} onChange={e => setEmpresa(e.target.value)} className={`${campoCls} w-full`} style={campoStyle}>
					<option value="">Escolha a empresa…</option>
					{empresas.map(e => <option key={String(e.id)} value={String(e.id)}>{String(e.nome)}</option>)}
				</select></Rotulo>
			)}
			<div className="grid grid-cols-2 gap-2">
				<Rotulo texto="Franquia por ciclo"><input inputMode="numeric" value={franquia} onChange={e => setFranquia(e.target.value)} placeholder="100" className={`${campoCls} w-full tnum`} style={campoStyle} /></Rotulo>
				<Rotulo texto="Teto por ciclo (opcional)"><input inputMode="numeric" value={teto} onChange={e => setTeto(e.target.value)} placeholder="sem teto" className={`${campoCls} w-full tnum`} style={campoStyle} /></Rotulo>
			</div>
			<p className="text-[12.5px] text-[var(--base-texto-2)]">Acima do teto, a ação de IA mostra "Limite de IA da sua empresa atingido neste mês; fale com o suporte." e não gasta crédito. Sem teto, nada bloqueia.</p>
			{invalido && <Aviso tom="erro">Use números inteiros; o teto é de pelo menos 1 crédito.</Aviso>}
			{msg?.erro && <Aviso tom="erro">{msg.erro}</Aviso>}
			{msg?.ok && <Aviso tom="ok">{msg.ok}</Aviso>}
		</Gaveta>
	);
}
