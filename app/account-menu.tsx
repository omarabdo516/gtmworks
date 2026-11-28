'use client';
import { saveTheme } from './theme-actions';
import { saveLanguage } from './language-actions';
import { setAgentVisible } from './agent-visibility-actions';
import { makeInviteLink, cancelInviteLink } from './invite-link-actions';
import { teamChoices } from './team-actions';
import AccountMenuView, { ThemeToggleView, type AccountMenuProps } from './account-menu-view';
import type { SaveSwitch } from './team-table';

// The account menu's saves and its Team dialog's reads and writes come from the server actions here, so the view itself
// imports none and its component test can render it (app/account-menu-view.tsx, #218).
const teamSwitch:SaveSwitch=(company,target,agent,visible)=>setAgentVisible(company,target,agent,visible);

export default function AccountMenu({slug,company,canManage,...props}:AccountMenuProps) {
 const team=canManage&&company&&slug?{load:teamChoices,save:teamSwitch,makeLink:(label:string,role:string,agents:string[])=>makeInviteLink(company,label,role,agents),cancelLink:(link:string)=>cancelInviteLink(company,link)}:undefined;
 return <AccountMenuView {...props} slug={slug} company={company} canManage={canManage} team={team} saveLanguage={saveLanguage} saveTheme={saveTheme}/>;
}

export function ThemeToggle({theme}:{theme:string}) {
 return <ThemeToggleView theme={theme} saveTheme={saveTheme}/>;
}
