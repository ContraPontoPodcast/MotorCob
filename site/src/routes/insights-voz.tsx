import { Navigate } from 'react-router';
// "Insights de voz" virou a Visão geral do Speech Analytics (SQL 60): o endereço antigo continua funcionando.
export default function InsightsVozRoute() { return <Navigate to="/speech-analytics" replace />; }
