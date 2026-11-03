/* Título, descrição, Open Graph e schema das páginas do site público v5 (textos do protótipo aprovado). */
import { seo, type SeoArgs } from '@/lib/seo';
import { ORIGEM_SITE } from '@/lib/dominios';

/* O site público mora em motorcx.com.br (o sistema fica em motorcob.online): canonical, og:url e schema apontam para lá. */
const SITE_ORIGIN = ORIGEM_SITE;

const ogImage = import.meta.env.VITE_SUPABASE_URL
	? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/site/og-motorcob.jpg`
	: undefined;

const ORGANIZACAO = {
	'@context': 'https://schema.org',
	'@type': 'Organization',
	name: 'MotorCX',
	url: `${SITE_ORIGIN}/`,
	logo: `${SITE_ORIGIN}/favicon.svg`,
	description: 'Um motor, muitas engrenagens e a MotorCX Intelligence, que faz tudo girar. Para assessorias e credores.',
};

export const PAGINAS = {
	home: { title: 'MotorCX', description: 'Para cada cliente da carteira, a MotorCX Intelligence decide se aciona, em qual contato e por qual canal. E mostra o motivo.' },
	comoDecide: { title: 'Como decide · MotorCX', description: 'Como o MotorCX cruza quem atende e quem paga: contato, canal, momento, chance de pagar e mensagem, e a Matriz que junta tudo.' },
	cobranca: { title: 'Cobrança · MotorCob · MotorCX', description: 'MotorCob: a Lista do dia com quem acionar, em qual contato e por qual canal, o motivo de quem ficou de fora e o comitê do mês.' },
	voz: { title: 'Voz · MotorCX', description: 'Agente de voz com a MotorCX Intelligence: liga pela sua telefonia, segue o fluxo aprovado, é testado com personas simuladas e trabalha com o Discador.' },
	speech: { title: 'Speech Analytics · MotorCX', description: 'Speech Analytics do MotorCX: nota pelo seu checklist, motivos de não pagamento, alertas para revisão humana e recomendações com evidência que viram rascunho.' },
	seguranca: { title: 'Segurança · MotorCX', description: 'Segurança e LGPD no MotorCX: o que a IA vê e o que não vê, isolamento por empresa, acesso registrado e propensão sem idade, sexo ou região.' },
	demonstracao: { title: 'Agendar demonstração · MotorCX', description: 'Agende uma demonstração do MotorCX. Conte como é a sua carteira; a demonstração roda numa empresa fictícia, no formato da sua operação.' },
} as const;

export function metaPublica(args: SeoArgs, pagina: keyof typeof PAGINAS) {
	const p = PAGINAS[pagina];
	const pagJson = { '@context': 'https://schema.org', '@type': 'WebPage', name: p.title, description: p.description, inLanguage: 'pt-BR', isPartOf: { '@type': 'WebSite', name: 'MotorCX', url: `${SITE_ORIGIN}/` } };
	const jsonLd = pagina === 'home'
		? [ORGANIZACAO, { '@context': 'https://schema.org', '@type': 'WebSite', name: 'MotorCX', url: `${SITE_ORIGIN}/`, inLanguage: 'pt-BR' }]
		: [pagJson];
	return seo(args, { ...p, path: `${SITE_ORIGIN}${args.location.pathname}`, image: ogImage, jsonLd });
}
