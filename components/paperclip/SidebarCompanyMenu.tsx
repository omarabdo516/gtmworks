'use client';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useI18n } from '@/lib/i18n-client';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
export function SidebarCompanyMenu({companies,slug,section,agency=false}:{companies:{slug:string,name:string}[],slug:string,section:string,agency?:boolean}) {
 const {t,language}=useI18n(); const router=useRouter();
 return <DropdownMenu dir={language==='ar'?'rtl':'ltr'}><DropdownMenuTrigger asChild>
  <Button variant="ghost" className="switch w-full justify-start px-2" aria-label={t('chooseCompany')}><span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-xs">{companies.find(c=>c.slug===slug)?.name.slice(0,1)}</span><bdi className="min-w-0 flex-1 truncate text-start">{companies.find(c=>c.slug===slug)?.name||t('allCompanies')}</bdi><ChevronsUpDown className="ms-auto h-3.5 w-3.5 text-muted-foreground"/></Button>
 </DropdownMenuTrigger><DropdownMenuContent align="start" className="w-64">
  {[...companies,...(agency?[{slug:'',name:t('allCompanies')}]:[])].map(c=><DropdownMenuItem key={c.slug} data-company-slug={c.slug} onSelect={()=>router.push(c.slug?`/c/${c.slug}/${section}`:'/all-brands')}><bdi className="flex-1">{c.name}</bdi>{c.slug===slug&&<Check className="h-4 w-4"/>}</DropdownMenuItem>)}
 </DropdownMenuContent></DropdownMenu>;
}
