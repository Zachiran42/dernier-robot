(function (global) {
  'use strict';
  const ID='dernier-robot', DURATION=90, MAX_ENEMIES=32, MAX_BULLETS=80, MAX_GEMS=90;
  const ARENA={left:24,right:396,top:134,bottom:544};
  const CAPS={overclock:5,cannon:5,servos:4,magnet:4,armor:3,split:2,pierce:2};
  const DESCRIPTIONS={
    overclock:['SURCADENCE','Tirs 17 % plus rapides.','#ff9578'],
    cannon:['CANON RENFORCÉ','Chaque projectile inflige 1 dégât de plus.','#ffbc79'],
    servos:['SERVOMOTEURS','Déplacement plus rapide : +16 par seconde.','#79d8e6'],
    magnet:['AIMANT À FRAGMENTS','Ramasse les fragments de plus loin.','#70e2d1'],
    armor:['BLINDAGE ADAPTATIF','Vie maximale +2 et réparation +3 PV.','#b5b3ff'],
    split:['DOUBLE CIRCUIT','Un projectile supplémentaire par salve.','#ffd98d'],
    pierce:['LENTILLE PERFORANTE','Les tirs traversent un ennemi de plus.','#81dff0'],
    repair:['RÉPARATION RAPIDE','Récupère 4 points de vie.','#92e7ad']
  };
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,a,b)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
  const integer=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const xpNeed=level=>8+level*4;
  function stats(s){const u=s.upgrades;return{maxHp:6+u.armor*2,speed:150+u.servos*16,damage:2+u.cannon,interval:.46*Math.pow(.83,u.overclock),shots:1+u.split,pierce:u.pierce,magnet:48+u.magnet*28};}
  function initialState(seed){return{game:ID,version:1,status:'playing',mode:'arena',rng:seed>>>0,time:0,hero:{x:210,y:339,hp:6,invuln:0},level:1,xp:0,kills:0,spawn:.5,fire:.15,enemies:[],bullets:[],gems:[],choices:[],upgrades:Object.fromEntries(Object.keys(CAPS).map(k=>[k,0])),nextId:1};}
  function validState(s){
    if(!s||s.game!==ID||s.version!==1||!['playing','won','lost'].includes(s.status)||!['arena','upgrade'].includes(s.mode))return false;
    if(!integer(s.rng,0,4294967295)||!finite(s.time,0,DURATION)||!integer(s.level,1,100)||!integer(s.xp,0,100000)||!integer(s.kills,0,100000)||!integer(s.nextId,1,1000000))return false;
    if(!s.upgrades||typeof s.upgrades!=='object'||Array.isArray(s.upgrades)||Object.keys(CAPS).some(k=>!integer(s.upgrades[k],0,CAPS[k])))return false;
    const h=s.hero,st=stats(s);
    if(!h||!finite(h.x,ARENA.left+11,ARENA.right-11)||!finite(h.y,ARENA.top+11,ARENA.bottom-11)||!integer(h.hp,0,st.maxHp)||!finite(h.invuln,0,1.2))return false;
    if(!finite(s.spawn,-.1,2)||!finite(s.fire,-.1,2))return false;
    if(s.status==='playing'&&(h.hp===0||s.time>=DURATION))return false;
    if(s.status==='won'&&(h.hp===0||s.time!==DURATION))return false;
    if(s.status==='lost'&&h.hp!==0)return false;
    if(!Array.isArray(s.choices)||s.choices.length>3||new Set(s.choices).size!==s.choices.length||s.choices.some(k=>k!=='repair'&&(!(k in CAPS)||s.upgrades[k]>=CAPS[k])))return false;
    if(s.mode==='upgrade'&&((s.choices.length<1||s.choices.length>3)||s.status!=='playing'))return false;
    if(s.mode==='arena'&&s.choices.length!==0)return false;
    if(!Array.isArray(s.enemies)||s.enemies.length>MAX_ENEMIES||!Array.isArray(s.bullets)||s.bullets.length>MAX_BULLETS||!Array.isArray(s.gems)||s.gems.length>MAX_GEMS)return false;
    const ids=new Set();
    for(const e of s.enemies){if(!e||!integer(e.id,1,s.nextId-1)||ids.has(e.id)||!integer(e.kind,0,2)||!finite(e.x,-30,450)||!finite(e.y,80,580)||!finite(e.hp,.01,20)||!finite(e.maxHp,1,20)||e.hp>e.maxHp||!finite(e.speed,10,100)||!finite(e.radius,8,20))return false;ids.add(e.id);}
    for(const b of s.bullets){if(!b||!finite(b.x,-50,470)||!finite(b.y,80,600)||!finite(b.vx,-400,400)||!finite(b.vy,-400,400)||!finite(b.life,.000001,3)||!integer(b.damage,1,12)||!integer(b.pierce,0,2)||!Array.isArray(b.hit)||b.hit.length>3||b.hit.some(v=>!integer(v,1,s.nextId-1)))return false;}
    for(const g of s.gems)if(!g||!finite(g.x,0,420)||!finite(g.y,100,570)||!integer(g.value,1,10000))return false;
    return true;
  }
  function box(c,x,y,w,h,r,color){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();if(color){c.fillStyle=color;c.fill();}}
  function text(c,value,x,y,size,color,weight,align){c.font=(weight||500)+' '+size+'px system-ui, sans-serif';c.fillStyle=color;c.textAlign=align||'left';c.fillText(value,x,y);}
  function createGame(api){
    api=api||{};const progress=api.progress&&typeof api.progress==='object'?api.progress:(api.progress={});
    if(!progress.robot||typeof progress.robot!=='object'||Array.isArray(progress.robot))progress.robot={};const records=progress.robot;
    for(const k of ['bestTime','bestKills','wins','runs','bestLevel'])if(!finite(records[k],0,10000000))records[k]=0;
    let s=null,clock=0,joystick=null,keys=new Set(),particles=[],shake=0,ended=false,lastHud='';
    const call=(name,...args)=>{if(typeof api[name]==='function')return api[name](...args);};
    function rand(){s.rng=(Math.imul(s.rng,1664525)+1013904223)>>>0;return s.rng/4294967296;}
    function hud(){if(!s)return;const st=stats(s),values=['VIE',s.hero.hp+'/'+st.maxHp,'SURVIE',Math.floor(s.time)+' / 90 s','NIVEAU',s.level];const key=JSON.stringify(values);if(key!==lastHud){lastHud=key;call('hud',...values);}}
    function burst(x,y,color,count){for(let i=0;i<count&&particles.length<90;i++){const a=i*2.399963+clock*9;particles.push({x,y,vx:Math.cos(a)*(25+i*4),vy:Math.sin(a)*(25+i*4),life:.35+i*.025,color});}}
    function finish(won){if(ended||!s||s.status!=='playing')return;ended=true;s.status=won?'won':'lost';s.mode='arena';s.choices=[];joystick=null;keys.clear();records.bestTime=Math.max(records.bestTime,s.time);records.bestKills=Math.max(records.bestKills,s.kills);records.bestLevel=Math.max(records.bestLevel,s.level);records.runs++;if(won)records.wins++;hud();call('save');const score=Math.floor(s.time*10)+s.kills*20+(s.level-1)*100+(won?1000:0);call('end',won?'Toujours debout !':'Circuit interrompu',won?'90 secondes survécues · '+s.kills+' drones neutralisés. Le châssis cyan est débloqué.':Math.floor(s.time)+' secondes de survie · '+s.kills+' drones neutralisés. Bouge pour éviter l’encerclement.',score,won);}
    function reset(){const rng=typeof api.random==='function'?api.random:Math.random;let n=Number(rng());if(!Number.isFinite(n))n=.5;s=initialState(Math.floor(clamp(n,0,.9999999999)*4294967296));joystick=null;keys.clear();particles=[];clock=0;shake=0;ended=false;lastHud='';hud();call('save');}
    function offerUpgrade(){const need=xpNeed(s.level);if(s.xp<need||s.mode!=='arena')return;s.xp-=need;s.level++;let pool=Object.keys(CAPS).filter(k=>s.upgrades[k]<CAPS[k]);if(s.hero.hp<stats(s).maxHp)pool.push('repair');for(let i=pool.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}if(!pool.length)pool=['repair'];s.choices=pool.slice(0,3);s.mode='upgrade';joystick=null;keys.clear();hud();call('save');}
    function choose(index){if(!s||s.status!=='playing'||s.mode!=='upgrade'||!integer(index,0,s.choices.length-1))return false;const id=s.choices[index];if(id==='repair')s.hero.hp=Math.min(stats(s).maxHp,s.hero.hp+4);else{s.upgrades[id]=Math.min(CAPS[id],s.upgrades[id]+1);s.hero.hp=Math.min(stats(s).maxHp,s.hero.hp+(id==='armor'?3:1));}s.mode='arena';s.choices=[];s.hero.invuln=Math.max(s.hero.invuln,.65);joystick=null;keys.clear();burst(s.hero.x,s.hero.y,DESCRIPTIONS[id][2],18);call('toast',DESCRIPTIONS[id][0]+' installé.');hud();call('save');return true;}
    function spawn(){
      if(s.enemies.length>=MAX_ENEMIES)return;const h=s.hero;let p;
      for(let tries=0;tries<12;tries++){const edge=Math.floor(rand()*4),along=rand();p=edge===0?{x:ARENA.left-14,y:ARENA.top+along*(ARENA.bottom-ARENA.top)}:edge===1?{x:ARENA.right+14,y:ARENA.top+along*(ARENA.bottom-ARENA.top)}:edge===2?{x:ARENA.left+along*(ARENA.right-ARENA.left),y:ARENA.top-14}:{x:ARENA.left+along*(ARENA.right-ARENA.left),y:ARENA.bottom+14};if(distance(p,h)>=110)break;}
      if(distance(p,h)<110)p=[{x:12,y:120},{x:408,y:120},{x:12,y:558},{x:408,y:558}].sort((a,b)=>distance(b,h)-distance(a,h))[0];
      const roll=rand(),kind=s.time>35&&roll<.22?2:s.time>12&&roll<.52?1:0;
      const hp=kind===2?8+(s.time>65?2:0):kind===1?2+(s.time>60?1:0):3+(s.time>50?1:0),speed=kind===2?26+Math.min(6,s.time*.1):kind===1?64+Math.min(10,s.time*.1):34+Math.min(9,s.time*.1);
      s.enemies.push({id:s.nextId++,x:p.x,y:p.y,kind,hp,maxHp:hp,speed,radius:kind===2?16:kind===1?9:12});
    }
    function fire(st){if(!s.enemies.length)return;const h=s.hero;let nearest=s.enemies[0];for(const e of s.enemies)if(distance(e,h)<distance(nearest,h))nearest=e;const angle=Math.atan2(nearest.y-h.y,nearest.x-h.x);for(let i=0;i<st.shots&&s.bullets.length<MAX_BULLETS;i++){const a=angle+(i-(st.shots-1)/2)*.13;s.bullets.push({x:h.x+Math.cos(a)*13,y:h.y+Math.sin(a)*13,vx:Math.cos(a)*340,vy:Math.sin(a)*340,damage:st.damage,pierce:st.pierce,life:2,hit:[]});}}
    function drop(e){const p={x:clamp(e.x,ARENA.left,ARENA.right),y:clamp(e.y,ARENA.top,ARENA.bottom),value:e.kind===2?5:e.kind===1?3:2};if(s.gems.length<MAX_GEMS)s.gems.push(p);else{s.gems.reduce((a,b)=>distance(a,p)<distance(b,p)?a:b).value+=p.value;}s.kills++;burst(e.x,e.y,e.kind===2?'#ff9578':'#7bd8e2',7);}
    function movement(){let x=(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')||keys.has('q')?1:0),y=(keys.has('arrowdown')||keys.has('s')?1:0)-(keys.has('arrowup')||keys.has('w')||keys.has('z')?1:0);if(!x&&!y&&joystick){x=joystick.dx;y=joystick.dy;}const length=Math.hypot(x,y);return length>1?{x:x/length,y:y/length}:{x,y};}
    function tick(dt){
      if(s.status!=='playing'||s.mode!=='arena')return;const st=stats(s),h=s.hero,v=movement();s.time=Math.min(DURATION,s.time+dt);h.x=clamp(h.x+v.x*st.speed*dt,ARENA.left+11,ARENA.right-11);h.y=clamp(h.y+v.y*st.speed*dt,ARENA.top+11,ARENA.bottom-11);h.invuln=Math.max(0,h.invuln-dt);
      s.spawn-=dt;if(s.spawn<=0){spawn();s.spawn+=Math.max(.38,.95-s.time*.006);}s.fire-=dt;if(s.fire<=0){fire(st);s.fire+=st.interval;}
      for(const e of s.enemies){const dx=h.x-e.x,dy=h.y-e.y,d=Math.hypot(dx,dy)||1;e.x+=dx/d*e.speed*dt;e.y+=dy/d*e.speed*dt;}
      for(const b of s.bullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.x<0||b.x>420||b.y<110||b.y>570)b.life=0;if(b.life<=0)continue;for(const e of s.enemies){if(e.hp<=0||b.hit.includes(e.id))continue;if(distance(b,e)<e.radius+3){e.hp-=b.damage;b.hit.push(e.id);burst(b.x,b.y,'#ffd5b1',2);if(e.hp<=0)drop(e);if(b.pierce>0)b.pierce--;else{b.life=0;break;}}}}
      s.bullets=s.bullets.filter(b=>b.life>0);s.enemies=s.enemies.filter(e=>e.hp>0);
      for(const e of s.enemies)if(distance(e,h)<e.radius+10&&h.invuln<=0){h.hp--;h.invuln=1.1;shake=.22;const dx=e.x-h.x,dy=e.y-h.y,d=Math.hypot(dx,dy)||1;e.x=clamp(e.x+dx/d*22,0,420);e.y=clamp(e.y+dy/d*22,110,570);burst(h.x,h.y,'#ff7f8d',12);if(h.hp<=0){finish(false);return;}break;}
      for(const gem of s.gems){const dx=h.x-gem.x,dy=h.y-gem.y,d=Math.hypot(dx,dy);if(d<st.magnet&&d>0){const travel=Math.min(d,230*dt);gem.x+=dx/d*travel;gem.y+=dy/d*travel;}if(distance(gem,h)<14){s.xp+=gem.value;gem.value=0;}}
      s.gems=s.gems.filter(g=>g.value>0);if(s.time>=DURATION){finish(true);return;}offerUpgrade();
    }
    function update(dt){dt=clamp(Number(dt)||0,0,.1);clock+=dt;shake=Math.max(0,shake-dt);for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;}particles=particles.filter(p=>p.life>0);if(!s||s.status!=='playing'||s.mode==='upgrade')return;let left=dt;while(left>1e-9&&s.status==='playing'&&s.mode==='arena'){const step=Math.min(left,1/60);tick(step);left-=step;}hud();}
    function pointer(type,x,y){if(type==='cancel'){joystick=null;return;}if(!s||s.status!=='playing')return;if(s.mode==='upgrade'){if(type==='down'&&x>=40&&x<=380){const i=Math.floor((y-225)/85);if(i>=0&&i<3&&y<=225+i*85+73)choose(i);}return;}if(type==='down'){joystick={x:clamp(x,50,370),y:clamp(y,160,514),dx:0,dy:0};}else if(type==='move'&&joystick){const dx=x-joystick.x,dy=y-joystick.y,d=Math.hypot(dx,dy);joystick.dx=d>5?dx/Math.max(45,d):0;joystick.dy=d>5?dy/Math.max(45,d):0;}else if(type==='up')joystick=null;}
    function key(value,down){const k=String(value).toLowerCase();if(!down){keys.delete(k);return;}if(!s||s.status!=='playing')return;if(s.mode==='upgrade'){if(['1','2','3'].includes(k))choose(Number(k)-1);else if(k==='enter')choose(0);return;}keys.add(k);}
    function snapshot(){return s?clone(s):null;}
    function restore(data){try{if(!validState(data))return false;s=clone(data);ended=s.status!=='playing';joystick=null;keys.clear();particles=[];shake=0;lastHud='';hud();return true;}catch(_){return false;}}
    function draw(c){
      c.save();c.textBaseline='alphabetic';c.clearRect(0,0,420,600);const bg=c.createLinearGradient(0,0,420,600);bg.addColorStop(0,'#211d29');bg.addColorStop(1,'#0b1721');c.fillStyle=bg;c.fillRect(0,0,420,600);
      text(c,'SECTEUR 09 · PROTOCOLE SURVIE',24,27,10,'#bf9e9e',700);text(c,'Dernier Robot',24,61,28,'#f8e8dd',800);
      if(!s){text(c,'Initialisation…',210,330,16,'#9abcc9',600,'center');c.restore();return;}
      const st=stats(s),h=s.hero,remaining=Math.max(0,Math.ceil(DURATION-s.time));
      box(c,338,30,58,37,11,'#3c2c37');text(c,String(remaining).padStart(2,'0')+'s',367,55,19,'#ffb097',800,'center');
      box(c,24,84,372,8,4,'#2b3544');const fraction=Math.min(1,s.xp/xpNeed(s.level));if(fraction>0)box(c,24,84,Math.max(8,372*fraction),8,4,'#75d6dc');
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
        c.save();c.translate(e.x,e.y);c.fillStyle='rgba(0,0,0,.27)';c.beginPath();c.ellipse(0,e.radius*.7,e.radius+3,e.radius*.45,0,0,Math.PI*2);c.fill();
        if(e.kind===2){c.fillStyle='#ba786c';c.strokeStyle='#ffb392';c.lineWidth=2;c.beginPath();for(let j=0;j<6;j++){const a=j*Math.PI/3;if(!j)c.moveTo(Math.cos(a)*16,Math.sin(a)*16);else c.lineTo(Math.cos(a)*16,Math.sin(a)*16);}c.closePath();c.fill();c.stroke();c.fillStyle='#452d38';c.fillRect(-10,-5,20,10);c.fillStyle='#ffc29a';c.fillRect(-7,-2,14,3);}
        else if(e.kind===1){c.rotate(Math.atan2(h.y-e.y,h.x-e.x));c.fillStyle='#9e8ecb';c.strokeStyle='#d5bcff';c.lineWidth=1.5;c.beginPath();c.moveTo(12,0);c.lineTo(-8,-9);c.lineTo(-4,0);c.lineTo(-8,9);c.closePath();c.fill();c.stroke();c.fillStyle='#f6deff';c.fillRect(2,-2,4,4);}
        else{c.fillStyle='#b77788';c.strokeStyle='#f0a3ab';c.lineWidth=1.5;box(c,-11,-10,22,20,6,'#b77788');c.stroke();c.fillStyle='#432a3d';c.fillRect(-8,-4,16,7);c.fillStyle='#ffb9b7';c.fillRect(-5,-2,3,3);c.fillRect(2,-2,3,3);c.strokeStyle='#f0a3ab';c.beginPath();c.moveTo(-8,-10);c.lineTo(-11,-15);c.moveTo(8,-10);c.lineTo(11,-15);c.stroke();}
        c.restore();if(e.hp<e.maxHp){box(c,e.x-12,e.y-e.radius-8,24,3,1.5,'#3e3747');box(c,e.x-12,e.y-e.radius-8,Math.max(2,24*e.hp/e.maxHp),3,1.5,'#ff9b90');}
      }
      c.save();c.translate(h.x,h.y);c.globalAlpha=h.invuln>0&&Math.sin(clock*32)<0?.45:1;
      const chassis=records.wins>0?'#7bd5df':'#ff9578';c.shadowColor=chassis;c.shadowBlur=18;box(c,-12,-13,24,25,7,chassis);c.shadowBlur=0;box(c,-9,-8,18,10,3,'#263a48');c.fillStyle='#aff6ee';c.fillRect(-6,-5,12,3);c.fillStyle='#7d5b5d';c.fillRect(-15,2,4,13);c.fillRect(11,2,4,13);c.fillStyle='#263a48';c.fillRect(-8,11,6,5);c.fillRect(2,11,6,5);
      let target=s.enemies[0];for(const e of s.enemies)if(!target||distance(e,h)<distance(target,h))target=e;
      c.rotate(target?Math.atan2(target.y-h.y,target.x-h.x):-.5);box(c,4,-3,17,6,2,'#e4cbb7');c.fillStyle='#ffe8ce';c.fillRect(17,-2,6,4);c.restore();
      box(c,h.x-15,h.y+21,30,4,2,'#36424a');if(h.hp>0)box(c,h.x-15,h.y+21,Math.max(2,30*h.hp/st.maxHp),4,2,h.hp<=2?'#ff8d91':'#8be2ca');
      for(const p of particles){c.globalAlpha=Math.min(1,p.life*3);c.fillStyle=p.color;c.fillRect(p.x-1.5,p.y-1.5,3,3);}c.globalAlpha=1;
      if(joystick){const x=joystick.x,y=joystick.y;c.strokeStyle='rgba(145,216,223,.35)';c.lineWidth=2;c.fillStyle='rgba(94,181,193,.06)';c.beginPath();c.arc(x,y,43,0,Math.PI*2);c.fill();c.stroke();c.fillStyle='rgba(153,222,224,.3)';c.beginPath();c.arc(x+joystick.dx*31,y+joystick.dy*31,15,0,Math.PI*2);c.fill();}
      if(h.invuln>.86){c.fillStyle='rgba(255,120,125,.10)';c.fillRect(24,134,372,410);}c.restore();
      text(c,'Maintiens et glisse pour te déplacer · tirs automatiques',210,570,11,'#b7c5cc',600,'center');
      text(c,records.wins>0?'Châssis cyan équipé · Ramasse les fragments lumineux.':'Ramasse les fragments pour améliorer ton robot.',210,590,10,'#728e9e',500,'center');
      if(s.mode==='upgrade'){
        c.fillStyle='rgba(7,13,23,.85)';c.fillRect(0,0,420,600);box(c,23,154,374,363,18,'#182b38');c.strokeStyle='#42606b';c.lineWidth=1;c.stroke();
        text(c,'NIVEAU '+s.level,210,187,11,'#7ee2df',800,'center');text(c,'Évolution disponible',210,213,23,'#f6e9dc',800,'center');
        s.choices.forEach((id,i)=>{const info=DESCRIPTIONS[id],y=225+i*85;box(c,40,y,340,73,11,'#233b48');c.fillStyle=info[2];c.fillRect(40,y+12,3,49);text(c,info[0],56,y+25,13,info[2],800);text(c,info[1],56,y+47,10,'#c2d2d9',500);const tier=id==='repair'?'SOINS':'NIV. '+(s.upgrades[id]+1);text(c,tier,56,y+63,8,'#7d9da9',700);box(c,342,y+17,23,24,6,'#35505c');text(c,String(i+1),353.5,y+34,12,'#cce9e8',800,'center');});
        text(c,'Le temps est suspendu. Choisis une carte.',210,500,10,'#9cb8c2',500,'center');
      }
      if(s.status!=='playing'){c.fillStyle='rgba(8,14,23,.45)';c.fillRect(24,134,372,410);text(c,s.status==='won'?'PROTOCOLE ACCOMPLI':'SIGNAL PERDU',210,334,21,'#f3e2d1',800,'center');}
      c.restore();
    }
    return{reset,update,draw,pointer,key,snapshot,restore};
  }
  if(global)global.createGame=createGame;
  if(typeof module!=='undefined'&&module.exports)module.exports={createGame,initialState,validState,stats,xpNeed,ARENA,DURATION,CAPS,MAX_ENEMIES,MAX_BULLETS,MAX_GEMS};
})(typeof window!=='undefined'?window:globalThis);

