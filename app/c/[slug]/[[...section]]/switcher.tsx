'use client';
import { SidebarCompanyMenu } from '@/components/paperclip/SidebarCompanyMenu';
import { useShellPlace } from '@/app/shell-place';

// The Company switcher opens the same page in another Company: a chat opens its Home, which every Company has (#789:
// the page shown comes from app/shell-place).
export default function Switcher({companies,slug}:{companies:{slug:string,name:string}[],slug:string}) {
 const place=useShellPlace();
 return <SidebarCompanyMenu companies={companies} slug={slug} section={place.chat?'home':place.section}/>;
}
