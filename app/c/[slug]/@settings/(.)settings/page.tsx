import SettingsLayer, { type SettingsQuery } from '@/app/settings-layer';

// Settings opened from a page of the Company (the account menu, an Agent's gear, a link): drawn over that page, which
// stays underneath as it was (#612).
export default async function SettingsOverPage({params,searchParams}:{params:Promise<{slug:string}>,searchParams:Promise<SettingsQuery>}) {
 return <SettingsLayer slug={(await params).slug} query={await searchParams}/>;
}
