// JS payloads injected into the browser guest via webview.executeJavaScript().
//
// executeJavaScript resolves with the value of the last expression, so each
// builder returns a self-invoking function expression that returns a
// JSON-serializable result (or null / true). Nothing here runs in the host —
// the host only ships these strings across; the guest stays sandboxed with no
// preload bridge, so the webview hardening is untouched.
//
// The scripts are static (no host interpolation) to keep them injection-safe:
// user text never becomes code. They read/mutate the live DOM and return data
// the host reads back through executeJavaScript's resolved value.

export interface SelectionResult {
  text: string
  outerHTML: string
  selector: string
  url: string
}

export interface EditStartResult {
  selector: string
  before: string
}

export interface EditResult {
  before: string
  after: string
  selector: string
  url: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function isSelectionResult(v: unknown): v is SelectionResult {
  return (
    isRecord(v) &&
    typeof v.text === 'string' &&
    typeof v.outerHTML === 'string' &&
    typeof v.selector === 'string' &&
    typeof v.url === 'string'
  )
}

export function isEditStartResult(v: unknown): v is EditStartResult {
  return isRecord(v) && typeof v.selector === 'string' && typeof v.before === 'string'
}

export function isEditResult(v: unknown): v is EditResult {
  return (
    isRecord(v) &&
    typeof v.before === 'string' &&
    typeof v.after === 'string' &&
    typeof v.selector === 'string' &&
    typeof v.url === 'string'
  )
}

const MAX_FIELD = 4000

// Shared guest helper: a compact-ish CSS path (id shortcut, up to 6 levels,
// nth-child for stability). Space-split on className avoids a regex (and its
// backslash-escaping across this template string).
const CSS_PATH = `function ccPath(e){
  if(!e||e.nodeType!==1)return '';
  var parts=[];
  while(e&&e.nodeType===1&&parts.length<6){
    if(e.id){parts.unshift('#'+e.id);break;}
    var p=e.tagName.toLowerCase();
    if(typeof e.className==='string'){
      var c=e.className.trim().split(' ').filter(Boolean).slice(0,2).join('.');
      if(c)p+='.'+c;
    }
    var par=e.parentElement;
    if(par){p+=':nth-child('+(Array.prototype.indexOf.call(par.children,e)+1)+')';}
    parts.unshift(p);
    e=e.parentElement;
  }
  return parts.join(' > ');
}`

const HIGHLIGHT_ID = '__cc_annotate_highlight'
const CANVAS_ID = '__cc_annotate_canvas'

/** Read the current selection, draw a transient highlight, return its context. */
export function readSelectionScript(): string {
  return `(function(){
  ${CSS_PATH}
  var sel=window.getSelection();
  if(!sel||sel.rangeCount===0||sel.isCollapsed)return null;
  var range=sel.getRangeAt(0);
  var node=range.commonAncestorContainer;
  var el=node.nodeType===1?node:node.parentElement;
  var rect=range.getBoundingClientRect();
  var hl=document.getElementById('${HIGHLIGHT_ID}')||document.createElement('div');
  hl.id='${HIGHLIGHT_ID}';
  hl.style.cssText='position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #0f5f6b;background:rgba(15,95,107,0.12);border-radius:3px;';
  hl.style.left=rect.left+'px';hl.style.top=rect.top+'px';
  hl.style.width=rect.width+'px';hl.style.height=rect.height+'px';
  document.body.appendChild(hl);
  var html=el&&el.outerHTML?el.outerHTML:sel.toString();
  return {text:sel.toString().slice(0,${MAX_FIELD}),outerHTML:html.slice(0,${MAX_FIELD}),selector:ccPath(el),url:location.href};
})()`
}

/** Make the element containing the selection editable; record before-state. */
export function startEditScript(): string {
  return `(function(){
  ${CSS_PATH}
  var sel=window.getSelection();
  if(!sel||sel.rangeCount===0||sel.isCollapsed)return null;
  var node=sel.getRangeAt(0).commonAncestorContainer;
  var el=node.nodeType===1?node:node.parentElement;
  if(!el)return null;
  window.__ccEditEl=el;
  window.__ccEditBefore=el.innerText;
  window.__ccEditSelector=ccPath(el);
  el.contentEditable='true';
  el.focus();
  return {selector:window.__ccEditSelector,before:el.innerText.slice(0,${MAX_FIELD})};
})()`
}

/** Read the edited element's after-state, revert editability, return the diff. */
export function readEditScript(): string {
  return `(function(){
  var el=window.__ccEditEl;
  if(!el)return null;
  var after=el.innerText;
  var before=window.__ccEditBefore||'';
  var selector=window.__ccEditSelector||'';
  try{el.contentEditable='inherit';}catch(e){}
  window.__ccEditEl=null;window.__ccEditBefore=null;window.__ccEditSelector=null;
  return {before:before.slice(0,${MAX_FIELD}),after:after.slice(0,${MAX_FIELD}),selector:selector,url:location.href};
})()`
}

/** Overlay a full-viewport canvas that captures freehand pointer drawing. */
export function enableDrawScript(): string {
  return `(function(){
  if(document.getElementById('${CANVAS_ID}'))return true;
  var c=document.createElement('canvas');
  c.id='${CANVAS_ID}';
  c.width=window.innerWidth;c.height=window.innerHeight;
  c.style.cssText='position:fixed;left:0;top:0;z-index:2147483646;cursor:crosshair;';
  document.body.appendChild(c);
  var ctx=c.getContext('2d');
  ctx.strokeStyle='#d64545';ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';
  var drawing=false;
  c.addEventListener('pointerdown',function(e){drawing=true;ctx.beginPath();ctx.moveTo(e.clientX,e.clientY);});
  c.addEventListener('pointermove',function(e){if(!drawing)return;ctx.lineTo(e.clientX,e.clientY);ctx.stroke();});
  window.addEventListener('pointerup',function(){drawing=false;});
  return true;
})()`
}

/** Remove any highlight, drawing canvas, and revert an in-progress edit. */
export function clearAnnotationsScript(): string {
  return `(function(){
  var hl=document.getElementById('${HIGHLIGHT_ID}');if(hl)hl.remove();
  var cv=document.getElementById('${CANVAS_ID}');if(cv)cv.remove();
  if(window.__ccEditEl){try{window.__ccEditEl.contentEditable='inherit';}catch(e){}window.__ccEditEl=null;}
  return true;
})()`
}
