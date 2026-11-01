import type { Route } from './+types/envios-gravacoes-discador';
import { seo } from '@/lib/seo';
import { SemPermissao } from '@/components/role-gate';
import { useMotorAuth } from '@/components/auth-provider';
import { GravacoesDiscador } from '@/components/voz/gravacoes-discador';
import { PERM } from '@/lib/permissoes';
import { PERM_IMPORT } from '@/lib/importador';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Gravações do discador · MotorCX', description: 'Fontes, envio, registro da importação das gravações do discador da empresa e quarentena.', noindex: true }); }
// abre com enviar_arquivos (envio pelo site) ou importar_gravacoes (fontes, SQL 64)
export default function EnviosGravacoesDiscador() {
	const { permissoes, loading } = useMotorAuth();
	if (loading) return null;
	if (!permissoes.includes(PERM.enviarArquivos) && !permissoes.includes(PERM_IMPORT.configurar)) return <SemPermissao perm={PERM.enviarArquivos} tela="Gravações do discador" />;
	return <GravacoesDiscador />;
}
