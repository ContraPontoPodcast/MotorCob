// Relatório ao credor pelo link (sem login). O token vai para relatorio_credor_publico, que confere o hash, a validade
// (30 dias) e registra a leitura. O credor marca "vamos testar", "não" ou "depois" em cada recomendação.
import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RESPOSTA_CREDOR, dataBR } from '@/lib/speech';
import { Botao, Pilula } from '@/components/voz/ui';
import { RelatorioView, type ConteudoRel } from './relatorio-view';

type Publico = { competencia: string; conteudo: ConteudoRel; comentario: string | null; expira_em: string; credor: string; assessoria: string; respostas: Record<string, string> };

export function RelatorioPublico({ token }: { token: string }) {
	const [d, setD] = useState<Publico | null>(null);
	const [erro, setErro] = useState('');
	const [ocupado, setOcupado] = useState('');

	useEffect(() => {
		if (!supabase) { setErro('Configuração ausente.'); return; }
		if (!/^[0-9a-f]{64}$/.test(token)) { setErro('Este link é inválido ou já venceu.'); return; }
		void supabase.rpc('relatorio_credor_publico', { token }).then(({ data, error }) => {
			if (error || !data) setErro('Este link é inválido ou já venceu. Peça um link novo à assessoria.');
			else setD(data as Publico);
		});
	}, [token]);

	async function responder(rec: string, valor: string | null) {
		if (!supabase || !d) return;
		setOcupado(rec);
		const { error } = await supabase.rpc('responder_relatorio_credor', { token, recomendacao: rec, resposta: valor });
		setOcupado('');
		if (error) { setErro('Não foi possível registrar a resposta. O link pode ter vencido.'); return; }
		setD({ ...d, respostas: valor ? { ...d.respostas, [rec]: valor } : Object.fromEntries(Object.entries(d.respostas).filter(([k]) => k !== rec)) });
	}

	return (
		<main className="min-h-screen bg-[var(--base-fundo,var(--base-fill))] px-4 py-6 sm:py-10">
			<div className="mx-auto max-w-[880px] space-y-4">
				{erro ? <div className="rounded-2xl bg-[var(--base-cartao)] px-6 py-10 text-center text-[14px] text-[var(--base-texto)]" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>{erro}</div>
					: !d ? <p className="text-center text-[13px] text-[var(--base-texto-2)]">Carregando o relatório…</p> : (
						<>
							<div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
								<p className="text-[12px] text-[var(--base-texto-3)]">Só leitura · link válido até {dataBR(d.expira_em)} · cada acesso fica registrado</p>
								<Botao secundario onClick={() => window.print()}><Printer size={14} />Imprimir ou salvar PDF</Botao>
							</div>
							<RelatorioView competencia={d.competencia} credor={d.credor} assessoria={d.assessoria} conteudo={d.conteudo} comentario={d.comentario} respostas={d.respostas}
								acaoResposta={(rec, atual) => atual ? (
									<><Pilula tom={atual === 'testar' ? 'ok' : 'neutro'}>{RESPOSTA_CREDOR[atual]}</Pilula><button type="button" className="text-[12.5px] font-semibold underline print:hidden" disabled={ocupado === rec} onClick={() => void responder(rec, null)}>Mudar</button></>
								) : (
									<span className="flex flex-wrap items-center gap-2 print:hidden"><span className="text-[var(--base-texto-2)]">O que vocês acham?</span>{Object.entries(RESPOSTA_CREDOR).map(([v, n], i) => <Botao key={v} secundario={i > 0} disabled={ocupado === rec} onClick={() => void responder(rec, v)}>{n}</Botao>)}</span>
								)} />
						</>
					)}
			</div>
		</main>
	);
}
