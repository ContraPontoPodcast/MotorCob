import { redirect } from 'react-router';
export function clientLoader() { return redirect('/conta?aba=perfil'); }
export default function ContaPermissoesRedirect() { return null; }
