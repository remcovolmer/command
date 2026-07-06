// JS payloads injected into the browser guest via webview.executeJavaScript().
//
// executeJavaScript resolves with the value of the last expression, so each
// builder returns a self-invoking function expression that returns a
// JSON-serializable result. The guest cannot call the host (no preload bridge —
// the webview stays hardened), so the one guest->host signal we need (the edit
// "Save" click) is delivered over the webview's console-message event: the
// injected button console.log's a sentinel-prefixed JSON payload, and the host
// listens for it (see parseEditSaveMessage).
//
// The scripts are static (no host interpolation of user data) so page text can
// never become code.

export interface SelectionResult {
  text: string
  outerHTML: string
  selector: string
  url: string
}

export interface EditResult {
  before: string
  after: string
  // Post-edit innerHTML — spliced into the element's source range (DOM-match).
  html: string
  selector: string
  // Element-child index chain from <html> to the target (structural locator).
  indexPath: number[]
  tag: string
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

export function isEditResult(v: unknown): v is EditResult {
  return (
    isRecord(v) &&
    typeof v.before === 'string' &&
    typeof v.after === 'string' &&
    typeof v.html === 'string' &&
    typeof v.selector === 'string' &&
    typeof v.tag === 'string' &&
    typeof v.url === 'string' &&
    Array.isArray(v.indexPath) &&
    v.indexPath.every((n) => typeof n === 'number')
  )
}

/** Prefix the injected Save button console.log's so the host can spot it. */
export const EDIT_SAVE_SENTINEL = '__CC_ANNOTATE_SAVE__'

/** Parse a guest console message into an edit payload, or null if it isn't one. */
export function parseEditSaveMessage(message: unknown): EditResult | null {
  if (typeof message !== 'string' || !message.startsWith(EDIT_SAVE_SENTINEL)) return null
  try {
    const parsed: unknown = JSON.parse(message.slice(EDIT_SAVE_SENTINEL.length))
    return isEditResult(parsed) ? parsed : null
  } catch {
    return null
  }
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
const MENU_ID = '__cc_annotate_menu'
const SAVE_ID = '__cc_annotate_save'

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

/**
 * Install the right-click edit flow into the guest (idempotent). On a
 * right-click over a selection it suppresses the native menu and shows an
 * "Edit" chip; choosing it makes the element contentEditable, blocks page-level
 * key handlers (so arrows move the caret, not the page), and shows an "Opslaan"
 * overlay near the element. Saving console.log's the sentinel payload for the
 * host. Re-run after each navigation (the guest DOM resets).
 */
export function installEditContextMenuScript(): string {
  return `(function(){
  if(window.__ccEditInstalled)return true;
  window.__ccEditInstalled=true;
  ${CSS_PATH}
  function ccIndexPath(el){
    var path=[];var node=el;
    while(node&&node.parentElement){
      path.unshift(Array.prototype.indexOf.call(node.parentElement.children,node));
      node=node.parentElement;
    }
    return path;
  }
  function rm(id){var e=document.getElementById(id);if(e)e.remove();}
  function teardown(){
    rm('${MENU_ID}');rm('${SAVE_ID}');
    if(window.__ccEditEl){try{window.__ccEditEl.contentEditable='inherit';}catch(e){}window.__ccEditEl=null;}
    if(window.__ccKeyBlocker){window.removeEventListener('keydown',window.__ccKeyBlocker,true);window.removeEventListener('keyup',window.__ccKeyBlocker,true);window.__ccKeyBlocker=null;}
  }
  window.__ccTeardownEdit=teardown;
  function startEdit(el){
    teardown();
    window.__ccEditEl=el;
    window.__ccEditBefore=el.innerText;
    window.__ccEditSelector=ccPath(el);
    window.__ccEditIndexPath=ccIndexPath(el);
    window.__ccEditTag=el.tagName?el.tagName.toLowerCase():'';
    el.contentEditable='true';
    el.focus();
    // Capture-phase blocker: stops page key handlers (e.g. arrow navigation)
    // from firing, but does not preventDefault, so caret movement/typing works.
    window.__ccKeyBlocker=function(ev){ev.stopPropagation();};
    window.addEventListener('keydown',window.__ccKeyBlocker,true);
    window.addEventListener('keyup',window.__ccKeyBlocker,true);
    var r=el.getBoundingClientRect();
    var save=document.createElement('button');
    save.id='${SAVE_ID}';save.textContent='Opslaan';
    save.style.cssText='position:fixed;z-index:2147483647;left:'+r.left+'px;top:'+Math.max(2,r.top-30)+'px;background:#1f6b3a;color:#fff;font:600 12px sans-serif;padding:5px 12px;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);';
    save.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      var el2=window.__ccEditEl;
      var payload={before:(window.__ccEditBefore||'').slice(0,${MAX_FIELD}),after:(el2?el2.innerText:'').slice(0,${MAX_FIELD}),html:el2?el2.innerHTML:'',selector:window.__ccEditSelector||'',indexPath:window.__ccEditIndexPath||[],tag:window.__ccEditTag||'',url:location.href};
      console.log('${EDIT_SAVE_SENTINEL}'+JSON.stringify(payload));
    });
    document.body.appendChild(save);
  }
  function showMenu(el,rect){
    rm('${MENU_ID}');
    var menu=document.createElement('div');
    menu.id='${MENU_ID}';menu.textContent='Edit';
    menu.style.cssText='position:fixed;z-index:2147483647;left:'+rect.left+'px;top:'+(rect.bottom+4)+'px;background:#0f5f6b;color:#fff;font:600 12px sans-serif;padding:4px 12px;border-radius:6px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2);';
    function outside(ev){if(ev.target!==menu){rm('${MENU_ID}');document.removeEventListener('pointerdown',outside,true);}}
    menu.addEventListener('click',function(ev){ev.stopPropagation();document.removeEventListener('pointerdown',outside,true);rm('${MENU_ID}');startEdit(el);});
    document.body.appendChild(menu);
    setTimeout(function(){document.addEventListener('pointerdown',outside,true);},0);
  }
  document.addEventListener('contextmenu',function(e){
    var sel=window.getSelection();
    if(!sel||sel.rangeCount===0||sel.isCollapsed)return;
    var range=sel.getRangeAt(0);
    var node=range.commonAncestorContainer;
    var el=node.nodeType===1?node:node.parentElement;
    if(!el)return;
    e.preventDefault();
    showMenu(el,range.getBoundingClientRect());
  });
  return true;
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

/** Remove any highlight, drawing canvas, and tear down an in-progress edit. */
export function clearAnnotationsScript(): string {
  return `(function(){
  var hl=document.getElementById('${HIGHLIGHT_ID}');if(hl)hl.remove();
  var cv=document.getElementById('${CANVAS_ID}');if(cv)cv.remove();
  if(window.__ccTeardownEdit){window.__ccTeardownEdit();}
  return true;
})()`
}
