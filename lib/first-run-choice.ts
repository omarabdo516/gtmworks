// First run's second step (#186), as its action and its screen share it: what the server answers before the workspace
// opens — one refusal per row, and the invitations an earlier press already sent so pressing again sends only the rest.
export type FirstRunState={error?:string,rowErrors?:Record<number,string>,firstError?:number,sent?:string[]};
export type FirstRunFinish=(state:FirstRunState,form:FormData)=>Promise<FirstRunState>;
