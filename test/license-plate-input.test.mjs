import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.match(/function normalizeLicensePlateInput\([^\n]+/)[0];
const insertSource=html.match(/function insertLicensePlateDigit\([^\n]+/)[0];
const {normalizeLicensePlateInput,insertLicensePlateDigit}=Function(`${source};${insertSource};return {normalizeLicensePlateInput,insertLicensePlateDigit};`)();

function input(value,start=value.length,end=start){return {value,selectionStart:start,selectionEnd:end,setSelectionRange(nextStart,nextEnd){this.selectionStart=nextStart;this.selectionEnd=nextEnd;},setRangeText(text,from,to){this.value=`${this.value.slice(0,from)}${text}${this.value.slice(to)}`;this.selectionStart=this.selectionEnd=from+text.length;},dispatchEvent(){},focus(){}}}

test('mixed letters and numbers normalize to uppercase without moving the cursor',()=>{
  const plate=input('ab12c',2);const priorDocument=globalThis.document;globalThis.document={activeElement:plate};
  assert.equal(normalizeLicensePlateInput(plate),'AB12C');
  assert.equal(plate.value,'AB12C');
  assert.deepEqual([plate.selectionStart,plate.selectionEnd],[2,2]);
  globalThis.document=priorDocument;
});

test('spaces, hyphens, pasted values, and dictated values are retained while letters normalize',()=>{
  const priorDocument=globalThis.document;
  for(const value of ['ma ab-123','ab 12-cd','voice plate ab-12']){const plate=input(value);globalThis.document={activeElement:plate};normalizeLicensePlateInput(plate);assert.equal(plate.value,value.toUpperCase());}
  globalThis.document=priorDocument;
});

test('save and blur normalization trims only the outer whitespace',()=>{
  const priorDocument=globalThis.document,plate=input('  ma ab-123  ');globalThis.document={activeElement:plate};
  assert.equal(normalizeLicensePlateInput(plate,{trim:true}),'MA AB-123');
  assert.equal(plate.value,'MA AB-123');
  globalThis.document=priorDocument;
});

test('custom number-row buttons insert 0–9 at the current cursor position without opening the numeric keyboard',()=>{
  const priorDocument=globalThis.document,plate=input('MA-23',3);globalThis.document={activeElement:plate};
  insertLicensePlateDigit(plate,'1');
  assert.equal(plate.value,'MA-123');
  assert.deepEqual([plate.selectionStart,plate.selectionEnd],[4,4]);
  globalThis.document=priorDocument;
});

test('mobile plate input uses the standard text keyboard and disables text assistance',()=>{
  assert.match(html,/id="plate" data-license-plate type="text" inputmode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" aria-controls="plateNumberRow"/);
  assert.doesNotMatch(html,/id="plate"[^>]*(?:inputmode="(?:numeric|tel|decimal|email)"|type="(?:number|tel|email)")/);
});

test('existing saved plate values remain restored as stored and the shared helper covers every editable plate input',()=>{
  assert.match(html,/setValue\("plate",record\.plate\)/);
  assert.match(html,/function configureLicensePlateInputs\(root=document\)\{root\.querySelectorAll\("\[data-license-plate\]"\)/);
  assert.match(html,/input\.addEventListener\("input",\(\)=>normalizeLicensePlateInput\(input\)\)/);
  assert.match(html,/input\.addEventListener\("blur",\(\)=>\{normalizeLicensePlateInput\(input,\{trim:true\}\);hide\(\);\}\)/);
  assert.match(html,/plate:normalizeLicensePlateForSave\(\)/);
});

test('phone-only number row is in-flow, focus-bound, and contains every digit',()=>{
  assert.match(html,/id="plateNumberRow" class="plate-number-row"[^>]*hidden/);
  for(let digit=0;digit<=9;digit++)assert.match(html,new RegExp(`data-plate-digit="${digit}"`));
  assert.match(html,/\.plate-number-row\{display:grid/);
  assert.match(html,/@media\(min-width:601px\)\{\.plate-number-row\{display:none!important\}\}/);
  assert.match(html,/input\.addEventListener\("focus",show\)/);
  assert.match(html,/window\.visualViewport\?\.addEventListener\("resize",\(\)=>\{if\(document\.activeElement!==input\|\|!keyboardOpen\(\)\)hide\(\);else show\(\);\}\)/);
});
