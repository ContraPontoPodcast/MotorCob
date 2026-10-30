import type { Route } from './+types/console-emails';
import { seo } from '@/lib/seo';
import { ConsoleEmailsPage } from '@/components/workspace/console/console-emails';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'E-mails do sistema · MotorCX', description: 'E-mails do sistema enviados pela plataforma.', noindex: true });
}

export default function ConsoleEmails() {
	return <ConsoleEmailsPage />;
}
