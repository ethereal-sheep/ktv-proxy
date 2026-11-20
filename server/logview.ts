// Usage-log viewer: /api/logs (page, live-updating) and /api/logs.json?after=<id>&n=<rows>&type=<type>. No auth, same as the rest of the app (LAN only).
import type { ServerResponse } from 'node:http'
import { listEvents } from './db.ts'

const page = `<!doctype html><meta name=viewport content="width=device-width"><title>KTV log</title>
<style>body{font:13px ui-monospace,monospace;margin:8px}input,select,button{font:inherit}td.r{text-align:right}td{padding:1px 8px 1px 0;white-space:nowrap;vertical-align:top}
tr.song_start,tr.song_stop{color:#0a7}tr.session_start,tr.session_end,tr.box_connect,tr.box_disconnect{color:#a60}.d{white-space:normal;color:#888}</style>
<p><select id=t><option value="">all<option>request<option>song_start<option>song_stop<option>session_start<option>session_end<option>box_connect<option>box_disconnect<option>client_seen</select>
<input id=f placeholder="filter text"> <label><input type=checkbox id=live checked> live</label> <span id=n></span>
<table><tbody id=b></tbody></table>
<script>
let last=0,rows=[];const $=i=>document.getElementById(i);
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const dc=s=>{try{return decodeURIComponent(s)}catch{return s}};
const tr=r=>'<tr class="'+r.type+'"><td>'+new Date(r.ts).toLocaleString('sv')+'.'+String(r.ts%1000).padStart(3,'0')+'<td>'+r.type+'<td>'+(r.client||'-').slice(0,6)+'<td>'+(r.session||'-').slice(0,4)+'<td>'+esc(r.origin)+
 '<td class=r>'+(r.ms==null?'':r.ms+'ms')+'<td>'+(r.method?esc(r.method+' '+dc(r.path)+(r.query?'?'+dc(r.query):'')+' '+r.status):'')+'<td>'+(r.song_name?esc(r.song_name+' - '+r.singer):'')+'<td class=d>'+esc(r.data);
function draw(){const f=$('f').value.toLowerCase(),v=rows.filter(r=>!f||JSON.stringify(r).toLowerCase().includes(f));
 $('b').innerHTML=v.slice(-500).reverse().map(tr).join('');$('n').textContent=v.length+' rows'}
async function load(reset){if(reset){last=0;rows=[]}
 const j=await(await fetch('/api/logs.json?n=500&after='+last+'&type='+$('t').value)).json();
 if(j.length){last=j[j.length-1].id;rows=rows.concat(j).slice(-2000);draw()}}
$('t').onchange=()=>load(true);$('f').oninput=draw;load(true);setInterval(()=>$('live').checked&&load(),2000)
</script>`

export function logview(path: string, q: URLSearchParams, res: ServerResponse): boolean {
  if (path === '/api/logs') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); return true }
  if (path !== '/api/logs.json') return false
  const n = Math.min(Math.max(+(q.get('n') ?? 100) || 100, 1), 2000)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(listEvents(+(q.get('after') ?? 0) || 0, n, q.get('type') || undefined)))
  return true
}
