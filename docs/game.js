(function (global) {
'use strict';
const ID='dernier-robot',ROOM_COUNT=5,ROOM_DURATION=32,DURATION=ROOM_COUNT*ROOM_DURATION;
const MAX_ENEMIES=44,MAX_BULLETS=110,MAX_GEMS=90,MAX_PICKUPS=20,MAX_ENEMY_BULLETS=90;
const ARENA={left:24,right:396,top:134,bottom:544};
const CAPS={overclock:5,cannon:5,servos:4,magnet:4,armor:3,split:2,pierce:2,shock:3,frost:3,orbit:3};
const DESCRIPTIONS={
 overclock:['SURCADENCE','Tirs 16 % plus rapides.','#ff9578'],
 cannon:['CANON RENFORCÉ','Chaque tir inflige +1 dégât.','#ffbc79'],
 servos:['SERVOMOTEURS','Vitesse +15 ; esquive plus fréquente.','#79d8e6'],
 magnet:['AIMANT','Rayon de collecte +25.','#70e2d1'],
 armor:['BLINDAGE','Vie maximale +2 ; répare 2 PV.','#b5b3ff'],
 split:['SALVE MULTIPLE','Un projectile en plus par salve.','#ffd98d'],
 pierce:['PERFORATION','Traverse un ennemi de plus.','#81dff0'],
 shock:['ARC ÉLECTRIQUE','Le tir rebondit sur un drone voisin.','#ffe98d'],
 frost:['CRYOCIRCUIT','Les tirs ralentissent leurs cibles.','#91d4ff'],
 orbit:['SATELLITE','Un drone frappe les ennemis proches.','#d2b8ff'],
 repair:['RÉPARATION','Récupère 5 PV ; aucun gain de puissance.','#92e7ad']
};
const PICKUP_INFO={repair:['+','#94e8aa','Réparation : +2 PV'],shield:['◇','#b9a5ff','Bouclier : absorbe 2 impacts'],magnet:['U','#79e4de','Aimant total pendant 10 secondes'],bomb:['✦','#ffba74','Impulsion : dégâts dans toute l’arène'],haste:['»','#fff19a','Surcadence pendant 10 secondes']};
const ROUTES=[['FORGE D’ASSAUT','Une augment au choix','Drones +25 % · PV +15 %','#ffad83','elite'],['ATELIER DE SECOURS','Répare 3 PV','Pas d’augment bonus','#98e5b5','normal'],['DÉPÔT INSTABLE','Bouclier +2 et aimant 12 s','Davantage de coureurs','#8ad9f1','cache']];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),finite=(v,a,b)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b,integer=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b,clone=v=>JSON.parse(JSON.stringify(v)),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),xpNeed=level=>10+level*5;
function stats(s){const u=s.upgrades;return{maxHp:8+u.armor*2,speed:148+u.servos*15,damage:2+u.cannon,interval:.47*Math.pow(.84,u.overclock)*(s.hero.hasteTime>0?.65:1),shots:1+u.split,pierce:u.pierce,magnet:s.hero.magnetTime>0?480:44+u.magnet*25,dashCooldown:Math.max(1.35,2.8-u.servos*.23)};}
function initialState(seed){return{game:ID,version:2,status:'playing',mode:'arena',rng:seed>>>0,time:0,room:1,roomTime:0,roomType:'normal',bossSpawned:false,rewardUpgrade:false,pendingRoute:null,hero:{x:210,y:339,hp:8,shield:0,invuln:0,magnetTime:0,hasteTime:0,dashCooldown:0,dashTime:0,dashX:0,dashY:-1,facingX:0,facingY:-1},level:1,xp:0,kills:0,spawn:.8,fire:.15,orbitTimer:.5,enemies:[],bullets:[],enemyBullets:[],gems:[],pickups:[],choices:[],upgrades:Object.fromEntries(Object.keys(CAPS).map(k=>[k,0])),nextId:1,pickupsCollected:0};}
function checkState(s){
 if(!s||s.game!==ID||s.version!==2||!['playing','won','lost'].includes(s.status)||!['arena','upgrade','route'].includes(s.mode))return false;
 if(!integer(s.rng,0,4294967295)||!finite(s.time,0,3600)||!integer(s.room,1,ROOM_COUNT)||!finite(s.roomTime,0,1200)||!['normal','elite','cache'].includes(s.roomType)||typeof s.bossSpawned!=='boolean'||typeof s.rewardUpgrade!=='boolean'||!(s.pendingRoute===null||['elite','normal','cache'].includes(s.pendingRoute)))return false;
 if(!integer(s.level,1,100)||!integer(s.xp,0,100000)||!integer(s.kills,0,100000)||!integer(s.nextId,1,1000000)||!integer(s.pickupsCollected,0,100000))return false;
 if(!s.upgrades||typeof s.upgrades!=='object'||Array.isArray(s.upgrades)||Object.keys(CAPS).some(k=>!integer(s.upgrades[k],0,CAPS[k])))return false;
 const h=s.hero,st=stats(s);if(!h||!finite(h.x,ARENA.left+11,ARENA.right-11)||!finite(h.y,ARENA.top+11,ARENA.bottom-11)||!integer(h.hp,0,st.maxHp)||!integer(h.shield,0,6)||!finite(h.invuln,0,1.5)||!finite(h.magnetTime,0,20)||!finite(h.hasteTime,0,20)||!finite(h.dashCooldown,0,3)||!finite(h.dashTime,0,.25)||!['dashX','dashY','facingX','facingY'].every(k=>finite(h[k],-1.001,1.001)))return false;
 if(!finite(s.spawn,-.2,3)||!finite(s.fire,-.2,3)||!finite(s.orbitTimer,-.2,1))return false;
 if(s.status==='playing'&&h.hp===0||s.status==='lost'&&h.hp!==0||s.status==='won'&&(h.hp===0||s.room!==ROOM_COUNT||s.roomTime<ROOM_DURATION||s.enemies.length!==0||!s.bossSpawned))return false;
 if(!Array.isArray(s.choices)||s.choices.length>3||new Set(s.choices).size!==s.choices.length||s.choices.some(k=>k!=='repair'&&(!(k in CAPS)||s.upgrades[k]>=CAPS[k])))return false;
 if(s.mode==='upgrade'&&(s.status!=='playing'||s.choices.length===0)||s.mode!=='upgrade'&&s.choices.length!==0||s.pendingRoute!==null&&s.mode!=='upgrade')return false;
 if(s.mode==='route'&&(s.status!=='playing'||s.room>=ROOM_COUNT||s.roomTime<ROOM_DURATION||s.enemies.length!==0||(s.room===3&&!s.bossSpawned)))return false;
 if(s.rewardUpgrade!==(s.mode==='upgrade'&&s.pendingRoute==='elite'))return false;
 if(s.pendingRoute!==null&&(s.pendingRoute!=='elite'||s.room>=ROOM_COUNT||s.roomTime<ROOM_DURATION||s.enemies.length!==0||(s.room===3&&!s.bossSpawned)))return false;
 if(s.time<s.roomTime||s.bossSpawned&&s.room!==3&&s.room!==5)return false;
 if(!Array.isArray(s.enemies)||s.enemies.length>MAX_ENEMIES||!Array.isArray(s.bullets)||s.bullets.length>MAX_BULLETS||!Array.isArray(s.enemyBullets)||s.enemyBullets.length>MAX_ENEMY_BULLETS||!Array.isArray(s.gems)||s.gems.length>MAX_GEMS||!Array.isArray(s.pickups)||s.pickups.length>MAX_PICKUPS)return false;
 if(s.enemies.filter(e=>e&&e.kind===5).length>1||s.enemies.some(e=>e&&e.kind===5)&&(!s.bossSpawned||s.room!==3&&s.room!==5))return false;
 const ids=new Set();for(const e of s.enemies){if(!e||!integer(e.id,1,s.nextId-1)||ids.has(e.id)||!integer(e.kind,0,5)||!finite(e.x,-30,450)||!finite(e.y,80,580)||!finite(e.hp,.00001,300)||!finite(e.maxHp,1,300)||e.hp>e.maxHp||!finite(e.speed,10,120)||!finite(e.radius,8,30)||!finite(e.slow,0,3)||!finite(e.cooldown,-.1,4)||!finite(e.windup,0,1)||!finite(e.chargeTime,0,.4)||!finite(e.aimX,-1.001,1.001)||!finite(e.aimY,-1.001,1.001)||e.pattern!==undefined&&!integer(e.pattern,0,1))return false;ids.add(e.id);}
 for(const b of s.bullets)if(!b||!finite(b.x,-50,470)||!finite(b.y,70,610)||!finite(b.vx,-400,400)||!finite(b.vy,-400,400)||!finite(b.life,.000001,3)||!integer(b.damage,1,12)||!integer(b.pierce,0,2)||!Array.isArray(b.hit)||b.hit.length>3||b.hit.some(v=>!integer(v,1,s.nextId-1)))return false;
 for(const b of s.enemyBullets)if(!b||!finite(b.x,-50,470)||!finite(b.y,70,610)||!finite(b.vx,-300,300)||!finite(b.vy,-300,300)||!finite(b.life,.000001,5)||!integer(b.damage,1,2))return false;
 for(const g of s.gems)if(!g||!finite(g.x,0,420)||!finite(g.y,100,570)||!integer(g.value,1,10000))return false;
 for(const p of s.pickups)if(!p||!Object.hasOwn(PICKUP_INFO,p.kind)||!finite(p.x,0,420)||!finite(p.y,100,570)||!finite(p.ttl,.000001,30))return false;
 return true;
}
function validState(s){try{return checkState(s);}catch{return false;}}
function box(c,x,y,w,h,r,color){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();if(color){c.fillStyle=color;c.fill();}}
function text(c,value,x,y,size,color,weight,align){c.font=(weight||500)+' '+size+'px system-ui, sans-serif';c.fillStyle=color;c.textAlign=align||'left';c.fillText(value,x,y);}
function createGame(api){
 api=api||{};const progress=api.progress&&typeof api.progress==='object'?api.progress:(api.progress={});if(!progress.robot||typeof progress.robot!=='object'||Array.isArray(progress.robot))progress.robot={};const records=progress.robot;
 for(const k of ['bestTime','bestKills','wins','runs','bestLevel','bestRoom','legacyWins'])if(!finite(records[k],0,10000000))records[k]=0;
 if(records.rules!==2){records.legacyWins+=records.wins;records.wins=0;records.rules=2;}
 let s=null,clock=0,joystick=null,keys=new Set(),particles=[],shake=0,ended=false,lastHud='';
 const call=(name,...args)=>{if(typeof api[name]==='function')return api[name](...args);};
 function rand(){s.rng=(Math.imul(s.rng,1664525)+1013904223)>>>0;return s.rng/4294967296;}
 function hud(){if(!s)return;const st=stats(s),values=['VIE',s.hero.hp+'/'+st.maxHp+(s.hero.shield?' +'+s.hero.shield+'◇':''),'SECTEUR',s.room+'/'+ROOM_COUNT,'NIVEAU',s.level],key=JSON.stringify(values);if(key!==lastHud){lastHud=key;call('hud',...values);}}
 function burst(x,y,color,count){for(let i=0;i<count&&particles.length<90;i++){const a=i*2.399963+clock*9;particles.push({x,y,vx:Math.cos(a)*(25+i*4),vy:Math.sin(a)*(25+i*4),life:.35+i*.025,color});}}
 function reset(){let n=Number(typeof api.random==='function'?api.random():Math.random());if(!Number.isFinite(n))n=.5;s=initialState(Math.floor(clamp(n,0,.9999999999)*4294967296));joystick=null;keys.clear();particles=[];clock=0;shake=0;ended=false;lastHud='';hud();call('toast','Survis au secteur, ramasse les bonus et choisis tes augments.');call('save');}
 function finish(won){if(ended||!s||s.status!=='playing')return;ended=true;s.status=won?'won':'lost';s.mode='arena';s.choices=[];s.pendingRoute=null;s.rewardUpgrade=false;s.bullets=s.bullets.filter(b=>b.life>1e-6);s.enemyBullets=s.enemyBullets.filter(b=>b.life>1e-6);joystick=null;keys.clear();records.bestTime=Math.max(records.bestTime,s.time);records.bestKills=Math.max(records.bestKills,s.kills);records.bestLevel=Math.max(records.bestLevel,s.level);records.bestRoom=Math.max(records.bestRoom,s.room);records.runs++;if(won)records.wins++;hud();call('save');call('end',won?'Le noyau est libre !':'Circuit interrompu',won?'5 secteurs nettoyés · '+s.kills+' drones. Nouvelle tentative : essaie une autre combinaison.':'Secteur '+s.room+'/5 · niveau '+s.level+' · '+s.kills+' drones. Esquive les tirs et garde les soins pour le bon moment.',Math.floor(s.time*10)+s.kills*20+s.room*300+(won?2000:0),won);}
 function offerUpgrade(reward=false){if(s.mode!=='arena'&&!(reward&&s.mode==='route'))return false;const need=xpNeed(s.level);if(!reward&&s.xp<need)return false;if(!reward){s.xp-=need;s.level++;}s.rewardUpgrade=reward;let pool=Object.keys(CAPS).filter(k=>s.upgrades[k]<CAPS[k]);if(s.hero.hp<stats(s).maxHp)pool.push('repair');for(let i=pool.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}s.choices=pool.slice(0,3);if(!s.choices.length)s.choices=['repair'];s.mode='upgrade';joystick=null;keys.clear();hud();call('save');return true;}
 function enterRoom(type){s.room++;s.roomTime=0;s.roomType=type;s.mode='arena';s.pendingRoute=null;s.rewardUpgrade=false;s.bossSpawned=false;s.enemies=[];s.enemyBullets=[];s.bullets=[];s.gems=[];s.pickups=[];s.spawn=.8;s.fire=.1;s.hero.x=210;s.hero.y=339;s.hero.invuln=1.3;s.hero.dashCooldown=0;s.hero.dashTime=0;joystick=null;keys.clear();hud();call('toast','Secteur '+s.room+' : '+(type==='elite'?'assaut renforcé.':type==='cache'?'les coureurs arrivent.':'garde une issue pour esquiver.'));call('save');}
 function choose(index){if(!s||s.status!=='playing'||s.mode!=='upgrade'||!integer(index,0,s.choices.length-1))return false;const id=s.choices[index];if(id==='repair')s.hero.hp=Math.min(stats(s).maxHp,s.hero.hp+5);else{s.upgrades[id]++;if(id==='armor')s.hero.hp=Math.min(stats(s).maxHp,s.hero.hp+2);}s.mode='arena';s.choices=[];s.rewardUpgrade=false;s.hero.invuln=.55;joystick=null;keys.clear();burst(s.hero.x,s.hero.y,DESCRIPTIONS[id][2],18);call('toast',DESCRIPTIONS[id][0]+' installé.');if(s.pendingRoute)enterRoom(s.pendingRoute);hud();call('save');return true;}
 function chooseRoute(index){if(!s||s.mode!=='route'||s.status!=='playing'||!integer(index,0,2))return false;if(index===0){s.pendingRoute='elite';offerUpgrade(true);}else if(index===1){s.hero.hp=Math.min(stats(s).maxHp,s.hero.hp+3);enterRoom('normal');}else{s.hero.shield=Math.min(6,s.hero.shield+2);s.hero.magnetTime=12;enterRoom('cache');}call('save');return true;}
 function spawn(boss=false){if(s.enemies.length>=MAX_ENEMIES)return;const h=s.hero;let p;for(let tries=0;tries<12;tries++){const edge=Math.floor(rand()*4),along=rand();p=edge===0?{x:10,y:ARENA.top+along*410}:edge===1?{x:410,y:ARENA.top+along*410}:edge===2?{x:ARENA.left+along*372,y:120}:{x:ARENA.left+along*372,y:558};if(distance(p,h)>130)break;}if(distance(p,h)<130)p=[{x:12,y:120},{x:408,y:120},{x:12,y:558},{x:408,y:558}].sort((a,b)=>distance(b,h)-distance(a,h))[0];const r=rand(),charger=s.room>=3?.17+(s.room-3)*.025:0,ranged=s.room>=3?.43+(s.room-3)*.025:.36,kind=boss?5:s.room>=3&&r<charger?4:s.room>=2&&r<ranged?3:r<(s.room===1?.52:s.roomType==='cache'?.74:.61)?1:r>(s.room===1?.84:.86)?2:0;
 const baseHp=kind===2?9+s.room*2:kind===1?2+Math.floor(s.room/2):kind===3?5+s.room:kind===4?6+s.room:3+Math.floor(s.room/2),hp=boss?(s.room===5?230:90):Math.ceil(baseHp*(1+.16*(s.room-1))*(s.roomType==='elite'?1.15:1));
 s.enemies.push({id:s.nextId++,x:p.x,y:p.y,kind,hp,maxHp:hp,speed:boss?24:kind===1?70+s.room*3:kind===2?28:kind===3?36:kind===4?47:38+s.room*2,radius:boss?25:kind===2?16:kind===1?9:12,slow:0,cooldown:boss?.55:kind===3?2.1:3,windup:0,chargeTime:0,aimX:0,aimY:0,pattern:0});}
 function fire(st){if(!s.enemies.length)return;const h=s.hero;let nearest=s.enemies[0];for(const e of s.enemies)if(distance(e,h)<distance(nearest,h))nearest=e;const angle=Math.atan2(nearest.y-h.y,nearest.x-h.x);for(let i=0;i<st.shots&&s.bullets.length<MAX_BULLETS;i++){const a=angle+(i-(st.shots-1)/2)*.15;s.bullets.push({x:h.x+Math.cos(a)*13,y:h.y+Math.sin(a)*13,vx:Math.cos(a)*340,vy:Math.sin(a)*340,damage:st.damage,pierce:st.pierce,life:2,hit:[]});}}
 function enemyShot(e,angle,speed,damage=1){if(s.enemyBullets.length>=MAX_ENEMY_BULLETS)return;s.enemyBullets.push({x:e.x,y:e.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:4,damage});}
 function addPickup(kind,x,y){if(s.pickups.length>=MAX_PICKUPS)return;s.pickups.push({kind,x:clamp(x,35,385),y:clamp(y,145,533),ttl:22});}
 function drop(e){const p={x:clamp(e.x,ARENA.left,ARENA.right),y:clamp(e.y,ARENA.top,ARENA.bottom),value:e.kind===5?18:e.kind===2?5:e.kind===3||e.kind===4?4:e.kind===1?3:2};if(s.gems.length<MAX_GEMS)s.gems.push(p);else s.gems.reduce((a,b)=>distance(a,p)<distance(b,p)?a:b).value+=p.value;s.kills++;burst(e.x,e.y,e.kind===5?'#ffd38a':'#7bd8e2',8);if(e.kind===5){addPickup('repair',e.x-15,e.y);addPickup('shield',e.x+15,e.y);}else if(s.kills%(s.room===1?7:9)===0){const kinds=['repair','shield','magnet','bomb','haste'];addPickup(kinds[Math.floor(rand()*kinds.length)],e.x,e.y);}}
 function cleanupDeaths(){const dead=s.enemies.filter(e=>e.hp<=0);s.enemies=s.enemies.filter(e=>e.hp>0);for(const e of dead)drop(e);}
 function applyPickup(p){const h=s.hero;h.invuln=Math.max(h.invuln,.12);if(p.kind==='repair')h.hp=Math.min(stats(s).maxHp,h.hp+2);if(p.kind==='shield')h.shield=Math.min(6,h.shield+2);if(p.kind==='magnet')h.magnetTime=10;if(p.kind==='haste')h.hasteTime=10;if(p.kind==='bomb'){for(const e of s.enemies)e.hp-=e.kind===5?20:30;cleanupDeaths();shake=.2;}s.pickupsCollected++;burst(p.x,p.y,PICKUP_INFO[p.kind][1],14);call('toast',PICKUP_INFO[p.kind][2]);}
 function movement(){let x=(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')||keys.has('q')?1:0),y=(keys.has('arrowdown')||keys.has('s')?1:0)-(keys.has('arrowup')||keys.has('w')||keys.has('z')?1:0);if(!x&&!y&&joystick){x=joystick.dx;y=joystick.dy;}const len=Math.hypot(x,y);return len>1?{x:x/len,y:y/len}:{x,y};}
 function dash(){if(!s||s.status!=='playing'||s.mode!=='arena'||s.hero.dashCooldown>0)return false;const h=s.hero,v=movement(),len=Math.hypot(v.x,v.y);h.dashX=len?v.x/len:h.facingX;h.dashY=len?v.y/len:h.facingY;h.dashTime=.20;h.dashCooldown=stats(s).dashCooldown;h.invuln=Math.max(h.invuln,.24);burst(h.x,h.y,'#9ae8ec',12);call('save');return true;}
 function hurt(amount){const h=s.hero;if(h.invuln>0||h.dashTime>0)return false;const absorbed=Math.min(h.shield,amount);h.shield-=absorbed;h.hp=Math.max(0,h.hp-(amount-absorbed));h.invuln=.78;shake=.2;burst(h.x,h.y,h.shield?'#b9a5ff':'#ff7f8d',10);if(h.hp===0)finish(false);return true;}
 // Bosses lock their aim before every volley. Pattern 0 is a fan; pattern 1
 // is a ring with a broad, visibly marked safe passage. Shots never home.
 function bossAngles(e){const aim=Math.atan2(e.aimY,e.aimX),angles=[];if((e.pattern||0)===0){const count=s.room===5?7:5;for(let n=0;n<count;n++)angles.push(aim+(n-(count-1)/2)*(s.room===5?.16:.18));}else{const count=s.room===5?16:12,gap=aim+Math.PI/2,spacing=Math.PI*2/count;for(let n=0;n<count;n++){const a=gap+n*spacing,difference=Math.atan2(Math.sin(a-gap),Math.cos(a-gap));if(Math.abs(difference)>spacing*1.55)angles.push(a);}}return angles;}
 function bossVolley(e){const fan=(e.pattern||0)===0;for(const angle of bossAngles(e))enemyShot(e,angle,fan?(s.room===5?170:145):(s.room===5?128:112),fan&&s.room===5?2:1);e.pattern=((e.pattern||0)+1)%2;const furious=s.room===5&&e.hp<e.maxHp*.5;e.cooldown=(furious?1.65:s.room===5?2.05:2.4)-(s.roomType==='elite'?.15:0);}
 function moveEnemies(dt){const h=s.hero,travel=movement(),heroSpeed=stats(s).speed;for(const e of s.enemies){e.slow=Math.max(0,e.slow-dt);e.cooldown=Math.max(0,e.cooldown-dt);const dx=h.x-e.x,dy=h.y-e.y,d=Math.hypot(dx,dy)||1,slow=e.slow>0?.55:1;
  if(e.kind===5){if(e.windup>0){e.windup=Math.max(0,e.windup-dt);if(e.windup===0)bossVolley(e);}else{e.x+=dx/d*e.speed*slow*dt;e.y+=dy/d*e.speed*slow*dt;if(e.cooldown<=0){e.windup=s.room===5?.72:.85;const ax=dx+travel.x*heroSpeed*.55,ay=dy+travel.y*heroSpeed*.55,length=Math.hypot(ax,ay)||1;e.aimX=ax/length;e.aimY=ay/length;}}}
  else if(e.kind===4){if(e.chargeTime>0){e.chargeTime=Math.max(0,e.chargeTime-dt);e.x+=e.aimX*285*dt;e.y+=e.aimY*285*dt;}else if(e.windup>0){e.windup=Math.max(0,e.windup-dt);if(e.windup===0)e.chargeTime=.30;}else if(e.cooldown<=0){e.windup=.65;e.aimX=dx/d;e.aimY=dy/d;e.cooldown=3.3;}else{e.x+=dx/d*e.speed*slow*dt;e.y+=dy/d*e.speed*slow*dt;}}
  else{const factor=e.kind===3?(d>170?1:d<125?-1:0):1;e.x+=dx/d*e.speed*factor*slow*dt;e.y+=dy/d*e.speed*factor*slow*dt;
   if(e.kind===3){if(e.windup>0){e.windup=Math.max(0,e.windup-dt);if(e.windup===0){const center=Math.atan2(e.aimY,e.aimX),count=s.room>=4?3:1;for(let n=0;n<count;n++)enemyShot(e,center+(n-(count-1)/2)*.15,112+s.room*12);e.cooldown=Math.max(1.25,2.6-s.room*.17);}}else if(e.cooldown<=0){if(s.room>=3){e.windup=.5;const ax=dx+travel.x*heroSpeed*.3,ay=dy+travel.y*heroSpeed*.3,length=Math.hypot(ax,ay)||1;e.aimX=ax/length;e.aimY=ay/length;}else{enemyShot(e,Math.atan2(dy,dx),112+s.room*12);e.cooldown=Math.max(1.25,2.6-s.room*.17);}}}}
  e.x=clamp(e.x,4,416);e.y=clamp(e.y,116,562);
 }}
 function roomCleared(){if(s.roomTime<ROOM_DURATION||s.enemies.length||(s.room===3||s.room===5)&&!s.bossSpawned)return false;if(s.room===ROOM_COUNT){finish(true);return true;}for(const g of s.gems)s.xp+=g.value;s.gems=[];s.enemyBullets=[];s.bullets=[];if(offerUpgrade())return true;s.mode='route';joystick=null;keys.clear();hud();call('save');return true;}
 function tick(dt){if(s.status!=='playing'||s.mode!=='arena')return;const h=s.hero,st=stats(s),v=movement();s.time+=dt;s.roomTime+=dt;if(Math.hypot(v.x,v.y)>.1){const len=Math.hypot(v.x,v.y);h.facingX=v.x/len;h.facingY=v.y/len;}const dashing=h.dashTime>0;h.x=clamp(h.x+(dashing?h.dashX*410:v.x*st.speed)*dt,ARENA.left+11,ARENA.right-11);h.y=clamp(h.y+(dashing?h.dashY*410:v.y*st.speed)*dt,ARENA.top+11,ARENA.bottom-11);for(const k of ['invuln','dashTime','dashCooldown','hasteTime','magnetTime'])h[k]=Math.max(0,h[k]-dt);
  if(s.roomTime<ROOM_DURATION){s.spawn-=dt;if(s.spawn<=0){spawn();s.spawn+=Math.max(.31,(.84-s.room*.085)*(s.roomType==='elite'?.80:1));}}
  if((s.room===3||s.room===5)&&!s.bossSpawned&&s.roomTime>=8){spawn(true);s.bossSpawned=true;call('toast',s.room===5?'LE NOYAU : esquive les salves en cercle.':'GARDIEN : repère les salves avant de foncer.');}
  s.fire-=dt;if(s.fire<=0){fire(st);s.fire+=st.interval;}
  moveEnemies(dt);
  for(const b of s.bullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.x<0||b.x>420||b.y<110||b.y>570)b.life=0;if(b.life<=1e-6)continue;for(const e of s.enemies){if(e.hp<=0||b.hit.includes(e.id)||distance(b,e)>=e.radius+3)continue;e.hp-=b.damage;e.slow=Math.max(e.slow,s.upgrades.frost>0?.7+s.upgrades.frost*.35:0);b.hit.push(e.id);burst(b.x,b.y,'#ffd5b1',2);if(s.upgrades.shock){let target=null;for(const other of s.enemies)if(other!==e&&other.hp>0&&distance(e,other)<85&&(!target||distance(e,other)<distance(e,target)))target=other;if(target){target.hp-=s.upgrades.shock;burst(target.x,target.y,'#ffe98d',3);}}if(b.pierce>0)b.pierce--;else{b.life=0;break;}}}
  s.bullets=s.bullets.filter(b=>b.life>1e-6);
  s.orbitTimer-=dt;if(s.orbitTimer<=0){s.orbitTimer=.8;if(s.upgrades.orbit)for(const e of s.enemies)if(distance(e,h)<44+s.upgrades.orbit*5)e.hp-=s.upgrades.orbit*2;}
  cleanupDeaths();
  for(const b of s.enemyBullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.x<0||b.x>420||b.y<110||b.y>570)b.life=0;if(b.life>1e-6&&distance(b,h)<12){b.life=0;hurt(b.damage);}}
  s.enemyBullets=s.enemyBullets.filter(b=>b.life>1e-6);if(s.status!=='playing')return;
  for(const e of s.enemies)if(distance(e,h)<e.radius+10&&h.invuln<=0){hurt(e.kind===5?2:1);const dx=e.x-h.x,dy=e.y-h.y,d=Math.hypot(dx,dy)||1;e.x=clamp(e.x+dx/d*20,4,416);e.y=clamp(e.y+dy/d*20,116,562);break;}if(s.status!=='playing')return;
  for(const g of s.gems){const dx=h.x-g.x,dy=h.y-g.y,d=Math.hypot(dx,dy);if(d<st.magnet&&d>0){const n=Math.min(d,250*dt);g.x+=dx/d*n;g.y+=dy/d*n;}if(distance(g,h)<15){s.xp+=g.value;g.value=0;}}s.gems=s.gems.filter(g=>g.value>0);
  const collect=[];for(const p of s.pickups){p.ttl-=dt;if(p.ttl>1e-6&&distance(p,h)<20){collect.push(p);p.ttl=0;}}s.pickups=s.pickups.filter(p=>p.ttl>1e-6);for(const p of collect)applyPickup(p);
  if(s.roomTime>=ROOM_DURATION&&roomCleared())return;offerUpgrade();
 }
 function update(dt){dt=clamp(Number(dt)||0,0,.1);clock+=dt;shake=Math.max(0,shake-dt);for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;}particles=particles.filter(p=>p.life>0);if(!s||s.status!=='playing'||s.mode!=='arena')return;let left=dt;while(left>1e-9&&s.status==='playing'&&s.mode==='arena'){const step=Math.min(left,1/60);tick(step);left-=step;}hud();}
 function pointer(type,x,y){if(type==='cancel'){joystick=null;return;}if(!s||s.status!=='playing')return;if(s.mode==='upgrade'||s.mode==='route'){if(type==='down'&&x>=40&&x<=380){const i=Math.floor((y-225)/85);if(i>=0&&i<3&&y<=225+i*85+73){if(s.mode==='route')chooseRoute(i);else choose(i);}}return;}if(type==='down'){if(y>=552&&x>=312){dash();return;}joystick={x:clamp(x,50,370),y:clamp(y,160,514),dx:0,dy:0};}else if(type==='move'&&joystick){const dx=x-joystick.x,dy=y-joystick.y,d=Math.hypot(dx,dy);joystick.dx=d>5?dx/Math.max(45,d):0;joystick.dy=d>5?dy/Math.max(45,d):0;}else if(type==='up')joystick=null;}
 function key(value,down){const k=String(value).toLowerCase();if(!down){keys.delete(k);return;}if(!s||s.status!=='playing')return;if(s.mode==='upgrade'||s.mode==='route'){if(['1','2','3'].includes(k)){if(s.mode==='route')chooseRoute(Number(k)-1);else choose(Number(k)-1);}else if(k==='enter'){if(s.mode==='route')chooseRoute(0);else choose(0);}return;}if(k===' '||k==='shift'||k==='shiftleft'){dash();return;}keys.add(k);}
 function snapshot(){return s?clone(s):null;}
 function restore(data){try{if(!validState(data))return false;s=clone(data);ended=s.status!=='playing';joystick=null;keys.clear();particles=[];shake=0;lastHud='';hud();return true;}catch(_){return false;}}
    function draw(c){
      c.save();c.textBaseline='alphabetic';c.clearRect(0,0,420,600);const bg=c.createLinearGradient(0,0,420,600);bg.addColorStop(0,'#211d29');bg.addColorStop(1,'#0b1721');c.fillStyle=bg;c.fillRect(0,0,420,600);
      text(c,'SECTEUR '+(s?s.room:1)+'/5 · '+(s&&s.roomType==='elite'?'ASSAUT':s&&s.roomType==='cache'?'DÉPÔT INSTABLE':'CIRCUIT EN FUITE'),24,27,10,'#bf9e9e',700);text(c,'Dernier Robot',24,61,28,'#f8e8dd',800);
      if(!s){text(c,'Initialisation…',210,330,16,'#9abcc9',600,'center');c.restore();return;}
      const st=stats(s),h=s.hero,remaining=Math.max(0,Math.ceil(ROOM_DURATION-s.roomTime));
      box(c,338,30,58,37,11,'#3c2c37');text(c,String(remaining).padStart(2,'0')+'s',367,55,19,'#ffb097',800,'center');
      const activeBoss=s.enemies.find(e=>e.kind===5);if(activeBoss){const phase=activeBoss.windup>0?((activeBoss.pattern||0)===0?'ÉVENTAIL':'ANNEAU'):activeBoss.hp<activeBoss.maxHp*.5&&s.room===5?'FURIE':'GARDE';text(c,(s.room===5?'NOYAU':'GARDIEN')+' · '+Math.ceil(activeBoss.hp)+' / '+activeBoss.maxHp+' PV · '+phase,210,79,10,'#ffd5ad',800,'center');box(c,80,86,260,10,5,'#493440');box(c,80,86,Math.max(3,260*activeBoss.hp/activeBoss.maxHp),10,5,activeBoss.hp<activeBoss.maxHp*.5?'#f39489':'#edbe83');}else{box(c,24,84,372,8,4,'#2b3544');const fraction=Math.min(1,s.xp/xpNeed(s.level));if(fraction>0)box(c,24,84,Math.max(8,372*fraction),8,4,'#75d6dc');}
      text(c,'NIVEAU '+s.level,24,115,10,'#83d4dc',800);text(c,s.xp+' / '+xpNeed(s.level)+' fragments',108,115,10,'#90abb8',500);text(c,s.kills+' drones',396,115,11,'#c6b3b4',600,'right');
      box(c,18,128,384,422,15,'#0c1924');c.strokeStyle='#34444f';c.lineWidth=1;c.stroke();
      c.save();box(c,24,134,372,410,10);c.clip();if(shake>0)c.translate(Math.sin(clock*90)*shake*12,Math.cos(clock*80)*shake*9);
      c.fillStyle='#101f2b';c.fillRect(24,134,372,410);c.strokeStyle='rgba(111,190,202,0.065)';c.lineWidth=1;
      c.beginPath();for(let x=24;x<400;x+=28){c.moveTo(x,134);c.lineTo(x,544);}for(let y=134;y<545;y+=28){c.moveTo(24,y);c.lineTo(396,y);}c.stroke();
      const scan=134+(clock*17)%410;c.fillStyle='rgba(91,193,201,0.025)';c.fillRect(24,scan,372,17);
      for(const gem of s.gems){c.save();c.translate(gem.x,gem.y);c.rotate(Math.PI/4);c.shadowColor='#73d4e2';c.shadowBlur=9;c.fillStyle='#7edce4';c.fillRect(-3.5,-3.5,7,7);c.shadowBlur=0;c.fillStyle='#d0fbf8';c.fillRect(-1.5,-1.5,3,3);c.restore();}
      for(const b of s.bullets){c.strokeStyle='#ffd5ae';c.lineWidth=3;c.lineCap='round';c.beginPath();c.moveTo(b.x-b.vx*.016,b.y-b.vy*.016);c.lineTo(b.x,b.y);c.stroke();}
      c.lineCap='butt';
      for(const e of s.enemies){
        if(e.kind===5&&e.windup>0){c.save();const fan=(e.pattern||0)===0,aim=Math.atan2(e.aimY,e.aimX);c.strokeStyle=fan?'rgba(255,193,140,.65)':'rgba(255,176,143,.28)';c.lineWidth=1.5;c.setLineDash([5,7]);c.beginPath();for(const a of bossAngles(e)){c.moveTo(e.x+Math.cos(a)*28,e.y+Math.sin(a)*28);c.lineTo(e.x+Math.cos(a)*230,e.y+Math.sin(a)*230);}c.stroke();c.setLineDash([]);if(!fan){const spacing=Math.PI*2/(s.room===5?16:12),gap=aim+Math.PI/2;c.strokeStyle='#99e3de';c.lineWidth=2;c.beginPath();for(const a of [gap-spacing*1.55,gap+spacing*1.55]){c.moveTo(e.x+Math.cos(a)*35,e.y+Math.sin(a)*35);c.lineTo(e.x+Math.cos(a)*180,e.y+Math.sin(a)*180);}c.stroke();text(c,'PASSAGE',e.x+Math.cos(gap)*85,e.y+Math.sin(gap)*85,9,'#b9f6e8',800,'center');}text(c,fan?'ÉVENTAIL':'ANNEAU',e.x,e.y-35,9,'#ffe0ae',800,'center');c.restore();}
        if(e.kind===3&&e.windup>0){c.save();c.strokeStyle='rgba(156,226,235,.5)';c.lineWidth=1.5;c.setLineDash([3,7]);c.beginPath();c.moveTo(e.x,e.y);c.lineTo(e.x+e.aimX*170,e.y+e.aimY*170);c.stroke();c.restore();}
        if(e.kind===4&&e.windup>0){c.save();c.strokeStyle='#ffb692';c.lineWidth=3;c.setLineDash([5,6]);c.beginPath();c.moveTo(e.x,e.y);c.lineTo(e.x+e.aimX*210,e.y+e.aimY*210);c.stroke();c.setLineDash([]);c.restore();}
        if(e.kind===5&&e.cooldown<.65){c.strokeStyle='rgba(255,210,140,.6)';c.lineWidth=2;c.beginPath();c.arc(e.x,e.y,30+(1-e.cooldown/.65)*40,0,Math.PI*2);c.stroke();}
        c.save();c.translate(e.x,e.y);c.fillStyle='rgba(0,0,0,.27)';c.beginPath();c.ellipse(0,e.radius*.7,e.radius+3,e.radius*.45,0,0,Math.PI*2);c.fill();
        if(e.kind===5){box(c,-24,-23,48,46,11,'#a96e73');c.strokeStyle='#ffce89';c.lineWidth=3;c.stroke();box(c,-17,-13,34,19,5,'#342b42');c.fillStyle='#ffe8a6';c.fillRect(-11,-7,22,5);c.fillStyle='#bd92e4';c.fillRect(-28,2,8,16);c.fillRect(20,2,8,16);}
        else if(e.kind===4){c.rotate(Math.atan2(e.aimY||h.y-e.y,e.aimX||h.x-e.x));c.fillStyle=e.windup>0?'#ffe3a1':'#ed947a';c.beginPath();c.moveTo(17,0);c.lineTo(-10,-12);c.lineTo(-5,0);c.lineTo(-10,12);c.closePath();c.fill();c.fillStyle='#542e42';c.fillRect(-4,-3,9,6);}
        else if(e.kind===3){c.fillStyle='#72bdc9';c.beginPath();c.arc(0,0,12,0,Math.PI*2);c.fill();c.rotate(Math.atan2(h.y-e.y,h.x-e.x));box(c,2,-4,17,8,3,'#d5d0b5');c.fillStyle='#223d50';c.beginPath();c.arc(-2,0,5,0,Math.PI*2);c.fill();}
        else if(e.kind===2){c.fillStyle='#ba786c';c.strokeStyle='#ffb392';c.lineWidth=2;c.beginPath();for(let j=0;j<6;j++){const a=j*Math.PI/3;if(!j)c.moveTo(Math.cos(a)*16,Math.sin(a)*16);else c.lineTo(Math.cos(a)*16,Math.sin(a)*16);}c.closePath();c.fill();c.stroke();c.fillStyle='#452d38';c.fillRect(-10,-5,20,10);c.fillStyle='#ffc29a';c.fillRect(-7,-2,14,3);}
        else if(e.kind===1){c.rotate(Math.atan2(h.y-e.y,h.x-e.x));c.fillStyle='#9e8ecb';c.strokeStyle='#d5bcff';c.lineWidth=1.5;c.beginPath();c.moveTo(12,0);c.lineTo(-8,-9);c.lineTo(-4,0);c.lineTo(-8,9);c.closePath();c.fill();c.stroke();c.fillStyle='#f6deff';c.fillRect(2,-2,4,4);}
        else{c.fillStyle='#b77788';c.strokeStyle='#f0a3ab';c.lineWidth=1.5;box(c,-11,-10,22,20,6,'#b77788');c.stroke();c.fillStyle='#432a3d';c.fillRect(-8,-4,16,7);c.fillStyle='#ffb9b7';c.fillRect(-5,-2,3,3);c.fillRect(2,-2,3,3);c.strokeStyle='#f0a3ab';c.beginPath();c.moveTo(-8,-10);c.lineTo(-11,-15);c.moveTo(8,-10);c.lineTo(11,-15);c.stroke();}
        c.restore();if(e.hp<e.maxHp){box(c,e.x-12,e.y-e.radius-8,24,3,1.5,'#3e3747');box(c,e.x-12,e.y-e.radius-8,Math.max(2,24*e.hp/e.maxHp),3,1.5,'#ff9b90');}
      }
      for(const b of s.enemyBullets){c.shadowColor='#f68ba5';c.shadowBlur=7;c.fillStyle=b.damage===2?'#ffe4a4':'#ff95b1';c.beginPath();c.arc(b.x,b.y,b.damage===2?5:4,0,Math.PI*2);c.fill();c.shadowBlur=0;}
      for(const p of s.pickups){const info=PICKUP_INFO[p.kind];if(p.ttl<4&&Math.sin(clock*12)<0)continue;box(c,p.x-12,p.y-12,24,24,7,'#233648');c.strokeStyle=info[1];c.lineWidth=1.5;c.stroke();text(c,info[0],p.x,p.y+5,17,info[1],800,'center');}
      if(s.upgrades.orbit){for(let n=0;n<s.upgrades.orbit;n++){const angle=clock*3+n*Math.PI*2/s.upgrades.orbit,dx=h.x+Math.cos(angle)*42,dy=h.y+Math.sin(angle)*42;c.fillStyle='#c9b1ff';c.beginPath();c.arc(dx,dy,5,0,Math.PI*2);c.fill();}}
      if(h.shield>0){c.strokeStyle='rgba(185,165,255,.65)';c.lineWidth=2;c.beginPath();c.arc(h.x,h.y,20,0,Math.PI*2);c.stroke();}
      c.save();c.translate(h.x,h.y);c.globalAlpha=h.invuln>0&&Math.sin(clock*32)<0?.45:1;
      const chassis=records.wins>0?'#7bd5df':'#ff9578';c.shadowColor=chassis;c.shadowBlur=18;box(c,-12,-13,24,25,7,chassis);c.shadowBlur=0;box(c,-9,-8,18,10,3,'#263a48');c.fillStyle='#aff6ee';c.fillRect(-6,-5,12,3);c.fillStyle='#7d5b5d';c.fillRect(-15,2,4,13);c.fillRect(11,2,4,13);c.fillStyle='#263a48';c.fillRect(-8,11,6,5);c.fillRect(2,11,6,5);
      let target=s.enemies[0];for(const e of s.enemies)if(!target||distance(e,h)<distance(target,h))target=e;
      c.rotate(target?Math.atan2(target.y-h.y,target.x-h.x):-.5);box(c,4,-3,17,6,2,'#e4cbb7');c.fillStyle='#ffe8ce';c.fillRect(17,-2,6,4);c.restore();
      box(c,h.x-15,h.y+21,30,4,2,'#36424a');if(h.hp>0)box(c,h.x-15,h.y+21,Math.max(2,30*h.hp/st.maxHp),4,2,h.hp<=2?'#ff8d91':'#8be2ca');
      for(const p of particles){c.globalAlpha=Math.min(1,p.life*3);c.fillStyle=p.color;c.fillRect(p.x-1.5,p.y-1.5,3,3);}c.globalAlpha=1;
      if(joystick){const x=joystick.x,y=joystick.y;c.strokeStyle='rgba(145,216,223,.35)';c.lineWidth=2;c.fillStyle='rgba(94,181,193,.06)';c.beginPath();c.arc(x,y,43,0,Math.PI*2);c.fill();c.stroke();c.fillStyle='rgba(153,222,224,.3)';c.beginPath();c.arc(x+joystick.dx*31,y+joystick.dy*31,15,0,Math.PI*2);c.fill();}
      if(h.invuln>.86){c.fillStyle='rgba(255,120,125,.10)';c.fillRect(24,134,372,410);}c.restore();
      text(c,activeBoss&&activeBoss.windup>0?((activeBoss.pattern||0)===0?'ÉVENTAIL : quitte les pointillés.':'ANNEAU : cherche le PASSAGE.'):s.roomTime>=ROOM_DURATION?'Nettoie les derniers drones pour avancer.':'Glisse pour bouger · ramasse les bonus.',24,568,10,'#b7c5cc',600);
      const buff=h.magnetTime>0?'Aimant '+Math.ceil(h.magnetTime)+' s':h.hasteTime>0?'Surcadence '+Math.ceil(h.hasteTime)+' s':st.shots+' tir(s) · dégâts '+st.damage+' · arc '+s.upgrades.shock+' · cryo '+s.upgrades.frost;
      text(c,buff,24,588,9,'#84c8cc',500);
      box(c,312,552,84,40,10,h.dashCooldown>0?'#283c49':'#3e6470');text(c,'ESQUIVE',354,569,9,'#d4f2ed',800,'center');text(c,h.dashCooldown>0?h.dashCooldown.toFixed(1)+' s':'PRÊTE',354,584,10,'#a0e6e2',700,'center');
      if(s.mode==='upgrade'){
        c.fillStyle='rgba(7,13,23,.85)';c.fillRect(0,0,420,600);box(c,23,154,374,363,18,'#182b38');c.strokeStyle='#42606b';c.lineWidth=1;c.stroke();
        text(c,s.rewardUpgrade?'BUTIN DE LA FORGE':'NIVEAU '+s.level,210,187,11,'#7ee2df',800,'center');text(c,'Évolution disponible',210,213,23,'#f6e9dc',800,'center');
        s.choices.forEach((id,i)=>{const info=DESCRIPTIONS[id],y=225+i*85;box(c,40,y,340,73,11,'#233b48');c.fillStyle=info[2];c.fillRect(40,y+12,3,49);text(c,info[0],56,y+25,13,info[2],800);text(c,info[1],56,y+47,10,'#c2d2d9',500);const tier=id==='repair'?'SOINS':'NIV. '+(s.upgrades[id]+1);text(c,tier,56,y+63,8,'#7d9da9',700);box(c,342,y+17,23,24,6,'#35505c');text(c,String(i+1),353.5,y+34,12,'#cce9e8',800,'center');});
        text(c,'Le temps est suspendu. Choisis une carte.',210,500,10,'#9cb8c2',500,'center');
      }
      if(s.mode==='route'){
        c.fillStyle='rgba(7,13,23,.88)';c.fillRect(0,0,420,600);box(c,23,153,374,369,18,'#182b38');text(c,'SECTEUR '+s.room+' NETTOYÉ',210,186,11,'#7ee2df',800,'center');text(c,'Choisis la suite',210,214,24,'#f6e9dc',800,'center');
        ROUTES.forEach((r,i)=>{const y=225+i*85;box(c,40,y,340,73,11,'#233b48');c.fillStyle=r[3];c.fillRect(40,y+12,3,49);text(c,r[0],56,y+24,13,r[3],800);text(c,r[1],56,y+44,11,'#d4e1e4',600);text(c,r[2],56,y+62,10,'#91b1bd',500);text(c,String(i+1),357,y+27,13,'#d4e1e4',800,'center');});
        text(c,'Tes augments restent actives pendant cette tentative.',210,506,9,'#9cb8c2',500,'center');
      }
      if(s.status!=='playing'){c.fillStyle='rgba(8,14,23,.45)';c.fillRect(24,134,372,410);text(c,s.status==='won'?'PROTOCOLE ACCOMPLI':'SIGNAL PERDU',210,334,21,'#f3e2d1',800,'center');}
      c.restore();
    }
    return{reset,update,draw,pointer,key,snapshot,restore};
  }
  if(global)global.createGame=createGame;
  if(typeof module!=='undefined'&&module.exports)module.exports={createGame,initialState,validState,stats,xpNeed,ARENA,DURATION,ROOM_COUNT,ROOM_DURATION,CAPS,MAX_ENEMIES,MAX_BULLETS,MAX_GEMS,MAX_PICKUPS,MAX_ENEMY_BULLETS,PICKUP_INFO,ROUTES};
})(typeof window!=='undefined'?window:globalThis);


