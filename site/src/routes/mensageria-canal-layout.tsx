import type { Route } from './+types/mensageria-canal-layout';
import { seo } from '@/lib/seo';
import { CanalShell } from '@/components/mensageria/canal-shell';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Mensageria · MotorCX', description: 'Mensageria por canal.', noindex: true });
}

export default function MensageriaCanalLayout() {
	return <CanalShell />;
}
