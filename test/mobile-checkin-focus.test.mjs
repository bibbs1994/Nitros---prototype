import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const runtime=html.match(/<script id="v1011-runtime-patch">([\s\S]*?)<\/script>/)?.[1]||'';

test('Vehicle Check-In gives iPhone-safe scroll room without adding desktop-only space',()=>{
  assert.match(html,/#customer\{scroll-padding-top:calc\(110px \+ env\(safe-area-inset-top\)\)\}/);
  assert.match(html,/input,textarea,select\{scroll-margin-top:calc\(110px \+ env\(safe-area-inset-top\)\);scroll-margin-bottom:180px\}/);
});

test('editing a form control hides only floating right-side controls and keeps the bottom toolbar available',()=>{
  assert.match(html,/\.keyboard-active \.global-dev-note-fab,[\s\S]*?\.keyboard-active \.oliver-guide-launch\{opacity:0;visibility:hidden;pointer-events:none\}/);
  assert.doesNotMatch(html,/\.keyboard-active \.quick-toolbar/);
  assert.match(runtime,/const isEditable=el=>el\?\.matches\?\.\('input,textarea,select'\)/);
  assert.match(runtime,/document\.body\.classList\.add\('keyboard-active'\)/);
  assert.match(runtime,/document\.body\.classList\.remove\('keyboard-active'\)/);
  assert.match(runtime,/window\.visualViewport\?\.addEventListener\('resize'/);
  assert.match(runtime,/window\.scrollBy\(\{top:delta,behavior:'auto'\}\)/);
});

test('License Plate uses an uppercase-capable alphanumeric text keyboard',()=>{
  assert.match(html,/<input id="plate" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Plate number">/);
  assert.match(html,/plate:document\.getElementById\("plate"\)\.value\.trim\(\)\.toUpperCase\(\)/);
});
