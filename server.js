const http=require('http');
const crypto=require('crypto');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=process.env.PORT||10000;
const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'});res.end(JSON.stringify({ok:true,service:'starlight-rpg-server',rooms:rooms.size,uptime:Math.floor(process.uptime())}));});
const wss=new WebSocketServer({server});
const rooms=new Map(),clients=new Map();
const MAX=24;
const clean=(v,n=24)=>String(v??'').replace(/[<>\\r\\n]/g,'').trim().slice(0,n);
const code=()=>{let s;do{s=crypto.randomBytes(3).toString('hex').toUpperCase()}while([...rooms.values()].some(r=>r.code===s));return s};
const send=(ws,obj)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))};
const broadcast=(room,obj,except=null)=>{for(const id of room.players.keys()){const c=clients.get(id);if(c&&c!==except)send(c,obj)}};
const list=()=>[...rooms.values()].filter(r=>r.public&&r.players.size).map(r=>({name:r.name,players:r.players.size,max:MAX,code:r.code}));
const worldFor=r=>({hp:r.hp,life:r.life,land:r.land});
function leave(ws){const p=clients.get(ws._id);if(!p)return;const r=rooms.get(p.room);if(r){r.players.delete(p.id);broadcast(r,{t:'rpg-player-left',id:p.id});if(!r.players.size)rooms.delete(r.code)}clients.delete(p.id);ws._id=null}
function fail(ws,msg){send(ws,{t:'rpg-error',msg})}
wss.on('connection',ws=>{ws._id=null;ws.on('message',raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return}if(!m||typeof m.t!=='string')return;
if(m.t==='rpg-server-list'){send(ws,{t:'rpg-server-list',servers:list()});return}
if(m.t==='rpg-create'||m.t==='rpg-join'){
 if(ws._id)leave(ws);
 let room;
 if(m.t==='rpg-create'){room={code:code(),name:clean(m.serverName||m.name||'모험가의 서버',24)||'모험가의 서버',public:!!m.public,players:new Map(),hp:{},life:null,land:{}};rooms.set(room.code,room)}
 else{const c=clean(m.code,6).toUpperCase();room=rooms.get(c);if(!room){fail(ws,'방을 찾을 수 없어. 방 코드를 확인해 줘!');return}}
 if(room.players.size>=MAX){fail(ws,'서버 인원이 가득 찼어!');return}
 const id=crypto.randomUUID(),player={id,name:clean(m.name||'모험가',12)||'모험가',region:'town',x:320,y:230,outfit:m.avatar||null,heroClass:'warrior',secondJob:''};
 room.players.set(id,player);clients.set(id,ws);ws._id=id;ws._room=room.code;
 send(ws,{t:'rpg-joined',you:id,code:room.code,players:[...room.players.values()],world:worldFor(room)});
 broadcast(room,{t:'rpg-player-joined',player},ws);return;
 }
 const p=clients.get(ws._id),room=p&&rooms.get(p.room);if(!p||!room){if(m.t==='rpg-leave')return;return}
 if(m.t==='rpg-leave'){leave(ws);return}
 if(m.t==='rpg-pos'){const player=room.players.get(p.id);player.x=Number.isFinite(+m.x)?+m.x:player.x;player.y=Number.isFinite(+m.y)?+m.y:player.y;player.region=clean(m.region,24)||player.region;player.outfit=m.outfit||player.outfit;player.heroClass=clean(m.heroClass,24)||player.heroClass;player.secondJob=clean(m.secondJob,24);broadcast(room,{t:'rpg-pos',player},ws);return}
 if(m.t==='rpg-region'){const player=room.players.get(p.id);player.region=clean(m.region,24)||'town';broadcast(room,{t:'rpg-region',id:p.id,region:player.region});return}
 if(m.t==='rpg-life-state'){room.life=m.life||null;broadcast(room,{t:'rpg-life-state',life:room.life},ws);return}
 if(m.t==='rpg-land-buy'){const parcel=clean(m.parcel,40);if(!parcel)return;if(room.land[parcel]){send(ws,{t:'rpg-land-state',ok:false,msg:'이미 다른 모험가가 구매한 땅이야!',land:room.land});return}room.land[parcel]={id:p.id,name:room.players.get(p.id).name};broadcast(room,{t:'rpg-land-state',ok:true,by:p.id,land:room.land});return}
 if(m.t==='rpg-chest'){const region=clean(m.region,24),index=Math.max(0,Math.min(500,Math.floor(+m.index||0))),key=region+':'+index;room.chests=room.chests||{};if(room.chests[key]){send(ws,{t:'rpg-error',msg:'누군가 이미 이 보물 상자를 열었어!'});return}room.chests[key]=true;const reward=15+Math.floor(Math.random()*20);send(ws,{t:'rpg-chest-state',region,index,by:p.id,reward});broadcast(room,{t:'rpg-chest-state',region,index,by:p.id,reward},ws);return}
 if(m.t==='rpg-monster-state'){const region=clean(m.region,24),index=Math.max(0,Math.min(500,Math.floor(+m.index||0)));room.hp[region]=room.hp[region]||[];room.hp[region][index]=Math.max(0,Number(m.hp)||0);broadcast(room,{t:'rpg-monster-state',region,index,hp:room.hp[region][index],alive:!!m.alive,by:p.id,world:worldFor(room)});return}
 if(m.t==='rpg-reset'){room.hp={};room.chests={};broadcast(room,{t:'rpg-reset',world:worldFor(room)});return}
 if(m.t==='rpg-chat'){const text=clean(m.text,180);if(text)broadcast(room,{t:'rpg-chat',name:room.players.get(p.id).name,text});return}
 });ws.on('close',()=>leave(ws));ws.on('error',()=>leave(ws));});
server.listen(PORT,'0.0.0.0',()=>console.log('Starlight RPG server listening on '+PORT));
