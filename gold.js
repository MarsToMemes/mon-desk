/* ================================================================
   COCKPIT — Espace Or : graphique et niveaux intraday, moteurs, flux du perpétuel
   Données : perpétuel OKX XAU-USDT-SWAP (bougies, prix en direct), funding et
   open interest OKX / Binance / Bybit, liquidations des flux temps réel du cœur,
   moteurs (dollar, taux, argent) via le scanner TradingView de core.js.
   Les calculs (CK.gold.calc) sont testés : node --test tests/*.mjs
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var INST="XAU-USDT-SWAP",OKX="https://www.okx.com",H=3600000,D=86400000;

/* ---------------- Calculs (sans affichage) ---------------- */
var FMT=null;
function parts(ts){if(!FMT)FMT=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  var o={};FMT.formatToParts(new Date(ts)).forEach(function(p){o[p.type]=+p.value;});return o;}
function parisOffset(ts){var p=parts(ts);return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute,p.second)-Math.floor(ts/1000)*1000;}
function parisMidnight(ts){var off=parisOffset(ts);return Math.floor((ts+off)/D)*D-off;}
function parisHour(ts){var off=parisOffset(ts);return ((((ts+off)%D)+D)%D)/H;}
function parisDow(ts){var off=parisOffset(ts);return new Date(ts+off).getUTCDay();}
/* Or « réel » : fermé du vendredi 23:00 au lundi 00:00 (Paris) et chaque soir de 23:00 à minuit */
function session(ts){var d=parisDow(ts),h=parisHour(ts);
  if(d===6||d===0||(d===5&&h>=23))return {k:"ferme",n:"Marché fermé (week-end)"};
  if(h>=23)return {k:"pause",n:"Pause quotidienne"};
  if(h>=1&&h<9)return {k:"asie",n:"Session d'Asie"};
  if(h>=9&&h<14.5)return {k:"londres",n:"Session de Londres"};
  if(h>=14.5)return {k:"newyork",n:h<17.5?"Londres + New York":"Session de New York"};
  return {k:"hors",n:"Hors séance"};}
function parseK(rows){return (rows||[]).map(function(r){return {t:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4]};}).filter(function(k){return k.t>0&&k.c>0;}).sort(function(a,b){return a.t-b.t;});}
function hl(K,a,b){var hi=-Infinity,lo=Infinity,n=0;K.forEach(function(k){if(k.t>=a&&k.t<b){if(k.h>hi)hi=k.h;if(k.l<lo)lo=k.l;n++;}});return n?{h:hi,l:lo}:null;}
function openAt(K,t){for(var i=0;i<K.length;i++)if(K[i].t===t)return K[i].o;return null;}
function rondNom(x){return "Niveau rond "+x;}
/* K : bougies 30 min (ordre chronologique) couvrant au moins le dernier jour ouvré */
function niveaux(K,px,now){
  var L=[],d0=parisMidnight(now),add=function(nom,prix,type){if(prix!=null&&isFinite(prix))L.push({nom:nom,prix:prix,type:type});};
  var p=d0-D,g=0;while(g++<4&&(parisDow(p+12*H)===0||parisDow(p+12*H)===6))p-=D;
  var v=hl(K,p,p+D);if(v){add("Haut de la veille",v.h,"veille");add("Bas de la veille",v.l,"veille");}
  add("Ouverture du jour",openAt(K,d0),"jour");
  if(now>d0+H){var a=hl(K,d0+H,Math.min(d0+9*H,now));if(a){add("Haut de l'Asie",a.h,"asie");add("Bas de l'Asie",a.l,"asie");}}
  if(now>=d0+9*H)add("Ouverture de Londres",openAt(K,d0+9*H),"session");
  if(now>=d0+14.5*H)add("Ouverture de New York",openAt(K,d0+14.5*H),"session");
  if(px>0){var e=1e-6; /* marge : 4000 × 1,005 vaut 4019,999… en virgule flottante */
    for(var x=Math.ceil(px*0.97/50-e)*50;x<=px*1.03+e;x+=50)add(rondNom(x),x,"rond");
    for(var y=Math.ceil(px*0.995/10-e)*10;y<=px*1.005+e;y+=10)if(y%50)add(rondNom(y),y,"rond10");}
  return L;}
function proches(L,px){var haut=null,bas=null;L.forEach(function(l){if(l.prix>px&&(!haut||l.prix<haut.prix))haut=l;if(l.prix<px&&(!bas||l.prix>bas.prix))bas=l;});return {haut:haut,bas:bas};}
function bp(d){return (d.c-d.c/(1+(d.ch||0)/100))*100;}
/* +1 : pousse l'or à la hausse · −1 : pèse sur l'or · 0 : neutre */
function effet(k,d){if(!d||d.ch==null||d.c==null)return 0;
  if(k==="US10Y"){var b=bp(d);return Math.abs(b)<1?0:b>0?-1:1;}
  if(Math.abs(d.ch)<0.05)return 0;
  if(k==="DXY")return d.ch>0?-1:1;
  if(k==="SILVER")return d.ch>0?1:-1;
  return 0;}

/* ---------------- État ---------------- */
var G={k:{},lv:[],tf:"15m",fitTf:"",fund:{},oi:{},oi1h:null,seeded:false,ch:null,lines:[],lk:"",err:{ch:false,fx:false}};
var TFS=[["5m","5 min"],["15m","15 min"],["1H","1 h"]];
var COL={veille:"#7FA8F0",jour:"#E8B931",asie:"#A99BEA",session:"#5FD3C6",rond:"#8E949E",rond10:"#5A5F68"};
var u=null,$=function(id){return document.getElementById(id);};
function J(url){return u.fetchJSON(url,null,12000);}
function q(p){return p.catch(function(){return null;});}
function visible(){return ["orchart","ormoteurs","orflux"].some(function(id){var e=$(id);return !!(e&&e.offsetParent);});}
function prix(){var t=CK.S&&CK.S.tick[INST];if(t&&t.last)return t.last;var K=G.k[G.tf]||[];return K.length?K[K.length-1].c:null;}
function lvNow(p){return G.lv.length&&p?niveaux(G.lv,p,Date.now()):[];}

/* ---------------- Chargement ---------------- */
function loadK(tf){return J(OKX+"/api/v5/market/candles?instId="+INST+"&bar="+tf+"&limit=200").then(function(j){var K=parseK(j&&j.data);if(K.length){G.k[tf]=K;G.err.ch=false;}if(tf===G.tf)paintChart();})
  .catch(function(){G.err.ch=true;if(tf===G.tf)paintChart();});}
function loadLv(){return J(OKX+"/api/v5/market/candles?instId="+INST+"&bar=30m&limit=300").then(function(j){var K=parseK(j&&j.data);if(K.length)G.lv=K;G.lk="";lines();paintHead();}).catch(function(){});}
function loadFlux(){
  return Promise.all([q(J(OKX+"/api/v5/public/funding-rate?instId="+INST)),q(J("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XAUUSDT")),q(J("https://api.bybit.com/v5/market/tickers?category=linear&symbol=XAUUSDT")),
    q(J(OKX+"/api/v5/public/open-interest?instType=SWAP&instId="+INST)),q(J("https://fapi.binance.com/fapi/v1/openInterest?symbol=XAUUSDT")),
    q(J("https://api.bybit.com/v5/market/open-interest?category=linear&symbol=XAUUSDT&intervalTime=5min&limit=13"))]).then(function(a){
    var ok=a[0]&&a[0].data&&a[0].data[0],bn=a[1],by=a[2]&&a[2].result&&a[2].result.list&&a[2].result.list[0],oo=a[3]&&a[3].data&&a[3].data[0],bo=a[4],hs=a[5]&&a[5].result&&a[5].result.list,p=prix();
    G.fund={okx:ok?+ok.fundingRate:null,bn:bn&&bn.lastFundingRate!=null?+bn.lastFundingRate:null,by:by&&by.fundingRate!=null?+by.fundingRate:null};
    G.oi={okx:oo?+oo.oiUsd:null,bn:bo&&bo.openInterest&&p?+bo.openInterest*p:null,by:by&&by.openInterestValue?+by.openInterestValue:null};
    G.oi1h=hs&&hs.length>=13&&+hs[12].openInterest>0?(+hs[0].openInterest/+hs[12].openInterest-1)*100:null;
    G.err.fx=!a.some(Boolean);seed();paintFlux();});
}
/* Historique récent des liquidations d'or sur OKX (le flux temps réel prend le relais) */
function seed(){var meta=CK.S&&CK.S.ct[INST];if(G.seeded||!meta||!CK.addLiqEvent)return;G.seeded=true;
  J(OKX+"/api/v5/public/liquidation-orders?instType=SWAP&uly=XAU-USDT&state=filled&limit=100").then(function(j){
    ((j&&j.data&&j.data[0]&&j.data[0].details)||[]).forEach(function(x){var amt=+x.sz*meta.ctVal*(+x.bkPx);if(!(amt>0))return;
      CK.addLiqEvent({ex:"OKX",base:"XAU",usd:amt,long:x.posSide==="long"||(x.posSide==="net"&&x.side==="sell"),px:+x.bkPx,ts:+x.ts},INST+x.ts+x.sz+x.side,true);});
    paintFlux();}).catch(function(){G.seeded=false;});}

/* ---------------- Graphique ---------------- */
var LWC=["https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js","https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"],lwcP=null;
function loadLWC(){if(window.LightweightCharts)return Promise.resolve();if(lwcP)return lwcP;
  lwcP=new Promise(function(ok,ko){var i=0;(function go(){var s=document.createElement("script");s.src=LWC[i];s.async=true;s.onload=function(){ok();};
    s.onerror=function(){s.remove();i++;if(i<LWC.length)go();else{lwcP=null;ko(new Error("graphique"));}};document.head.appendChild(s);})();});return lwcP;}
function css(v,d){var x=getComputedStyle(document.documentElement).getPropertyValue(v).trim();return x||d;}
function makeChart(box){var up=css("--up","#7CFFB2"),dn=css("--down","#FF8C7A"),mu=css("--faint","#737882"),li=css("--line","rgba(242,238,230,.09)");
  var ch=LightweightCharts.createChart(box,{autoSize:true,layout:{background:{type:"solid",color:"transparent"},textColor:mu,fontSize:11,fontFamily:"JetBrains Mono, monospace"},
    grid:{vertLines:{visible:false},horzLines:{color:li}},rightPriceScale:{borderVisible:false},timeScale:{borderVisible:false,timeVisible:true,secondsVisible:false,rightOffset:4},
    crosshair:{mode:0},localization:{priceFormatter:function(p){return u.nf(p,2);}}});
  var se=ch.addCandlestickSeries({upColor:up,downColor:dn,borderVisible:false,wickUpColor:up,wickDownColor:dn,priceLineVisible:true,lastValueVisible:true});
  return {chart:ch,se:se};}
function bar(k){var off=-new Date(k.t).getTimezoneOffset()*60;return {time:Math.floor(k.t/1000)+off,open:k.o,high:k.h,low:k.l,close:k.c};}
var LEG=[["veille","Veille"],["jour","Jour"],["asie","Asie"],["session","Sessions"],["rond","Ronds"]].map(function(x){return '<span><i style="background:'+COL[x[0]]+'"></i>'+x[1]+'</span>';}).join("");
function ensureDom(){var host=$("orchart");if(!host||host.querySelector(".or-ch"))return;
  host.innerHTML='<div class="or-hd"></div><div class="or-bar"><div class="or-tf" role="group" aria-label="Unité de temps">'+
    TFS.map(function(t){return '<button type="button" data-ortf="'+t[0]+'" aria-pressed="'+(t[0]===G.tf)+'">'+t[1]+'</button>';}).join("")+
    '</div><div class="or-leg">'+LEG+'</div><button type="button" class="or-tv">Ouvrir dans TradingView</button></div><div class="or-ch"></div>';
  host.addEventListener("click",function(e){var b=e.target.closest("[data-ortf]");if(b){setTf(b.getAttribute("data-ortf"));return;}
    if(e.target.closest(".or-tv")&&CK.openChart)CK.openChart("OANDA:XAUUSD","Or");});}
function setTf(tf){if(!/^(5m|15m|1H)$/.test(tf)||tf===G.tf)return;G.tf=tf;CK.ls("or:tf",tf);
  [].forEach.call(document.querySelectorAll("[data-ortf]"),function(b){b.setAttribute("aria-pressed",String(b.getAttribute("data-ortf")===tf));});
  if(G.k[tf])paintChart();loadK(tf);}
function paintChart(){var host=$("orchart");if(!host)return;ensureDom();var box=host.querySelector(".or-ch"),K=G.k[G.tf]||[];
  if(!K.length){if(G.ch){G.ch.chart.remove();G.ch=null;G.lines=[];G.lk="";}
    box.innerHTML='<div class="empty">'+(G.err.ch?"Graphique indisponible pour le moment (OKX ne répond pas), nouvel essai dans un instant. Le bouton TradingView reste disponible.":"Chargement des bougies de l'or…")+'</div>';paintHead();return;}
  if(!window.LightweightCharts){loadLWC().then(paintChart,function(){box.innerHTML='<div class="empty">Impossible de charger le module graphique. Utilise le bouton TradingView.</div>';});return;}
  if(!G.ch){box.innerHTML="";G.ch=makeChart(box);}
  G.ch.se.setData(K.map(bar));
  if(G.fitTf!==G.tf){G.ch.chart.timeScale().fitContent();G.fitTf=G.tf;}
  lines();paintHead();}
function court(n){return n.replace("Haut de la veille","H. veille").replace("Bas de la veille","B. veille").replace("Ouverture du jour","Ouv. jour").replace("Haut de l'Asie","H. Asie")
  .replace("Bas de l'Asie","B. Asie").replace("Ouverture de Londres","Ouv. Londres").replace("Ouverture de New York","Ouv. NY").replace("Niveau rond ","");}
function lines(){if(!G.ch)return;var p=prix(),L=lvNow(p);if(!L.length)return;var key=L.map(function(l){return l.type+l.prix;}).join("|");if(key===G.lk)return;G.lk=key;
  G.lines.forEach(function(x){try{G.ch.se.removePriceLine(x);}catch(e){}});
  G.lines=L.map(function(l){var r=l.type==="rond"||l.type==="rond10";
    return G.ch.se.createPriceLine({price:l.prix,color:COL[l.type],lineWidth:1,lineStyle:r?1:2,axisLabelVisible:l.type!=="rond10",title:l.type==="rond10"?"":court(l.nom)});});}
function paintHead(){var host=$("orchart"),hd=host&&host.querySelector(".or-hd");if(!hd||!u)return;
  var now=Date.now(),p=prix(),L=lvNow(p),jo=L.filter(function(x){return x.type==="jour";})[0],ch=jo&&p?(p/jo.prix-1)*100:null,pr=p?proches(L,p):{},se=session(now);
  function dist(l){if(!l)return "<b>—</b>";return '<b>'+u.px(l.prix)+'</b> <small>'+u.esc(l.nom)+' · '+(l.prix>p?"+":"−")+u.nf(Math.abs(l.prix-p),1)+' $</small>';}
  hd.innerHTML='<div class="or-px"><span class="or-lbl">Or · XAU</span><b>'+(p?u.px(p):"—")+'</b><span class="'+(ch==null?"":u.cls(ch))+'">'+(ch==null?"":u.pct(ch)+" depuis l'ouverture")+'</span></div>'+
    '<div class="or-nx"><span>Niveau au-dessus</span>'+dist(pr.haut)+'</div><div class="or-nx"><span>Niveau en dessous</span>'+dist(pr.bas)+'</div>'+
    '<div class="or-se"><span>'+u.parisTime(now)+' · Paris</span><b class="or-s-'+se.k+'">'+se.n+'</b></div>'+
    (se.k==="ferme"?'<div class="or-wk">Marché de l\'or fermé : le perpétuel OKX continue de coter le week-end, les niveaux reprennent lundi.</div>':'');}
function tick(){if(!u||!visible())return;var p=prix(),K=G.k[G.tf];
  if(p&&K&&K.length&&G.ch){var k=K[K.length-1];k.c=p;if(p>k.h)k.h=p;if(p<k.l)k.l=p;try{G.ch.se.update(bar(k));}catch(e){}}
  paintHead();}

/* ---------------- Moteurs ---------------- */
var MOT=[["DXY","Dollar (DXY)"],["US10Y","Taux US 10 ans"],["SILVER","Argent"]];
function pastille(e){return '<span class="or-ef '+(e>0?"up":e<0?"down":"")+'" title="'+(e>0?"Pousse l'or à la hausse":e<0?"Pèse sur l'or":"Effet neutre")+'">'+(e>0?"▲ or":e<0?"▼ or":"—")+'</span>';}
function paintMoteurs(){var host=$("ormoteurs");if(!host||!u)return;var mk=(CK.S&&CK.S.mk)||{};
  if(!MOT.some(function(m){return mk[m[0]];})){host.innerHTML='<div class="empty">Chargement des moteurs…</div>';return;}
  var rows=MOT.map(function(m){var d=mk[m[0]],t=m[0]==="US10Y";
    var val=!d?"—":t?u.nf(d.c,3)+" %":u.px(d.c),chg=!d?"":t?((bp(d)>=0?"+":"−")+u.nf(Math.abs(bp(d)),1)+" pb"):u.pct(d.ch),c=!d?"":u.cls(t?bp(d):d.ch);
    return '<div class="or-mr"><span class="or-mn">'+m[1]+'</span><b class="or-mv">'+val+'</b><span class="or-mc '+c+'">'+chg+'</span>'+pastille(effet(m[0],d))+'</div>';});
  var g=mk.GOLD,s=mk.SILVER,ratio=g&&s&&s.c?g.c/s.c:null;
  rows.push('<div class="or-mr"><span class="or-mn">Ratio or / argent</span><b class="or-mv">'+(ratio?u.nf(ratio,1):"—")+'</b><span class="or-mc"></span><span class="or-ef">info</span></div>');
  var sc=MOT.reduce(function(a,m){return a+effet(m[0],mk[m[0]]);},0);
  host.innerHTML='<div class="or-bilan '+(sc>0?"up":sc<0?"down":"")+'">'+(sc>0?"Les moteurs poussent l'or à la hausse":sc<0?"Les moteurs pèsent sur l'or":"Moteurs partagés ou calmes")+'</div>'+rows.join("")+
    '<p class="or-note">Dollar ou taux en hausse : pression à la baisse sur l\'or. L\'argent confirme ou non le mouvement des métaux.</p>';}

/* ---------------- Flux et positionnement ---------------- */
function fr(v){return v==null?"—":(v>=0?"+":"−")+u.nf(Math.abs(v*100),4)+" %";}
function paintFlux(){var host=$("orflux");if(!host||!u)return;var S=CK.S||{},now=Date.now();
  var L=(S.liqHist||[]).filter(function(x){return x.base==="XAU";}),lg=0,sh=0;
  L.forEach(function(x){if(now-x.ts<H){if(x.long)lg+=x.usd;else sh+=x.usd;}});
  var list=L.filter(function(x){return x.usd>=1000;}).sort(function(a,b){return b.ts-a.ts;}).slice(0,10);
  var tot=["okx","bn","by"].reduce(function(a,k){return a+(G.oi[k]||0);},0);
  host.innerHTML='<div class="or-fx">'+
    '<div class="or-fc"><h3>Funding (par période)</h3>'+[["okx","OKX"],["bn","Binance"],["by","Bybit"]].map(function(x){var v=G.fund[x[0]];return '<div class="or-fr"><span>'+x[1]+'</span><b class="'+(v==null?"":u.cls(v))+'">'+fr(v)+'</b></div>';}).join("")+
      '<p class="or-note">Positif : les acheteurs paient les vendeurs, le marché est chargé en longs.</p></div>'+
    '<div class="or-fc"><h3>Open interest</h3><div class="or-big">'+(tot?u.usd(tot):"—")+'</div><div class="or-fr"><span>Variation 1 h</span><b class="'+(G.oi1h==null?"":u.cls(G.oi1h))+'">'+(G.oi1h==null?"—":u.pct(G.oi1h))+'</b></div>'+
      '<p class="or-note">OKX + Binance + Bybit. Variation mesurée sur Bybit.</p></div>'+
    '<div class="or-fc"><h3>Liquidations or</h3><div class="or-fr"><span>Longs liquidés (1 h)</span><b class="down">'+u.usd(lg)+'</b></div><div class="or-fr"><span>Shorts liquidés (1 h)</span><b class="up">'+u.usd(sh)+'</b></div>'+
      '<div class="or-ll">'+(list.length?list.map(function(x){return '<div class="or-li"><span class="'+(x.long?"down":"up")+'">'+(x.long?"Long":"Short")+' liquidé</span><span class="or-ex">'+u.esc(x.ex)+'</span><b>'+u.usd(x.usd)+'</b><small>'+u.parisTime(x.ts)+'</small></div>';}).join(""):'<div class="empty">Aucune liquidation d\'or récente.</div>')+'</div></div>'+
    '</div>'+(G.err.fx?'<p class="or-note">Sources du perpétuel indisponibles, nouvel essai dans une minute.</p>':'');}

/* ---------------- Résumé (carte de l'accueil) ---------------- */
function summary(){var p=prix(),L=lvNow(p),jo=L.filter(function(x){return x.type==="jour";})[0],pr=p?proches(L,p):{};
  return {px:p,ch:jo&&p?(p/jo.prix-1)*100:null,sess:session(Date.now()),haut:pr.haut,bas:pr.bas,closes:G.lv.slice(-48).map(function(k){return k.c;})};}

/* ---------------- Démarrage ---------------- */
function boot(){u=CK.u;if(!$("orchart"))return;
  var t=CK.ls("or:tf");G.tf=/^(5m|15m|1H)$/.test(t||"")?t:"15m";
  ensureDom();paintChart();paintMoteurs();paintFlux();
  loadLv();loadK(G.tf);loadFlux();
  setInterval(function(){if(!document.hidden&&visible())loadK(G.tf);},30000);
  setInterval(function(){if(!document.hidden)loadLv();},300000);
  setInterval(function(){if(!document.hidden&&visible())loadFlux();},60000);
  setInterval(function(){if(!document.hidden&&visible()){paintHead();lines();paintFlux();}},15000);
  CK.onLiqEvent=function(it,silent){if(!silent&&it&&it.base==="XAU"&&visible())paintFlux();};}

CK.gold={boot:boot,tick:tick,visible:function(){return !!u&&visible();},paintMoteurs:paintMoteurs,summary:summary,
  calc:{parisOffset:parisOffset,parisMidnight:parisMidnight,parisHour:parisHour,parisDow:parisDow,session:session,parseK:parseK,niveaux:niveaux,proches:proches,effet:effet}};
})();
