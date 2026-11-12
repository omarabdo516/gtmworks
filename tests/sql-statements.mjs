// Top-level statements of a SQL file with comments removed. Strings, quoted names and dollar-quoted bodies are kept
// whole, so a semicolon or keyword inside a function body is never read as a statement. Its statement counts were
// checked against the Postgres parser (libpg-query) on every migration file; tests/migration-statements.test.mjs keeps
// the cases it must get right.
export function topLevelStatements(sql) {
 const statements=[]; let current='', i=0;
 while(i<sql.length) {
  const rest=sql.slice(i,i+2);
  if(rest==='--') { const end=sql.indexOf('\n',i); i=end<0?sql.length:end; current+=' '; continue; }
  if(rest==='/*') { const end=sql.indexOf('*/',i+2); i=end<0?sql.length:end+2; current+=' '; continue; }
  if(sql[i]==="'"||sql[i]==='"') {
   const quote=sql[i]; let end=i+1;
   while(end<sql.length) { if(sql[end]===quote) { if(sql[end+1]===quote) { end+=2; continue; } break; } end++; }
   current+=sql.slice(i,end+1); i=end+1; continue;
  }
  const dollar=sql[i]==='$'&&sql.slice(i).match(/^\$([A-Za-z_]\w*)?\$/);
  if(dollar) { const end=sql.indexOf(dollar[0],i+dollar[0].length); const stop=end<0?sql.length:end+dollar[0].length; current+=sql.slice(i,stop); i=stop; continue; }
  if(sql[i]===';') { statements.push(current.trim()); current=''; i++; continue; }
  current+=sql[i]; i++;
 }
 statements.push(current.trim());
 return statements.filter(Boolean);
}
