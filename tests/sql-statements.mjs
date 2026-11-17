// A SQL file read in order as code, comments, and quoted text (strings, quoted names and dollar-quoted bodies) kept
// whole, so a semicolon or keyword inside a function body is never read as code. Its statement counts were checked
// against the Postgres parser (libpg-query) on every migration file; tests/migration-statements.test.mjs keeps the cases
// it must get right.
// A character that continues a name, as Postgres's lexer reads one (scan.l, ident_cont: [A-Za-z\200-\377_0-9\$]):
// every character past ASCII counts, combining marks and either half of a surrogate pair included.
const continuesName=character=>/[A-Za-z0-9_$\u0080-\uffff]/.test(character??'');
function pieces(sql) {
 const found=[]; let code='', i=0;
 const keep=(kind,text,open=false)=>{ if(code) { found.push({kind:'code',text:code}); code=''; } found.push({kind,text,open}); };
 while(i<sql.length) {
  const rest=sql.slice(i,i+2);
  if(rest==='--') { const end=sql.indexOf('\n',i); const stop=end<0?sql.length:end; keep('comment',sql.slice(i,stop)); i=stop; continue; }
  if(rest==='/*') {
   // Block comments nest in Postgres: the comment ends where its depth returns to zero.
   let depth=0, end=i;
   while(end<sql.length) {
    const pair=sql.slice(end,end+2);
    if(pair==='/*') { depth++; end+=2; } else if(pair==='*/') { depth--; end+=2; if(!depth) break; } else end++;
   }
   keep('comment',sql.slice(i,end),depth>0); i=end; continue;
  }
  if(sql[i]==="'"||sql[i]==='"') {
   // In an escape string (E'...', the E not ending a longer name) a backslash escapes the next character, quote included.
   const quote=sql[i], escapes=quote==="'"&&/[Ee]/.test(sql[i-1]??'')&&!continuesName(sql[i-2]); let end=i+1;
   while(end<sql.length) { if(escapes&&sql[end]==='\\') { end+=2; continue; } if(sql[end]===quote) { if(sql[end+1]===quote) { end+=2; continue; } break; } end++; }
   keep('quoted',sql.slice(i,end+1),end>=sql.length); i=end+1; continue;
  }
  // A dollar quote opens only where a name ends: after a character that continues one, the sign belongs to it (result$tag$).
  const dollar=sql[i]==='$'&&!continuesName(sql[i-1])&&sql.slice(i).match(/^\$([A-Za-z_]\w*)?\$/);
  if(dollar) { const end=sql.indexOf(dollar[0],i+dollar[0].length); const stop=end<0?sql.length:end+dollar[0].length; keep('quoted',sql.slice(i,stop),end<0); i=stop; continue; }
  code+=sql[i]; i++;
 }
 if(code) found.push({kind:'code',text:code});
 return found;
}

// Top-level statements of a SQL file with comments removed.
export function topLevelStatements(sql) {
 const statements=[]; let current='';
 for(const {kind,text} of pieces(sql)) {
  if(kind==='comment') { current+=' '; continue; }
  if(kind==='quoted') { current+=text; continue; }
  const parts=text.split(';');
  current+=parts[0];
  for(const part of parts.slice(1)) { statements.push(current.trim()); current=part; }
 }
 statements.push(current.trim());
 return statements.filter(Boolean);
}

// The code of a SQL file outside comments and quoted text: where psql would read a backslash as a command of its own.
export const codeOutsideQuotes=sql=>pieces(sql).filter(piece=>piece.kind==='code').map(piece=>piece.text).join(' ');

// Whether a SQL file ends inside a string, a quoted name, a dollar quote or a block comment.
export const leavesOpen=sql=>pieces(sql).some(piece=>piece.open);
