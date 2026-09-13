/*
 * URBANA REDEMPTION — a compact, original WebGL vertical slice.
 * The renderer is deliberately asset-light: the frontier is assembled from
 * colored low-poly primitives so the slice can run on Android-class hardware.
 * Systems are kept in their own sections for the future streamed-world build.
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const canvas = $('#world');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });

if (!gl) {
  document.body.innerHTML = '<div style="padding:40px;color:#e8d7b1;background:#171713;font:18px system-ui">WebGL is required to enter Bramble County. Please enable hardware acceleration.</div>';
  throw new Error('WebGL unavailable');
}

// ---------------------------------------------------------------------------
// Tiny math layer (column-major matrices, matching WebGL conventions)
// ---------------------------------------------------------------------------
const PI2 = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const hex = (v) => { const n = parseInt(v.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const v3 = (x, y, z) => ({ x, y, z });

function m4() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function translate(x, y, z) { const o = m4(); o[12] = x; o[13] = y; o[14] = z; return o; }
function scale(x, y, z) { const o = m4(); o[0] = x; o[5] = y; o[10] = z; return o; }
function ry(a) { const o = m4(), c = Math.cos(a), s = Math.sin(a); o[0]=c; o[2]=-s; o[8]=s; o[10]=c; return o; }
function rx(a) { const o = m4(), c = Math.cos(a), s = Math.sin(a); o[5]=c; o[6]=s; o[9]=-s; o[10]=c; return o; }
function model(x, y, z, sx, sy, sz, rot = 0, tilt = 0) { return mul(mul(mul(translate(x,y,z), ry(rot)), rx(tilt)), scale(sx,sy,sz)); }
function perspective(fov, aspect, near, far) { const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far), o = new Float32Array(16); o[0]=f/aspect; o[5]=f; o[10]=(far+near)*nf; o[11]=-1; o[14]=2*far*near*nf; return o; }
function lookAt(eye, target, up = {x:0,y:1,z:0}) {
  let zx = eye.x-target.x, zy=eye.y-target.y, zz=eye.z-target.z; let zl=Math.hypot(zx,zy,zz); zx/=zl; zy/=zl; zz/=zl;
  let xx=up.y*zz-up.z*zy, xy=up.z*zx-up.x*zz, xz=up.x*zy-up.y*zx; let xl=Math.hypot(xx,xy,xz); xx/=xl; xy/=xl; xz/=xl;
  const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
  const o=m4(); o[0]=xx;o[1]=yx;o[2]=zx; o[4]=xy;o[5]=yy;o[6]=zy; o[8]=xz;o[9]=yz;o[10]=zz; o[12]=-(xx*eye.x+xy*eye.y+xz*eye.z);o[13]=-(yx*eye.x+yy*eye.y+yz*eye.z);o[14]=-(zx*eye.x+zy*eye.y+zz*eye.z); return o;
}

// ---------------------------------------------------------------------------
// WebGL renderer and primitive meshes
// ---------------------------------------------------------------------------
const VERT = `attribute vec3 aPosition; attribute vec3 aColor; uniform mat4 uVP; uniform mat4 uModel; uniform vec3 uTint; uniform float uFog; varying vec3 vColor; varying float vDepth; void main(){ vec4 p=uVP*uModel*vec4(aPosition,1.0); gl_Position=p; vColor=aColor*uTint; vDepth=p.z/p.w; }`;
const FRAG = `precision mediump float; varying vec3 vColor; varying float vDepth; uniform vec3 uFogColor; void main(){ float fog=smoothstep(0.34,0.98,vDepth); gl_FragColor=vec4(mix(vColor,uFogColor,fog),1.0); }`;
function shader(type, source) { const s=gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
const program = gl.createProgram(); gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(program); gl.useProgram(program);
const loc = { position: gl.getAttribLocation(program,'aPosition'), color: gl.getAttribLocation(program,'aColor'), vp:gl.getUniformLocation(program,'uVP'), model:gl.getUniformLocation(program,'uModel'), tint:gl.getUniformLocation(program,'uTint'), fog:gl.getUniformLocation(program,'uFog'), fogColor:gl.getUniformLocation(program,'uFogColor') };

function meshData(vertices, colors, mode = gl.TRIANGLES) { const pb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW); const cb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,cb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(colors),gl.STATIC_DRAW); return {pb,cb,count:vertices.length/3,mode}; }
function cubeData() {
  const faces = [[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]],[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]],[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]],[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]],[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]];
  const shade=[1,.78,1.12,.55,.9,.72], v=[], c=[]; for(let f=0;f<6;f++){const q=faces[f], col=Array(3).fill(shade[f]); v.push(...q[0],...q[1],...q[2],...q[0],...q[2],...q[3]); for(let i=0;i<6;i++) c.push(...col); } return meshData(v,c);
}
function cylinderData(sides=12) { const v=[],c=[]; for(let i=0;i<sides;i++){const a=i/sides*PI2,b=(i+1)/sides*PI2;const q=[[Math.cos(a),-1,Math.sin(a)],[Math.cos(b),-1,Math.sin(b)],[Math.cos(b),1,Math.sin(b)],[Math.cos(a),1,Math.sin(a)]];v.push(...q[0],...q[1],...q[2],...q[0],...q[2],...q[3]);for(let k=0;k<6;k++)c.push(1,.9,.72)} return meshData(v,c); }
function coneData(sides=8) { const v=[],c=[]; for(let i=0;i<sides;i++){const a=i/sides*PI2,b=(i+1)/sides*PI2;v.push(0,1,0,Math.cos(a),-1,Math.sin(a),Math.cos(b),-1,Math.sin(b));for(let k=0;k<3;k++)c.push(1,.88,.7)} return meshData(v,c); }
function sphereData(rows=8,sides=12) { const v=[],c=[]; for(let r=0;r<rows;r++){const p1=r/rows*Math.PI,p2=(r+1)/rows*Math.PI;for(let s=0;s<sides;s++){const a=s/sides*PI2,b=(s+1)/sides*PI2;const q=[ [Math.sin(p1)*Math.cos(a),Math.cos(p1),Math.sin(p1)*Math.sin(a)], [Math.sin(p1)*Math.cos(b),Math.cos(p1),Math.sin(p1)*Math.sin(b)], [Math.sin(p2)*Math.cos(b),Math.cos(p2),Math.sin(p2)*Math.sin(b)], [Math.sin(p2)*Math.cos(a),Math.cos(p2),Math.sin(p2)*Math.sin(a)] ];v.push(...q[0],...q[1],...q[2],...q[0],...q[2],...q[3]);for(let k=0;k<6;k++)c.push(.92,.88,.72)}}return meshData(v,c); }
const meshes={cube:cubeData(), cylinder:cylinderData(), cone:coneData(), sphere:sphereData()};
function draw(kind, mat, tint = '#ffffff') { const q=meshes[kind]; gl.bindBuffer(gl.ARRAY_BUFFER,q.pb);gl.enableVertexAttribArray(loc.position);gl.vertexAttribPointer(loc.position,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,q.cb);gl.enableVertexAttribArray(loc.color);gl.vertexAttribPointer(loc.color,3,gl.FLOAT,false,0,0);gl.uniformMatrix4fv(loc.model,false,mat);gl.uniform3fv(loc.tint,hex(tint));gl.drawArrays(q.mode,0,q.count); }
function box(x,y,z,sx,sy,sz,color,rot=0) { draw('cube',model(x,y,z,sx,sy,sz,rot),color); }
function post(x,y,z,sx,sy,sz,color,rot=0){box(x,y,z,sx,sy,sz,color,rot)}
function sphere(x,y,z,sx,sy,sz,color,rot=0){draw('sphere',model(x,y,z,sx,sy,sz,rot),color)}
function cyl(x,y,z,sx,sy,sz,color,rot=0){draw('cylinder',model(x,y,z,sx,sy,sz,rot),color)}
function cone(x,y,z,sx,sy,sz,color,rot=0){draw('cone',model(x,y,z,sx,sy,sz,rot),color)}

// ---------------------------------------------------------------------------
// World state — settlement, ranch edge, river, forest and the split-rail pass
// ---------------------------------------------------------------------------
const world = { trees:[], rocks:[], grass:[], birds:[], fireflies:[] };
let seed=4471; const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
for(let i=0;i<105;i++){const x=(rand()-.5)*92,z=(rand()-.5)*86;if(Math.abs(x)<18&&Math.abs(z)<19)continue;world.trees.push({x,z,s:.65+rand()*1.15,type:rand()>.18?'pine':'oak'});}
for(let i=0;i<40;i++){world.rocks.push({x:(rand()-.5)*80,z:(rand()-.5)*78,s:.3+rand()*1.4});}
for(let i=0;i<50;i++){world.grass.push({x:(rand()-.5)*74,z:(rand()-.5)*68,s:.5+rand()});}

const player={x:0,y:0,z:-3,yaw:0,health:1,stamina:1,money:42.5,ammo:6,reserve:24,weapon:'IRONWIND',mounted:false,aiming:false};
const horse={x:-3,z:-1,yaw:0,health:1,stamina:1,bond:1,name:'ASHFALL',following:false};
const npcs=[
  {id:'mara',name:'MARA VALE',role:'RANCHER',x:2,z:-5,color:'#7e5340',hair:'#31251c',routine:'water tower'},
  {id:'cass',name:'CASS DORAN',role:'TRAPPER',x:-15,z:11,color:'#50645b',hair:'#25231d',routine:'camp'},
  {id:'sheriff',name:'EMANUEL ROOK',role:'SHERIFF',x:-3,z:-14,color:'#4e5d69',hair:'#2b2a26',routine:'sheriff office'},
  {id:'shop',name:'OLLIE VENN',role:'PROVISIONER',x:10,z:-11,color:'#9d6845',hair:'#3f281c',routine:'general store'},
  {id:'traveler',name:'JON BELL',role:'TRAVELER',x:15,z:-3,color:'#6b5e48',hair:'#2c241d',routine:'road'}
];
const animals=[
  {id:'deer-1',type:'DEER',x:-22,z:17,homeX:-22,homeZ:17,alive:true,health:1,dir:1,speed:1.1},
  {id:'deer-2',type:'DEER',x:-27,z:22,homeX:-27,homeZ:22,alive:true,health:1,dir:-1,speed:.8},
  {id:'wolf-1',type:'WOLF',x:24,z:25,homeX:24,homeZ:25,alive:true,health:1,dir:-1,speed:.7},
  {id:'coyote-1',type:'COYOTE',x:29,z:-19,homeX:29,homeZ:-19,alive:true,health:1,dir:1,speed:.9},
];
let outlaws=[];
let lawman={x:-3,z:-18,active:false,health:1};
let mission={step:0,active:true,complete:false,side:false,sideReady:false,sideDone:false};
let worldMinutes=7*60+24, weather='CLEAR', weatherTimer=47, wanted=0, wantedTimer=0;
let gameStarted=false, paused=false, dialogue=null, saveStamp='Autosave is active. The last camp was saved moments ago.';
let last=performance.now(), accumulator=0, cameraOrbit=0, cameraPitch=.12, aimHeld=false, mouseDown=false, keys={};

// ---------------------------------------------------------------------------
// UI helpers and the original story/dialogue layer
// ---------------------------------------------------------------------------
function showScreen(id){$$('.screen').forEach(s=>s.classList.toggle('active',s.id===id));}
function toast(text, duration=3300){const el=document.createElement('div');el.className='toast';el.textContent=text;$('#toast-stack').appendChild(el);setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),450)},duration);}
function notify(text){const n=$('#notification');n.textContent=text;n.classList.add('show');setTimeout(()=>n.classList.remove('show'),1700);}
function setLoading(){showScreen('loading-screen');let p=0;const tip=['A good horse listens before it runs.','Cinderwell keeps its stories in the dust.','Watch the treeline when the light turns blue.','The river remembers every crossing.'];$('#loading-tip').textContent=tip[Math.floor(Math.random()*tip.length)];const tick=setInterval(()=>{p+=Math.random()*18+8;if(p>=100){p=100;clearInterval(tick);setTimeout(beginGame,330)}$('#loading-progress').style.width=`${p}%`;$('#loading-percent').textContent=`${Math.floor(p)}%`},115);}
function beginGame(){gameStarted=true;paused=false;canvas.style.opacity=1;showScreen('');$('#hud').classList.remove('hidden');$('#touch-controls').classList.remove('hidden');toast('CINDERWELL · BRAMBLE COUNTY',3200);toast('The Price of a Promise · Find Mara Vale by the old water tower',5200);updateHUD();}
function openDialogue(lines, onDone){ if(dialogue)return; dialogue={lines,index:0,onDone};$('#dialogue').classList.remove('hidden');paintDialogue(); }
function paintDialogue(){const l=dialogue.lines[dialogue.index];$('#speaker-role').textContent=l.role;$('#speaker-name').textContent=l.name;$('#dialogue-text').textContent=l.text;$('#dialogue-index').textContent=`${String(dialogue.index+1).padStart(2,'0')} / ${String(dialogue.lines.length).padStart(2,'0')}`;}
function advanceDialogue(){if(!dialogue)return;dialogue.index++;if(dialogue.index>=dialogue.lines.length){const cb=dialogue.onDone;dialogue=null;$('#dialogue').classList.add('hidden');if(cb)cb();}else paintDialogue();}
function storyDialogue(){
  openDialogue([
    {role:'RANCHER · WATER TOWER',name:'MARA VALE',text:'You rode in beneath a quiet sky. That usually means the trouble got here first.'},
    {role:'RANCHER · WATER TOWER',name:'MARA VALE',text:'A red scarf went missing at Split-Rail Bridge. So did my brother’s payroll. I need the road looked at before the next train.'},
    {role:'DRIFTER',name:'ELIAS VANE',text:'I’m not a courier, Mara.'},
    {role:'RANCHER · WATER TOWER',name:'MARA VALE',text:'No. You’re the one who came back. That makes you the only promise in this county I can still spend.'}
  ],()=>{mission.step=1;$('#objective-label').textContent='Ride to Split-Rail Bridge and find the missing payroll';$('#objective-progress').textContent='STORY · THE PRICE OF A PROMISE';toast('New objective · Split-Rail Bridge is east of town');autosave();});
}
function bridgeDialogue(){openDialogue([{role:'RANCHER · WATER TOWER',name:'MARA VALE',text:'The bridge is ahead. If the trail goes cold, look for what the robbers left behind.'},{role:'DRIFTER',name:'ELIAS VANE',text:'And if they’re still waiting?'},{role:'RANCHER · WATER TOWER',name:'MARA VALE',text:'Then make them wish they had chosen a softer road.'}],()=>{mission.step=2;outlaws=[{id:'outlaw-a',name:'RED JACKAL',x:11,z:12,health:1,active:true},{id:'outlaw-b',name:'MOTH',x:15,z:14,health:1,active:true},{id:'outlaw-c',name:'CALLOW',x:17,z:10,health:1,active:true}];$('#objective-label').textContent='Break the ambush at Split-Rail Bridge';$('#objective-progress').textContent='STORY · THE PRICE OF A PROMISE · 0 / 3';toast('AMBUSH · Stay low and watch the ridge',3500);});}
function endingDialogue(){openDialogue([{role:'RANCHER · WATER TOWER',name:'MARA VALE',text:'You brought the money back. Most people would have kept it and called that justice.'},{role:'DRIFTER',name:'ELIAS VANE',text:'Justice is a word folks use when they want a clean pair of hands.'},{role:'RANCHER · WATER TOWER',name:'MARA VALE',text:'Then keep yours dirty a little longer. Bramble County has more roads than it has honest men.'}],()=>{mission.step=4;mission.complete=true;player.money+=18;horse.bond=Math.min(4,horse.bond+1);$('#objective-label').textContent='Explore Cinderwell · the county is open';$('#objective-progress').textContent='MISSION COMPLETE · $18.00 · BOND +1';toast('MISSION COMPLETE · The Price of a Promise',4800);autosave();});}
function sideDialogue(){openDialogue([{role:'TRAPPER · FIR CAMP',name:'CASS DORAN',text:'A pair of mule deer have been circling my camp. Not scared of the wolves. Scared of something else.'},{role:'TRAPPER · FIR CAMP',name:'CASS DORAN',text:'Bring me one clean hide and I’ll trade you a compass that still points home.'},{role:'DRIFTER',name:'ELIAS VANE',text:'You ask strangers for favors like you’ve known them years.'},{role:'TRAPPER · FIR CAMP',name:'CASS DORAN',text:'Out here, years are expensive. Favors are what we can afford.'}],()=>{mission.side=true;$('#objective-label').textContent='Bring Cass one deer hide';$('#objective-progress').textContent='SIDE ACTIVITY · THE QUIET MEASURE';toast('Side activity started · Hunt a deer beyond the fir camp');});}
function sideDoneDialogue(){openDialogue([{role:'TRAPPER · FIR CAMP',name:'CASS DORAN',text:'That’s a clean hide. You didn’t make the woods pay more than it owed.'},{role:'TRAPPER · FIR CAMP',name:'CASS DORAN',text:'Take the compass. It won’t tell you where to go. It’ll only tell you when you’ve stopped.'}],()=>{mission.sideDone=true;player.money+=9;toast('SIDE ACTIVITY COMPLETE · Compass received · $9.00');autosave();});}

// ---------------------------------------------------------------------------
// Player, horse, wildlife, combat, law and activity systems
// ---------------------------------------------------------------------------
function moveVector(){let x=0,z=0;if(keys.KeyW)x+=Math.sin(cameraYaw());if(keys.KeyS)x-=Math.sin(cameraYaw()),z-=Math.cos(cameraYaw());if(keys.KeyA)x-=Math.cos(cameraYaw()),z+=Math.sin(cameraYaw());if(keys.KeyD)x+=Math.cos(cameraYaw()),z-=Math.sin(cameraYaw());if(keys.KeyW)z+=Math.cos(cameraYaw());const len=Math.hypot(x,z);return len?{x:x/len,z:z/len}:{x:0,z:0};}
function cameraYaw(){return player.yaw+cameraOrbit;}
function handleMovement(dt){if(dialogue||paused)return;const mv=moveVector();const moving=mv.x||mv.z;const sprint=keys.ShiftLeft||keys.ShiftRight;let speed=player.mounted?7.2:3.9;if(sprint&&player.stamina>.06){speed*=1.45;player.stamina=clamp(player.stamina-dt*.15,0,1)}else player.stamina=clamp(player.stamina+dt*.08,0,1);if(moving){const target=Math.atan2(mv.x,mv.z);player.yaw+=angleDiff(target,player.yaw)*Math.min(1,dt*10);player.x+=mv.x*speed*dt;player.z+=mv.z*speed*dt;if(player.mounted){horse.x=player.x;horse.z=player.z;horse.yaw=player.yaw;horse.stamina=clamp(horse.stamina-(sprint?dt*.07:-dt*.02),0,1);}}else if(player.mounted){horse.x=lerp(horse.x,player.x,dt*7);horse.z=lerp(horse.z,player.z,dt*7);}player.x=clamp(player.x,-40,40);player.z=clamp(player.z,-38,38);}
function whistle(){if(!gameStarted||dialogue)return;const d=dist(player,horse);if(d<7&&!player.mounted){toast('ASHFALL nickers from nearby.');return;}horse.following=true;horse.x=player.x-Math.sin(player.yaw)*2.2;horse.z=player.z-Math.cos(player.yaw)*2.2;horse.yaw=player.yaw;toast('ASHFALL answers your whistle.');}
function toggleMount(){if(!gameStarted||dialogue)return;if(player.mounted){player.mounted=false;horse.x=player.x-Math.sin(player.yaw)*1.4;horse.z=player.z-Math.cos(player.yaw)*1.4;toast('Dismounted Ashfall.');return;}if(dist(player,horse)<3.2){player.mounted=true;horse.following=false;horse.yaw=player.yaw;toast(`Mounted ${horse.name} · bond ${horse.bond}/4`);horse.bond=Math.min(4,horse.bond+0.08);return;}toast('Ashfall is too far away. Whistle with F.');}
function fire(){if(!gameStarted||paused||dialogue)return;if(player.ammo<=0){toast('The cylinder is empty · press R to reload');return;}player.ammo--;const yaw=player.yaw+(player.aiming?0:cameraOrbit*.25);let candidates=[...outlaws.filter(x=>x.active),...animals.filter(x=>x.alive),...npcs.map(x=>({...x,kind:'npc'})),lawman.active?{...lawman,kind:'lawman'}:null].filter(Boolean);let hit=null,best=999;for(const e of candidates){const d=dist(player,e);const a=Math.atan2(e.x-player.x,e.z-player.z);const diff=Math.abs(angleDiff(a,yaw));if(d<28&&diff<.28+(player.aiming?.22:0)&&d<best){hit=e;best=d;}}if(hit){if(hit.id&&hit.id.startsWith('outlaw')){const real=outlaws.find(x=>x.id===hit.id);real.health-=.8;toast(`Hit ${real.name} · ${Math.max(0,Math.ceil(real.health*100))}%`,1100);if(real.health<=0){real.active=false;toast(`${real.name} is down`,1800);checkMissionCombat();}}else if(hit.type==='DEER'||hit.type==='COYOTE'||hit.type==='WOLF'){const real=animals.find(x=>x.id===hit.id);real.health=0;real.alive=false;toast(`${real.type.toLowerCase()} harvested · skin it at camp`,2400);if(mission.side&&!mission.sideDone){mission.side=false;mission.sideDone=true;player.money+=9;$('#objective-label').textContent='Return to Cass at the fir camp';toast('Clean hide secured · return to Cass');} }else { wanted=Math.max(wanted,1);wantedTimer=26;toast('WITNESS · Violence reported in Cinderwell',3300);lawman.active=true; } }else toast('The shot cracks across the valley.',900);updateHUD();}
function reload(){if(player.ammo===6||player.reserve<=0)return;const n=Math.min(6-player.ammo,player.reserve);player.ammo+=n;player.reserve-=n;toast(`Reloaded · ${player.ammo} rounds ready`,1000);}
function checkMissionCombat(){if(mission.step===2&&outlaws.every(x=>!x.active)){mission.step=3;$('#objective-label').textContent='Return to Mara at the old water tower';$('#objective-progress').textContent='STORY · THE PRICE OF A PROMISE · AMBUSH BROKEN';horse.bond=Math.min(4,horse.bond+.25);toast('The road is quiet again · return to Mara',3300);autosave();}}
function updateLaw(dt){if(!wanted)return;if(!lawman.active){lawman.active=true;lawman.x=player.x+10;lawman.z=player.z+10;}if(dist(player,lawman)>1.5){const a=Math.atan2(player.x-lawman.x,player.z-lawman.z);lawman.x+=Math.sin(a)*dt*2.1;lawman.z+=Math.cos(a)*dt*2.1;}else{player.health-=dt*.18;if(player.health<=0){player.health=1;wanted=0;lawman.active=false;player.x=0;player.z=-3;toast('You were taken in · the sheriff returned you to Cinderwell',4000);}}if(dist(player,{x:0,z:-10})>15)wantedTimer-=dt;else wantedTimer=26;if(wantedTimer<=0){wanted=0;lawman.active=false;toast('The search has gone cold.',2800);} }
function updateAnimals(dt){for(const a of animals){if(!a.alive)continue;const d=dist(player,a);if(d<9){a.dir=Math.atan2(a.x-player.x,a.z-player.z);a.speed=a.type==='DEER'?2.7:2.1;}else{a.dir+=Math.sin(worldMinutes*.02+a.x)*dt*.35;}a.x+=Math.sin(a.dir)*a.speed*dt*.24;a.z+=Math.cos(a.dir)*a.speed*dt*.24;if(Math.abs(a.x-a.homeX)>10)a.dir+=Math.PI*.7;if(Math.abs(a.z-a.homeZ)>10)a.dir+=Math.PI*.7;}}
function updateNPCs(dt){for(const n of npcs){const phase=(worldMinutes/60+n.x*.1)%24;if(n.id==='traveler'){n.x+=Math.sin(worldMinutes*.006)*dt*.35;n.z+=Math.cos(worldMinutes*.006)*dt*.25;}else if(phase>18||phase<6){n.x=lerp(n.x,n.id==='mara'?2:-2,dt*.03);}}}

// ---------------------------------------------------------------------------
// Mission proximity and save system
// ---------------------------------------------------------------------------
function nearestInteractable(){let best=null,bd=99;for(const n of npcs){const d=dist(player,n);if(d<3.1&&d<bd){best={kind:'npc',entity:n};bd=d;}}if(dist(player,horse)<3.2&&!player.mounted&&dist(player,horse)<bd){best={kind:'horse',entity:horse};bd=dist(player,horse);}if(mission.step===1&&dist(player,{x:14,z:12})<3.2&&dist(player,{x:14,z:12})<bd)best={kind:'bridge',entity:{x:14,z:12}};return best;}
function interact(){if(dialogue){advanceDialogue();return;}if(!gameStarted||paused)return;const hit=nearestInteractable();if(!hit){if(dist(player,{x:-24,z:20})<3.5){toast('Fresh tracks · use the crosshair to hunt beyond the fir camp.');}else toast('Nothing here but dust and a long road.',1200);return;}if(hit.kind==='horse'){toggleMount();return;}const n=hit.entity;if(n.id==='mara'){if(mission.step===0)storyDialogue();else if(mission.step===1)toast('Mara watches the eastern road. The bridge is waiting.');else if(mission.step===3)endingDialogue();else if(mission.complete)toast('Mara: The county hasn’t finished with you yet.');}else if(n.id==='cass'){if(!mission.side&&!mission.sideDone)sideDialogue();else if(mission.sideDone)toast('Cass: Keep the compass close.');else toast('Cass is waiting on a clean hide.');}else if(hit.kind==='bridge'){bridgeDialogue();}}
function autosave(){const data={version:1,player:{x:player.x,z:player.z,health:player.health,money:player.money,ammo:player.ammo,reserve:player.reserve},horse:{x:horse.x,z:horse.z,bond:horse.bond},mission:{step:mission.step,complete:mission.complete,side:mission.side,sideDone:mission.sideDone},animals:animals.map(a=>({id:a.id,alive:a.alive,health:a.health}))};try{localStorage.setItem('urbana-save',JSON.stringify(data));saveStamp=`Last camp saved at ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}.`;$('#save-note').textContent=saveStamp;toast('CAMP SAVED',1200);}catch(e){toast('Camp ledger unavailable in this browser.',2000);}}
function loadSave(){try{const d=JSON.parse(localStorage.getItem('urbana-save'));if(!d){toast('No camp ledger found · starting a new journey',2200);setLoading();return;}Object.assign(player,d.player);Object.assign(horse,d.horse);Object.assign(mission,d.mission);d.animals?.forEach(s=>{const a=animals.find(x=>x.id===s.id);if(a)Object.assign(a,s)});toast('Camp ledger loaded',1800);setLoading();}catch(e){setLoading();}}

// ---------------------------------------------------------------------------
// Rendering the world: a warm, readable low-poly frontier designed for touch
// ---------------------------------------------------------------------------
let vp=m4(), fogColor=[.18,.18,.15];
function renderWorld(now){
  const w=canvas.clientWidth,h=canvas.clientHeight;gl.viewport(0,0,w*devicePixelRatio,h*devicePixelRatio);const aspect=w/h;const hour=worldMinutes/60;const daylight=clamp(Math.sin((hour-6)/24*Math.PI*2)*.65+.48,.12,1);const night=1-daylight;
  const sky=[lerp(.035,.32,daylight),lerp(.055,.38,daylight),lerp(.075,.35,daylight)];gl.clearColor(sky[0],sky[1],sky[2],1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.useProgram(program);fogColor=[lerp(.055,.43,daylight),lerp(.07,.40,daylight),lerp(.08,.31,daylight)];gl.uniform3fv(loc.fogColor,fogColor);gl.uniform1f(loc.fog,1);
  const cy=cameraYaw();const camDist=player.mounted?8.0:6.4;const eye={x:player.x-Math.sin(cy)*camDist,y:player.y+(player.mounted?3.1:2.75)+Math.sin(cameraPitch)*2,z:player.z-Math.cos(cy)*camDist};const target={x:player.x,y:player.mounted?.95:1.05,z:player.z};vp=mul(perspective(1.02,aspect,.1,110),lookAt(eye,target));gl.uniformMatrix4fv(loc.vp,false,vp);
  // moon/sun read as small warm/cool orbs in the sky.
  sphere(player.x+Math.sin(hour*.26)*28,18,player.z+Math.cos(hour*.26)*28,1.4,1.4,1.4,daylight>.45?'#f4c878':'#c5ced2');
  // ground and the river that divides Cinderwell from the pass.
  box(0,-.42,0,48,.4,45,weather==='RAIN'?'#3b483d':'#53634a');box(11,.015,1,2.2,.035,45,weather==='RAIN'?'#405d63':'#47717a');box(0,.02,-8,48,.045,2.6,'#a4815d');box(-13,.025,5,15,.04,1.5,'#9b7754');box(13,.025,11,16,.04,1.4,'#9b7754');
  // distant mesas / mountains frame the playable area.
  for(let i=0;i<11;i++){const x=-42+i*8;cone(x,4,-35,5.5,8,5.5, i%2?'#3a4038':'#303a35',0);}
  for(let i=0;i<9;i++){const x=-39+i*10;cone(x,4,34,6,9,6,i%2?'#454b40':'#354139',0);}
  // town buildings and readable landmarks.
  building(-10,-12, '#7d5941','#49382d','THE DUSTY LARK',0); building(-1,-14,'#6c6d63','#343f3b','SHERIFF',0);building(9,-11,'#886547','#50382c','GENERAL',0);building(3,-19,'#7c523c','#40322a','HOTEL',0);building(-17,7,'#8b674a','#4f3929','RANCH',.06);building(18,6,'#6d5846','#3c3630','MINE',-.08);
  // river bridge and train/telegraph details.
  box(14,.2,11,3.1,.28,3.8,'#624c39',0);for(let i=0;i<8;i++){box(11.8+i*.65,.62,11, .1,.8,3.5,'#a17b51');}for(let i=0;i<8;i++){box(11.8+i*.65,.88,11, .16,.08,4.1,'#c5a16c');}
  // water tower landmark
  cyl(2,2.8,-5,2.4,2.0,2.4,'#6a5a47');cyl(2,1,-5,.13,1.8,.13,'#aa8455');cyl(1.1,1,-5,.13,1.8,.13,'#aa8455');cyl(2.9,1,-5,.13,1.8,.13,'#aa8455');cyl(2,1,-5,.13,1.8,.13,'#aa8455');
  // trees and rocks with distance culling = first small streaming seam.
  for(const t of world.trees){if(Math.hypot(t.x-player.x,t.z-player.z)>52)continue;const bob=Math.sin(now*.0006+t.x)*.025;tree(t.x,t.z,t.s,bob,t.type);}
  for(const r of world.rocks){if(Math.hypot(r.x-player.x,r.z-player.z)>48)continue;rock(r.x,r.z,r.s);}
  for(const g of world.grass){if(Math.hypot(g.x-player.x,g.z-player.z)>40)continue;post(g.x,.12,g.z,.035,.2*g.s,.035,'#82935e',g.x);}
  // telegraph line across the road
  for(let i=-34;i<35;i+=4){post(i,3.4,-6, .06,.06,.06,'#332c23');if(i<34)box(i+2,3.4,-6,.01,.01,2.2,'#433d31',.22);}
  // props and actors
  drawRanch();drawHorse(now);drawPlayer(now);for(const n of npcs)drawNPC(n,now);for(const a of animals)if(a.alive)drawAnimal(a,now);for(const o of outlaws)if(o.active)drawOutlaw(o,now);if(lawman.active)drawLawman(now);drawCampfire(-24,.4,20,now);
  // tiny rain and dust streaks are rendered as warm, low-cost slanted posts.
  if(weather==='RAIN'){for(let i=0;i<28;i++){const x=player.x+(i*7%26)-13,z=player.z+((i*13)%24)-12;post(x,3+(i%4),z,.012,.4,.012,'#9ebbc1',.22);}}
}
function building(x,z,wall,roof,label,rot){box(x,1.5,z,3.5,1.5,2.4,wall,rot);box(x,3.3,z,3.9,.28,2.7,roof,rot);box(x,1,z-(rot?-.0:2.43),.6,1.0,.08,'#332820',rot);box(x-.0,2.0,z-2.48,1.2,.12,.06,'#cfa56b',rot);}
function tree(x,z,s,bob,type){const green=type==='pine'?'#2f4a3b':'#43583d';cyl(x,.85*s+bob,z,.18*s,.85*s,.18*s,'#594534',x);if(type==='pine'){cone(x,2.0*s,z,1.15*s,1.4*s,1.15*s,green,x*.03);cone(x,2.8*s,z,.85*s,1.15*s,.85*s,green,x*.03);}else{sphere(x,2.0*s,z,1.25*s,1.1*s,1.25*s,green);sphere(x+.5*s,2.3*s,z+.2*s,.9*s,.8*s,.9*s,'#4d6443');}}
function rock(x,z,s){cone(x,.5*s,z,.8*s,1*s,.8*s,'#68604e',x);}
function drawRanch(){for(let i=0;i<7;i++){post(-20+i*1.8,.5,6,.06,.5,.06,'#6d5136');if(i<6)box(-19.1+i*1.8,.6,6,.9,.06,.06,'#92704a',0);}}
function drawCampfire(x,y,z,t){sphere(x,y+.15,z,.55,.22,.55,'#6c3e26');cone(x,y+1.0,z,.22,.7,.22, t%900<450?'#e8a14b':'#d36235');sphere(x,y+1.2,z,.26,.4,.26,'#f3c86c');}
function drawHorse(t){const moving=(keys.KeyW||keys.KeyA||keys.KeyS||keys.KeyD)&&!paused;const bob=moving?Math.sin(t*.014)*.06:Math.sin(t*.002)*.025;const x=horse.x,y=.9,z=horse.z,r=horse.yaw;box(x,y+bob,z,1.0,.62,.48,'#704a36',r);sphere(x+Math.sin(r)*.95,y+.45+bob,z+Math.cos(r)*.95,.38,.46,.34,'#6a4533',r);box(x+Math.sin(r)*1.12,y+.82+bob,z+Math.cos(r)*1.12,.16,.4,.18,'#5b3a2c',r);for(const side of [-.65,.65])for(const end of [-.32,.32]){const lx=x+Math.sin(r)*end+Math.cos(r)*side*.55,lz=z+Math.cos(r)*end-Math.sin(r)*side*.55;box(lx,.34+bob,lz,.11,.55,.11,'#4b3328',r);}box(x-Math.sin(r)*.2,y+.68+bob,z-Math.cos(r)*.2,.62,.12,.12,'#3d2a22',r);if(player.mounted){sphere(player.x,2.0+ bob,player.z,.26,.43,.22,'#9c7552',player.yaw);box(player.x,1.55+bob,player.z,.42,.45,.25,'#654738',player.yaw);}}
function drawPlayer(t){if(player.mounted)return;const x=player.x,z=player.z,bob=(keys.KeyW||keys.KeyA||keys.KeyS||keys.KeyD)?Math.sin(t*.018)*.045:0;box(x,.95+bob,z,.35,.75,.26,'#6c4d3b',player.yaw);sphere(x,.2+bob,z,.22,.25,.2,'#bb8a61',player.yaw);box(x,.18+bob,z,.37,.11,.28,'#4b3027',player.yaw);box(x,.63+bob,z,.41,.18,.29,'#b58458',player.yaw);box(x,1.55+bob,z,.34,.1,.28,'#3b2a24',player.yaw);}
function drawNPC(n,t){const active=n.id==='mara'&&mission.step===3;const bob=Math.sin(t*.002+n.x)*.025;box(n.x,.85+bob,n.z,.32,.7,.25,n.color);sphere(n.x,.1+bob,n.z,.2,.22,.18,n.hair);box(n.x,1.46+bob,n.z,.4,.1,.3,n.hair);if(active){sphere(n.x,2.1+Math.sin(t*.003)*.08,n.z,.1,.1,.1,'#e5b861');}}
function drawAnimal(a,t){const bob=Math.sin(t*.004+a.x)*.06, r=a.dir;let body=a.type==='DEER'?'#9b7957':a.type==='WOLF'?'#575650':'#78614a';box(a.x,.62+bob,a.z,.7,.38,.3,body,r);sphere(a.x+Math.sin(r)*.65,.8+bob,a.z+Math.cos(r)*.65,.25,.24,.22,body,r);for(const side of [-.18,.18])for(const end of [-.35,.35])box(a.x+Math.sin(r)*end+Math.cos(r)*side,.28+bob,a.z+Math.cos(r)*end-Math.sin(r)*side,.07,.32,.07,body,r);if(a.type==='DEER'){cone(a.x+Math.sin(r)*.85,1.12+bob,a.z+Math.cos(r)*.85,.1,.35,.1,'#cdb38a',r);cone(a.x+Math.sin(r)*.68,1.25+bob,a.z+Math.cos(r)*.68,.05,.24,.05,'#cdb38a',r);}}
function drawOutlaw(o,t){const bob=Math.sin(t*.015+o.x)*.04;box(o.x,.94+bob,o.z,.35,.78,.27,'#6f3f35',Math.atan2(player.x-o.x,player.z-o.z));sphere(o.x,.2+bob,o.z,.21,.24,.18,'#875f46');box(o.x,1.55+bob,o.z,.43,.1,.32,'#342629');box(o.x+Math.sin(o.x)*.35,.85,o.z+Math.cos(o.x)*.35,.08,.45,.08,'#252221');}
function drawLawman(t){const bob=Math.sin(t*.008)*.03;box(lawman.x,.95+bob,lawman.z,.36,.8,.28,'#3f5860',0);sphere(lawman.x,.2+bob,lawman.z,.21,.24,.18,'#a77b5c');box(lawman.x,1.56+bob,lawman.z,.46,.1,.35,'#242b2d');}

// ---------------------------------------------------------------------------
// HUD, clock, day/night and world tick
// ---------------------------------------------------------------------------
function updateHUD(){const hour=Math.floor(worldMinutes/60)%24,min=Math.floor(worldMinutes%60);$('#clock-label').textContent=`${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;const period=hour<6?'NIGHT':hour<12?'MORNING':hour<18?'AFTERNOON':hour<21?'EVENING':'NIGHT';$('#weather-label').textContent=`${weather} · ${period}`;$('#health-meter').style.width=`${player.health*100}%`;$('#stamina-meter').style.width=`${player.stamina*100}%`;$('#ammo-label').textContent=`${player.ammo} / ${player.reserve}`;$('#money-label').textContent=player.money.toFixed(2);$('#horse-status').classList.toggle('hidden',!gameStarted);$('#horse-meter-fill').style.width=`${horse.stamina*100}%`;$('#bond-label').textContent=`BOND · ${Math.max(1,Math.floor(horse.bond))}`;const hit=nearestInteractable();$('#interact-prompt').classList.toggle('show',!!hit);if(hit){$('#interact-label').textContent=hit.kind==='horse'?(player.mounted?'DISMOUNT':'MOUNT'):(hit.kind==='bridge'?'CHECK BRIDGE':'TALK');}$('#wanted-chip').classList.toggle('active',wanted>0);$('#wanted-label').textContent=wanted?'WANTED':'CLEAR';$('#objective-label').textContent=$('#objective-label').textContent;}
function tick(dt){if(!gameStarted||paused)return;worldMinutes=(worldMinutes+dt*.72)%1440;weatherTimer-=dt;if(weatherTimer<0){weatherTimer=70+Math.random()*65;weather=Math.random()>.72?(weather==='RAIN'?'CLEAR':'RAIN'):'CLEAR';toast(weather==='RAIN'?'Clouds break over Bramble County.':'The rain moves east.',2400);}handleMovement(dt);updateAnimals(dt);updateNPCs(dt);updateLaw(dt);if(mission.step===1&&dist(player,{x:14,z:12})<3.4&&!dialogue){$('#objective-label').textContent='Check the split-rail bridge';}if(mission.step===3&&dist(player,npcs[0])<3.5&&!dialogue)$('#objective-label').textContent='Speak with Mara at the water tower';if(mission.side&&dist(player,animals[0])<5)$('#objective-label').textContent='Bring Cass one deer hide';if(mission.sideReady)$('#objective-label').textContent='Return to Cass at the fir camp';if(player.mounted&&horse.bond<4)horse.bond=Math.min(4,horse.bond+dt*.003);updateHUD();}

// ---------------------------------------------------------------------------
// Input and responsive mobile controls
// ---------------------------------------------------------------------------
window.addEventListener('keydown',(e)=>{keys[e.code]=true;if(e.code==='Escape'){if(dialogue){dialogue=null;$('#dialogue').classList.add('hidden');}else if(gameStarted)togglePause();}if(e.code==='KeyE'||e.code==='Space')interact();if(e.code==='KeyF')whistle();if(e.code==='KeyR')reload();if(e.code==='KeyQ'){player.weapon=player.weapon==='IRONWIND'?'PINE NEEDLE':'IRONWIND';$('#weapon-label').textContent=player.weapon;toast(`Equipped ${player.weapon}`,1000);}if(e.code==='Enter'&&dialogue)advanceDialogue();});window.addEventListener('keyup',(e)=>{keys[e.code]=false});
canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',(e)=>{if(!gameStarted||paused)return;mouseDown=true;canvas.setPointerCapture?.(e.pointerId);if(e.button===0)fire();if(e.button===2){player.aiming=true;aimHeld=true;}});canvas.addEventListener('pointerup',(e)=>{mouseDown=false;if(e.button===2){player.aiming=false;aimHeld=false;}});let lastPointer=null;canvas.addEventListener('pointermove',(e)=>{if(lastPointer&&mouseDown&&e.button!==0){cameraOrbit+= (e.clientX-lastPointer.x)*.006;cameraPitch=clamp(cameraPitch+(e.clientY-lastPointer.y)*.004,-.25,.38);}lastPointer={x:e.clientX,y:e.clientY};});canvas.addEventListener('pointerleave',()=>lastPointer=null);
function bindTouch(){const joy=$('#joystick');let active=false,origin={x:0,y:0};joy.addEventListener('pointerdown',e=>{active=true;joy.setPointerCapture(e.pointerId);origin={x:e.clientX,y:e.clientY};});joy.addEventListener('pointermove',e=>{if(!active)return;const dx=e.clientX-origin.x,dy=e.clientY-origin.y;const l=Math.min(38,Math.hypot(dx,dy)),a=Math.atan2(dy,dx);const kx=Math.cos(a)*l,ky=Math.sin(a)*l;joy.querySelector('i').style.transform=`translate(${kx}px,${ky}px)`;keys.KeyW=dy<-12;keys.KeyS=dy>12;keys.KeyA=dx<-12;keys.KeyD=dx>12;});joy.addEventListener('pointerup',()=>{active=false;joy.querySelector('i').style.transform='';['KeyW','KeyA','KeyS','KeyD'].forEach(k=>keys[k]=false);});$$('[data-touch]').forEach(b=>{b.addEventListener('pointerdown',()=>{const a=b.dataset.touch;if(a==='fire')fire();if(a==='aim'){player.aiming=true;}if(a==='interact')interact();if(a==='mount')toggleMount();if(a==='whistle')whistle();});b.addEventListener('pointerup',()=>{if(b.dataset.touch==='aim')player.aiming=false;});});}
bindTouch();

function togglePause(){paused=!paused;$('#pause-menu').classList.toggle('hidden',!paused);}
$$('[data-action]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.action;if(a==='new'||a==='continue')setLoading();if(a==='load')loadSave();if(a==='settings')$('#settings-modal').classList.remove('hidden');if(a==='credits')$('#credits-modal').classList.remove('hidden');}));
$$('[data-pause]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.pause;if(a==='resume')togglePause();if(a==='save')autosave();if(a==='settings'){$('#pause-menu').classList.add('hidden');$('#settings-modal').classList.remove('hidden');}if(a==='menu'){paused=false;$('#pause-menu').classList.add('hidden');gameStarted=false;$('#hud').classList.add('hidden');$('#touch-controls').classList.add('hidden');showScreen('main-menu');}}));
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>{$(`#${b.dataset.close}-modal`).classList.add('hidden');}));$('#sens-range').addEventListener('input',e=>{$('#sens-output').textContent=`${e.target.value}%`;});$$('.toggle').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('on');b.textContent=b.classList.contains('on')?'ON':'OFF';}));
$('#dialogue').addEventListener('click',advanceDialogue);

// ---------------------------------------------------------------------------
// Loop and title ambience
// ---------------------------------------------------------------------------
function frame(now){const dt=Math.min(.05,(now-last)/1000);last=now;accumulator+=dt;if(gameStarted&&!paused)tick(dt);if(gameStarted)renderWorld(now);requestAnimationFrame(frame);}
$('#title-enter').addEventListener('click',()=>showScreen('main-menu'));
showScreen('title-screen');requestAnimationFrame(frame);
