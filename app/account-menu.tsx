'use client';
import { saveTheme } from './theme-actions';
import { saveLanguage } from './language-actions';
import { setAgentVisible, setInvitationAgentVisible } from './agent-visibility-actions';
import { inviteMember } from './invite-actions';
import { makeInviteLink } from './invite-link-actions';
import { teamChoices } from './team-actions';
import AccountMenuView, { ThemeToggleView, type AccountMenuProps } from './account-menu-view';
import type { SaveSwitch } from './team-table';

// The account menu's saves and its Team dialog's reads and writes come from the server actions here, so the view itself
// imports none and its component test can render it (app/account-menu-view.tsx, #218).
const teamSwitch:SaveSwitch=(company,target,agent,visible)=>'member' in target?setAgentVisible(company,target.member,agent,visible):setInvitationAgentVisible(company,target.invitation,agent,visible);

export default function AccountMenu({slug,company,canManage,...props}:AccountMenuProps) {
 const team=canManage&&company&&slug?{load:teamChoices,save:teamSwitch,saveInvitation:teamSwitch,invite:(email:string,role:string)=>inviteMember(company,slug,email,role),makeLink:(label:string,role:string,agents:string[])=>makeInviteLink(company,label,role,agents)}:undefined;
 return <AccountMenuView {...props} slug={slug} company={company} canManage={canManage} team={team} saveLanguage={saveLanguage} saveTheme={saveTheme}/>;
}

export function ThemeToggle({theme}:{theme:string}) {
 return <ThemeToggleView theme={theme} saveTheme={saveTheme}/>;
}
