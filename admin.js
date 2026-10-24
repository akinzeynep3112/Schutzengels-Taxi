const $=id=>document.getElementById(id);
let status=null;
function fmt(s){s=Math.max(0,Math.floor(s));return `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor(s%3600/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;}
function parseTime(v){const p=v.trim().split(":").map(Number);if(p.length!==3||p.some(x=>!Number.isInteger(x)||x<0)||p[1]>59||p[2]>59)return null;return p[0]*3600+p[1]*60+p[2];}
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Fehler");return d;}
function showAdmin(){ $("login-panel").classList.add("hidden");$("admin-panel").classList.remove("hidden");load();}
function showLogin(){ $("admin-panel").classList.add("hidden");$("login-panel").classList.remove("hidden");}

function render(data){
  status=data;
  $("toggle").textContent=data.running?"Alle Timer pausieren":"Alle Timer starten";
  const wrap=$("admin-slots");
  
  if(wrap.children.length !== data.slots.length){
    wrap.innerHTML="";
    data.slots.forEach(s=>{
      const card=document.createElement("div");card.className="admin-row";card.dataset.slot=s.slot;
      const heading=document.createElement("div");heading.className="admin-heading";heading.innerHTML=`<strong>Platz ${s.slot}</strong><span class="muted class-time">${fmt(s.remainingSeconds)}</span>`;
      const form=document.createElement("form");form.className="slot-form";
      const nameLabel=document.createElement("label");nameLabel.textContent="Ingame-Name";const name=document.createElement("input");name.name="name";name.maxLength=40;name.value=s.name;nameLabel.append(name);
      const timeLabel=document.createElement("label");timeLabel.textContent="Left Time (HH:MM:SS)";const time=document.createElement("input");time.name="time";time.value=fmt(s.remainingSeconds);time.placeholder="23:59:59";timeLabel.append(time);
      const save=document.createElement("button");save.type="submit";save.className="secondary";save.textContent="Speichern";form.append(nameLabel,timeLabel,save);
      
      form.addEventListener("submit",async e=>{
        e.preventDefault();
        const seconds=parseTime(time.value);
        if(seconds===null){$("message").textContent="Zeit bitte als Stunden:Minuten:Sekunden eingeben, z. B. 23:59:59.";return;}
        try{
          const d=await api(`/api/slots/${s.slot}`,{method:"PUT",body:JSON.stringify({name:name.value,remainingSeconds:seconds})});
          render(d);
          $("message").textContent=`Platz ${s.slot} gespeichert.`;
        }catch(err){$("message").textContent="Fehler: "+err.message;}
      });
      card.append(heading,form);wrap.append(card);
    });
  } else {
    data.slots.forEach(s=>{
      const card=wrap.querySelector(`[data-slot="${s.slot}"]`);
      if(card){
        const heading=card.querySelector(".class-time");
        if(heading) heading.textContent = fmt(s.remainingSeconds);
        const timeInput = card.querySelector('input[name="time"]');
        const nameInput = card.querySelector('input[name="name"]');
        if(timeInput && document.activeElement !== timeInput){
          timeInput.value = fmt(s.remainingSeconds);
        }
        nameInput.value = s.name;
      }
    });
  }
}

async function load(){
  try{ render(await api("/api/status")); }
  catch(e){ if(e.message==="Nicht angemeldet") showLogin(); else $("message").textContent="Fehler: "+e.message; }
}

$("login-form").addEventListener("submit",async e=>{
  e.preventDefault();
  $("login-error").textContent="";
  try{
    await api("/api/login",{method:"POST",body:JSON.stringify({username:$("username").value,password:$("password").value})});
    showAdmin();
  }catch(err){$("login-error").textContent=err.message;}
});

$("toggle").addEventListener("click",async()=>{
  try{
    const resData = await api("/api/toggle",{method:"POST",body:"{}"});
    render(resData);
    $("message").textContent = resData.running ? "Timer gestartet!" : "Timer pausiert!";
  }catch(e){
    $("message").textContent = "Fehler beim Starten: " + e.message;
  }
});

$("logout").addEventListener("click",async()=>{
  try{ await api("/api/logout",{method:"POST",body:"{}"}); }
  finally{ showLogin(); }
});

load();
setInterval(()=>{ if(!$("admin-panel").classList.contains("hidden")) load(); }, 2000);
