import { randomBytes } from 'node:crypto';

export function newPublicKey(): string {
  return `aw_${randomBytes(12).toString('hex')}`;
}

export function buildTrackedUrl(
  rawUrl: string,
  p: { platform: string; campaignId: string; postId: string },
): string {
  const u = new URL(rawUrl);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) links can be tracked.');
  u.searchParams.set('utm_source', p.platform.toLowerCase());
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', p.campaignId);
  u.searchParams.set('utm_content', p.postId); // joins back to ProjectPost.id
  return u.toString();
}

// Plain string (not Function#toString) so bundlers can't rewrite it.
const SNIPPET_BODY = `function(cfg){
try{
var nav=navigator;
if(nav.doNotTrack==='1'||window.doNotTrack==='1'||nav.globalPrivacySignal===true)return;
var ls=window.localStorage,ss=window.sessionStorage;
function get(s,k){try{return s.getItem(k)}catch(e){return null}}
function set(s,k,v){try{s.setItem(k,v)}catch(e){}}
function rid(){var a=new Uint8Array(12);crypto.getRandomValues(a);return Array.prototype.map.call(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('')}
var vid=get(ls,'aw_vid');if(!vid){vid=rid();set(ls,'aw_vid',vid)}
var sid=get(ss,'aw_sid');if(!sid){sid=rid();set(ss,'aw_sid',sid)}
var q=new URLSearchParams(location.search),keys=['utm_source','utm_medium','utm_campaign','utm_content'],t={},has=false;
keys.forEach(function(k){var v=q.get(k);if(v){t[k]=v.slice(0,100);has=true}});
var now=Date.now(),stored=null;
try{stored=JSON.parse(get(ls,'aw_touch')||'null')}catch(e){}
if(has){stored={t:t,at:now};set(ls,'aw_touch',JSON.stringify(stored))}
var touch=(stored&&now-stored.at<2592000000)?stored.t:{};
function host(r){try{return r?new URL(r).hostname:''}catch(e){return ''}}
function send(name,props){
var b={k:cfg.k,n:name,v:vid,s:sid,p:location.pathname,r:host(document.referrer),u:touch};
if(props&&typeof props.value==='number'){b.val=props.value;b.cur=String(props.currency||'').slice(0,3)}
var d=JSON.stringify(b);
if(nav.sendBeacon){nav.sendBeacon(cfg.e,new Blob([d],{type:'text/plain'}))}
else{fetch(cfg.e,{method:'POST',body:d,keepalive:true,mode:'no-cors',headers:{'Content-Type':'text/plain'}}).catch(function(){})}
}
window.aw={track:send};
send('pageview');
var ps=history.pushState;
history.pushState=function(){ps.apply(this,arguments);send('pageview')};
window.addEventListener('popstate',function(){send('pageview')});
}catch(e){}
}`;

export function analyticsSnippet(publicKey: string, endpoint: string): string {
  // JSON-in-script safety: neutralize "<" so the config can never close the tag.
  const cfg = JSON.stringify({ k: publicKey, e: endpoint }).replace(/</g, '\\u003c');
  return `<script data-aw-analytics defer>(${SNIPPET_BODY})(${cfg});</script>`;
}

/** Idempotent: removes any previous snippet, then inserts before </head> (fallbacks provided). */
export function injectAnalytics(html: string, snippet: string): string {
  const cleaned = html.replace(/<script data-aw-analytics[\s\S]*?<\/script>/i, '');
  // Function replacers: the snippet contains "$" characters that String#replace would interpret.
  if (/<\/head>/i.test(cleaned)) return cleaned.replace(/<\/head>/i, () => `${snippet}</head>`);
  if (/<\/body>/i.test(cleaned)) return cleaned.replace(/<\/body>/i, () => `${snippet}</body>`);
  return snippet + cleaned;
}