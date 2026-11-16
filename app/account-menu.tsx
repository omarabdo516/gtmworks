'use client';
import { saveTheme } from './theme-actions';
import { saveLanguage } from './language-actions';
import AccountMenuView, { ThemeToggleView, type AccountMenuProps } from './account-menu-view';

export default function AccountMenu(props:AccountMenuProps) {
 return <AccountMenuView {...props} saveLanguage={saveLanguage} saveTheme={saveTheme}/>;
}

export function ThemeToggle({theme}:{theme:string}) {
 return <ThemeToggleView theme={theme} saveTheme={saveTheme}/>;
}
