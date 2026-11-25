/* Phone orders for the SCP Chemical Tally.
   A technician calls in an order: no invoice to scan. Daniel types it, Claude (quick tier) turns it into JSON,
   this file validates it, fills estimated prices, shows an editable preview, and saves "phone order" docs
   (source 'phone') that count like any invoice until the real invoice replaces them.
   Everything it needs from the page comes through window.__tally (set by the page). */
(function(){
'use strict';
var T=window.__tally;
if(!T||window.__tallyPhone)return;

var esc=T.esc,money=T.money,r2=T.r2;
var st={open:false,turns:[],drafts:null,busy:false,ctl:null,saving:false,msg:'',inited:false,delArm:null};
function $(id){return document.getElementById(id)}
function perBox(){var p=T.cfg&&Number(T.cfg.perBox);return p>0?p:4}
function numf(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})}

/* ---------- styles ---------- */
var css=document.createElement('style');
css.textContent=
'.ph-log{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto;padding:2px}'+
'.ph-log:empty{display:none}'+
'.ph-msg{padding:7px 11px;border-radius:12px;max-width:88%;white-space:pre-wrap;overflow-wrap:anywhere}'+
'.ph-msg.you{align-self:flex-end;background:var(--accent);color:var(--accent-ink)}'+
'.ph-msg.bot{align-self:flex-start;background:var(--tint);color:var(--ink)}'+
'.ph-msg.q{border:1px solid var(--accent)}'+
'.ph-in{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}'+
'.ph-in textarea{flex:1 1 260px;min-height:64px}'+
'.ph-card{border:1px solid var(--line);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--surface);min-width:0}'+
'.ph-card h3{margin:0}'+
'.ph-fields{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}'+
'.ph-card input[type=number]{width:92px;text-align:right}'+
'.ph-card .routein{width:64px}'+
'.ph-warn{border:1px solid var(--bad);background:var(--bad-bg);border-radius:6px;padding:8px 10px;color:var(--ink)}'+
'.ph-badge{background:var(--acid-bg);color:var(--acid)}'+
'.ph-wait .nrow{align-items:flex-start}'+
'.ph-hid{display:none}';
document.head.appendChild(css);

/* ---------- product catalog (SKUs seen on real invoices) ---------- */
var DEF={
  SCP:{
    chlorine:{sku:'AAA-50-1010',um:'GAL',desc:'Bulk chlorine sod hypo',label:'gal liquid chlorine'},
    acid:{sku:'AAA-50-8602',um:'BTL',desc:'No deposit muriatic acid 4/CS gal',label:'muriatic acid (bottles)'},
    bicarb:{sku:'AAA-50-8604',um:'BAG',desc:'50# Sodium Bicarbonate',label:'bag bicarb'},
    tabs:{sku:'EZC-50-3850',um:'PL',desc:'50# 3in Xtreme tabs',label:'50# 3in Xtreme tabs'},
    salt:{sku:'USC-50-1040',um:'BAG',desc:'Aquasalt food quality salt 40#',label:'bag salt'}
  },
  Proline:{
    chlorine:{sku:'1',um:'GAL',desc:'ProClean bleach 1 gallon, pickup only (5.25%-12.5%)',label:'gal liquid chlorine',gpu:1},
    acid:{sku:'3',um:'BTL',desc:'Muriatic acid 1 gallon, pickup only (billed per gallon)',label:'muriatic acid (bottles)'},
    bicarb:{sku:'5800',um:'BAG',desc:'Sodium bicarbonate 50LB bag',label:'bag bicarb'},
    salt:{sku:'AQUASALT',um:'BAG',desc:'Aqua Salt 40LB bag',label:'bag salt'},
    tabs:null
  }
};
var NICE={chlorine:'liquid chlorine',acid:'muriatic acid',bicarb:'bicarb',tabs:'3" Xtreme tabs (50#)',salt:'salt'};
var UW={GAL:'gal',BTL:'bottles',BAG:'bags',PL:'pails',PLT:'pails',DRM:'drums',EA:'each',CS:'cases',JUG:'jugs'};

function cleanDesc(s){return String(s||'').replace(/\s*\([^)]*ordered[^)]*\)/ig,'').replace(/,\s*\d+(\.\d+)?\s*jugs?\s*x\s*[\d.]+\s*gal/ig,'').trim()}
function priceHist(vendor,sku,um){
  var k=vendor+'|'+sku+'|'+String(um||'').toUpperCase(),out=[];
  T.priceLines().forEach(function(r){if(r.k===k)out.push(r.p)});
  return out;
}
function histTemplate(vendor,cat){
  var rows=T.priceLines().filter(function(r){return r.vendor===vendor&&r.it.cat===cat&&String(r.it.um||'').toUpperCase()!=='CS'});
  if(!rows.length)return null;
  var it=rows[rows.length-1].it;
  return {tpl:{sku:it.sku||'',um:String(it.um||'').toUpperCase(),desc:cleanDesc(it.desc),label:it.label||cat,group:it.group,gpu:it.gpu},hist:priceHist(vendor,it.sku||'',it.um)};
}
var STOP={the:1,and:1,for:1,bag:1,bags:1,pail:1,pails:1,box:1,boxes:1,gal:1,gallon:1,gallons:1,lbs:1,lb:1,some:1,more:1};
function tokens(name){
  return String(name||'').toLowerCase().split(/[^a-z0-9#]+/).filter(function(t){return t&&!STOP[t]&&(t.length>=3||/\d/.test(t))}).map(function(t){return t.length>4&&/s$/.test(t)&&!/ss$/.test(t)?t.slice(0,-1):t});
}
function findOther(vendor,name){
  var toks=tokens(name);if(!toks.length)return {none:true};
  var by={};
  T.priceLines().forEach(function(r){
    if(r.vendor!==vendor||(r.it.cat&&r.it.cat!=='other'))return;
    var txt=[r.it.group,r.it.label,r.it.desc].join(' ').toLowerCase(),ok=toks.every(function(t){return txt.indexOf(t)>=0});
    if(ok)by[(r.it.sku||'')+'|'+String(r.it.um||'').toUpperCase()]=r;
  });
  var ks=Object.keys(by);
  if(!ks.length)return {none:true};
  var c=ks.map(function(k){var r=by[k];return {it:r.it,key:k,price:T.typicalPrice(priceHist(vendor,r.it.sku||'',r.it.um))}});
  if(c.length>1)return {ambig:c};
  var x=c[0];
  return {tpl:{sku:x.it.sku||'',um:String(x.it.um||'').toUpperCase(),desc:cleanDesc(x.it.desc),label:x.it.label||name,group:x.it.group||x.it.label||name},price:x.price};
}
/* template + estimated price for one product at one vendor */
function getTemplate(vendor,cat,name){
  if(cat!=='other'){
    var d=(DEF[vendor]||{})[cat],hist=d?priceHist(vendor,d.sku,d.um):[];
    if(!hist.length){var h=histTemplate(vendor,cat);if(h){d=h.tpl;hist=h.hist}}
    var fb=false;
    if(!d){d=DEF.SCP[cat];hist=[];fb=true}
    var p=T.typicalPrice(hist);
    return {tpl:d,price:p,fallback:fb};
  }
  return findOther(vendor,name);
}

/* ---------- reading what he typed ---------- */
function weekdayOf(iso){return new Date(iso+'T12:00:00').getDay()}
function addDays(iso,n){var d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
var MON={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
var WD={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
function mkIso(y,m,d){
  if(!(m>=1&&m<=12&&d>=1&&d<=31))return null;
  var iso=y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'),t=new Date(iso+'T12:00:00');
  return isNaN(t)||t.getMonth()+1!==m?null:iso;
}
/* date words and numbers to YYYY-MM-DD, or null when it cannot be read */
function parseDate(txt,today){
  var s=String(txt||'').trim().toLowerCase().replace(/[,]/g,' ').replace(/\s+/g,' ');
  if(!s)return null;
  var y=Number(today.slice(0,4)),m;
  if(/^(today|now|this morning|this afternoon|tonight)$/.test(s))return today;
  if(/^day before yesterday$/.test(s))return addDays(today,-2);
  if(/^yesterday$/.test(s))return addDays(today,-1);
  if((m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)))return mkIso(+m[1],+m[2],+m[3]);
  if((m=/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2}|\d{4}))?$/.exec(s))){
    var yy=m[3]?(m[3].length===2?2000+(+m[3]):+m[3]):y,iso=mkIso(yy,+m[1],+m[2]);
    if(iso&&!m[3]&&iso>addDays(today,60))iso=mkIso(y-1,+m[1],+m[2]);
    return iso;
  }
  var wm=/^(?:(?:last|this|on)\s+)?([a-z]+)$/.exec(s);
  if(wm&&/^(sun|mon|tue|wed|thu|fri|sat)/.test(wm[1])){
    var back=(weekdayOf(today)-WD[wm[1].slice(0,3)]+7)%7;
    return addDays(today,-back);
  }
  var mm=/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2}|\d{4}))?$/.exec(s);
  if(mm&&MON[mm[1].slice(0,3)]){
    var yv=mm[3]?(mm[3].length===2?2000+(+mm[3]):+mm[3]):y,iso2=mkIso(yv,MON[mm[1].slice(0,3)],+mm[2]);
    if(iso2&&!mm[3]&&iso2>addDays(today,60))iso2=mkIso(y-1,MON[mm[1].slice(0,3)],+mm[2]);
    return iso2;
  }
  var m3=/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{2}|\d{4}))?$/.exec(s);
  if(m3&&MON[m3[2].slice(0,3)]){
    var yv2=m3[3]?(m3[3].length===2?2000+(+m3[3]):+m3[3]):y,iso3=mkIso(yv2,MON[m3[2].slice(0,3)],+m3[1]);
    if(iso3&&!m3[3]&&iso3>addDays(today,60))iso3=mkIso(y-1,MON[m3[2].slice(0,3)],+m3[1]);
    return iso3;
  }
  return null;
}
function resolveRoute(txt){
  var s=String(txt||'').trim();if(!s)return null;
  if(/\bstock\b/i.test(s)&&!/\d/.test(s))return 'Stock';
  var m=/(\d{1,2})/.exec(s);
  if(m){var n=parseInt(m[1],10);return n>=0&&n<=12?String(n):null}
  var r=String(T.routeFrom(s));
  if(r==='Stock')return r;
  return /^\d{1,2}$/.test(r)&&+r<=12?String(+r):null;
}
function kindOf(u){
  var s=String(u||'').toLowerCase().trim();
  if(!s)return '';
  if(/jug/.test(s))return 'jug';
  if(/^(gal|gals|gallon|gallons|g)$/.test(s))return 'gal';
  if(/case|^cs$|box/.test(s))return 'case';
  if(/bottle|btl|bot/.test(s))return 'bottle';
  if(/bag/.test(s))return 'bag';
  if(/pail|bucket|unit|tub|each|ea$/.test(s))return 'unit';
  if(/drum/.test(s))return 'drum';
  return s;
}
var PRODUCTS=['chlorine','tabs','bicarb','salt','acid','other'];

/* one line the model returned -> a priced line, or a question */
function resolveLine(vendor,sp,pre,notes){
  var cat=PRODUCTS.indexOf(sp.product)>=0?sp.product:'other',name=String(sp.name||'').trim(),qty=Number(sp.qty),uk=kindOf(sp.unit),
      label=NICE[cat]||name||'that item',q=null,gal=null;
  if(cat==='other'&&!name)return {ask:pre+'What is the item that is not bleach, acid, salt, bicarb or tabs? Give me its name.'};
  if(!(qty>0))return {ask:pre+'How many '+(cat==='chlorine'?'gallons (or jugs) of bleach':cat==='other'?name:label)+'?'};
  var line={cat:cat,qty:qty,name:name,spec:{product:cat,name:name}};
  if(cat==='chlorine'){
    if(uk==='gal'){line.qty=qty}
    else if(uk==='jug'){var jg=Number(sp.jug_gal)>0?Number(sp.jug_gal):2.5;line.qty=r2(qty*jg);line.desc2=numf(qty)+' jugs x '+jg+' gal';notes.push(pre+numf(qty)+' jug'+(qty===1?'':'s')+' of bleach counted as '+numf(line.qty)+' gal ('+jg+' gal each).')}
    else return {ask:pre+'Is the '+numf(qty)+' of bleach in gallons or in jugs?'};
  }else if(cat==='acid'){
    var altk=kindOf(sp.alt_unit),altq=Number(sp.alt_qty),cs=perBox();
    if(!uk)return {ask:pre+'Is the '+numf(qty)+' of muriatic acid in bottles or in cases?'};
    var bt=uk==='case'?qty*cs:(uk==='bottle'||uk==='gal')?qty:null;
    if(bt===null)return {ask:pre+'Is the '+numf(qty)+' of muriatic acid in bottles or in cases?'};
    if(altq>0&&altk&&altk!==uk){
      var bt2=altk==='case'?altq*cs:(altk==='bottle'||altk==='gal')?altq:null;
      if(bt2!==null&&Math.abs(bt2-bt)>1e-9)return {ask:pre+'You said '+numf(qty)+' '+(uk==='case'?'case'+(qty===1?'':'s'):'bottle'+(qty===1?'':'s'))+' and '+numf(altq)+' '+(altk==='case'?'case'+(altq===1?'':'s'):'bottle'+(altq===1?'':'s'))+', but a case is '+cs+' bottles ('+numf(qty)+' '+uk+(qty===1?'':'s')+' = '+numf(bt)+' bottles, '+numf(altq)+' '+altk+(altq===1?'':'s')+' = '+numf(bt2)+'). How many bottles is it?'};
    }
    line.qty=bt;
  }
  var tp=getTemplate(vendor,cat,name);
  if(tp.ambig){
    return {ask:pre+'Which '+name+' do you mean: '+tp.ambig.map(function(c){return (c.it.label||c.it.desc)+(c.price?' ('+money(c.price)+')':'')}).join(', or ')+'?'};
  }
  if(tp.none||!tp.tpl){
    var um=uk==='bag'?'BAG':uk==='drum'?'DRM':uk==='unit'?'PL':uk==='gal'?'GAL':'EA';
    line.sku='';line.um=um;line.desc=name;line.label=name;line.group=name;line.price=0;line.noPrice=true;line.cat='other';
    notes.push(pre+'"'+name+'" is not in the tally yet, so I have no price for it. Type one in the preview.');
  }else{
    var t=tp.tpl;
    line.sku=t.sku;line.um=t.um;line.desc=t.desc+(line.desc2?', '+line.desc2:'');line.label=t.label;
    if(t.group)line.group=t.group;
    if(cat==='chlorine')line.gpu=1;
    else if(t.gpu)line.gpu=t.gpu;
    line.price=tp.price==null?0:tp.price;
    if(tp.price==null){line.noPrice=true;notes.push(pre+'No '+vendor+' price on file for '+(NICE[cat]||name)+'. Type one in the preview.')}
    if(tp.fallback&&!line.noPrice){}
    else if(tp.fallback){}
  }
  return {line:line};
}
/* the whole answer -> drafts, or the one question to ask */
function analyze(res){
  var today=T.todayISO(),orders=res&&Array.isArray(res.orders)?res.orders:[];
  if(!orders.length)return {ask:String((res&&res.question)||'').trim()||'I could not find an order in that. Tell me the route, the date and what was ordered.'};
  var drafts=[],notes=[];
  for(var i=0;i<orders.length;i++){
    var o=orders[i]||{},pre=orders.length>1?'Order '+(i+1)+': ':'';
    var rt=String(o.route_text||'').trim(),route=resolveRoute(rt);
    if(route===null)return {ask:pre+(rt?'I could not tell which route "'+rt+'" is. Which route is it, a number from 0 to 12 or the tech name?':'Which route is this order for? A number from 0 to 12, or the tech name.')};
    var vendor=/proline/i.test(String(o.vendor||''))?'Proline':'SCP';
    if(!/proline|scp/i.test(String(o.vendor||'')))notes.push(pre+'No vendor was mentioned, so I used SCP.');
    var dt=String(o.date_text||'').trim(),date;
    if(!dt){date=today;notes.push(pre+'No date was given, so I used today ('+T.mmdd(today)+'). Change it below if that is wrong.')}
    else{date=parseDate(dt,today);if(!date)return {ask:pre+'I could not read the date "'+dt+'". What date is it? For example 11/5/26.'}}
    var lines=Array.isArray(o.lines)?o.lines:[];
    if(!lines.length)return {ask:pre+'What was ordered for route '+route+'?'};
    var out=[];
    for(var j=0;j<lines.length;j++){
      var r=resolveLine(vendor,lines[j]||{},pre,notes);
      if(r.ask)return {ask:r.ask};
      out.push(r.line);
    }
    drafts.push({route:route,date:date,vendor:vendor,lines:out,dup:null,confirmDup:false,future:date>today});
  }
  return {drafts:drafts,notes:notes};
}

/* ---------- duplicates, ids, documents ---------- */
function keyOf(it){return it.cat&&it.cat!=='other'?it.cat:(it.sku?'sku:'+String(it.sku).toUpperCase():T.prodKey(it))}
function qtyOf(it){return it.cat==='acid'?T.bottlesOf(it):it.cat==='chlorine'?T.qOf(it):Number(it.qty)||0}
function sigOf(items){
  var m={};
  (items||[]).forEach(function(it){var q=qtyOf(it);if(!(q>0))return;var k=keyOf(it);m[k]=(m[k]||0)+q});
  return m;
}
function sameSig(a,b){
  var ka=Object.keys(a),kb=Object.keys(b);
  if(!ka.length||ka.length!==kb.length)return false;
  return ka.every(function(k){return b[k]!==undefined&&Math.abs(a[k]-b[k])<1e-6});
}
function draftSig(d){return sigOf(d.lines.map(function(l){return {cat:l.cat,sku:l.sku,group:l.group,label:l.label,qty:l.qty,um:l.um,gpu:l.gpu,desc:l.desc}}))}
function findDup(d){
  var s=draftSig(d),hit=null;
  T.invoices.forEach(function(v){
    if(hit||String(v.route)!==String(d.route)||v.date!==d.date||(v.vendor==='Proline')!==(d.vendor==='Proline'))return;
    if(sameSig(s,sigOf(v.items)))hit=v;
  });
  return hit;
}
function newId(d,taken){
  var base='PH-'+d.date.replace(/-/g,'')+'-R'+d.route+'-',n=1;
  var used={};T.invoices.forEach(function(v){used[v.invoice]=1});Object.keys(taken).forEach(function(k){used[k]=1});
  while(used[base+n])n++;
  return base+n;
}
function makeDoc(d,id,text){
  var items=d.lines.map(function(l){
    var it={cat:l.cat,desc:l.desc,ext:r2((Number(l.qty)||0)*(Number(l.price)||0)),label:l.label,price:r2(l.price),qty:Number(l.qty)||0,sku:l.sku||'',um:l.um,est:true};
    if(l.group)it.group=l.group;
    if(l.gpu)it.gpu=l.gpu;
    return it;
  });
  var total=r2(items.reduce(function(s,i){return s+i.ext},0));
  var doc={date:d.date,invoice:id,order:'',orderDate:d.date,route:d.route,source:'phone',est:true,total:total,note:'Phone order, no invoice yet (est.)',phoneText:String(text||'').slice(0,600),at:Date.now(),items:items};
  if(d.vendor==='Proline')doc.vendor='Proline';
  return doc;
}
function lineTotal(l){return r2((Number(l.qty)||0)*(Number(l.price)||0))}
function draftTotal(d){return r2(d.lines.reduce(function(s,l){return s+lineTotal(l)},0))}
function allUserText(){return st.turns.filter(function(t){return t.who==='you'}).map(function(t){return t.text}).join('\n')}

/* ---------- the model call ---------- */
function buildPrompt(){
  var today=T.todayISO(),wd=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][weekdayOf(today)];
  var p=[
    'You turn a phone or text order from a Dr. Pool technician into JSON for a chemical tally. Today is '+wd+' '+today+'. Reply with ONLY this JSON, nothing else:',
    '{"orders":[{"route_text":"","date_text":"","vendor":"","lines":[{"product":"chlorine","name":"","qty":0,"unit":"","alt_qty":null,"alt_unit":"","jug_gal":null}]}],"question":""}',
    'Rules:',
    '- One order is one route, one date and one vendor. The message may hold several orders (different routes or dates); lines belong to the order they follow. A route or date said once applies to the lines after it until another is said.',
    '- route_text: the route or tech exactly as said, with number words turned into digits (route ten = "route 10"). Names such as Jeff, Geffet, Maicon, Carlos, Adalberto, Aldo, Mike, Mika, Luis, Evaldo, Rodrigo, Samuel, Fabio, Jean, or the word stock, are kept as said. Empty string if no route was said.',
    '- date_text: the date exactly as said (11/5/26, 11/5, yesterday, Monday, Nov 5). Empty string if none was said. Do not calculate dates.',
    '- vendor: "Proline" only if Proline is mentioned, "SCP" only if SCP is mentioned, otherwise "".',
    '- product is one of: chlorine (bleach, liquid chlorine, sodium hypo, liquid; counted in gallons or jugs), tabs (3 inch Xtreme tabs, chlorine tabs, tabs; each unit is one 50 lb pail), bicarb (sodium bicarbonate, bicarb, alkalinity), salt (pool salt, 40 lb bags), acid (muriatic acid; sold in bottles or cases of bottles), other (anything else: calcium, stabilizer, perlite, DE, etc., with name as said).',
    '- name: a short name for product other; for the five main products leave name empty.',
    '- qty is the number of units ordered. A size such as "50 lbs" or "40#" describes the product, it is NOT the quantity: "1 xtreme tab 50 lbs" is qty 1. "65gals of bleach" is qty 65, unit "gal".',
    '- unit: the unit word as said (gal, jugs, bags, bottles, cases, pails, units), or "" if none was said.',
    '- When the message gives the same amount two ways, such as "2 cases (8 bottles)", put the first in qty/unit and the second in alt_qty/alt_unit. Do NOT do any arithmetic or fix a mismatch.',
    '- jug_gal: gallons per jug only if said (for example "1 gallon jugs" is 1), otherwise null.',
    '- Never guess. If something was not said, leave it empty or null. Never invent a quantity.',
    '- The conversation below may contain earlier messages and questions that were asked back. Combine everything: later messages answer the questions or correct earlier parts. Return the full final orders.',
    '- question: only if the messages are too unclear to make even one order, one short question. Otherwise "".',
    '',
    'Conversation:'
  ];
  st.turns.forEach(function(t){
    if(t.who==='you')p.push('Daniel: '+t.text);
    else if(t.q)p.push('Question asked back: '+t.text);
  });
  return p.join('\n');
}
function errCopy(e){
  var c=e&&e.code;
  var m={rate_limited:'Too many requests right now. Wait a minute and try again.',not_granted:'Reading is turned off for this view. Allow Claude for this page and try again.',sampling_disabled:'Claude is not available on this account.',session_expired:'Your session expired. Sign in again.',invalid_json:'I could not make sense of that. Try again, or write it a little more simply.'};
  return m[c]||'Something went wrong reading that. Try again.';
}

/* ---------- chat UI ---------- */
function build(){
  if(st.inited)return;st.inited=true;
  var pb=$('pasteBox'),row=$('readBtn')&&$('readBtn').parentNode;
  if(row&&!$('phOpen')){
    var b=document.createElement('button');b.type='button';b.className='btn';b.id='phOpen';b.textContent='Type an order';
    b.title='A tech called in an order and there is no invoice yet';
    row.insertBefore(b,$('readBtn').nextSibling);
  }
  var hb=document.querySelector('header .hbtns');
  if(hb&&!$('phHdr')){
    var h=document.createElement('button');h.type='button';h.className='btn';h.id='phHdr';h.textContent='Type an order';
    hb.insertBefore(h,$('pasteBtn'));
  }
  if(pb&&!$('phChat')){
    var box=document.createElement('div');box.className='stockbox';box.id='phChat';box.hidden=true;
    box.setAttribute('aria-label','Type an order');
    box.innerHTML='<h3>Type an order</h3>'+
      '<p class="muted">A tech called in an order, so there is no invoice to scan. Type it the way you would say it, for example: <i>route 10 11/5/26 65gals of bleach, 5 bags of salt, 2 cases (8 bottles) of muriatic acid, 1 xtreme tab 50 lbs</i>. Several orders in one message are fine. Nothing is saved until you press Add to tally.</p>'+
      '<div class="ph-log" id="phLog" role="log" aria-live="polite"></div>'+
      '<div class="ph-in"><label class="sr" for="phIn">Order text</label><textarea id="phIn" rows="2" placeholder="route 10 11/5/26 65gals of bleach, 5 bags of salt..."></textarea>'+
      '<button class="btn primary" type="button" id="phSend">Send</button><button class="btn" type="button" id="phStop" hidden>Stop</button></div>'+
      '<div class="row"><span id="phStatus" class="muted" role="status"></span><button class="linkbtn" type="button" id="phClose">Close</button></div>'+
      '<div id="phPrev" class="pv"></div>';
    var sch=$('schedBox');
    if(sch)pb.insertBefore(box,sch);else pb.appendChild(box);
  }
  if(!$('phWait')){
    var w=document.createElement('section');w.id='phWait';w.className='alerts ph-wait';w.hidden=true;w.setAttribute('aria-label','Phone orders waiting for an invoice');
    var ms=$('missing');ms.parentNode.insertBefore(w,ms);
  }
  drawWait();
}
function openChat(prefill){
  build();
  if(!T.sampleFn)return;
  if($('pasteBox').hidden&&T.openPaste)T.openPaste(true);
  var box=$('phChat');box.hidden=false;st.open=true;
  var ta=$('phIn');
  if(prefill&&String(prefill).trim()){ta.value=String(prefill).trim()}
  drawChat();
  try{box.scrollIntoView({block:'nearest'});ta.focus()}catch(x){}
}
function setStatus(t,bad){var el=$('phStatus');if(el){el.textContent=t||'';el.className=bad?'bad-t':'muted'}}
function drawChat(){
  var log=$('phLog');if(!log)return;
  log.innerHTML=st.turns.slice(-12).map(function(t){return '<div class="ph-msg '+(t.who==='you'?'you':'bot'+(t.q?' q':''))+'">'+esc(t.text)+'</div>'}).join('');
  log.scrollTop=log.scrollHeight;
  $('phSend').disabled=st.busy||st.saving;
  $('phStop').hidden=!st.busy;
  $('phIn').disabled=st.saving;
  drawPrev();
}
async function send(){
  if(st.busy||st.saving||!T.sampleFn)return;
  var ta=$('phIn'),text=ta.value.trim();if(!text)return;
  st.turns.push({who:'you',text:text});ta.value='';st.drafts=null;st.busy=true;st.ctl=new AbortController();
  setStatus('Reading...');drawChat();
  var res=null,err=null;
  try{res=await T.sampleFn.json(buildPrompt(),{modelTier:'quick',cache:false,signal:st.ctl.signal})}catch(e){err=e||{}}
  st.busy=false;st.ctl=null;
  if(err){
    st.turns.pop();ta.value=text;
    setStatus(err.code==='cancelled'?'Stopped. Your text is still in the box.':errCopy(err),err.code!=='cancelled');
    drawChat();return;
  }
  var a=analyze(res);
  if(a.ask){st.turns.push({who:'bot',text:a.ask,q:true});setStatus('Answer the question above.')}
  else{
    st.drafts=a.drafts;
    st.drafts.forEach(function(d){d.dup=findDup(d)});
    var head='Got it: '+a.drafts.length+' order'+(a.drafts.length===1?'':'s')+'. '+a.drafts.map(function(d){return 'Route '+d.route+(T.techName(d.route)&&d.route!=='Stock'?' ('+T.techName(d.route)+')':'')+', '+T.mmdd(d.date)+', '+d.vendor+', '+d.lines.length+' line'+(d.lines.length===1?'':'s')}).join(' | ');
    st.turns.push({who:'bot',text:head+'. Prices are estimates from the last prices paid, so check the preview, change anything you need, then press Add to tally.'+(a.notes.length?'\n'+a.notes.join('\n'):'')});
    setStatus('');
  }
  drawChat();
}
function reset(keepOpen){
  st.turns=[];st.drafts=null;st.busy=false;st.saving=false;
  if($('phIn'))$('phIn').value='';
  setStatus('');
  if(!keepOpen&&$('phChat')){$('phChat').hidden=true;st.open=false}
  drawChat();
}

/* ---------- the editable preview ---------- */
function validateDraft(d){
  var p=[];
  if(resolveRoute('route '+d.route)===null&&d.route!=='Stock')p.push('Route must be 0 to 12 (or Stock).');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date||'')||isNaN(new Date(d.date+'T12:00:00')))p.push('Pick a date.');
  if(!d.lines.length)p.push('Add at least one line.');
  d.lines.forEach(function(l){if(!(Number(l.qty)>0))p.push('Every line needs a quantity above 0.')});
  return Array.from(new Set(p));
}
function drawPrev(){
  var box=$('phPrev');if(!box)return;
  if(!st.drafts||!st.drafts.length){box.innerHTML='';return}
  var ok=true,h='';
  st.drafts.forEach(function(d,i){
    var probs=validateDraft(d);if(probs.length)ok=false;
    if(d.dup&&!d.confirmDup)ok=false;
    var tn=d.route!=='Stock'?T.techName(d.route):'';
    h+='<div class="ph-card"><div class="dhead"><h3>'+(st.drafts.length>1?'Order '+(i+1)+' &middot; ':'')+'Phone order <span class="pill ph-badge">Phone order, no invoice yet (est.)</span></h3></div>'+
      '<div class="ph-fields"><label class="f" for="phr'+i+'">Route <input type="text" class="routein" id="phr'+i+'" data-phf="route" data-o="'+i+'" value="'+esc(d.route)+'"></label>'+
      '<span class="muted">'+esc(tn)+'</span>'+
      '<label class="f" for="phd'+i+'">Date <input type="date" id="phd'+i+'" data-phf="date" data-o="'+i+'" value="'+esc(d.date)+'"></label>'+
      '<label class="f" for="phv'+i+'">Vendor <select id="phv'+i+'" data-phf="vendor" data-o="'+i+'"><option'+(d.vendor==='SCP'?' selected':'')+'>SCP</option><option'+(d.vendor==='Proline'?' selected':'')+'>Proline</option></select></label></div>'+
      '<div class="scroll"><table><thead><tr><th class="l">Product</th><th>Qty</th><th class="l">Unit</th><th>Est. price</th><th>Est. amount</th><th></th></tr></thead><tbody>';
    d.lines.forEach(function(l,j){
      h+='<tr><td class="l" style="white-space:normal;min-width:170px">'+esc(l.label||l.desc)+(l.noPrice?'<small class="bad-t">No price on file. Type one.</small>':'')+'<small>'+esc(l.sku?'SKU '+l.sku:'')+(l.desc2?' &middot; '+esc(l.desc2):'')+'</small></td>'+
        '<td><input type="number" min="0" step="any" aria-label="Quantity, line '+(j+1)+'" data-phl="qty" data-o="'+i+'" data-l="'+j+'" value="'+esc(l.qty)+'"></td>'+
        '<td class="l">'+esc(UW[String(l.um).toUpperCase()]||String(l.um).toLowerCase())+'</td>'+
        '<td><input type="number" min="0" step="0.01" aria-label="Estimated price, line '+(j+1)+'" data-phl="price" data-o="'+i+'" data-l="'+j+'" value="'+esc(l.price)+'"></td>'+
        '<td class="m">'+money(lineTotal(l))+'</td>'+
        '<td><button class="btn" type="button" data-phrm="'+i+'.'+j+'" aria-label="Remove line '+(j+1)+'">Remove</button></td></tr>';
    });
    h+='</tbody><tfoot><tr><td class="l">Estimated total</td><td></td><td></td><td></td><td class="m">'+money(draftTotal(d))+'</td><td></td></tr></tfoot></table></div>';
    h+='<div class="muted">Prices are the typical price paid to '+esc(d.vendor)+' (the most common of the last 8). The real price is on the invoice, so this total is an estimate.</div>';
    if(probs.length)h+='<div class="ph-warn" role="alert">'+probs.map(esc).join(' ')+'</div>';
    if(d.future)h+='<div class="ph-warn" role="alert">This date is in the future. Is it right?</div>';
    if(d.dup)h+='<div class="ph-warn" role="alert"><b>Possible duplicate.</b> '+esc(d.dup.source==='phone'?'Phone order ':'Invoice ')+esc(d.dup.invoice)+' is already in the tally for route '+esc(d.dup.route)+' on '+esc(T.mmdd(d.dup.date))+' with the same products and quantities. <label><input type="checkbox" data-phf="dup" data-o="'+i+'"'+(d.confirmDup?' checked':'')+'> Add it anyway</label></div>';
    h+='</div>';
  });
  var n=st.drafts.length;
  h+='<div class="row"><button class="btn primary" type="button" id="phAdd"'+(ok&&!st.saving?'':' disabled')+'>Add to tally'+(n>1?' ('+n+' orders)':'')+'</button><button class="btn" type="button" id="phCancel"'+(st.saving?' disabled':'')+'>Cancel</button><span class="muted">Nothing is saved until you press Add to tally.</span></div>';
  box.innerHTML=h;
}
function retemplate(d){
  d.lines.forEach(function(l){
    if(l.cat==='other'&&l.noPrice&&!l.sku){return}
    var tp=getTemplate(d.vendor,l.cat,l.name||l.group||'');
    if(!tp||!tp.tpl)return;
    var t=tp.tpl;l.sku=t.sku;l.um=t.um;l.desc=t.desc+(l.desc2?', '+l.desc2:'');l.label=t.label;
    if(t.group)l.group=t.group;
    if(l.cat==='chlorine')l.gpu=1;
    l.price=tp.price==null?0:tp.price;l.noPrice=tp.price==null;
  });
}
function onEdit(e){
  var t=e.target,f=t.getAttribute&&t.getAttribute('data-phf'),pl=t.getAttribute&&t.getAttribute('data-phl');
  if(!st.drafts)return;
  if(f){
    var d=st.drafts[+t.getAttribute('data-o')];if(!d)return;
    if(f==='route'){var r=resolveRoute(t.value);d.route=r===null?String(t.value).trim():r}
    else if(f==='date'){d.date=t.value;d.future=!!d.date&&d.date>T.todayISO()}
    else if(f==='vendor'){d.vendor=t.value;retemplate(d)}
    else if(f==='dup'){d.confirmDup=t.checked}
    if(f!=='dup')d.dup=findDup(d),d.confirmDup=false;
    drawPrev();return;
  }
  if(pl){
    var d2=st.drafts[+t.getAttribute('data-o')],l=d2&&d2.lines[+t.getAttribute('data-l')];if(!l)return;
    var v=parseFloat(t.value);
    if(pl==='qty')l.qty=isFinite(v)&&v>0?v:0;
    if(pl==='price'){l.price=isFinite(v)&&v>=0?v:0;l.noPrice=false}
    d2.dup=findDup(d2);if(pl==='qty')d2.confirmDup=false;
    drawPrev();
  }
}
async function addAll(){
  if(!st.drafts||st.saving)return;
  if(!T.dbRef){setStatus('The saved tally is not available in this view.',true);return}
  var bad=st.drafts.some(function(d){return validateDraft(d).length||(d.dup&&!d.confirmDup)});
  if(bad)return;
  st.saving=true;drawChat();setStatus('Saving...');
  var taken={},docs=[],text=allUserText();
  st.drafts.forEach(function(d){var id=newId(d,taken);taken[id]=1;docs.push(makeDoc(d,id,text))});
  try{
    await Promise.all(docs.map(function(doc){return T.dbRef.doc('invoices/'+doc.invoice).set(doc)}));
    var msg='Added '+docs.length+' phone order'+(docs.length===1?'':'s')+': '+docs.map(function(x){return x.invoice}).join(', ')+'. They count as estimates until the real invoice is added.';
    st.saving=false;reset(true);
    st.turns.push({who:'bot',text:msg});drawChat();setStatus('');
  }catch(e){
    st.saving=false;drawChat();setStatus('Could not save to the tally. You may need edit access to this artifact.',true);
  }
}

/* ---------- waiting for the real invoice ---------- */
function phoneOrders(){return T.invoices.filter(function(v){return v&&v.source==='phone'}).sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:a.invoice<b.invoice?1:-1})}
function lineSummary(v){return (v.items||[]).map(function(i){return T.itemText(i)}).join(', ')}
function drawWait(){
  var el=$('phWait');if(!el)return;
  var list=phoneOrders();
  if(!list.length){el.hidden=true;el.innerHTML='';return}
  el.hidden=false;
  el.innerHTML='<div class="detail"><div class="dhead"><div><h2>Waiting for invoice ('+list.length+')</h2><p>Phone orders with no invoice yet. They are counted as estimates. When the real invoice is added, you will be asked to replace the phone order with it.</p></div></div>'+
    '<div class="nlist">'+list.map(function(v){
      var armed=st.delArm===v.invoice;
      return '<div class="nrow"><div><span class="pill ph-badge">Phone order, est.</span> <b class="mono">'+esc(v.invoice)+'</b>'+(v.vendor==='Proline'?' <span class="pill neutral">Proline</span>':'')+' &middot; '+esc(T.dlabel(v.date))+' &middot; '+esc(T.rlabel(v.route))+(T.techName(v.route)&&v.route!=='Stock'?' ('+esc(T.techName(v.route))+')':'')+
      '<small>'+esc(lineSummary(v))+'</small></div><div class="row"><span class="mono">'+money(v.total)+' est.</span><button class="btn" type="button" data-phdel="'+esc(v.invoice)+'">'+(armed?'Press again to delete':'Delete')+'</button></div></div>';
    }).join('')+'</div></div>';
}
function delPhone(id){
  var v=T.invoices.filter(function(x){return x.invoice===id})[0];
  if(!v||v.source!=='phone'||!T.dbRef)return;
  if(st.delArm!==id){st.delArm=id;drawWait();setTimeout(function(){if(st.delArm===id){st.delArm=null;drawWait()}},4000);return}
  st.delArm=null;
  T.dbRef.doc('invoices/'+id).delete().then(function(){}).catch(function(){setStatus('Could not delete that. Ask the owner for edit access.',true)});
}

/* ---------- reconcile: the real invoice arrives ---------- */
function matchFor(d){
  if(!d||!d.route)return null;
  var s=sigOf(d.items),best=null,bd=1e9;
  if(!Object.keys(s).length)return null;
  phoneOrders().forEach(function(p){
    if(String(p.route)!==String(d.route)||(p.vendor==='Proline')!==(d.vendor==='Proline'))return;
    var gap=(new Date(d.date+'T12:00:00')-new Date(p.date+'T12:00:00'))/864e5;
    if(isNaN(gap)||gap<-1||gap>10)return;
    if(!sameSig(s,sigOf(p.items)))return;
    if(Math.abs(gap)<bd){bd=Math.abs(gap);best=p}
  });
  return best;
}
function onPreview(box){
  build();
  Array.prototype.forEach.call(box.querySelectorAll('[data-reread]'),function(btn){
    if(btn.parentNode.querySelector('[data-phfrom]'))return;
    var b=document.createElement('button');b.type='button';b.className='btn';b.setAttribute('data-phfrom',btn.getAttribute('data-reread'));b.textContent='Type the order instead';
    btn.parentNode.insertBefore(b,btn.nextSibling);
  });
  var empty=box.querySelector('.empty');
  if(empty&&!empty.querySelector('[data-phfrom]')){
    var b2=document.createElement('button');b2.type='button';b2.className='btn';b2.setAttribute('data-phfrom','');b2.textContent='Type it as an order instead';
    empty.appendChild(document.createElement('br'));empty.appendChild(b2);
  }
  var F=T.found,sug='';
  if(F&&F.inv)F.inv.forEach(function(e,i){
    var d=e.data;
    if(!d||T.invoices.some(function(v){return v.invoice===d.invoice}))return;
    var p=matchFor(d);if(!p)return;
    var on=d.phoneOrderId===p.invoice;
    sug+='<div class="alert"><div><b>This looks like the real invoice for phone order '+esc(p.invoice)+': replace it?</b>'+
      '<p>Invoice '+esc(d.invoice)+' and the phone order are for route '+esc(d.route)+', '+esc(T.mmdd(p.date))+' / '+esc(T.mmdd(d.date))+', same products and quantities ('+esc(lineSummary(p))+'). If you replace it, the phone order is removed and the real invoice is kept with the order date '+esc(T.mmdd(p.orderDate||p.date))+', so nothing is counted twice.</p></div>'+
      '<div class="row">'+(on?'<span class="pill ok">Will replace '+esc(p.invoice)+' when you add</span><button class="btn" type="button" data-phkeep="'+i+'">Keep both</button>':'<button class="btn primary" type="button" data-phrep="'+i+'" data-phid="'+esc(p.invoice)+'">Replace phone order '+esc(p.invoice)+'</button>')+'</div></div>';
  });
  if(sug){var w=document.createElement('div');w.className='alerts';w.setAttribute('data-phsug','1');w.innerHTML=sug;box.insertBefore(w,box.firstChild)}
}
function afterAdd(pick){
  (pick||[]).forEach(function(e){
    var id=e.data&&e.data.phoneOrderId;if(!id||!T.dbRef)return;
    var v=T.invoices.filter(function(x){return x.invoice===id})[0];
    if(!v||v.source!=='phone')return;
    T.dbRef.doc('invoices/'+id).delete().then(function(){}).catch(function(){});
  });
}

/* ---------- wiring ---------- */
document.addEventListener('click',function(e){
  var t=e.target;if(!t||!t.closest)return;
  var b;
  if(t.closest('#phOpen')||t.closest('#phHdr')){openChat('');return}
  if((b=t.closest('[data-phfrom]'))){
    var idx=b.getAttribute('data-phfrom'),pre='';
    var ta=idx!==''?$('hint-'+idx):null;
    pre=ta&&ta.value.trim()?ta.value:($('pasteText')?$('pasteText').value:'');
    if(!pre&&idx!==''&&T.found){var pg=T.found.pages.filter(function(p){return String(p.idx)===idx})[0];if(pg&&pg.invoice)pre='Invoice '+pg.invoice+' '+(pg.note||'')}
    openChat(pre);return;
  }
  if(t.closest('#phSend')){send();return}
  if(t.closest('#phStop')){if(st.ctl)st.ctl.abort();return}
  if(t.closest('#phClose')){if(!st.busy){$('phChat').hidden=true;st.open=false}return}
  if(t.closest('#phCancel')){reset(true);setStatus('Cancelled. Nothing was saved.');return}
  if(t.closest('#phAdd')){addAll();return}
  if((b=t.closest('[data-phrm]'))){
    var ij=b.getAttribute('data-phrm').split('.'),d=st.drafts&&st.drafts[+ij[0]];
    if(d){d.lines.splice(+ij[1],1);d.dup=findDup(d);d.confirmDup=false;drawPrev()}
    return;
  }
  if((b=t.closest('[data-phdel]'))){delPhone(b.getAttribute('data-phdel'));return}
  if((b=t.closest('[data-phrep]'))){
    var i=+b.getAttribute('data-phrep'),F=T.found,en=F&&F.inv[i];
    if(en){var p=T.invoices.filter(function(x){return x.invoice===b.getAttribute('data-phid')})[0];
      if(p){en.data.phoneOrderId=p.invoice;en.data.orderDate=p.orderDate||p.date;T.renderPreview()}}
    return;
  }
  if((b=t.closest('[data-phkeep]'))){
    var F2=T.found,en2=F2&&F2.inv[+b.getAttribute('data-phkeep')];
    if(en2){delete en2.data.phoneOrderId;T.renderPreview()}
  }
});
document.addEventListener('change',function(e){if(e.target&&e.target.closest&&e.target.closest('#phPrev'))onEdit(e)});
document.addEventListener('keydown',function(e){
  if(e.target&&e.target.id==='phIn'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}
});

var drawT=null;
function schedule(){clearTimeout(drawT);drawT=setTimeout(drawWait,30)}
function showButtons(){
  build();
  var on=!!T.sampleFn;
  ['phOpen','phHdr'].forEach(function(id){var el=$(id);if(el)el.hidden=!on});
  if(!on&&$('phChat')){$('phChat').hidden=true;st.open=false}
}
window.__tallyPhone={parseDate:parseDate,analyze:analyze,resolveRoute:resolveRoute,matchFor:matchFor,findDup:findDup};
T.phone={matchFor:matchFor,onPreview:onPreview,afterAdd:afterAdd,onRender:schedule,onSample:showButtons};
showButtons();
})();
