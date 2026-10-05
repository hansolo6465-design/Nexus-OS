/* ================= helpers & state ================= */
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rnd=(a,b)=>Math.floor(Math.random()*(b-a+1))+a,pick=a=>a[Math.floor(Math.random()*a.length)];
const hex=n=>[...Array(n)].map(()=>rnd(0,255).toString(16).padStart(2,'0')).join('');
const ip=()=>`${rnd(11,223)}.${rnd(0,255)}.${rnd(0,255)}.${rnd(1,254)}`;
const TAU=Math.PI*2,norm=s=>s.toLowerCase().replace(/[^a-z]/g,'');
const S={power:false,sound:true,stream:true,busy:false,alert:0,override:0,t0:Date.now()};
const C={c:'#39ff14',alt:'#ffb000',err:'#ff3b3b'};
const readColors=()=>{const g=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();C.c=g('--c');C.alt=g('--alt');C.err=g('--err')};
function fitCanvas(c){const d=Math.min(2,devicePixelRatio||1),w=c.clientWidth,h=c.clientHeight;if(!w||!h)return;c.width=w*d;c.height=h*d;c.getContext('2d').setTransform(d,0,0,d,0,0);c._w=w;c._h=h}
const ro=new ResizeObserver(es=>es.forEach(e=>fitCanvas(e.target)));$$('#viz,#radar').forEach(c=>{fitCanvas(c);ro.observe(c)});

/* ================= audio engine (Web Audio) ================= */
let AC,master,sfxBus,musicBus,padBus,analyser,noiseBuf;const eq=[];
function initAudio(){
  if(!AC){
    AC=new (window.AudioContext||window.webkitAudioContext)();
    master=AC.createGain();master.gain.value=S.sound?1:0;master.connect(AC.destination);
    sfxBus=AC.createGain();sfxBus.gain.value=.55;sfxBus.connect(master);
    musicBus=AC.createGain();musicBus.gain.value=$('#aVol').value/100;
    padBus=AC.createGain();padBus.connect(musicBus);
    [['lowshelf',140],['peaking',1100],['highshelf',5200]].forEach(([t,f],i)=>{const n=AC.createBiquadFilter();n.type=t;n.frequency.value=f;n.gain.value=+$$('[data-eq]')[i].value;eq.push(n)});
    musicBus.connect(eq[0]);eq[0].connect(eq[1]);eq[1].connect(eq[2]);
    analyser=AC.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.82;
    eq[2].connect(analyser);analyser.connect(master);
    noiseBuf=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  }
  if(AC.state==='suspended')AC.resume();
}
function tone(f,d,type,v,t0=0,dest){const t=AC.currentTime+t0,o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.setValueAtTime(f,t);g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0008,t+d);o.connect(g);g.connect(dest||sfxBus);o.start(t);o.stop(t+d+.03)}
function sweep(f0,f1,d,type,v,t0=0){const t=AC.currentTime+t0,o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+d);g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0008,t+d);o.connect(g);g.connect(sfxBus);o.start(t);o.stop(t+d+.03)}
function nz(d,v,fq,t0=0,dest,type='highpass'){const t=AC.currentTime+t0,s=AC.createBufferSource(),f=AC.createBiquadFilter(),g=AC.createGain();s.buffer=noiseBuf;f.type=type;f.frequency.value=fq;g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0008,t+d);s.connect(f);f.connect(g);g.connect(dest||sfxBus);s.start(t,Math.random()*.5);s.stop(t+d+.03)}
const SFX={
  key(){nz(.025,.25,2500);tone(rnd(700,1100),.025,'square',.03)},
  tick(){tone(2000,.012,'square',.02)},
  click(){nz(.015,.3,1200);tone(220,.03,'square',.06)},
  beep(){tone(990,.08,'square',.1)},
  ping(){tone(1600,.3,'sine',.1)},
  ok(){[523,659,784,1047].forEach((f,i)=>tone(f,.12,'square',.09,i*.07))},
  err(){tone(150,.3,'sawtooth',.2);tone(110,.35,'sawtooth',.2,.12)},
  alarm(){for(let i=0;i<4;i++){tone(900,.14,'square',.14,i*.3);tone(600,.14,'square',.14,i*.3+.15)}},
  on(){sweep(40,900,.5,'sawtooth',.18);nz(.7,.25,800,.1)},
  off(){sweep(900,30,.5,'sawtooth',.18);nz(.4,.2,1500)},
  squelch(){nz(.6,.25,1800,0,null,'bandpass');tone(1200,.05,'square',.08,.55)}
};
Object.keys(SFX).forEach(k=>{const f=SFX[k];SFX[k]=(...a)=>{if(AC&&S.sound)f(...a)}});

/* ---- synthwave sequencer: kick, snare, hats, bass, arp, pad ---- */
const M={play:false,step:0,next:0,bpm:100,timer:null};
const mtof=m=>440*Math.pow(2,(m-69)/12);
const CH=[{b:45,a:[57,60,64,67]},{b:41,a:[53,57,60,65]},{b:48,a:[55,60,64,67]},{b:43,a:[55,59,62,67]}]; // Am F C G
function note(f,t,d,type,v,cut,dest,det=0,att=.01){const o=AC.createOscillator(),fl=AC.createBiquadFilter(),g=AC.createGain();o.type=type;o.frequency.value=f;o.detune.value=det;fl.type='lowpass';fl.frequency.value=cut;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(v,t+att);g.gain.exponentialRampToValueAtTime(.0008,t+d);o.connect(fl);fl.connect(g);g.connect(dest||musicBus);o.start(t);o.stop(t+d+.05)}
function kick(t){const o=AC.createOscillator(),g=AC.createGain();o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(42,t+.14);g.gain.setValueAtTime(.9,t);g.gain.exponentialRampToValueAtTime(.001,t+.28);o.connect(g);g.connect(musicBus);o.start(t);o.stop(t+.3)}
function schedule(){
  const spb=60/M.bpm/4;
  while(M.next<AC.currentTime+.15){
    const t=M.next,s=M.step,i=s%16,ch=CH[Math.floor(s/16)%4],dt=t-AC.currentTime;
    if(i%4===0)kick(t);
    if(i===4||i===12)nz(.16,.35,1400,dt,musicBus);
    if(i%2===1)nz(.04,.1,7000,dt,musicBus);
    if(i%2===0)note(mtof(ch.b+(i%8===6?12:0)),t,spb*1.8,'sawtooth',.3,420,musicBus);
    note(mtof(ch.a[[0,1,2,3,2,1,2,3][i%8]]+(i>=8?12:0)),t,spb*1.5,'square',.06,2600,musicBus,i%2?6:-6);
    if(i===0)[0,1,2].forEach(k=>note(mtof(ch.a[k]-12),t,spb*16,'sawtooth',.045,900,padBus,k*6-6,.5));
    M.next+=spb;M.step++;
  }
}
function musicStart(){initAudio();if(M.play)return;M.play=true;M.next=AC.currentTime+.05;M.step=0;padBus.gain.cancelScheduledValues(AC.currentTime);padBus.gain.setValueAtTime(1,AC.currentTime);M.timer=setInterval(schedule,25);$('#aPlay').textContent='❚❚ PAUSE'}
function musicStop(){if(!M.play)return;M.play=false;clearInterval(M.timer);padBus.gain.setTargetAtTime(0,AC.currentTime,.05);$('#aPlay').textContent='▶ PLAY'}
$('#aPlay').onclick=()=>{initAudio();SFX.click();M.play?musicStop():musicStart()};
$('#aVol').oninput=e=>{if(musicBus)musicBus.gain.value=e.target.value/100};
$('#aBpm').oninput=e=>{M.bpm=+e.target.value;$('#bpmV').textContent=M.bpm+' BPM'};
$$('[data-eq]').forEach((el,i)=>el.oninput=()=>{if(eq[i])eq[i].gain.value=+el.value});

/* ---- frequency visualizer ---- */
function drawViz(t){
  const c=$('#viz'),x=c._w&&c.getContext('2d');if(!x)return;const W=c._w,H=c._h;x.clearRect(0,0,W,H);
  const N=40,bw=W/N;let data=null;if(analyser&&M.play){data=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(data)}
  for(let i=0;i<N;i++){
    const v=data?data[Math.floor(Math.pow(i/N,1.6)*data.length*.8)]/255:.05+.03*Math.sin(t/400+i*.5),h=Math.max(2,v*H);
    for(let y=0;y<h;y+=7){const r=y/H;x.fillStyle=r>.8?C.err:r>.55?C.alt:C.c;x.fillRect(i*bw+1,H-y-5,bw-2,5)}
  }
}

/* ================= console ================= */
const out=$('#out'),cmd=$('#cmd'),hist=[];let hi=0;
function line(txt,cls=''){const d=document.createElement('div');d.className='ln '+cls;d.textContent=txt;out.appendChild(d);while(out.children.length>300)out.firstChild.remove();out.scrollTop=out.scrollHeight;return d}
async function typeLine(txt,cls='',ms=8){const d=line('',cls);for(let i=0;i<txt.length;i+=2){d.textContent=txt.slice(0,i+2);if(i%6===0)SFX.tick();out.scrollTop=out.scrollHeight;await sleep(ms)}}
async function bar(label,ms,cls=''){const d=line('',cls),n=24;for(let i=0;i<=n;i++){d.textContent=`${label} [${'█'.repeat(i)}${'░'.repeat(n-i)}] ${Math.round(i/n*100)}%`;if(i%3===0)SFX.tick();out.scrollTop=out.scrollHeight;await sleep(ms/n)}}

/* ---- data ---- */
const SVC=[[22,'ssh'],[23,'telnet'],[80,'http'],[443,'https'],[3306,'mysql'],[5900,'vnc'],[8080,'proxy'],[31337,'backdoor']];
const pickPorts=()=>[...SVC].sort(()=>Math.random()-.5).slice(0,3).map(p=>p.join('/'));
const NODES=[['tokyo','NEO-TOKYO',35.7,139.7,4],['nyc','NYC-ARCOLOGY',40.7,-74,5],['london','LONDON-GRID',51.5,-.1,3],['mumbai','MUMBAI-HIVE',19.1,72.9,2],['reykjavik','REYKJAVIK-VLT',64.1,-21.9,3],['cape','CAPE-RELAY',-33.9,18.4,1],['sao','SAO-PAULO-X',-23.5,-46.6,2],['sydney','SYDNEY-DOCK',-33.9,151.2,4]]
  .map(([id,name,lat,lon,sec])=>({id,name,lat,lon,sec,ip:ip(),ping:rnd(18,240),status:sec>=4?'HOSTILE':'ONLINE',ports:pickPorts(),scanned:false,compromised:false}));
function findNode(q){q=norm(q||'');if(!q)return null;return NODES.find(n=>n.id===q)||NODES.find(n=>norm(n.name).startsWith(q))||NODES.find(n=>n.id.startsWith(q))}

const SCHEM=`<svg class="sch" viewBox="0 0 300 160" fill="none" stroke="currentColor" stroke-width="1.2"><polygon points="150,10 220,40 220,110 150,150 80,110 80,40"/><circle cx="150" cy="80" r="26"/><circle cx="150" cy="80" r="8"/><path d="M150 54V22M176 80H220M150 106V150M124 80H80M168 62L205 42M132 98L95 118"/><path d="M10 40H80M10 110H80M220 40H290M220 110H290"/><text x="12" y="34" font-size="8" fill="currentColor" stroke="none">SPIKE-A</text><text x="236" y="34" font-size="8" fill="currentColor" stroke="none">CORTEX-IO</text><text x="12" y="124" font-size="8" fill="currentColor" stroke="none">PWR 3.3V</text><text x="236" y="124" font-size="8" fill="currentColor" stroke="none">SYNAPSE-BUS</text></svg>`;
const FILES=[
 {id:'dos-017',type:'DOSSIER',title:'OPERATION GLASS RAIN',pin:'2077',hint:'THE YEAR THE GRID FELL',node:'london',
  body:`CLASSIFICATION: OMEGA-BLACK\nOPERATION: GLASS RAIN\nSTATUS: ACTIVE // DO NOT ARCHIVE\n\nPHASE 1 - Seed 4,200 sleeper daemons across the Ghostnet backbone via compromised relay stations.\nPHASE 2 - On trigger word "GLASS", all arcology HVAC and transit grids fall under single-operator control.\nPHASE 3 - Extract Dr. Imura from the Neo-Tokyo spire before the 04:00 purge.\n\nHANDLER: SPECTER-9. BURN AFTER READING.`},
 {id:'sch-a9',type:'SCHEMATIC',title:'NEURAL SPIKE MK-II',pin:'1337',hint:'ELITE, WRITTEN IN LEET',node:'tokyo',kind:'svg',
  body:`NEURAL SPIKE MK-II // cortical interface\nBANDWIDTH ..... 4.2 Tbps\nLATENCY ....... 0.3 ms\nWARNING: prolonged use causes affect bleed and phantom memories.`},
 {id:'aud-03',type:'AUDIO LOG',title:'CPT. VOSS - LAST TX',pin:'0451',hint:'FAHRENHEIT BOOK-BURN, PADDED WITH A ZERO',node:'reykjavik',kind:'audio',
  body:`[02:14:07] This is Captain Voss, last known position beyond the Karman relay. Reactor three is gone. The crew is quiet. We found the signal source. It was not a machine. Repeat, it was not a machine. If anyone receives this, do not follow the beacon. Do not follow the beacon.`},
 {id:'dos-042',type:'DOSSIER',title:'PROJECT LAZARUS',pin:'8086',hint:'THE CHIP THAT STARTED IT ALL',node:'cape',
  body:`CLASSIFICATION: OMEGA-BLACK\nPROJECT: LAZARUS\n\nSubject 0xA7 consciousness upload reached 71% fidelity before cascade failure.\nSubject repeats a single phrase on every channel:\n\n   "the rain is made of glass"\n\nRECOMMENDATION: sever all links to GLASS RAIN until origin is traced.`}
];

/* ================= node map (polar radar) ================= */
let SEL=null;
const proj=(n,W,H)=>{const R=Math.min(W,H)/2-16,r=(90-n.lat)/150*R,a=(n.lon-90)*Math.PI/180;return{x:W/2+r*Math.cos(a),y:H/2+r*Math.sin(a),a:((a%TAU)+TAU)%TAU}};
function drawRadar(t){
  const c=$('#radar');if(!c._w)return;const x=c.getContext('2d'),W=c._w,H=c._h,cx=W/2,cy=H/2,R=Math.min(W,H)/2-16;x.clearRect(0,0,W,H);
  x.strokeStyle=C.c;x.fillStyle=C.c;x.lineWidth=1;x.globalAlpha=.35;
  [60,30,0,-30,-60].forEach(l=>{x.beginPath();x.arc(cx,cy,(90-l)/150*R,0,TAU);x.stroke()});
  for(let a=0;a<12;a++){const th=a*TAU/12;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+R*Math.cos(th),cy+R*Math.sin(th));x.stroke()}
  const sw=(t*.00045)%TAU;
  for(let k=0;k<40;k++){x.globalAlpha=.2*(1-k/40);x.beginPath();x.moveTo(cx,cy);x.arc(cx,cy,R,sw-(k+1)*.02,sw-k*.02);x.closePath();x.fill()}
  x.globalAlpha=.9;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+R*Math.cos(sw),cy+R*Math.sin(sw));x.stroke();
  x.font='10px "Share Tech Mono",monospace';
  NODES.forEach(n=>{
    const p=proj(n,W,H),ph=(((sw-p.a)%TAU)+TAU)%TAU;
    if(n._ph!==undefined&&ph<n._ph-Math.PI){n._rip=t;if(n===SEL)SFX.ping()}   // sweep just passed -> ping ripple
    n._ph=ph;const col=n.compromised?C.alt:n.status==='HOSTILE'?C.err:C.c;x.fillStyle=x.strokeStyle=col;
    if(n._rip&&t-n._rip<1300){const k=(t-n._rip)/1300;x.globalAlpha=1-k;x.beginPath();x.arc(p.x,p.y,4+k*22,0,TAU);x.stroke()}
    x.globalAlpha=.35+.65*(1-ph/TAU);x.beginPath();x.arc(p.x,p.y,n===SEL?5:3.5,0,TAU);x.fill();
    x.globalAlpha=.8;x.fillText(n.name,p.x+8,p.y+3);
    if(n===SEL){x.globalAlpha=1;const s=11+Math.sin(t/150)*2;x.strokeRect(p.x-s,p.y-s,s*2,s*2)}
  });x.globalAlpha=1;
}
$('#radar').onclick=e=>{const c=e.currentTarget,r=c.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;let best=null,bd=20;
  NODES.forEach(n=>{const p=proj(n,c._w,c._h),d=Math.hypot(p.x-mx,p.y-my);if(d<bd){bd=d;best=n}});
  if(best){select(best);if(!S.busy)line(`> target acquired: ${best.name} (${best.ip})`,'ok')}};
function select(n){SEL=n;renderCard();SFX.beep()}
function renderCard(){
  const c=$('#card'),n=SEL;
  $('#mapInfo').textContent=`${NODES.length} NODES / ${NODES.filter(n=>n.compromised).length} OWNED`;
  if(!n){c.innerHTML='<p class="dim">CLICK A NODE ON THE RADAR TO ACQUIRE A TARGET.</p>';return}
  const st=n.compromised?['comp','COMPROMISED']:n.status==='HOSTILE'?['host','HOSTILE']:['on','ONLINE'];
  c.innerHTML=`<div class="ch"><b>${n.name}</b><span class="st ${st[0]}">${st[1]}</span></div><dl><dt>ID</dt><dd>${n.id}</dd><dt>IP</dt><dd>${n.ip}</dd><dt>COORD</dt><dd>${n.lat.toFixed(1)}, ${n.lon.toFixed(1)}</dd><dt>ICE</dt><dd>${'▮'.repeat(n.sec)}${'▯'.repeat(5-n.sec)}</dd><dt>PING</dt><dd>${n.ping} ms</dd><dt>PORTS</dt><dd>${n.scanned?n.ports.join(' '):'UNSCANNED'}</dd></dl><div class="cb"><button data-a="ping">PING</button><button data-a="scan">SCAN</button><button data-a="hack">HACK</button></div>`;
}
$('#card').onclick=e=>{const a=e.target.dataset.a;if(a&&SEL)run(`${a} ${SEL.id}`)};

/* ================= vault ================= */
let pinFile=null,pinBuf='',tries=0,lockUntil=0,vTok=0;
function renderFiles(){
  $('#files').innerHTML=FILES.map(f=>`<li data-id="${f.id}" class="${f.unlocked?'open':'locked'}"><span class="ic">${f.unlocked?'◈':'▣'}</span><b>${f.id}</b><span>${f.title}</span><em>${f.type}</em></li>`).join('');
  $('#vaultState').textContent=`${FILES.filter(f=>f.unlocked).length}/${FILES.length} UNLOCKED`;
}
$('#files').onclick=e=>{const li=e.target.closest('li');if(li){SFX.click();openFile(FILES.find(f=>f.id===li.dataset.id))}};
$('#keys').innerHTML=[1,2,3,4,5,6,7,8,9,'CLR',0,'ENT'].map(k=>`<button data-k="${k}">${k}</button>`).join('');
$('#keys').onclick=e=>{const k=e.target.dataset.k;if(k!==undefined)pinKey(k)};
$('#pinCancel').onclick=()=>{SFX.click();closePin()};
const drawDots=()=>$$('#pinDots i').forEach((d,i)=>d.classList.toggle('f',i<pinBuf.length));
function openFile(f){
  if(f.unlocked)return showFile(f);
  if(Date.now()<lockUntil){SFX.err();$('#viewer').innerHTML=`<p class="err">KEYPAD LOCKED - ${Math.ceil((lockUntil-Date.now())/1000)}S REMAINING</p>`;return}
  pinFile=f;pinBuf='';$('#pinTitle').textContent=`${f.id} - ENTER PIN`;$('#pinHint').textContent='HINT: '+f.hint;$('#pinMsg').textContent='';drawDots();$('#pin').hidden=false;if(document.activeElement)document.activeElement.blur();
}
function closePin(){$('#pin').hidden=true;pinFile=null;pinBuf=''}
function pinKey(k){
  if(k==='ENT')return pinSubmit();
  if(k==='CLR'){pinBuf='';SFX.click()}else if(pinBuf.length<4){pinBuf+=k;SFX.key()}
  drawDots();if(pinBuf.length===4)setTimeout(()=>{if(pinBuf.length===4&&pinFile)pinSubmit()},180);
}
function pinSubmit(){
  if(!pinFile)return;if(pinBuf.length<4){$('#pinMsg').textContent='ENTER 4 DIGITS';SFX.err();return}
  const f=pinFile;
  if(pinBuf===f.pin){closePin();unlock(f,'PIN')}
  else{
    tries++;pinBuf='';drawDots();const b=$('.pbox');b.classList.remove('shake');void b.offsetWidth;b.classList.add('shake');SFX.err();
    if(tries>=3){tries=0;lockUntil=Date.now()+8000;closePin();line('[VAULT] 3 failed attempts - keypad locked 8s','err');SFX.alarm();addAlert(25);$('#viewer').innerHTML='<p class="err">KEYPAD LOCKED - TRACE +25</p>'}
    else $('#pinMsg').textContent=`ACCESS DENIED (${tries}/3)`;
  }
}
function unlock(f,how){f.unlocked=true;renderFiles();line(`[VAULT] ${f.id} unlocked via ${how}`,'ok');SFX.ok();showFile(f)}
async function typeInto(el,txt,tok){for(let i=0;i<txt.length;i+=3){if(tok!==vTok)return;el.textContent=txt.slice(0,i+3);if(i%6===0)SFX.tick();await sleep(14)}}
async function showFile(f){
  const tok=++vTok,v=$('#viewer');if('speechSynthesis' in window)speechSynthesis.cancel();
  v.innerHTML=`<div class="vh"><span>${f.type} // ${f.id}</span><span class="warn">TOP SECRET</span></div><div id="vb"></div>`;
  const b=$('#vb');if(f.kind==='svg')b.innerHTML=SCHEM;
  if(f.kind==='audio')b.innerHTML='<button id="plog">▶ PLAY TRANSMISSION</button>';
  const pre=document.createElement('pre');b.appendChild(pre);
  if(f.kind==='audio'){pre.textContent='[AUDIO LOG - PRESS PLAY]';$('#plog').onclick=()=>{initAudio();SFX.squelch();const t2=++vTok;typeInto(pre,f.body,t2);
    if('speechSynthesis' in window&&S.sound){try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(f.body.replace(/\[.*?\]/g,''));u.rate=.8;u.pitch=.4;speechSynthesis.speak(u)}catch(e){}}}}
  else await typeInto(pre,f.body,tok);
}

/* ================= alert / trace ================= */
function addAlert(n){if(S.override>0)return;S.alert=Math.min(100,S.alert+n);$('#mAlert').style.width=S.alert+'%';if(S.alert>=100)lockdown()}
async function lockdown(){S.alert=0;bigGlitch();SFX.alarm();line('!!! TRACE COMPLETE - LOCKDOWN 5s !!!','err');S.busy=true;await sleep(5000);S.busy=false;line('[SYS] lockdown lifted','warn')}

/* ================= commands ================= */
const CMDS={
  async help(){for(const l of ['COMMANDS:','  help                 this list','  scan [node]          global sweep / deep-scan a node','  hack <node>          exploit a scanned node','  decrypt [file]       brute-force a vault file (node must be owned)','  override             seize kernel, suppress trace for 20s','  ping <node>          echo test','  vault                list vault files','  status               system status','  music play|stop      synthwave player','  theme green|amber    colour scheme','  rain | crt | stream  toggle matrix rain / scanlines / log feed','  reboot | clear','TAB autocompletes. UP/DOWN recalls history.']){line(l,'ok');SFX.tick();await sleep(25)}},
  clear(){out.innerHTML=''},
  async scan([q]){
    if(!q){await typeLine('> INITIATING GLOBAL SWEEP...','ok');await bar('SWEEP',1400);
      for(const n of NODES){line(`${n.id.padEnd(10)} ${n.ip.padEnd(16)} ${(n.compromised?'COMPROMISED':n.status).padEnd(12)} ${n.ping}ms`,n.compromised?'warn':n.status==='HOSTILE'?'err':'');SFX.tick();await sleep(60)}
      await typeLine("TIP: 'scan <node>' for a deep scan, or click a node on the radar.",'dim');return}
    const n=findNode(q);if(!n){SFX.err();return typeLine('unknown node: '+q,'err')}
    select(n);await typeLine(`> DEEP SCAN ${n.name} (${n.ip})`,'ok');await bar('PORTSCAN',1200);n.scanned=true;renderCard();
    n.ports.forEach(p=>line(`  ${p.padEnd(14)} open`));await typeLine(`  ICE LEVEL ${n.sec}/5 // ${n.status}`,n.sec>=4?'err':'warn');SFX.ok();
  },
  async ping([q]){const n=findNode(q);if(!n){SFX.err();return typeLine('usage: ping <node>','err')}
    for(let i=0;i<4;i++){n.ping=rnd(15,260);line(`64 bytes from ${n.ip}: seq=${i} ttl=${rnd(40,64)} time=${n.ping} ms`);SFX.ping();await sleep(280)}
    n._rip=performance.now();select(n)},
  async hack([q]){
    if(!q){SFX.err();return typeLine('usage: hack <node>','err')}
    const n=findNode(q);if(!n){SFX.err();return typeLine('unknown node: '+q,'err')}
    if(n.compromised)return typeLine(n.name+' is already compromised.','warn');
    if(!n.scanned){SFX.err();return typeLine(`target not profiled. run: scan ${n.id}`,'err')}
    select(n);await typeLine(`> LAUNCHING EXPLOIT CHAIN AGAINST ${n.name}`,'ok');await bar('BRUTE',1600);
    const chance=.85-n.sec*.12+(S.override>0?.3:0);
    if(Math.random()<chance){n.compromised=true;renderCard();SFX.ok();bigGlitch();await typeLine('ACCESS GRANTED. ROOT SHELL ESTABLISHED.','warn');
      FILES.filter(f=>f.node===n.id).forEach(f=>line(`VAULT KEY ESCROW RECOVERED: ${f.id}  ->  decrypt ${f.id}`,'ok'))}
    else{SFX.err();const a=rnd(15,30);await typeLine(`ICE COUNTERMEASURE TRIGGERED - TRACE +${a}`,'err');addAlert(a)}
  },
  async decrypt([q]){
    if(!q){for(const f of FILES)line(`${f.id.padEnd(9)} ${f.unlocked?'[OPEN]  ':'[LOCKED]'} ${f.title}  (escrow: ${f.node})`,f.unlocked?'warn':'');return}
    const f=FILES.find(x=>x.id===q.toLowerCase());if(!f){SFX.err();return typeLine('unknown file: '+q,'err')}
    if(f.unlocked){await typeLine('already decrypted - opening viewer.','warn');return showFile(f)}
    const n=NODES.find(x=>x.id===f.node);
    if(!n.compromised){SFX.err();addAlert(5);return typeLine(`ACCESS DENIED. KEY ESCROW HELD BY ${n.name}. COMPROMISE IT FIRST.`,'err')}
    await typeLine(`> BRUTE-FORCING ${f.id} ...`,'ok');const d=line('');
    for(let k=0;k<=4;k++)for(let i=0;i<7;i++){d.textContent=`KEY ${hex(6)} :: PIN ${f.pin.slice(0,k)}${[...Array(4-k)].map(()=>rnd(0,9)).join('')}`;if(i%2===0)SFX.tick();await sleep(35)}
    d.textContent=`KEY ${hex(6)} :: PIN ${f.pin}  << CRACKED`;unlock(f,'brute-force');
  },
  async override(){
    if(S.override>0)return typeLine(`override already active (${S.override}s)`,'warn');
    await typeLine('> SYS OVERRIDE: SEIZING KERNEL...','warn');await bar('OVERRIDE',1200,'warn');
    S.alert=0;S.override=20;$('#mAlert').style.width='0%';$('#hud').classList.add('ovr');bigGlitch();SFX.alarm();
    await typeLine('TRACE SUPPRESSED FOR 20s. EXPLOIT ODDS +30%.','warn');
  },
  async vault(){return CMDS.decrypt([])},
  async status(){for(const l of [`UPTIME      ${Math.floor((Date.now()-S.t0)/1000)}s`,`NODES OWNED ${NODES.filter(n=>n.compromised).length}/${NODES.length}`,`VAULT       ${FILES.filter(f=>f.unlocked).length}/${FILES.length} unlocked`,`TRACE       ${Math.round(S.alert)}%${S.override>0?'  (override '+S.override+'s)':''}`,`SOUND       ${S.sound?'on':'off'}   MUSIC ${M.play?'playing':'stopped'}`])line(l,'ok')},
  async music([a]){initAudio();a==='stop'?musicStop():musicStart();await typeLine('music '+(M.play?'playing':'stopped'),'ok')},
  async theme([a]){setTheme(a==='amber'||a==='green'?a:document.documentElement.dataset.theme==='green'?'amber':'green');await typeLine('theme: '+document.documentElement.dataset.theme,'ok')},
  async rain(){setRain(!rainOn);await typeLine('matrix rain '+(rainOn?'on':'off'),'ok')},
  async crt(){toggleCRT();await typeLine('crt effects '+(document.body.classList.contains('noscan')?'off':'on'),'ok')},
  async stream(){S.stream=!S.stream;$('#streamState').textContent='STREAM:'+(S.stream?'ON':'OFF');await typeLine('log stream '+(S.stream?'on':'off'),'ok')},
  async reboot(){await powerOff();await sleep(600);await powerOn()}
};
async function run(raw){
  const [c,...args]=raw.trim().split(/\s+/);if(!c)return;
  line(`root@nexus:~# ${raw}`,'cmdecho');hist.push(raw);hi=hist.length;
  if(S.busy){line('SYSTEM BUSY - WAIT FOR CURRENT TASK','warn');SFX.err();return}
  const fn=CMDS[c.toLowerCase()];if(!fn){SFX.err();return typeLine(`command not found: ${c}. type 'help'`,'err')}
  S.busy=true;try{await fn(args)}finally{S.busy=false}
}
cmd.addEventListener('keydown',e=>{
  if(e.key==='Enter'){SFX.click();const v=cmd.value;cmd.value='';run(v);return}
  if(e.key==='ArrowUp'){e.preventDefault();if(hi>0)cmd.value=hist[--hi];return}
  if(e.key==='ArrowDown'){e.preventDefault();cmd.value=hi<hist.length-1?hist[++hi]:'';hi=Math.min(hi+1,hist.length);return}
  if(e.key==='Tab'){e.preventDefault();const p=cmd.value.split(/\s+/);
    if(p.length<=1){const m=Object.keys(CMDS).filter(k=>k.startsWith(p[0]));if(m.length===1)cmd.value=m[0]+' '}
    else{const m=[...NODES.map(n=>n.id),...FILES.map(f=>f.id)].filter(k=>k.startsWith(p[p.length-1]));if(m.length===1){p[p.length-1]=m[0];cmd.value=p.join(' ')}}return}
  if(e.key.length===1)SFX.key();
});
$$('.chips button').forEach(b=>b.onclick=()=>{SFX.click();if(b.dataset.fill){cmd.value=b.dataset.fill;cmd.focus()}else run(b.dataset.run)});
$('#pCon').onclick=e=>{if(!getSelection().toString()&&!e.target.closest('button'))cmd.focus()};

/* PIN keyboard entry */
document.addEventListener('keydown',e=>{
  if($('#pin').hidden)return;
  if(/^\d$/.test(e.key))pinKey(e.key);
  else if(e.key==='Backspace'){pinBuf=pinBuf.slice(0,-1);drawDots()}
  else if(e.key==='Enter')pinSubmit();
  else if(e.key==='Escape')closePin();else return;
  e.preventDefault();
});

/* ================= live log stream ================= */
const LOGS=[
  ()=>['sys',`[SYS] core temp ${rnd(48,71)}C  load ${rnd(12,88)}%  mem ${rnd(30,92)}%`],
  ()=>['dim',`[NET] TCP ${ip()}:${rnd(1024,65535)} -> ${ip()}:${pick([22,80,443,3389,8080])}  SYN len=${rnd(40,1500)} ttl=${rnd(32,128)}`],
  ()=>['dim',`[PKT] 0x${hex(2)}: ${hex(8).replace(/(..)/g,'$1 ')}`],
  ()=>['dim',`[DNS] resolve ${pick(['grid','arcology','mnemonic','ghostnet','lazarus'])}.${pick(['corp','onion','sys','void'])} -> ${ip()}`],
  ()=>['warn',`[SEC] intrusion probe blocked from ${ip()}`],
  ()=>['ok',`[AUTH] handshake ${hex(4)} verified`],
  ()=>['err',`[ICE] anomaly near node ${pick(NODES).id} - countermeasures armed`]
];
setInterval(()=>{if(!S.power||!S.stream||S.busy)return;const [c,t]=pick(LOGS)();line(t,c)},900);

/* HUD meters, trace decay, clock, random glitches */
let cpu=30,net=50;
setInterval(()=>{if(!S.power)return;cpu=Math.max(8,Math.min(95,cpu+rnd(-14,14)));net=Math.max(10,Math.min(98,net+rnd(-16,16)));$('#mCpu').style.width=cpu+'%';$('#mNet').style.width=net+'%'},800);
setInterval(()=>{if(!S.power)return;
  if(S.override>0){S.override--;if(!S.override){$('#hud').classList.remove('ovr');line('[SYS] override expired - trace resumed','warn')}}
  else if(S.alert>0){S.alert=Math.max(0,S.alert-1);$('#mAlert').style.width=S.alert+'%'}},1000);
const clock=()=>$('#clock').textContent=new Date().toLocaleTimeString([],{hour12:false})+' // '+new Date().toISOString().slice(0,10);
setInterval(clock,1000);clock();
function bigGlitch(){const s=$('#screen');s.classList.remove('bg');void s.offsetWidth;s.classList.add('bg');setTimeout(()=>s.classList.remove('bg'),520)}
setInterval(()=>{if(!S.power)return;if(Math.random()<.35)bigGlitch();else{const h=pick($$('.panel h2'));h.classList.add('gl');setTimeout(()=>h.classList.remove('gl'),400)}},9000);

/* ================= matrix rain ================= */
const rc=$('#rain'),rx=rc.getContext('2d'),GL='ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789ABCDEF<>/\\';let rainOn=false,rainT,cols=[];
function rainResize(){rc.width=innerWidth;rc.height=innerHeight;cols=Array.from({length:Math.ceil(rc.width/16)},()=>rnd(-40,0))}
function rainStep(){rx.globalCompositeOperation='destination-out';rx.fillStyle='rgba(0,0,0,.12)';rx.fillRect(0,0,rc.width,rc.height);rx.globalCompositeOperation='source-over';rx.fillStyle=C.c;rx.font='14px monospace';
  cols.forEach((y,i)=>{rx.fillText(GL[rnd(0,GL.length-1)],i*16,y*16);cols[i]=y*16>rc.height&&Math.random()>.975?0:y+1})}
function setRain(on){rainOn=on;$('#tRain').classList.toggle('on',on);clearInterval(rainT);if(on){rainResize();rainT=setInterval(rainStep,55)}else rx.clearRect(0,0,rc.width,rc.height)}
addEventListener('resize',()=>{if(rainOn)rainResize()});

/* ================= toggles ================= */
function setTheme(t){document.documentElement.dataset.theme=t;$('#tTheme').textContent=t==='green'?'AMBER':'GREEN';readColors()}
function toggleCRT(){const off=document.body.classList.toggle('noscan');$('#tScan').classList.toggle('on',!off)}
$('#tTheme').onclick=()=>{SFX.click();setTheme(document.documentElement.dataset.theme==='green'?'amber':'green')};
$('#tScan').onclick=()=>{SFX.click();toggleCRT()};
$('#tRain').onclick=()=>{SFX.click();setRain(!rainOn)};
$('#tSnd').onclick=()=>{S.sound=!S.sound;$('#tSnd').classList.toggle('on',S.sound);if(master)master.gain.value=S.sound?1:0;if(!S.sound&&'speechSynthesis' in window)speechSynthesis.cancel()};
$('#tPwr').onclick=()=>powerOff();

/* ================= CRT power on / off ================= */
async function powerOn(){
  if(S.power)return;initAudio();const sc=$('#screen');
  $('#power').classList.add('hide');sc.classList.remove('off','live');sc.classList.add('booting');SFX.on();await sleep(900);
  sc.classList.remove('booting');sc.classList.add('live');S.power=true;S.busy=true;out.innerHTML='';
  for(const l of ['NEXUS-OS BIOS v4.77  (c) 2077 Arasaka-Zero Systems','MEMORY TEST ........ 65536K OK','MOUNTING /dev/vault0 (AES-512) ... OK','LOADING NODE MAP DRIVER ... OK','LINK ESTABLISHED: GHOSTNET UPLINK 9.6 Tbps',"WELCOME, OPERATOR. TYPE 'help' FOR COMMANDS."])await typeLine(l,l.startsWith('WELCOME')?'warn':'ok',4);
  S.busy=false;cmd.focus();
}
async function powerOff(){
  if(!S.power)return;S.power=false;musicStop();if('speechSynthesis' in window)speechSynthesis.cancel();SFX.off();
  const sc=$('#screen');sc.classList.remove('live');sc.classList.add('shutting');await sleep(650);sc.classList.remove('shutting');sc.classList.add('off');$('#power').classList.remove('hide');
}
$('#pOn').onclick=powerOn;

/* ================= init ================= */
readColors();renderFiles();renderCard();
(function frame(t){if(S.power){drawRadar(t);drawViz(t)}requestAnimationFrame(frame)})(0);
