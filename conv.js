/* ================================================================
   COCKPIT — Convergences de l'or : cinq familles de signaux votent
   (cassure, moteurs, flux, tendance, agent IA). Repérage de signaux,
   jamais une consigne d'achat ou de vente.
   Calculs purs : CK.conv.calc (testés : node --test tests/*.mjs)
   ================================================================ */
(function(){
"use strict";
var CK=window.CK=window.CK||{};
var INST="XAU-USDT-SWAP",OKX="https://www.okx.com",M15=9e5,H=36e5,JOURS3=3*864e5;

/* ---------------- Calculs ---------------- */
function sma(v,n){if(!v||v.length<n)return null;var s=0;for(var i=v.length-n;i<v.length;i++)s+=v[i];return s/n;}
function ent(x){return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g," ");}
function vote(v,txt){return {v:v,txt:txt};}
/* K : bougies 15 min clôturées (ordre chronologique) ; L : niveaux du jour (CK.gold.calc.niveaux) */
function voteCassure(K,L){
  if(!K||K.length<2||!L||!L.length)return vote(0,"pas assez de données");
  var a=K[K.length-2].c,b=K[K.length-1].c,best=null;
  L.forEach(function(l){if(l.type==="rond10")return;var up=a<=l.prix&&b>l.prix,dn=a>=l.prix&&b<l.prix;if(!up&&!dn)return;
    var d=Math.abs(b-l.prix);if(!best||d<best.d)best={l:l,s:up?1:-1,d:d};});
  if(!best)return vote(0,"aucune cassure à la dernière clôture 15 min");
  return vote(best.s,"clôture 15 min "+(best.s>0?"au-dessus de ":"sous ")+ent(best.l.prix)+" ("+best.l.nom+")");}
function voteMoteurs(mk,effet){mk=mk||{};var s=effet("DXY",mk.DXY)+effet("US10Y",mk.US10Y),ag=effet("SILVER",mk.SILVER);
  if(s>0&&ag>=0)return vote(1,"dollar ou taux en baisse"+(ag>0?", l'argent confirme":""));
  if(s<0&&ag<=0)return vote(-1,"dollar ou taux en hausse"+(ag<0?", l'argent confirme":""));
  if(s!==0)return vote(0,"l'argent contredit le dollar et les taux");
  return vote(0,"dollar et taux calmes ou partagés");}
/* f : {oi1h (%), px1h (%), fund:[taux par période], liqL, liqS ($ liquidés sur 1 h)} */
function voteFlux(f){f=f||{};
  var fu=(f.fund||[]).filter(function(x){return x!=null&&isFinite(x);}),fm=fu.length?fu.reduce(function(a,b){return a+b;},0)/fu.length:0;
  var oi=f.oi1h,p=f.px1h,L=f.liqL||0,S=f.liqS||0,pS=S>=5e4&&S>=2*L,pL=L>=5e4&&L>=2*S;
  var up=(oi!=null&&p!=null&&oi>0.3&&p>0.1)||pS,dn=(oi!=null&&p!=null&&oi>0.3&&p<-0.1)||pL;
  if(up&&dn)return vote(0,"flux contradictoires");
  if(up&&fm>0.0003)return vote(0,"flux acheteur mais funding surchargé");
  if(dn&&fm<-0.0003)return vote(0,"flux vendeur mais funding très négatif");
  if(up)return vote(1,pS?"purge des shorts sur 1 h":"nouveaux acheteurs : open interest et prix en hausse sur 1 h");
  if(dn)return vote(-1,pL?"purge des longs sur 1 h":"nouveaux vendeurs : open interest en hausse, prix en baisse sur 1 h");
  return vote(0,"flux sans direction nette");}
/* c1, c4 : clôtures 1 h et 4 h (ordre chronologique) */
function voteTendance(c1,c4){if(!c1||c1.length<50||!c4||c4.length<20)return vote(0,"historique insuffisant");
  var x=c1[c1.length-1],m20=sma(c1,20),m50=sma(c1,50),y=c4[c4.length-1],n20=sma(c4,20);
  if(x>m20&&m20>m50&&y>n20)return vote(1,"au-dessus de ses moyennes en 1 h et en 4 h");
  if(x<m20&&m20<m50&&y<n20)return vote(-1,"sous ses moyennes en 1 h et en 4 h");
  return vote(0,"tendances 1 h et 4 h pas alignées");}
/* x : actifs.XAU de la dernière lecture de l'agent */
function voteAgent(x,now){if(!x)return vote(0,"pas encore de lecture de l'agent sur l'or");
  var actif=function(sc){return !!(sc&&sc.dec&&!sc.ok&&now-sc.dec<4*H);},h=actif(x.hausse),b=actif(x.baisse);
  if(h&&!b)return vote(1,"scénario haussier de l'agent déclenché");
  if(b&&!h)return vote(-1,"scénario baissier de l'agent déclenché");
  return vote(0,"aucun scénario de l'agent en cours");}
function combine(V){var up=0,dn=0;V.forEach(function(x){if(x.v>0)up++;else if(x.v<0)dn++;});
  var r={up:up,dn:dn,neu:V.length-up-dn,sens:0,force:""};
  if(up>=4&&dn===0){r.sens=1;r.force="forte";}else if(dn>=4&&up===0){r.sens=-1;r.force="forte";}
  else if(up>=3&&dn<=1&&up>dn+1){r.sens=1;r.force="convergence";}else if(dn>=3&&up<=1&&dn>up+1){r.sens=-1;r.force="convergence";}
  return r;}
function nouvelle(prev,cur){return !!(cur&&cur.sens&&(!prev||prev.sens!==cur.sens));}
/* Variation entre la clôture tc (prix px) et la clôture tc + d, sur des bougies 15 min */
function apres(K,tc,px,d){for(var i=0;i<K.length;i++)if(K[i].t+M15===tc+d)return {d:K[i].c-px,p:(K[i].c/px-1)*100};return null;}

/* ---------------- État et données ---------------- */
var u=null,$=function(id){return document.getElementById(id);};
var C={k15:[],k1:[],k4:[],ev:[],seen:0,last:null,res:null,ok:false};
function J(url){return u.fetchJSON(url,null,12000);}
function bougies(tf,n){return J(OKX+"/api/v5/market/candles?instId="+INST+"&bar="+tf+"&limit="+n).then(function(j){
  return ((j&&j.data)||[]).filter(function(r){return r[8]==="1";}).map(function(r){return {t:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4]};}).sort(function(a,b){return a.t-b.t;});});}
function load15(){return bougies("15m",100).then(function(K){if(K.length){C.k15=K;C.ok=true;}}).catch(function(){});}
function loadLent(){return Promise.all([bougies("1H",100).then(function(K){if(K.length)C.k1=K;}),bougies("4H",60).then(function(K){if(K.length)C.k4=K;})]).catch(function(){});}
function ferme(now){var s=CK.gold&&CK.gold.calc.session(now);return !!(s&&(s.k==="ferme"||s.k==="pause"));}
function annonce(now){var S=CK.S||{};return (S.cal||[]).filter(function(e){return e.imp==="hi"&&e.ts>now&&e.ts-now<=30*6e4;})[0]||null;}
function lectureOr(){var a=CK.S&&CK.S.agent,L=a&&a.lectures,x=L&&L.length&&L[L.length-1];return x&&x.actifs&&x.actifs.XAU;}
var FAM=[["cassure","Cassure"],["moteurs","Moteurs"],["flux","Flux"],["tendance","Tendance"],["agent","Agent IA"]];
/* K : bougies 15 min (la dernière est celle qu'on évalue), now : heure de sa clôture */
function evaluer(K,now){
  var g=CK.gold,e=g&&g.etat?g.etat():{},S=CK.S||{},px=K.length?K[K.length-1].c:null;
  var L=e.lv&&e.lv.length&&px?g.calc.niveaux(e.lv,px,now):[];
  var lL=0,lS=0;(S.liqHist||[]).forEach(function(x){if(x.base==="XAU"&&now-x.ts<H&&x.ts<=now){if(x.long)lL+=x.usd;else lS+=x.usd;}});
  var f=e.fund||{},px1h=K.length>4?(K[K.length-1].c/K[K.length-5].c-1)*100:null;
  var c1=C.k1.map(function(k){return k.c;}),c4=C.k4.map(function(k){return k.c;});if(px){c1=c1.concat([px]);c4=c4.concat([px]);}
  var V=[voteCassure(K,L),voteMoteurs(S.mk,g.calc.effet),voteFlux({oi1h:e.oi1h,px1h:px1h,fund:[f.okx,f.bn,f.by],liqL:lL,liqS:lS}),voteTendance(c1,c4),voteAgent(lectureOr(),now)];
  V.forEach(function(v,i){v.k=FAM[i][0];v.n=FAM[i][1];});
  return {V:V,r:combine(V),px:px,t:K.length?K[K.length-1].t:0};}
function sauver(){var lim=Date.now()-JOURS3;C.ev=C.ev.filter(function(x){return x.t>lim;});CK.lsj("or:conv",{ev:C.ev,seen:C.seen,last:C.last});}
function charger(){var s=CK.lsj("or:conv")||{};C.ev=Array.isArray(s.ev)?s.ev:[];C.seen=+s.seen||0;C.last=s.last||null;}
function marquer(){if(CK.gold&&CK.gold.marqueurs)CK.gold.marqueurs(C.ev.map(function(x){return {t:x.t,sens:x.sens,force:x.force};}));}
/* Calcul officiel à chaque nouvelle bougie 15 min clôturée */
function officiel(){var K=C.k15;if(!K.length)return;var t=K[K.length-1].t;if(t<=C.seen)return;
  if(!C.seen&&K.length>2){var p=evaluer(K.slice(0,-1),t);C.last=ferme(t)?null:p.r;}   /* premier passage : état de la bougie précédente */
  C.seen=t;var tc=t+M15,res=evaluer(K,tc);
  if(ferme(tc)){C.last=null;sauver();return;}
  if(nouvelle(C.last,res.r)){C.ev.push({t:t,tc:tc,sens:res.r.sens,force:res.r.force,px:res.px,up:res.r.up,dn:res.r.dn,raisons:res.V.filter(function(v){return v.v===res.r.sens;}).map(function(v){return v.n;})});marquer();}
  C.last={sens:res.r.sens};sauver();}

/* ---------------- Affichage ---------------- */
var esc=function(s){return u.esc(s);};
function sensTxt(r){if(!r.sens)return "Pas de convergence";return (r.force==="forte"?"Convergence forte ":"Convergence ")+(r.sens>0?"haussière":"baissière");}
function ligne(v){var c=v.v>0?"up":v.v<0?"down":"",i=v.v>0?"▲":v.v<0?"▼":"—";return '<div class="cv-l"><span class="cv-i '+c+'">'+i+'</span><b>'+esc(v.n)+'</b><span>'+esc(v.txt)+'</span></div>';}
function jauge(r){var h="";for(var i=0;i<5;i++)h+='<i class="'+(i<r.up?"up":i>=5-r.dn?"down":"")+'"></i>';return '<div class="cv-j" aria-hidden="true">'+h+'</div>';}
function var1(a){if(!a)return '<span class="cv-na">…</span>';return '<span class="'+u.cls(a.d)+'">'+(a.d>=0?"+":"−")+u.nf(Math.abs(a.d),1)+' $</span>';}
function histo(now){var d0=CK.gold.calc.parisMidnight(now),L=C.ev.filter(function(x){return x.t>=d0;}).slice(-12).reverse();
  if(!L.length)return '<div class="cv-vide">Aucune convergence repérée aujourd\'hui pendant que le Desk était ouvert.</div>';
  return '<div class="cv-h"><div class="cv-hr cv-hh"><span>Heure</span><span>Sens</span><span>Prix</span><span>+15 min</span><span>+1 h</span><span>+4 h</span></div>'+L.map(function(x){
    return '<div class="cv-hr"><span>'+u.parisTime(x.tc)+'</span><span class="'+(x.sens>0?"up":"down")+'">'+(x.sens>0?"▲":"▼")+(x.force==="forte"?" forte":"")+'</span><span>'+u.px(x.px)+'</span>'+
      var1(apres(C.k15,x.tc,x.px,M15))+var1(apres(C.k15,x.tc,x.px,H))+var1(apres(C.k15,x.tc,x.px,4*H))+'</div>';}).join("")+'</div>';}
function render(){var host=$("orconv");if(!host||!u)return;var now=Date.now();
  if(!C.ok){host.innerHTML='<div class="empty">Calcul des convergences…</div>';return;}
  var K=C.k15,tick=CK.S&&CK.S.tick[INST],live=tick&&tick.last,res=C.res;
  if(live&&K.length){var dern=K[K.length-1];res=evaluer(K.concat([{t:dern.t+M15,o:dern.c,h:live,l:live,c:live}]),now);}
  else res=evaluer(K,now);
  C.res=res;var r=res.r,an=annonce(now),fe=ferme(now),proch=K.length?K[K.length-1].t+2*M15:now;
  host.innerHTML=(fe?'<div class="cv-band">Marché de l\'or fermé : rien n\'est repéré pendant cette période.</div>':'')+
    (an&&!fe?'<div class="cv-band cv-warn">Annonce imminente à '+u.parisTime(an.ts)+' ('+esc(an.fr||an.t)+') : signaux moins fiables.</div>':'')+
    '<div class="cv-hd">'+jauge(r)+'<div><b class="cv-etat '+(r.sens>0?"up":r.sens<0?"down":"")+'">'+sensTxt(r)+'</b><small>'+r.up+' ▲ · '+r.dn+' ▼ · '+r.neu+' neutres</small></div></div>'+
    res.V.map(ligne).join("")+
    '<p class="cv-t">Aperçu en direct · calcul officiel à chaque clôture 15 min (prochaine à '+u.parisTime(proch)+')</p>'+
    '<h3 class="cv-st">Aujourd\'hui</h3>'+histo(now)+
    '<p class="or-note">Repérage de signaux, pas une consigne d\'achat ou de vente.</p>';}
function tick(){if(document.hidden)return;officiel();render();}

function boot(){u=CK.u;if(!$("orconv"))return;charger();
  Promise.all([load15(),loadLent()]).then(function(){tick();marquer();});
  setInterval(function(){if(!document.hidden)load15().then(tick);},60000);
  setInterval(function(){if(!document.hidden)loadLent();},300000);
  setInterval(tick,30000);}

CK.conv={boot:boot,
  _test:function(){var K=C.k15;if(!K.length)return "pas de bougies";var x=K[K.length-3]||K[K.length-1];C.ev.push({t:x.t,tc:x.t+M15,sens:1,force:"forte",px:x.c,up:4,dn:0,raisons:["test"],test:1});marquer();render();return "ok";},
  _reset:function(){C.ev=C.ev.filter(function(x){return !x.test;});sauver();marquer();render();return "ok";},
  calc:{sma:sma,voteCassure:voteCassure,voteMoteurs:voteMoteurs,voteFlux:voteFlux,voteTendance:voteTendance,voteAgent:voteAgent,combine:combine,nouvelle:nouvelle,apres:apres}};
})();
