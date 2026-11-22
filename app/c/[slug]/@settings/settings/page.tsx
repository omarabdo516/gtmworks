import SettingsLayer, { type SettingsQuery } from '@/app/settings-layer';

// Settings reached at their own address (a link, a reload, a sign-in that returns here), over the Company's frame
// (app/c/[slug]/default.tsx).
export default async function SettingsAtAddress({params,searchParams}:{params:Promise<{slug:string}>,searchParams:Promise<SettingsQuery>}) {
 return <SettingsLayer slug={(await params).slug} query={await searchParams}/>;
}
