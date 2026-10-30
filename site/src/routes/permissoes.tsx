import { redirect } from 'react-router';
export function clientLoader() { return redirect('/empresa/pessoas?aba=perfis'); }
export default function PermissoesRedirect() { return null; }
