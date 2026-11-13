const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = Number(process.env.PORT || 10000);
const rooms = new Map();
const server = http.createServer((req,res) => {
  res.writeHead(200, {'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'});
  res.end(JSON.stringify({ok:true,service:'starlight-rpg-server',rooms:rooms.size,uptime:Math.floor(process.uptime())}));
});
const wss = new WebSocketServer({server});
const code = () => { let n; do { n=String(Math.floor(100000+Math.random()*900000)); } while([...rooms.values()].some(r=>r.code===n)); return n; };
const send = (ws,msg) => { if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
const broadcast = (room,msg,except=null) => { for(const p of room.players.values()) if(p.ws!==except) send(p.ws,msg); };
const publicList = () => [...rooms.values()].filter(r=>r.public && r.players.size>0).map(r=>({name:r.name,players:r.players.size,max:r.max,code:r.code}));
function leave(ws) {
  const room=ws.room; if(!room)return;
  const p=room.players.get(ws.playerId); room.players.delete(ws.playerId);
  if(p) broadcast(room,{t:'rpg-player-left',id:p.id,name:p.name});
  ws.room=null; ws.playerId=null;
  if(room.players.size===0) rooms.delete(room.code);
  else broadcast(room,{t:'rpg-server-list',servers:publicList()});
}
function join(ws,room,name,msg) {
  if(room.players.size>=room.max) return send(ws,{t:'rpg-error',msg:'서버 인원이 가득 찼어.'});
  const id='p'+Math.random().toString(36).slice(2,11);
  const player={id,name:String(name||'모험가').slice(0,12),x:320,y:230,region:'town',outfit:{},heroClass:'warrior',secondJob:''};
  player.ws=ws; room.players.set(id,player); ws.room=room; ws.playerId=id;
  send(ws,{t:'rpg-joined',you:id,code:room.code,players:[...room.players.values()].filter(p=>p.id!==id).map(({ws,...p})=>p),world:room.world});
  broadcast(room,{t:'rpg-player-joined',player:{id:player.id,name:player.name,x:player.x,y:player.y,region:player.region,outfit:player.outfit,heroClass:player.heroClass,secondJob:player.secondJob}},ws);
  broadcast(room,{t:'rpg-server-list',servers:publicList()});
}
wss.on('connection',ws=>{
  ws.on('message',raw=>{
    let m; try { m=JSON.parse(raw.toString()); } catch { return; }
    if(!m || typeof m.t!=='string') return;
    if(m.t==='rpg-server-list') { send(ws,{t:'rpg-server-list',servers:publicList()}); return; }
    if(m.t==='rpg-create' || m.t==='rpg-public') {
      leave(ws);
      const c=code(), room={code:c,name:String(m.serverName||m.name||'모험가의 서버').slice(0,24),public:m.t==='rpg-public'||m.public===true,max:24,players:new Map(),world:null,life:null,land:{}};
      rooms.set(c,room); join(ws,room,m.name,m); return;
    }
    if(m.t==='rpg-join') {
      leave(ws);
      const room=[...rooms.values()].find(r=>r.code===String(m.code||'').trim().toUpperCase());
      if(!room) return send(ws,{t:'rpg-error',msg:'서버를 찾을 수 없어. 방 코드를 확인해 줘.'});
      join(ws,room,m.name,m); return;
    }
    const room=ws.room, player=room&&room.players.get(ws.playerId);
    if(!room||!player) return;
    if(m.t==='rpg-leave') { leave(ws); return; }
    if(m.t==='rpg-pos') {
      player.x=Number.isFinite(m.x)?m.x:player.x; player.y=Number.isFinite(m.y)?m.y:player.y;
      if(typeof m.region==='string')player.region=m.region;
      if(m.outfit&&typeof m.outfit==='object')player.outfit=m.outfit;
      if(typeof m.heroClass==='string')player.heroClass=m.heroClass;
      if(typeof m.secondJob==='string')player.secondJob=m.secondJob;
      const {ws:ignored,...data}=player; broadcast(room,{t:'rpg-pos',player:data},ws); return;
    }
    if(m.t==='rpg-region') { player.region=String(m.region||'town'); broadcast(room,{t:'rpg-region',id:player.id,region:player.region}); return; }
    if(m.t==='rpg-chat') { const text=String(m.text||'').trim().slice(0,180); if(text) broadcast(room,{t:'rpg-chat',name:player.name,text}); return; }
    if(m.t==='rpg-life-state') { room.life=m.life||{}; broadcast(room,{t:'rpg-life-state',life:room.life},ws); return; }
    if(m.t==='rpg-land-buy') {
      const parcel=String(m.parcel||'').slice(0,80);
      if(!parcel)return;
      if(room.land[parcel]) send(ws,{t:'rpg-land-state',ok:false,msg:'이미 다른 모험가가 구매한 땅이야.',land:room.land});
      else { room.land[parcel]={id:player.id,name:player.name}; broadcast(room,{t:'rpg-land-state',ok:true,by:player.id,parcel,land:room.land}); }
      return;
    }
    if(m.t==='rpg-hit') {
      const region=String(m.region||''); const index=Math.max(0,Math.floor(Number(m.index)||0));
      const damage=Math.max(0,Math.min(999,Number(m.damage)||0));
      broadcast(room,{t:'rpg-hit',region,index,damage,by:player.id},ws); return;
    }
  });
  ws.on('close',()=>leave(ws));
  ws.on('error',()=>leave(ws));
});
server.listen(PORT,'0.0.0.0',()=>console.log('Starlight RPG server listening on '+PORT));
