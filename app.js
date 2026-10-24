const slotsEl = document.getElementById("slots");
const stateEl = document.getElementById("state");
let latest = null;
function fmt(s){s=Math.max(0,Math.floor(s));const h=String(Math.floor(s/3600)).padStart(2,"0");const m=String(Math.floor(s%3600/60)).padStart(2,"0");const sec=String(s%60).padStart(2,"0");return `${h}:${m}:${sec}`;}
function render(data){latest=data;stateEl.textContent=data.running?"LÄUFT":"PAUSIERT";stateEl.className="pill "+(data.running?"green":"amber");slotsEl.innerHTML="";
 data.slots.forEach(s=>{const row=document.createElement("article");row.className="slot";
 const num=document.createElement("span");num.className="number";num.textContent=s.slot;
 const info=document.createElement("div");info.className="slot-info";const name=document.createElement("strong");name.textContent=s.name||"Freier Platz";const label=document.createElement("small");label.textContent="LEFT TIME";info.append(name,label);
 const time=document.createElement("time");time.className="time";time.textContent=fmt(s.remainingSeconds);
 row.append(num,info,time);slotsEl.append(row);});}
async function refresh(){try{const r=await fetch("/api/status",{cache:"no-store"});render(await r.json());}catch(e){stateEl.textContent="VERBINDUNG FEHLER";}}
refresh();setInterval(refresh,1000);