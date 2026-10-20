import { CORS_HEADERS } from '@/lib/project-reviews/public-api';

type Ctx = { params: Promise<{ projectId: string }> };

// Self-contained form widget. All user content is inserted via textContent (no innerHTML).
const WIDGET = `(function(){
var s=document.currentScript;if(!s)return;
var base=new URL(s.src).origin+'/api/projects/'+encodeURIComponent(__PID__);
var mount=document.getElementById('aw-leads')||(function(){var d=document.createElement('div');s.parentNode.insertBefore(d,s);return d})();
function el(t,css,txt){var e=document.createElement(t);if(css)e.style.cssText=css;if(txt!=null)e.textContent=txt;return e}
var q=new URLSearchParams(location.search);var utm={};
['source','medium','campaign','content'].forEach(function(k){var v=q.get('utm_'+k);if(v)utm[k]=v});
var form=el('form','display:grid;gap:8px;max-width:420px;font-family:system-ui,sans-serif;color:inherit');
var name=el('input','padding:8px');name.placeholder='Your name';name.required=true;name.maxLength=120;
var email=el('input','padding:8px');email.type='email';email.placeholder='Email';email.required=true;
var phone=el('input','padding:8px');phone.placeholder='Phone (optional)';phone.maxLength=40;
var msg=el('textarea','padding:8px;min-height:70px');msg.placeholder='How can we help? (optional)';msg.maxLength=2000;
var hp=el('input','position:absolute;left:-9999px;opacity:0');hp.tabIndex=-1;hp.autocomplete='off';hp.setAttribute('aria-hidden','true');
var label=el('label','font-size:13px;display:flex;gap:6px;align-items:flex-start');
var cb=el('input');cb.type='checkbox';label.appendChild(cb);label.appendChild(el('span',null,'I agree to be contacted by email about my enquiry.'));
var btn=el('button','padding:10px;cursor:pointer','Get in touch');btn.type='submit';
var out=el('div','font-size:14px');
[name,email,phone,msg,hp,label,btn,out].forEach(function(x){form.appendChild(x)});
form.onsubmit=function(e){e.preventDefault();btn.disabled=true;
fetch(base+'/leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name.value,email:email.value,phone:phone.value,message:msg.value,consent:cb.checked,utm:utm,website:hp.value})})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){out.textContent=x.ok?'Thanks! We will be in touch.':(x.j.error||'Could not submit.');if(x.ok)form.reset();btn.disabled=false}).catch(function(){out.textContent='Could not submit.';btn.disabled=false})};
mount.appendChild(form);
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
