// Cobrança › Resultados › Speech Analytics (substitui "Insights de voz"). Sete subtelas: Visão geral, Qualidade e
// compliance, Operadores, Alertas, Busca, Retroalimentação (estratégia e relatório ao credor) e Curadoria.
// Banco: SQL 60 (supabase/migrations/20261227000001_voz_speech_analytics.sql). O Roleplay fica fora daqui (SQL 59).
// LGPD: nunca CPF nem nome de devedor; trecho só mascarado; grupo com menos de 30 não aparece.
import { useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { ABAS_SA, periodo, type AbaSA } from '@/lib/speech';
import { SubAbas } from '@/components/voz/ui';
import type { Filtros } from './comum';
import { Visao } from './visao';
import { Qualidade } from './qualidade';
import { Operadores } from './operadores';
import { Alertas } from './alertas';
import { Busca } from './busca';
import { Retro } from './retro';
import { Curadoria } from './curadoria';

const SUBTITULO: Record<AbaSA, string> = {
	visao: 'O que as ligações dizem, da IA e do discador de vocês, e o que fazer com isso',
	qualidade: 'Checklist de qualidade da IA e do humano, com os itens de lei travados',
	operadores: 'Operadores do discador de vocês · só a parte da ligação depois da transferência',
	alertas: 'Procon, advogado ou processo, ameaça, linguagem abusiva e vulnerabilidade',
	busca: 'Busca nas transcrições mascaradas · só dentro do prazo de retenção',
	retroalimentacao: 'O que as ligações ensinam vira mudança na estratégia de vocês e na política do credor',
	curadoria: 'Onde a operação revisa e melhora o que a IA faz',
};

export function SpeechAnalytics({ aba }: { aba: AbaSA }) {
	const { empresa, credor } = useMotorAuth();
	const [dias, setDias] = useState(30);
	const [origem, setOrigem] = useState('');
	const [persona, setPersona] = useState('');
	const p = periodo(dias);
	const f: Filtros | null = empresa ? { empresaId: Number(empresa.id), credorId: credor ? Number(credor.id) : null, credorNome: credor?.nome ?? null, dias, de: p.de, ate: p.ate, origem } : null;
	return (
		<>
			<PageHeading title="Speech Analytics" description={SUBTITULO[aba]} actions={aba === 'visao' ? <Link to="/speech-analytics/retroalimentacao" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}><RefreshCw size={14} />Ver recomendações</Link> : undefined} />
			<SubAbas itens={ABAS_SA.map(a => ({ id: a.id, nome: a.nome, to: a.id === 'visao' ? '/speech-analytics' : `/speech-analytics/${a.id}` }))} atual={aba} />
			{!f ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>
				: aba === 'visao' ? <Visao f={f} setDias={setDias} setOrigem={setOrigem} persona={persona} setPersona={setPersona} />
				: aba === 'qualidade' ? <Qualidade f={f} setDias={setDias} />
				: aba === 'operadores' ? <Operadores f={f} setDias={setDias} />
				: aba === 'alertas' ? <Alertas f={f} setDias={setDias} />
				: aba === 'busca' ? <Busca f={f} />
				: aba === 'retroalimentacao' ? <Retro f={f} />
				: <Curadoria f={f} />}
		</>
	);
}
