const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = Number(process.env.PORT || 10000);
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '');
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const databaseReady = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
async function dbRequest(path, options={}) {
  if (!databaseReady) return null;
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, { ...options, headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error('Supabase HTTP ' + response.status + ': ' + body.slice(0,200));
  return body ? JSON.parse(body) : null;
}
async function loadStoredPatchNotes() {
  if (!databaseReady) return;
  const rows = await dbRequest('game_settings?select=value&key=eq.patch_notes&limit=1');
  if (rows && rows[0] && rows[0].value && typeof rows[0].value.text === 'string') patchNotes = rows[0].value.text.slice(0,2500);
}
async function storePatchNotes(text) {
  if (!databaseReady) return false;
  await dbRequest('game_settings?on_conflict=key', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify({ key:'patch_notes', value:{text}, updated_at:new Date().toISOString() }) });
  return true;
}
function mapSuggestion(row) { return { id:Number(row.id), name:row.player_name, text:row.content, reply:row.reply || '', createdAt:row.created_at, ownerId:row.owner_id }; }
async function listSuggestions(ownerId=null) {
  if (!databaseReady) return suggestions.filter(x=>!ownerId || x.ownerId===ownerId).map(({ws:origin,...item})=>item);
  const filter = ownerId ? '&owner_id=eq.'+encodeURIComponent(ownerId) : '';
  const rows = await dbRequest('player_suggestions?select=id,owner_id,player_name,content,reply,created_at&order=created_at.desc&limit=100'+filter);
  return (rows || []).map(mapSuggestion);
}
async function createSuggestionRecord(name, content, ownerId) {
  if (!databaseReady) return null;
  const rows = await dbRequest('player_suggestions?select=id,owner_id,player_name,content,reply,created_at', { method:'POST', headers:{ Prefer:'return=representation' }, body:JSON.stringify({ owner_id:ownerId, player_name:name, content, reply:'' }) });
  return rows && rows[0] ? mapSuggestion(rows[0]) : null;
}
async function updateSuggestionReply(id, reply) {
  if (!databaseReady) return null;
  const rows = await dbRequest('player_suggestions?id=eq.'+encodeURIComponent(id)+'&select=id,owner_id,player_name,content,reply,created_at', { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify({ reply }) });
  return rows && rows[0] ? mapSuggestion(rows[0]) : null;
}
const rooms = new Map();
let patchNotes = '별빛 숲 RPG 업데이트 소식을 확인해 줘!';
const suggestions = [];
let nextSuggestionId = 1;
const server = http.createServer((req,res) => {
  res.writeHead(200, {'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'});
  res.end(JSON.stringify({ok:true,service:'starlight-rpg-server',rooms:rooms.size,uptime:Math.floor(process.uptime()),adminConfigured:!!ADMIN_TOKEN,databaseConfigured:databaseReady,websocket:true,build:process.env.RENDER_GIT_COMMIT||'unknown'}));
});
const wss = new WebSocketServer({server});
const code = () => { let n; do { n=String(Math.floor(100000+Math.random()*900000)); } while([...rooms.values()].some(r=>r.code===n)); return n; };
const send = (ws,msg) => { if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
const broadcast = (room,msg,except=null) => { for(const p of room.players.values()) if(p.ws!==except) send(p.ws,msg); };
const publicList = () => [...rooms.values()].filter(r=>r.public && r.players.size>0).map(r=>({name:r.name,players:r.players.size,max:r.max,code:r.code}));
const safeEqual = (a,b) => { const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); };
const ITEM_KEYS = new Set(['gold','xp','potions','reviveStones','seeds','starCore','classChangeTickets','stone','copper','iron','crystal','floor','wall','door','flower','fence','bench','lampPost','pond']);
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
  const id='p'+crypto.randomBytes(5).toString('hex');
  const player={id,name:String(name||'모험가').slice(0,12),x:320,y:230,region:'town',outfit:{},heroClass:'warrior',secondJob:''};
  player.ws=ws; room.players.set(id,player); ws.room=room; ws.playerId=id;
  send(ws,{t:'rpg-joined',you:id,code:room.code,players:[...room.players.values()].filter(p=>p.id!==id).map(({ws,...p})=>p),world:room.world,patchNotes});
  broadcast(room,{t:'rpg-player-joined',player:{id:player.id,name:player.name,x:player.x,y:player.y,region:player.region,outfit:player.outfit,heroClass:player.heroClass,secondJob:player.secondJob}},ws);
  broadcast(room,{t:'rpg-server-list',servers:publicList()});
}
wss.on('connection',ws=>{
  console.log('[ws] client connected');
  ws.isAdmin=false;
  ws.on('message',raw=>{
    let m; try { m=JSON.parse(raw.toString()); } catch { console.warn('[ws] invalid JSON message'); return; }
    if(!m || typeof m.t!=='string') return;
    if(m.t==='rpg-create'||m.t==='rpg-public'||m.t==='rpg-join') console.log('[ws] room request:',m.t,'name:',String(m.name||'').slice(0,12),'code:',String(m.code||''));
    if(m.t==='rpg-admin-auth') {
      ws.isAdmin=!!ADMIN_TOKEN && safeEqual(m.token||'',ADMIN_TOKEN);
      send(ws,ws.isAdmin?{t:'rpg-admin-auth-ok',patchNotes}:{t:'rpg-admin-auth-failed',msg:ADMIN_TOKEN?'관리자 비밀키가 올바르지 않아.':'서버에 ADMIN_TOKEN 환경 변수가 설정되지 않았어.'});
      return;
    }
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
    if(m.t==='rpg-admin-notice') {
      if(!ws.isAdmin) return send(ws,{t:'rpg-admin-result',msg:'관리자 권한이 없어.'});
      const text=String(m.text||'').trim().slice(0,180);
      if(!text) return send(ws,{t:'rpg-admin-result',msg:'공지 내용을 입력해 줘.'});
      for(const r of rooms.values()) broadcast(r,{t:'rpg-admin-notice',text});
      send(ws,{t:'rpg-admin-result',msg:'전체 서버에 공지를 보냈어.'});
      return;
    }
    if(m.t==='rpg-admin-grant-solo') {
      if(!ws.isAdmin) return send(ws,{t:'rpg-admin-result',msg:'관리자 권한이 없어.'});
      const item=String(m.item||''),amount=Math.floor(Number(m.amount));
      if(!ITEM_KEYS.has(item)||!Number.isFinite(amount)||amount<1||amount>100000) return send(ws,{t:'rpg-admin-result',msg:'아이템 또는 수량이 올바르지 않아.'});
      send(ws,{t:'rpg-admin-item',item,amount});
      send(ws,{t:'rpg-admin-result',msg:'솔로 캐릭터에게 '+item+' × '+amount+' 지급 완료!'});
      return;
    }
    if(m.t==='rpg-admin-patchnotes') {
      if(!ws.isAdmin) return send(ws,{t:'rpg-admin-result',msg:'관리자 권한이 없어.'});
      const text=String(m.text||'').trim().slice(0,2500);
      if(!text) return send(ws,{t:'rpg-admin-result',msg:'패치노트 내용을 입력해 줘.'});
      patchNotes=text;
      storePatchNotes(text).then(saved=>{
        for(const client of wss.clients) send(client,{t:'rpg-admin-patchnotes',text});
        send(ws,{t:'rpg-admin-result',msg:saved?'패치노트를 게시하고 영구 저장했어.':'패치노트를 게시했어. (데이터베이스 미설정: 서버 재시작 시 초기화될 수 있어)'});
      }).catch(error=>{console.error('[patchnotes]',error.message);send(ws,{t:'rpg-admin-result',msg:'패치노트 게시 완료. 데이터베이스 저장은 실패했어.'});for(const client of wss.clients)send(client,{t:'rpg-admin-patchnotes',text})});
      return;
    }
    if(m.t==='rpg-admin-suggestions-get') {
      if(!ws.isAdmin) return send(ws,{t:'rpg-admin-result',msg:'관리자 권한이 없어.'});
      listSuggestions().then(items=>send(ws,{t:'rpg-suggestion-list',items})).catch(error=>{console.error('[suggestions]',error.message);send(ws,{t:'rpg-suggestion-list',items:suggestions.map(({ws:origin,...item})=>item)})});
      return;
    }
    if(m.t==='rpg-admin-suggestion-reply') {
      if(!ws.isAdmin) return send(ws,{t:'rpg-admin-result',msg:'관리자 권한이 없어.'});
      const id=Number(m.id), reply=String(m.text||'').trim().slice(0,500);
      if(!Number.isSafeInteger(id)||id<1||!reply) return send(ws,{t:'rpg-admin-result',msg:'건의 또는 답변을 확인해 줘.'});
      updateSuggestionReply(id,reply).then(updated=>{
        const item=updated || suggestions.find(x=>x.id===id);
        if(!item) return send(ws,{t:'rpg-admin-result',msg:'건의를 찾지 못했어.'});
        item.reply=reply;
        for(const client of wss.clients)send(client,{t:'rpg-suggestion-reply',ownerId:item.ownerId,item:{id:item.id,reply}});
        send(ws,{t:'rpg-admin-result',msg:databaseReady?'건의 #'+id+'에 답장했고 저장했어.':'건의 #'+id+'에 답장했어. (서버 재시작 시 초기화될 수 있어)'});
        listSuggestions().then(items=>send(ws,{t:'rpg-suggestion-list',items})).catch(()=>{});
      }).catch(error=>{console.error('[suggestion-reply]',error.message);send(ws,{t:'rpg-admin-result',msg:'답장 저장에 실패했어. 데이터베이스 설정을 확인해 줘.'})});
      return;
    }
    if(m.t==='rpg-suggestion-my') {
      const ownerId=String(m.ownerId||'').slice(0,80);
      if(!ownerId) return;
      listSuggestions(ownerId).then(items=>send(ws,{t:'rpg-suggestion-my',items})).catch(error=>{console.error('[suggestion-my]',error.message);send(ws,{t:'rpg-suggestion-my',items:suggestions.filter(x=>x.ownerId===ownerId).map(({ws:origin,...item})=>item)})});
      return;
    }
    if(m.t==='rpg-suggestion') {
      const name=String(m.name||'모험가').trim().slice(0,12)||'모험가';
      const text=String(m.text||'').trim().slice(0,500);
      const ownerId=String(m.ownerId||'').slice(0,80);
      if(text.length<3) return send(ws,{t:'rpg-admin-result',msg:'건의는 3글자 이상 입력해 줘.'});
      createSuggestionRecord(name,text,ownerId).then(saved=>{
        const item=saved || {id:nextSuggestionId++,name,text,reply:'',createdAt:Date.now(),ownerId,ws};
        item.ws=ws;suggestions.push(item);while(suggestions.length>100)suggestions.shift();
        listSuggestions().then(items=>{for(const client of wss.clients)if(client.isAdmin)send(client,{t:'rpg-suggestion-list',items})}).catch(()=>{});
        send(ws,{t:'rpg-admin-result',msg:databaseReady?'건의 #'+item.id+' 접수 완료! 안전하게 저장했어.':'건의 #'+item.id+' 접수 완료! (데이터베이스 미설정: 서버 재시작 시 초기화될 수 있어)'});
      }).catch(error=>{console.error('[suggestion-create]',error.message);send(ws,{t:'rpg-admin-result',msg:'건의 저장에 실패했어. 잠시 후 다시 시도해 줘.'})});
      return;
    }
        if(m.t==='rpg-admin-revoke'||m.t==='rpg-admin-revoke-solo') {
      if(!ws.isAdmin) return send(ws,{t:'rpg-admin-result',msg:'관리자 권한이 없어.'});
      const item=String(m.item||''),amount=Math.floor(Number(m.amount));
      if(!ITEM_KEYS.has(item)||!Number.isFinite(amount)||amount<1||amount>100000) return send(ws,{t:'rpg-admin-result',msg:'아이템 또는 수량이 올바르지 않아.'});
      const target=String(m.target||'all');
      if(!ws.room) {
        send(ws,{t:'rpg-admin-remove-item',item,amount});
        send(ws,{t:'rpg-admin-result',msg:'솔로 캐릭터에게서 '+item+' 회수 명령을 보냈어.'});
        return;
      }
      const recipients=target==='all'?[...ws.room.players.values()]:[ws.room.players.get(target)].filter(Boolean);
      if(!recipients.length)return send(ws,{t:'rpg-admin-result',msg:'회수할 플레이어를 찾지 못했어.'});
      for(const recipient of recipients)send(recipient.ws,{t:'rpg-admin-remove-item',item,amount});
      send(ws,{t:'rpg-admin-result',msg:recipients.length+'명에게서 '+item+' × '+amount+' 회수 명령을 보냈어.'});
      return;
    }
    if(!room||!player) return;
    if(m.t==='rpg-admin-grant') {
      if(!ws.isAdmin) return send(ws,{t:'rpg-admin-result',msg:'관리자 권한이 없어.'});
      const item=String(m.item||''),amount=Math.floor(Number(m.amount));
      if(!ITEM_KEYS.has(item)||!Number.isFinite(amount)||amount<1||amount>100000) return send(ws,{t:'rpg-admin-result',msg:'아이템 또는 수량이 올바르지 않아.'});
      const target=String(m.target||'all');
      const recipients=target==='all'?[...room.players.values()]:[room.players.get(target)].filter(Boolean);
      if(!recipients.length) return send(ws,{t:'rpg-admin-result',msg:'지급할 플레이어를 찾지 못했어.'});
      for(const recipient of recipients) send(recipient.ws,{t:'rpg-admin-item',item,amount});
      send(ws,{t:'rpg-admin-result',msg:recipients.length+'명에게 '+item+' × '+amount+' 지급 명령을 보냈어.'});
      return;
    }
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
  ws.on('error',err=>{ console.error('[ws] client error:',err&&err.message||err); leave(ws); });
});
loadStoredPatchNotes().catch(error=>console.error('[patchnotes-load]',error.message));
server.listen(PORT,'0.0.0.0',()=>console.log('Starlight RPG server listening on '+PORT));
