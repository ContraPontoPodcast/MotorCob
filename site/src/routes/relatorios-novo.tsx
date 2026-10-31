import { redirect } from 'react-router';
import type { Route } from './+types/relatorios-novo';

// O montador abre dentro de Relatórios (mesmo do botão "Montar relatório"); o produto do link é mantido.
export function clientLoader({ request }: Route.ClientLoaderArgs) {
	const de = new URL(request.url).searchParams;
	const para = new URLSearchParams({ montar: '1' });
	const produto = de.get('produto');
	if (produto) para.set('produto', produto);
	return redirect(`/relatorios?${para.toString()}`);
}
export default function RelatoriosNovoRedirect() { return null; }
