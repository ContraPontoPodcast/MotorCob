import type { Route } from './+types/envios-gravacoes-discador-enviar';
import { seo } from '@/lib/seo';
import { SemPermissao } from '@/components/role-gate';
import { useMotorAuth } from '@/components/auth-provider';
import { EnviarGravacoesPagina } from '@/components/voz/gravacoes-discador';
import { PERM_IMPORT } from '@/lib/importador';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Enviar gravações · MotorCX', description: 'Envio das gravações do discador em 3 passos: escolher, conferir e enviar.', noindex: true }); }
// O envio pelo site: quem tem enviar_arquivos ou a equipe (como na tela de Gravações do discador); o banco confere
// de novo em registrar_envio_gravacoes.
export default function EnviosGravacoesDiscadorEnviar() {
	const { permissoes, perfil, loading } = useMotorAuth();
	if (loading) return null;
	if (!permissoes.includes(PERM_IMPORT.enviar) && !perfil?.equipe) return <SemPermissao perm={PERM_IMPORT.enviar} tela="Enviar gravações" />;
	return <EnviarGravacoesPagina />;
}
