import type { Route } from './+types/site';
import { seo } from '@/lib/seo';
import { SiteHeader } from '@/components/site/site-header';
import { Hero } from '@/components/site/hero';
import { Provocacoes } from '@/components/site/provocacoes';
import { Produto } from '@/components/site/produto';
import { Triplo } from '@/components/site/triplo';
import { OrquestracaoSite } from '@/components/site/orquestracao-site';
import { MensageriaSite } from '@/components/site/mensageria-site';
import { PersonasSite } from '@/components/site/personas-site';
import { CargaSite } from '@/components/site/carga-site';
import { WorkspaceSite } from '@/components/site/workspace-site';
import { Agentes } from '@/components/site/agentes';
import { Seguranca } from '@/components/site/seguranca';
import { Contato } from '@/components/site/contato';
import { SiteFooter } from '@/components/site/site-footer';

const ogImage = import.meta.env.VITE_SUPABASE_URL
	? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/site/og-motorcob.jpg`
	: undefined;

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, {
		title: 'MotorCX · Pare de adivinhar.',
		description: 'O MotorCX usa agentes de IA para decidir, para cada cliente da carteira, quem acionar, por qual canal e em qual telefone. Todo dia. E aprendem com cada ocorrência.',
		image: ogImage,
	});
}

export default function Site() {
	return (
		<div className="min-h-screen bg-white text-[#1D1D1F]">
			<SiteHeader />
			<main>
				<Hero />
				<Provocacoes />
				<Produto />
				<Triplo />
				<OrquestracaoSite />
				<MensageriaSite />
				<PersonasSite />
				<CargaSite />
				<WorkspaceSite />
				<Agentes />
				<Seguranca />
				<Contato />
			</main>
			<SiteFooter />
		</div>
	);
}
