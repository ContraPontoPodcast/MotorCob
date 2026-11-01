// Cobrança › Resultados › Speech Analytics (substitui "Insights de voz"). Redesign v2: seis abas (Visão geral,
// Qualidade, Operadores, Alertas, Recomendações e Curadoria) e "Buscar nas conversas" como link no fim da barra.
// O Roleplay saiu daqui e foi para Fluxo do agente › Testar com personas (ROTA_TESTAR_PERSONAS).
// Banco: SQL 60 (supabase/migrations/20261227000001_voz_speech_analytics.sql).
// LGPD: nunca CPF nem nome de devedor; trecho só mascarado; grupo com menos de 30 não aparece.
import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { ABAS_SA, BUSCA_SA, periodo, rotaSA, type AbaSA } from '@/lib/speech';
import { Abas } from '@/components/ds';
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
	alertas: 'O alerta só avisa: nada é pausado nem bloqueado sozinho',
	busca: 'Busca nas transcrições mascaradas · só dentro do prazo de retenção',
	recomendacoes: 'O que as ligações ensinam vira rascunho na estratégia de vocês e relatório ao credor',
	curadoria: 'Onde a operação revisa e melhora o que a IA faz',
};

/** Cada aba registra aqui as ações do cabeçalho (uma principal, no máximo uma secundária). */
export type DefinirAcoes = (n: ReactNode) => void;

export function SpeechAnalytics({ aba }: { aba: AbaSA }) {
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
			<Abas rotulo="Seções do Speech Analytics" atual={aba}
				itens={ABAS_SA.map(a => ({ id: a.id, nome: a.nome, to: rotaSA(a.id) }))}
				fim={{ id: BUSCA_SA.id, nome: BUSCA_SA.nome, to: rotaSA('busca'), icone: <Search size={14} aria-hidden="true" /> }} />
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
