'use client';
import { createContext, useContext, type ReactNode } from 'react';

export type AgentIdentity={id:string,role:string,name:string};
const AgentIdentities=createContext<AgentIdentity[]>([]);
export const useAgentIdentities=()=>useContext(AgentIdentities);
export function AgentIdentitiesProvider({agents,children}:{agents:AgentIdentity[],children:ReactNode}) {
 return <AgentIdentities value={agents}>{children}</AgentIdentities>;
}
