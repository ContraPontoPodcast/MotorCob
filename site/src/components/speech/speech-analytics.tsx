// Speech Analytics (área própria do trilho; antes Cobrança › Resultados) (substitui "Insights de voz"). Redesign v2: abas
// Visão geral, Qualidade, Operadores, Roleplay, Alertas, Recomendações e Curadoria, e "Buscar nas conversas" como link
// no fim da barra. Roleplay = treino de operadores humanos (SQL 90; components/speech/roleplay, com moldura própria:
// trilha, título por tela e sub-navegação). O teste do agente de IA continua em Agente Voz/CX › Testar com personas.
// Banco: SQL 60 (supabase/migrations/20261227000001_voz_speech_analytics.sql).
// LGPD: nunca CPF nem nome de devedor; trecho só mascarado; grupo com menos de 30 não aparece.
import { useState, type ReactNode } from 'react';
import { Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { periodo, type AbaSA } from '@/lib/speech';
import { AbasSpeech } from './abas-speech';
import { Roleplay } from './roleplay';
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
	roleplay: 'Treino de operadores com clientes simulados, com nota pelo mesmo checklist das ligações',
	alertas: 'O alerta só avisa: nada é pausado nem bloqueado sozinho',
	busca: 'Busca nas transcrições mascaradas · só dentro do prazo de retenção',
	recomendacoes: 'O que as ligações ensinam vira rascunho na estratégia de vocês e relatório ao credor',
	curadoria: 'Onde a operação revisa e melhora o que a IA faz',
};

/** Cada aba registra aqui as ações do cabeçalho (uma principal, no máximo uma secundária). */
export type DefinirAcoes = (n: ReactNode) => void;

export function SpeechAnalytics({ aba }: { aba: AbaSA }) {
	if (aba === 'roleplay') return <Roleplay tela={{ tipo: 'painel' }} />;
	return <SpeechAnalyticsAbas aba={aba} />;
}

function SpeechAnalyticsAbas({ aba }: { aba: AbaSA }) {
	const { empresa, credor } = useMotorAuth();
	const [dias, setDias] = useState(30);
	const [origem, setOrigem] = useState('');
	const [persona, setPersona] = useState('');
	const [acoes, setAcoes] = useState<ReactNode>(null);
	const p = periodo(dias);
	const f: Filtros | null = empresa ? { empresaId: Number(empresa.id), credorId: credor ? Number(credor.id) : null, credorNome: credor?.nome ?? null, dias, de: p.de, ate: p.ate, origem } : null;
	return (
		<>
			<PageHeading title="Speech Analytics" description={SUBTITULO[aba]} actions={acoes} />
			<AbasSpeech atual={aba} />
			{!f ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>
				: aba === 'visao' ? <Visao key={aba} f={f} setDias={setDias} setOrigem={setOrigem} persona={persona} setPersona={setPersona} setAcoes={setAcoes} />
				: aba === 'qualidade' ? <Qualidade key={aba} f={f} setDias={setDias} setAcoes={setAcoes} />
				: aba === 'operadores' ? <Operadores key={aba} f={f} setDias={setDias} setAcoes={setAcoes} />
				: aba === 'alertas' ? <Alertas key={aba} f={f} setDias={setDias} setAcoes={setAcoes} />
				: aba === 'busca' ? <Busca key={aba} f={f} setAcoes={setAcoes} />
				: aba === 'recomendacoes' ? <Retro key={aba} f={f} setAcoes={setAcoes} />
				: <Curadoria key={aba} f={f} setAcoes={setAcoes} />}
		</>
	);
}
