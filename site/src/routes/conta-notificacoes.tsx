import { redirect } from 'react-router';
export function clientLoader() { return redirect('/conta?aba=notificacoes'); }
export default function ContaNotificacoesRedirect() { return null; }
