import type { ReactNode } from 'react';
import { AsciiArtAnimation } from './AsciiArtAnimation';
export function Auth({wordmark,title,description,children}:{wordmark:ReactNode,title:string,description:string,children:ReactNode}) {
 return <main className="fixed inset-0 flex bg-background">
  <div className="w-full md:w-1/2 flex flex-col overflow-y-auto"><div className="w-full max-w-md mx-auto my-auto px-8 py-12">
   <div className="mb-8">{wordmark}</div><h1 className="text-xl font-semibold">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p>{children}
  </div></div>
  <div className="hidden md:block w-1/2 overflow-hidden"><AsciiArtAnimation/></div>
 </main>;
}
