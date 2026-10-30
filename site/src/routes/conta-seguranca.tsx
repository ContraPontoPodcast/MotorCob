import { redirect } from 'react-router';
export function clientLoader() { return redirect('/conta?aba=seguranca'); }
export default function ContaSegurancaRedirect() { return null; }
