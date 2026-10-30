import { numberBR } from '@/lib/supabase';
import { semAcaoEntradas, type ResumoExecucao } from '@/lib/execucao';

/** Linha discreta acima dos cartões: "9.812 com ação · 150 sem contato · 38 fora da carga". */
export function ResumoHoje({ resumo }: { resumo: ResumoExecucao | null }) {
	const entradas = semAcaoEntradas(resumo?.sem_acao);
	if (entradas.length === 0) return null;
	// com_acao sempre primeiro; o resto na ordem (já ordenado por tamanho)
	const comAcao = entradas.find(e => e.key === 'com_acao');
	const demais = entradas.filter(e => e.key !== 'com_acao');
	const ordem = comAcao ? [comAcao, ...demais] : demais;
	return (
		<p className="text-sm text-slate-500">
			{ordem.map((e, i) => (
				<span key={e.key}>
					{i > 0 && <span className="mx-1.5 text-slate-300">·</span>}
					<span className={e.key === 'com_acao' ? 'font-semibold text-[#0F4C5C]' : ''}>{numberBR(e.valor)} {e.short}</span>
				</span>
			))}
		</p>
	);
}
