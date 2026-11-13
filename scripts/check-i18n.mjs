import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function catalogueProblems(en, ar) {
 const problems=[];
 for(const key of new Set([...Object.keys(en),...Object.keys(ar)])) {
  for(const [language,messages] of [['en',en],['ar',ar]]) if(typeof messages[key]!=='string'||!messages[key].trim()) problems.push(`${language}: missing or empty message ${key}`);
  if(typeof en[key]==='string'&&typeof ar[key]==='string') {
   const parameters=value=>[...value.matchAll(/\{\d+\}/g)].map(match=>match[0]).sort().join(',');
   if(parameters(en[key])!==parameters(ar[key])) problems.push(`${key}: interpolation parameters differ`);
  }
 }
 return problems;
}

// Product wordmark and the design thumbnail glyph are the only text exceptions.
const textAllowlist={'app/shell.tsx':['gtm','works'],'app/sign-in/page.tsx':['gtm','works'],'app/first-run/page.tsx':['gtm','works'],'app/forgot-password/page.tsx':['gtm','works'],'app/reset-password/page.tsx':['gtm','works'],'app/no-company/page.tsx':['gtm','works'],'app/c/[slug]/[[...section]]/approvals.tsx':['Aa']};
const visibleAttributes=new Set(['aria-label','aria-description','aria-valuetext','title','placeholder','alt']);
export function literalProblems(file, source) {
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const problems=[];
 const hasWords=value=>/[\p{L}\p{N}]/u.test(value);
 const report=(node,value)=>{
  if(!hasWords(value)||textAllowlist[file]?.includes(value.trim())) return;
  const {line}=tree.getLineAndCharacterOfPosition(node.getStart(tree));
  problems.push(`${file}:${line+1}: UI literal must come from the catalogue: ${value.trim()}`);
 };
 function rendered(node) {
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)) report(node,node.text);
  else if(ts.isTemplateExpression(node)) {report(node,[node.head.text,...node.templateSpans.map(span=>span.literal.text)].join(''));}
  else if(ts.isConditionalExpression(node)) {rendered(node.whenTrue);rendered(node.whenFalse);}
  else if(ts.isBinaryExpression(node)) {if(node.operatorToken.kind!==ts.SyntaxKind.AmpersandAmpersandToken) rendered(node.left);rendered(node.right);}
  else if(ts.isParenthesizedExpression(node)) rendered(node.expression);
  else if(ts.isArrayLiteralExpression(node)) node.elements.forEach(rendered);
 }
 function visit(node) {
  if(ts.isJsxText(node)) report(node,node.text);
  if(ts.isJsxExpression(node)&&node.expression&&!ts.isJsxAttribute(node.parent)) rendered(node.expression);
  if(ts.isJsxAttribute(node)&&visibleAttributes.has(node.name.getText(tree))&&node.initializer) {
   if(ts.isStringLiteral(node.initializer)) report(node.initializer,node.initializer.text);
   else if(ts.isJsxExpression(node.initializer)&&node.initializer.expression) rendered(node.initializer.expression);
  }
  // Arabic labels hidden in arrays, maps, errors or helpers also belong in the catalogue.
  if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))&&/[\u0621-\u064a]/.test(node.text)) report(node,node.text);
  ts.forEachChild(node,visit);
 }
 visit(tree);
 return [...new Set(problems)];
}
function files(directory) {return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(`${directory}/${entry.name}`):[`${directory}/${entry.name}`]);}
export function checkI18n() {
 const en=JSON.parse(readFileSync('lib/messages/en.json','utf8')),ar=JSON.parse(readFileSync('lib/messages/ar.json','utf8'));
 const problems=catalogueProblems(en,ar);
 // Strings used only by server components live in their own pair so the browser bundle does not carry them.
 for(const name of ['skills','lessons']) problems.push(...catalogueProblems(JSON.parse(readFileSync(`lib/messages/${name}.en.json`,'utf8')),JSON.parse(readFileSync(`lib/messages/${name}.ar.json`,'utf8'))).map(problem=>`${name}: ${problem}`));
 for(const file of [...files('app'),...files('lib'),...files('components')].filter(file=>/\.(tsx?|mjs)$/.test(file)&&!file.endsWith('.d.mts'))) problems.push(...literalProblems(file,readFileSync(file,'utf8')));
 return problems;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const problems=checkI18n();
 for(const problem of problems) console.error(problem);
 console.log(`i18n check: ${problems.length} problem(s)`);
 process.exitCode=problems.length?1:0;
}
