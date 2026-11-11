// Read-only application investigation: render current source locally, never authenticate,
// submit forms, contact Supabase, or modify application/test-runner source.
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from '@playwright/test';
const require=createRequire(import.meta.url);
function loadSource(path,resolve){
 const source=fs.readFileSync(path,'utf8');
 const js=ts.transpileModule(source,{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};vm.runInNewContext(js,{exports,require:resolve},{filename:path});return exports;
}
const validation=loadSource('src/lib/foundation/validation.ts',require);
let actionCalls=0;
const forms=loadSource('src/components/foundation/forms.tsx',name=>{
 if(name==='react')return {...React,useActionState:(_action,state)=>[state,()=>{actionCalls++;},false]};
 if(name==='@/lib/foundation/validation')return validation;
 if(name==='@/app/portal/actions')return {mutate:()=>{throw Error('Actions prohibited');},sendInquiry:()=>{throw Error('Actions prohibited');}};
 if(name==='next/link')return {default:()=>null};
 return require(name);
});
const markup=renderToStaticMarkup(React.createElement(forms.InvitationForm,{businessId:'11111111-1111-4111-8111-111111111111'}));
let browser;const result={scope:'Offline render of actual InvitationForm with inert action hook; no hosted session or request',source:'src/components/foundation/forms.tsx',runner:'scripts/validate-staging-private-workflows.mjs'};
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',headless:true});const context=await browser.newContext();let attemptedNetwork=0;
 await context.route('**/*',route=>{attemptedNetwork++;return route.abort();});
 const page=await context.newPage();await page.setContent(markup);
 result.labelText=await page.locator('label').filter({has:page.locator('select[name="role"]')}).innerText();
 result.exactLabelMatches=await page.getByLabel('Team role',{exact:true}).count();
 result.nonExactLabelMatches=await page.getByLabel('Team role').count();
 try{await page.getByLabel('Team role',{exact:true}).selectOption('viewer',{timeout:700});result.originalSelector='unexpected success';}catch(e){result.originalSelector=e.name==='TimeoutError'?'TimeoutError':'other failure';}
 // Demonstrate the proposed locator only; do not change the approved runner or submit.
 await page.getByLabel('Team role').selectOption('viewer');
 result.proposedLocatorSelectedViewer=await page.locator('select[name="role"]').inputValue()==='viewer';
 result.actionCalls=actionCalls;result.attemptedNetwork=attemptedNetwork;result.formsSubmitted=0;
 // Exercise the locator expression from the actual runner, so a future regression
 // in that runner fails against real component markup instead of a copied selector.
 const runnerSource=fs.readFileSync('scripts/validate-staging-private-workflows.mjs','utf8');
 const ast=ts.createSourceFile('runner.mjs',runnerSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const locators=[];
 function visit(node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='getByLabel'&&node.arguments[0]?.text==='Team role')locators.push(node.getText(ast));ts.forEachChild(node,visit);}
 visit(ast);
 result.runnerLocatorCount=locators.length;
 if(locators.length===1){const currentLocator=vm.runInNewContext(locators[0],{b:{page}});result.runnerLocatorMatches=await currentLocator.count();await currentLocator.selectOption('viewer',{timeout:1000});result.runnerSelectedViewer=await page.locator('select[name="role"]').inputValue()==='viewer';}
 result.confirmed=result.exactLabelMatches===0&&result.nonExactLabelMatches===1&&result.originalSelector==='TimeoutError'&&result.proposedLocatorSelectedViewer&&actionCalls===0&&attemptedNetwork===0;
 if(!result.confirmed)process.exitCode=1;
}finally{if(browser)await browser.close();fs.mkdirSync('review',{recursive:true});fs.writeFileSync('review/phase1-invitation-selector-investigation.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
