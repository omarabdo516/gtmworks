// First run's second step (#186, #953), as its action and its screen share it: an Invite link made for each Person, each
// shown once to copy, and, once the answer is saved, the Conversation that opens. The question goes there after its
// leave (#130).
export type FirstRunLink={label:string,link:string};
export type FirstRunState={error?:string,links?:FirstRunLink[],opened?:string};
export type FirstRunFinish=(state:FirstRunState,form:FormData)=>Promise<FirstRunState>;
