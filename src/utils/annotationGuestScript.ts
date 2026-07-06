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

/** Console-message signals from the floating markup toolbar's buttons. */
export const MARKUP_ADD_SENTINEL = '__CC_MARKUP_ADD__'
export const MARKUP_CANCEL_SENTINEL = '__CC_MARKUP_CANCEL__'

/** Classify a guest console message as a markup toolbar action, or null. */
export function parseMarkupMessage(message: unknown): 'add' | 'cancel' | null {
  if (typeof message !== 'string') return null
  if (message.startsWith(MARKUP_ADD_SENTINEL)) return 'add'
  if (message.startsWith(MARKUP_CANCEL_SENTINEL)) return 'cancel'
  return null
}

export interface CommentPayload {
  selector: string
  snippet: string
  comment: string
  url: string
}

/** Signal from an in-guest comment box (right-click Comment, or inspect click). */
export const COMMENT_SENTINEL = '__CC_COMMENT__'

function isCommentPayload(v: unknown): v is CommentPayload {
  return (
    isRecord(v) &&
    typeof v.selector === 'string' &&
    typeof v.snippet === 'string' &&
    typeof v.comment === 'string' &&
    typeof v.url === 'string'
  )
}

/** Parse a guest console message into a comment payload, or null. */
export function parseCommentMessage(message: unknown): CommentPayload | null {
  if (typeof message !== 'string' || !message.startsWith(COMMENT_SENTINEL)) return null
  try {
    const parsed: unknown = JSON.parse(message.slice(COMMENT_SENTINEL.length))
    return isCommentPayload(parsed) ? parsed : null
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
const MARKUP_BAR_ID = '__cc_annotate_markupbar'
const COMMENT_BOX_ID = '__cc_annotate_commentbox'

// Shared guest helper: ccShowComment(rect, snippet, selector) shows an input +
// send button near rect and, on send, console.log's the comment payload. Used
// by both the right-click "Comment" menu item and the inspect-mode click.
const COMMENT_UI = `function ccShowComment(rect,snippet,selector){
  var old=document.getElementById('${COMMENT_BOX_ID}');if(old)old.remove();
  var box=document.createElement('div');box.id='${COMMENT_BOX_ID}';
  box.style.cssText='position:fixed;z-index:2147483647;left:'+Math.max(4,Math.min(rect.left,window.innerWidth-280))+'px;top:'+(rect.bottom+6)+'px;display:flex;gap:6px;background:#fff;border:1px solid #d7dbe0;border-radius:8px;padding:6px;box-shadow:0 4px 14px rgba(0,0,0,.15);';
  var inp=document.createElement('input');inp.type='text';inp.placeholder='Opmerking…';
  inp.style.cssText='font:400 13px sans-serif;color:#1a1c1e;border:1px solid #d7dbe0;border-radius:6px;padding:4px 8px;min-width:200px;outline:none;';
  var send=document.createElement('button');send.textContent='Stuur';
  send.style.cssText='font:600 13px sans-serif;background:#0f5f6b;color:#fff;border:none;border-radius:6px;padding:0 12px;cursor:pointer;';
  box.appendChild(inp);box.appendChild(send);document.body.appendChild(box);
  var done=false;
  function fin(){if(done)return;done=true;var t=inp.value.trim();if(box.parentNode)box.remove();if(t)console.log('${COMMENT_SENTINEL}'+JSON.stringify({selector:selector||'',snippet:(snippet||'').slice(0,${MAX_FIELD}),comment:t,url:location.href}));}
  box.addEventListener('pointerdown',function(ev){ev.stopPropagation();});
  send.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();fin();});
  inp.addEventListener('keydown',function(ev){ev.stopPropagation();if(ev.key==='Enter'){ev.preventDefault();fin();}else if(ev.key==='Escape'){done=true;if(box.parentNode)box.remove();}});
  setTimeout(function(){inp.focus();},0);
}`

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
  ${COMMENT_UI}
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
  function showMenu(el,rect,selText){
    rm('${MENU_ID}');
    var menu=document.createElement('div');menu.id='${MENU_ID}';
    menu.style.cssText='position:fixed;z-index:2147483647;left:'+rect.left+'px;top:'+(rect.bottom+4)+'px;background:#0f5f6b;color:#fff;font:600 12px sans-serif;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.2);';
    function close(){rm('${MENU_ID}');document.removeEventListener('pointerdown',outside,true);}
    function outside(ev){if(!menu.contains(ev.target))close();}
    function item(label,fn){var it=document.createElement('div');it.textContent=label;it.style.cssText='padding:5px 14px;cursor:pointer;';it.addEventListener('mouseenter',function(){it.style.background='rgba(255,255,255,.15)';});it.addEventListener('mouseleave',function(){it.style.background='transparent';});it.addEventListener('click',function(ev){ev.stopPropagation();close();fn();});menu.appendChild(it);}
    item('Edit',function(){startEdit(el);});
    item('Comment',function(){ccShowComment(rect,selText,ccPath(el));});
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
    showMenu(el,range.getBoundingClientRect(),sel.toString());
  });
  return true;
})()`
}

/**
 * Inspect mode for the comment tool: hovering highlights the element under the
 * cursor; clicking it opens a comment box (sending the comment + the element's
 * outerHTML to the chat). Clicks are captured so the page's own handlers don't
 * fire while picking. Toggle the mode off to exit.
 */
export function enableCommentInspectScript(): string {
  return `(function(){
  ${CSS_PATH}
  ${COMMENT_UI}
  var hl=document.getElementById('${HIGHLIGHT_ID}')||document.createElement('div');
  hl.id='${HIGHLIGHT_ID}';
  hl.style.cssText='position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #0f5f6b;background:rgba(15,95,107,0.10);border-radius:3px;display:none;';
  document.body.appendChild(hl);
  function commenting(){return !!document.getElementById('${COMMENT_BOX_ID}');}
  function isChrome(el){return !el||el.id==='${HIGHLIGHT_ID}'||el.id==='${COMMENT_BOX_ID}'||!!(el.closest&&el.closest('#${COMMENT_BOX_ID}'));}
  function onMove(e){
    if(commenting()){hl.style.display='none';return;}
    var el=document.elementFromPoint(e.clientX,e.clientY);
    if(isChrome(el)){hl.style.display='none';window.__ccInspectEl=null;return;}
    var r=el.getBoundingClientRect();
    hl.style.display='block';hl.style.left=r.left+'px';hl.style.top=r.top+'px';hl.style.width=r.width+'px';hl.style.height=r.height+'px';
    window.__ccInspectEl=el;
  }
  function onClick(e){
    if(commenting())return;
    var at=document.elementFromPoint(e.clientX,e.clientY);
    if(isChrome(at))return;
    var el=window.__ccInspectEl||at;
    if(!el)return;
    e.preventDefault();e.stopPropagation();
    hl.style.display='none';
    ccShowComment(el.getBoundingClientRect(),el.outerHTML,ccPath(el));
  }
  window.addEventListener('mousemove',onMove,true);
  window.addEventListener('click',onClick,true);
  window.__ccInspectTeardown=function(){
    window.removeEventListener('mousemove',onMove,true);
    window.removeEventListener('click',onClick,true);
    var h=document.getElementById('${HIGHLIGHT_ID}');if(h)h.remove();
    var b=document.getElementById('${COMMENT_BOX_ID}');if(b)b.remove();
    window.__ccInspectEl=null;
  };
  return true;
})()`
}

/**
 * Overlay a markup canvas plus a floating toolbar (pen / line / rect / circle /
 * text, four colours, clear, Cancel, Add to chat) — all injected into the guest
 * so it floats correctly over the webview. Cancel and Add to chat signal the
 * host over console-message; Add to chat hides the toolbar (two rAFs so the
 * hidden frame paints) before signalling, so it's excluded from the capture.
 */
export function enableMarkupScript(): string {
  return `(function(){
  if(document.getElementById('${MARKUP_BAR_ID}'))return true;
  var c=document.createElement('canvas');
  c.id='${CANVAS_ID}';
  c.width=window.innerWidth;c.height=window.innerHeight;
  c.style.cssText='position:fixed;left:0;top:0;z-index:2147483646;cursor:crosshair;';
  document.body.appendChild(c);
  var ctx=c.getContext('2d');
  var tool='pen',color='#e5484d',ops=[],start=null,pts=null;
  function draw(op){
    ctx.strokeStyle=op.color;ctx.fillStyle=op.color;ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';
    if(op.t==='pen'){ctx.beginPath();for(var i=0;i<op.pts.length;i++){var p=op.pts[i];if(i===0)ctx.moveTo(p[0],p[1]);else ctx.lineTo(p[0],p[1]);}ctx.stroke();}
    else if(op.t==='line'){ctx.beginPath();ctx.moveTo(op.x0,op.y0);ctx.lineTo(op.x1,op.y1);ctx.stroke();}
    else if(op.t==='rect'){ctx.strokeRect(Math.min(op.x0,op.x1),Math.min(op.y0,op.y1),Math.abs(op.x1-op.x0),Math.abs(op.y1-op.y0));}
    else if(op.t==='circle'){ctx.beginPath();ctx.ellipse((op.x0+op.x1)/2,(op.y0+op.y1)/2,Math.abs(op.x1-op.x0)/2,Math.abs(op.y1-op.y0)/2,0,0,2*Math.PI);ctx.stroke();}
    else if(op.t==='text'){ctx.font='600 18px sans-serif';ctx.fillText(op.text,op.x,op.y);}
  }
  function redraw(){ctx.clearRect(0,0,c.width,c.height);for(var i=0;i<ops.length;i++)draw(ops[i]);}
  function commit(op){ops.push(op);redraw();enableAdd();}
  c.addEventListener('pointerdown',function(e){
    if(tool==='text'){e.preventDefault();addText(e.clientX,e.clientY);return;}
    start=[e.clientX,e.clientY];
    if(tool==='pen')pts=[[e.clientX,e.clientY]];
  });
  c.addEventListener('pointermove',function(e){
    if(!start)return;
    if(tool==='pen'){pts.push([e.clientX,e.clientY]);redraw();draw({t:'pen',color:color,pts:pts});}
    else{redraw();draw({t:tool,color:color,x0:start[0],y0:start[1],x1:e.clientX,y1:e.clientY});}
  });
  window.addEventListener('pointerup',function(e){
    if(!start)return;
    if(tool==='pen'){if(pts&&pts.length>1)commit({t:'pen',color:color,pts:pts});pts=null;}
    else commit({t:tool,color:color,x0:start[0],y0:start[1],x1:e.clientX,y1:e.clientY});
    start=null;
  });
  function addText(x,y){
    var inp=document.createElement('input');inp.type='text';
    inp.style.cssText='position:fixed;z-index:2147483647;left:'+x+'px;top:'+(y-14)+'px;font:600 18px sans-serif;color:'+color+';background:rgba(255,255,255,.95);border:1px dashed '+color+';padding:0 2px;outline:none;min-width:40px;';
    document.body.appendChild(inp);
    var done=false;
    function fin(){if(done)return;done=true;var t=inp.value;if(inp.parentNode)inp.remove();if(t)commit({t:'text',color:color,x:x,y:y+6,text:t});}
    // Prevent the placing click / drags from stealing focus or hitting the canvas.
    inp.addEventListener('pointerdown',function(ev){ev.stopPropagation();});
    inp.addEventListener('keydown',function(ev){ev.stopPropagation();if(ev.key==='Enter'){ev.preventDefault();fin();}else if(ev.key==='Escape'){done=true;if(inp.parentNode)inp.remove();}});
    inp.addEventListener('blur',fin);
    // Focus after the current pointer event settles, else it blurs immediately.
    setTimeout(function(){inp.focus();},0);
  }
  var bar=document.createElement('div');
  bar.id='${MARKUP_BAR_ID}';
  bar.style.cssText='position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #d7dbe0;border-radius:10px;padding:6px 8px;box-shadow:0 4px 14px rgba(0,0,0,.15);font:600 13px sans-serif;';
  function mkBtn(title){var b=document.createElement('button');b.title=title;b.style.cssText='min-width:28px;height:28px;border:1px solid transparent;border-radius:6px;background:transparent;color:#444;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;font:600 13px sans-serif;';return b;}
  var ICON={
    pen:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    line:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="19" x2="19" y2="5"/></svg>',
    rect:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>',
    circle:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>',
    trash:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"/></svg>'
  };
  var toolBtns={};
  [['pen',ICON.pen],['line',ICON.line],['rect',ICON.rect],['circle',ICON.circle],['text','<span style="font:700 15px sans-serif">T</span>']].forEach(function(t){
    var b=mkBtn(t[0]);b.innerHTML=t[1];toolBtns[t[0]]=b;
    b.addEventListener('click',function(ev){ev.stopPropagation();tool=t[0];refreshTools();});
    bar.appendChild(b);
  });
  function refreshTools(){for(var k in toolBtns){var on=k===tool;toolBtns[k].style.background=on?'#e6f2f3':'transparent';toolBtns[k].style.borderColor=on?'#0f5f6b':'transparent';}}
  var sep=document.createElement('span');sep.style.cssText='width:1px;height:18px;background:#d7dbe0;margin:0 2px;';bar.appendChild(sep);
  ['#e5484d','#3b82f6','#16a34a','#111111'].forEach(function(col){
    var s=document.createElement('button');s.title=col;s.__col=col;
    s.style.cssText='width:18px;height:18px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #d7dbe0;background:'+col+';cursor:pointer;';
    s.addEventListener('click',function(ev){ev.stopPropagation();color=col;refreshColors();});
    bar.appendChild(s);
  });
  function refreshColors(){Array.prototype.forEach.call(bar.querySelectorAll('button'),function(b){if(b.__col)b.style.boxShadow=(b.__col===color)?'0 0 0 2px #0f5f6b':'0 0 0 1px #d7dbe0';});}
  var del=mkBtn('Wis');del.innerHTML=ICON.trash;del.addEventListener('click',function(ev){ev.stopPropagation();ops=[];redraw();disableAdd();});bar.appendChild(del);
  var cancel=mkBtn('Cancel');cancel.textContent='Cancel';cancel.style.minWidth='auto';cancel.style.padding='0 8px';cancel.addEventListener('click',function(ev){ev.stopPropagation();console.log('${MARKUP_CANCEL_SENTINEL}');});bar.appendChild(cancel);
  var add=mkBtn('Add to chat');add.textContent='Voeg toe aan chat';add.style.minWidth='auto';add.style.padding='0 10px';add.style.background='#0f5f6b';add.style.color='#fff';
  add.addEventListener('click',function(ev){ev.stopPropagation();if(add.disabled)return;bar.style.visibility='hidden';requestAnimationFrame(function(){requestAnimationFrame(function(){console.log('${MARKUP_ADD_SENTINEL}');});});});
  bar.appendChild(add);
  function enableAdd(){add.disabled=false;add.style.opacity='1';add.style.cursor='pointer';}
  function disableAdd(){add.disabled=true;add.style.opacity='.5';add.style.cursor='default';}
  disableAdd();
  document.body.appendChild(bar);
  refreshTools();refreshColors();
  window.__ccMarkupTeardown=function(){var b=document.getElementById('${MARKUP_BAR_ID}');if(b)b.remove();var cv=document.getElementById('${CANVAS_ID}');if(cv)cv.remove();};
  window.__ccMarkupReset=function(){ops=[];redraw();disableAdd();bar.style.visibility='visible';};
  return true;
})()`
}

/** After an Add-to-chat capture, re-show the toolbar and clear the markup. */
export function resetMarkupScript(): string {
  return `(function(){if(window.__ccMarkupReset)window.__ccMarkupReset();return true;})()`
}

/** Remove any highlight, drawing canvas, and tear down an in-progress edit. */
export function clearAnnotationsScript(): string {
  return `(function(){
  var hl=document.getElementById('${HIGHLIGHT_ID}');if(hl)hl.remove();
  var cv=document.getElementById('${CANVAS_ID}');if(cv)cv.remove();
  var cb=document.getElementById('${COMMENT_BOX_ID}');if(cb)cb.remove();
  if(window.__ccTeardownEdit){window.__ccTeardownEdit();}
  if(window.__ccMarkupTeardown){window.__ccMarkupTeardown();}
  if(window.__ccInspectTeardown){window.__ccInspectTeardown();}
  return true;
})()`
}
