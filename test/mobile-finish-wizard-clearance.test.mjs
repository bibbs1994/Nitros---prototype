import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Finish Wizard clears the measured fixed toolbar and iPhone safe area',()=>{
  assert.match(html,/--nitros-bottom-toolbar-clearance:calc\(var\(--nitros-toolbar-height\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(html,/--nitros-ro-bottom-clearance:calc\(var\(--nitros-bottom-toolbar-clearance\) \+ var\(--nitros-validation-nav-height\) \+ 28px\)/);
  assert.match(html,/\.validation-nav\{bottom:calc\(var\(--nitros-bottom-toolbar-clearance\) \+ 12px\)\}/);
  assert.match(html,/\.screen\{padding-bottom:max\(24px,var\(--nitros-ro-bottom-clearance\)\);scroll-padding-bottom:var\(--nitros-ro-bottom-clearance\)\}/);
  assert.match(html,/\.validation-center\{scroll-margin-bottom:var\(--nitros-ro-bottom-clearance\)\}/);
});

test('runtime sizing tracks toolbar and Finish Wizard navigator height after text reflow',()=>{
  assert.match(html,/const toolbarBox=toolbar\.getBoundingClientRect\(\),navigatorBox=validationNavigator\?\.getBoundingClientRect\(\)/);
  assert.match(html,/setProperty\('--nitros-toolbar-height',`\$\{visible\(toolbar\)\?Math\.ceil\(toolbarBox\.height\):0\}px`\)/);
  assert.match(html,/setProperty\('--nitros-validation-nav-height',`\$\{visible\(validationNavigator\)&&navigatorBox\?Math\.ceil\(navigatorBox\.height\):0\}px`\)/);
  assert.match(html,/new ResizeObserver\(syncLayout\)\.observe\(validationNavigator\)/);
  assert.match(html,/new MutationObserver\(syncLayout\)\.observe\(validationNavigator,\{attributes:true,attributeFilter:\['class'\]\}\)/);
});

test('opening or advancing the Finish Wizard scrolls its required field clear of fixed controls',()=>{
  assert.match(html,/function scrollValidationTargetAboveFixedControls\(target\)/);
  assert.match(html,/const blockers=\[document\.getElementById\("quickToolbar"\),document\.getElementById\("validationNavigator"\)\]/);
  assert.match(html,/const clearAbove=Math\.min\(\.\.\.blockers\.map\(rect=>rect\.top\)\)-16/);
  assert.match(html,/window\.scrollBy\(\{top:targetRect\.bottom-clearAbove,behavior:"smooth"\}\)/);
  assert.match(html,/window\.NitrosMobileTools\?\.syncLayout\?\.\(\);[\s\S]*?scrollValidationTargetAboveFixedControls\(target\)/);
  assert.match(html,/id="validationNext" class="btn primary small" type="button">Next Missing Item<\/button>/);
});

test('scrollable RO surfaces and mobile dialogs keep clearance without changing toolbar identity',()=>{
  assert.match(html,/\.productivity-modal,\.quick-notes-overlay,\.quick-vehicle-overlay,\.nitros-support-ticket,\.nitros-support-inbox\{padding-bottom:max\(12px,var\(--nitros-bottom-toolbar-clearance\)\);scroll-padding-bottom:var\(--nitros-bottom-toolbar-clearance\)\}/);
  assert.match(html,/id="quickToolbar" class="quick-toolbar"/);
  assert.match(html,/\.quick-toolbar\{bottom:var\(--nitros-v1031-safe-bottom\)\}/);
});
