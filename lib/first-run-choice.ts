// First run's second step (#186), as its action and its screen share it: what the server answers before the workspace
// opens — one refusal per row, named by the row's own id so it stays with that person when rows above it are removed, and
// the invitations an earlier press already sent so pressing again sends only the rest.
export type FirstRunState={error?:string,rowErrors?:Record<number,string>,firstError?:number,sent?:string[]};
export type FirstRunFinish=(state:FirstRunState,form:FormData)=>Promise<FirstRunState>;
