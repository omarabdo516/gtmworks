const text=m=>typeof m.content==='string'?m.content:JSON.stringify(m.content??'');
const call=(name,args)=>({call:{id:'c_'+name+'_'+Math.random().toString(36).slice(2,8),type:'function',function:{name,arguments:JSON.stringify(args)}}});
export const plan=(messages)=>{
 const users=messages.filter(m=>m.role==='user').map(text); const kick=users.join('\n');
 const called=messages.filter(m=>m.role==='assistant').flatMap(m=>(m.tool_calls||[]).map(c=>c.function.name));
 if(kick.includes('HAND-TO-BETA')&&!called.includes('kanban_create')) return call('kanban_create',{title:'Job for beta',body:'Do it. NO-QUESTION REVIEWER-PASSES',assignee:'delta'});
 if(!kick.includes('Kanban task')&&!kick.includes('sdlc-review')) return {reply:'plain: '+messages.filter(m=>m.role==='tool').map(text).join(' | ')};
 if(kick.includes('sdlc-review')) {
  if((kick.includes('REVIEWER-PASSES')||kick.includes('REVIEWER-RETURNED'))&&!called.includes('kanban_complete')) return call('kanban_complete',{summary:'Reviewed and passed by the reviewer.'});
  if(kick.includes('REVIEWER-RETURNS')&&!kick.includes('REVIEWER-RETURNED')&&!called.includes('kanban_request_changes')) return call('kanban_request_changes',{reason:'Make it shorter. REVIEWER-RETURNED'});
  return {reply:'reviewer waits'};
 }
 if(!called.includes('terminal')) return call('terminal',{command:'mkdir -p /tmp/probe-x && echo worked > /tmp/probe-x/out.txt && rm -rf /tmp/probe-x/gone && pwd && hostname'});
 if((kick.includes('ANSWER-BLUE')||kick.includes('NO-QUESTION'))&&!called.includes('kanban_request_review')) return call('kanban_request_review',{summary:kick.includes('SENT-BACK-REASON')?'Rewritten after the reason.':kick.includes('REVIEWER-RETURNED')?'Shortened.':'Brief written in blue.'});
 if(!kick.includes('ANSWER-BLUE')&&!kick.includes('NO-QUESTION')&&!called.includes('kanban_block')) return call('kanban_block',{reason:'Which colour should the brief use?'});
 return {reply:'done talking'};
};
