export function readMemoryNotes(connection:import('../engine.mjs').EngineConnection):Promise<import('../engine.mjs').MemoryNotes>;
export function resetMemory(connection:import('../engine.mjs').EngineConnection):Promise<import('../engine.mjs').MemoryReset>;
export function editMemoryNote(connection:import('../engine.mjs').EngineConnection,change:{note:string,text:string}):Promise<import('../engine.mjs').MemoryEdit>;
export function forgetMemoryNote(connection:import('../engine.mjs').EngineConnection,change:{note:string}):Promise<import('../engine.mjs').MemoryForget>;
