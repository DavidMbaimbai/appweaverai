import { CORS_HEADERS } from '@/lib/project-reviews/public-api';

type Ctx = { params: Promise<{ projectId: string }> };

// Self-contained widget. All user content is inserted via textContent (no innerHTML).
const WIDGET = `(function(){
var s=document.currentScript;if(!s)return;
var base=new URL(s.src).origin+'/api/projects/'+encodeURIComponent(__PID__);
var mount=document.getElementById('aw-reviews')||(function(){var d=document.createElement('div');s.parentNode.insertBefore(d,s);return d})();
function el(t,css,txt){var e=document.createElement(t);if(css)e.style.cssText=css;if(txt!=null)e.textContent=txt;return e}
function stars(n){return '\\u2605'.repeat(n)+'\\u2606'.repeat(5-n)}
var wrap=el('div','font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;color:inherit');
mount.appendChild(wrap);
var list=el('div');var form=el('form','display:grid;gap:8px;margin:16px 0');
var rating=5;var hp=el('input','display:none');hp.tabIndex=-1;hp.autocomplete='off';
var starRow=el('div','font-size:24px;cursor:pointer;color:#f5a623');
function drawStars(){starRow.textContent='';for(var i=1;i<=5;i++){(function(i){var b=el('span',null,i<=rating?'\\u2605':'\\u2606');b.onclick=function(){rating=i;drawStars()};starRow.appendChild(b)})(i)}}
drawStars();
var name=el('input','padding:8px');name.placeholder='Your name';name.required=true;name.maxLength=80;
var email=el('input','padding:8px');email.type='email';email.placeholder='Email (optional, never shown)';
var body=el('textarea','padding:8px;min-height:80px');body.placeholder='Your review';body.required=true;body.maxLength=2000;
var btn=el('button','padding:10px;cursor:pointer','Submit review');btn.type='submit';
var msg=el('div','font-size:14px');
[starRow,name,email,body,hp,btn,msg].forEach(function(x){form.appendChild(x)});
form.onsubmit=function(e){e.preventDefault();btn.disabled=true;
fetch(base+'/reviews',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rating:rating,authorName:name.value,authorEmail:email.value,body:body.value,website:hp.value})})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){msg.textContent=x.ok?'Thank you for your review!':(x.j.error||'Could not submit.');if(x.ok){body.value='';load()}btn.disabled=false}).catch(function(){msg.textContent='Could not submit.';btn.disabled=false})};
wrap.appendChild(el('h3','margin:0 0 8px','Reviews'));wrap.appendChild(list);wrap.appendChild(form);
function load(){fetch(base+'/reviews').then(function(r){return r.json()}).then(function(j){list.textContent='';(j.reviews||[]).forEach(function(r){var c=el('div','border:1px solid #8884;border-radius:8px;padding:10px;margin-bottom:8px');c.appendChild(el('div','color:#f5a623',stars(r.rating)));c.appendChild(el('strong',null,r.authorName));c.appendChild(el('p','margin:4px 0',r.body));if(r.reply){var q=el('div','margin-top:6px;padding-left:10px;border-left:3px solid #8886;font-size:14px');q.appendChild(el('em',null,'Reply from the team: '+r.reply));c.appendChild(q)}list.appendChild(c)})}).catch(function(){})}
load();
if(s.getAttribute('data-support')!=='off'){
var hist=[];var open=el('button','position:fixed;right:20px;bottom:20px;padding:12px 16px;border-radius:24px;border:0;background:#111;color:#fff;cursor:pointer;z-index:99999','Help');
var box=el('div','position:fixed;right:20px;bottom:76px;width:320px;max-width:90vw;height:420px;background:#fff;color:#111;border:1px solid #ccc;border-radius:12px;display:none;flex-direction:column;z-index:99999;font-family:system-ui,sans-serif');
var log=el('div','flex:1;overflow:auto;padding:10px;font-size:14px');var row=el('form','display:flex;gap:6px;padding:8px');
var inp=el('input','flex:1;padding:8px');inp.placeholder='Ask a question';inp.maxLength=600;var go=el('button',null,'Send');go.type='submit';
row.appendChild(inp);row.appendChild(go);box.appendChild(log);box.appendChild(row);document.body.appendChild(box);document.body.appendChild(open);
var pending=null;
function add(who,t){log.appendChild(el('p','margin:6px 0;'+(who==='user'?'text-align:right':''),t));log.scrollTop=log.scrollHeight}
add('bot','Hi! Ask me anything about this business.');
open.onclick=function(){box.style.display=box.style.display==='flex'?'none':'flex'};
function ask(payload){return fetch(base+'/support',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json()})}
row.onsubmit=function(e){e.preventDefault();var q=inp.value.trim();if(!q)return;inp.value='';add('user',q);
if(pending&&/^(y|yes|ok|sure|please)/i.test(q)){ask({question:pending,history:hist.slice(-10),createTicket:true}).then(function(j){add('bot',j.answer||'Done.');pending=null});return}
ask({question:q,history:hist.slice(-10)}).then(function(j){add('bot',j.answer||'Sorry, something went wrong.');hist.push({role:'user',text:q},{role:'assistant',text:j.answer||''});pending=j.offerTicket?q:null}).catch(function(){add('bot','Sorry, something went wrong.')})}
}
})();`;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(_request: Request, { params }: Ctx) {
  const { projectId } = await params;
  return new Response(WIDGET.replace('__PID__', JSON.stringify(projectId)), {
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
