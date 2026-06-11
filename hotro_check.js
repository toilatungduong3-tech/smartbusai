
/* ── Galaxy Canvas ── */
(function(){
  const cv=document.getElementById("gc"),ctx=cv.getContext("2d");
  function mb32(s){s=s>>>0;return()=>{s+=0x6D2B79F5;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
  function draw(){
    cv.width=innerWidth;cv.height=innerHeight;
    const g=ctx.createRadialGradient(cv.width*.5,cv.height*.3,0,cv.width*.5,cv.height*.3,cv.width*.85);
    g.addColorStop(0,"#0c1830");g.addColorStop(.5,"#080f1c");g.addColorStop(1,"#04080f");
    ctx.fillStyle=g;ctx.fillRect(0,0,cv.width,cv.height);
    const rng=mb32(cv.width*cv.height+13);
    const n=Math.min(320,Math.floor(cv.width*cv.height/5000));
    for(let i=0;i<n;i++){
      const x=rng()*cv.width,y=rng()*cv.height,r=rng()*1.4+.15,a=rng()*.7+.2;
      const h=rng()<.11?180:rng()<.07?265:0;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fillStyle=h===180?`rgba(0,255,224,${a*.5})`:h===265?`rgba(170,148,255,${a*.42})`:`rgba(255,255,255,${a})`;ctx.fill();
    }
    [{x:.10,y:.18,r:.14,c:"rgba(0,190,255,0.055)"},{x:.78,y:.68,r:.14,c:"rgba(120,75,240,0.065)"}].forEach(s=>{
      const ng=ctx.createRadialGradient(s.x*cv.width,s.y*cv.height,0,s.x*cv.width,s.y*cv.height,s.r*cv.width);
      ng.addColorStop(0,s.c);ng.addColorStop(1,"transparent");ctx.fillStyle=ng;ctx.fillRect(0,0,cv.width,cv.height);
    });
  }
  draw();let rt;window.addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(draw,200);});
})();

/* ── Page transition ── */
document.addEventListener("click",e=>{
  const a=e.target.closest("a[href]");if(!a)return;
  const h=a.getAttribute("href");if(!h||h==="#"||h.startsWith("http"))return;
  e.preventDefault();
  document.body.style.transition="opacity .2s";document.body.style.opacity="0";
  setTimeout(()=>{window.location.href=h;},210);
});

const API="/api";
function logout(){localStorage.clear();window.location.href="../auth/login.html";}

/* ── Clock ── */
function updateClock(){
  const now=new Date();
  const hh=String(now.getHours()).padStart(2,"0");
  const mm=String(now.getMinutes()).padStart(2,"0");
  const el=document.getElementById("ssbClock");
  if(el) el.textContent=`${hh}:${mm} — ${now.toLocaleDateString("vi-VN",{weekday:"short",day:"2-digit",month:"2-digit"})}`;
}
updateClock();setInterval(updateClock,30000);

/* ── Toast ── */
function toast(msg,type="info"){
  const w=document.getElementById("toastWrap");
  const el=document.createElement("div");el.className=`toast ${type}`;
  const icons={success:"✅",error:"❌",info:"ℹ️"};
  el.innerHTML=`<span>${icons[type]||"ℹ️"}</span><span>${msg}</span>`;
  w.appendChild(el);
  setTimeout(()=>{el.style.animation="toastOut .3s ease forwards";setTimeout(()=>el.remove(),320);},4000);
}

/* ── Copy helper ── */
function copyText(text,label){
  navigator.clipboard.writeText(text).then(()=>{
    toast(`✅ Đã sao chép ${label}: ${text}`,"success");
  }).catch(()=>toast("Không sao chép được","error"));
}

/* ── User init ── */
function _initUser(){
  try{
    /* Dùng getUser() từ api.js (đã load sẵn), fallback về parse thủ công */
    const u = (typeof getUser==="function" ? getUser() : null)
           || JSON.parse(localStorage.getItem("user")||"null");
    if(!u){
      /* Chưa đăng nhập */
      const row=document.getElementById("userInfoRow");
      if(row) row.innerHTML=`<span style="font-size:12.5px;color:var(--text2);">⚠️ Chưa đăng nhập — <a href="../auth/login.html" style="color:#5dc8ff;">Đăng nhập ngay</a></span>`;
      return;
    }
    /* Lấy tên hiển thị: ưu tiên full_name → username → email */
    const nm = (u.full_name||"").trim() || (u.username||"").trim() || (u.email||"").trim() || "Người dùng";
    /* Cập nhật navbar */
    const navEl=document.getElementById("headerUserName");
    if(navEl) navEl.textContent=nm;
    /* Cập nhật user info row trong form */
    const uiName=document.getElementById("uiName");
    const uiEmail=document.getElementById("uiEmail");
    if(uiName) uiName.textContent=nm;
    if(uiEmail) uiEmail.textContent=u.email||"";
  }catch(e){console.warn("[hotro] user init error:",e);}
}
/* Chạy ngay (script ở cuối body, DOM đã sẵn sàng) VÀ đảm bảo bằng DOMContentLoaded */
_initUser();
if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",_initUser);
}

/* ── Priority chips ── */
let _priority="normal";
function setPriority(p,el){
  _priority=p;
  document.querySelectorAll(".pchip").forEach(c=>c.classList.remove("on"));
  el.classList.add("on");
}

/* ── Char counter ── */
function updateCharCount(){
  const ta=document.getElementById("reqContent");
  const cc=document.getElementById("charCounter");
  if(!ta||!cc) return;
  const len=ta.value.length;
  cc.textContent=`${len} / 1000`;
  cc.className="char-counter"+(len>900?" warn":"")+(len>=1000?" over":"");
}

/* ── Smart suggest on type change ── */
const TYPE_FAQ_MAP={
  booking:["booking","booking","booking"],
  payment:["payment","payment","payment"],
  refund:["refund","refund","refund"],
  account:["account","account"],
  technical:["technical","technical"],
};
function onTypeChange(){
  const val=document.getElementById("reqType").value;
  const ss=document.getElementById("smartSuggest");
  const si=document.getElementById("suggestItems");
  if(!val||!TYPE_FAQ_MAP[val]){ss.style.display="none";return;}
  const matches=FAQ_DATA.filter(f=>f.cat===val).slice(0,3);
  if(!matches.length){ss.style.display="none";return;}
  si.innerHTML=matches.map((f,i)=>`
    <div class="ss-item" onclick="openFaqFromSuggest('${f.cat}',${FAQ_DATA.indexOf(f)})">
      ${f.q}
    </div>`).join("");
  ss.style.display="block";
}
function openFaqFromSuggest(cat,idx){
  switchTab("faq",document.getElementById("tabFaq"));
  setTimeout(()=>{
    setFaqCat(cat,document.querySelector(`.faq-cat[onclick*="'${cat}'"]`)||document.querySelector(".faq-cat.active"));
    const itemId=`faq-${cat}-${FAQ_DATA.filter(f=>f.cat===cat).findIndex((f,i)=>FAQ_DATA.indexOf(f)===idx)}`;
    setTimeout(()=>{
      const el=document.getElementById(itemId);
      if(el){el.classList.add("open");el.scrollIntoView({behavior:"smooth",block:"center"});}
    },200);
  },100);
}

/* ── Tabs ── */
function switchTab(name,btn){
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
  const panel=document.getElementById("panel-"+name);
  if(panel) panel.classList.add("active");
  if(btn) btn.classList.add("active");
  else{
    const map={send:"tabSend",mine:"tabMine",faq:"tabFaq",ai:"tabAI"};
    const b=document.getElementById(map[name]);
    if(b) b.classList.add("active");
  }
  if(name==="mine") loadMyRequests();
  if(name==="faq") renderFaq();
  if(name==="ai") initAITab();
}

/* ── Quick Actions ── */
function quickAction(type){
  const map={
    lost_ticket:{title:"Mất vé - Lấy lại mã vé",type:"booking"},
    refund:{title:"Yêu cầu hoàn tiền",type:"refund"},
    change_seat:{title:"Đổi ghế / đổi chuyến",type:"refund"},
    delay:{title:"Báo cáo xe trễ hoặc sự cố",type:"complaint"}
  };
  const m=map[type]||{};
  switchTab("send",document.getElementById("tabSend"));
  setTimeout(()=>{
    const titleEl=document.getElementById("reqTitle");
    const typeEl=document.getElementById("reqType");
    if(titleEl) titleEl.value=m.title||"";
    if(typeEl){ typeEl.value=m.type||""; onTypeChange(); }
    if(titleEl) titleEl.focus();
  },120);
}

/* ── Submit request ── */
let myRequests=[];
async function submitRequest(){
  const type=document.getElementById("reqType").value;
  const title=document.getElementById("reqTitle").value.trim();
  const content=document.getElementById("reqContent").value.trim();
  const bookingId=document.getElementById("reqBookingId").value.trim();
  if(!type){toast("Vui lòng chọn loại yêu cầu","error");return;}
  if(!title){toast("Vui lòng nhập tiêu đề yêu cầu","error");return;}
  if(!content){toast("Vui lòng nhập nội dung chi tiết","error");return;}
  let user=null;
  try{user=JSON.parse(localStorage.getItem("user"));}catch{}
  if(!user?.user_id){
    toast("Bạn cần đăng nhập để gửi yêu cầu","error");
    setTimeout(()=>{window.location.href="../auth/login.html";},1500);
    return;
  }
  const TYPE_MAP={general:"GENERAL",booking:"BOOKING",payment:"PAYMENT",
    refund:"REFUND",technical:"TECHNICAL",complaint:"COMPLAINT",other:"OTHER"};
  const payload={
    user_id:user.user_id,
    booking_id:bookingId?(parseInt(bookingId.replace(/\D/g,""))||null):null,
    type:TYPE_MAP[type]||type.toUpperCase(),
    title, content,
    priority:_priority.toUpperCase()
  };
  const submitBtn=document.getElementById("submitBtn");
  if(submitBtn){submitBtn.disabled=true;submitBtn.innerHTML="⏳ Đang gửi...";}
  try{
    const res=await fetch(`${API}/support/requests`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.message||`HTTP ${res.status}`);
    myRequests.unshift({
      id:data.request_id?`#${data.request_id}`:`#${Date.now()}`,
      type,title,content,booking_id:bookingId||null,
      status:"pending",created_at:new Date().toISOString(),priority:_priority
    });
    updateBadge();
    ["reqType","reqTitle","reqContent","reqBookingId"].forEach(id=>{
      const el=document.getElementById(id);if(el)el.value="";
    });
    updateCharCount();
    document.getElementById("smartSuggest").style.display="none";
    toast("✅ Đã gửi yêu cầu thành công! Chúng tôi sẽ phản hồi sớm nhất.","success");
    setTimeout(()=>switchTab("mine",document.getElementById("tabMine")),1400);
  }catch(err){
    toast("Không gửi được: "+err.message,"error");
  }finally{
    if(submitBtn){submitBtn.disabled=false;submitBtn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Gửi yêu cầu hỗ trợ';}
  }
}

function updateBadge(){
  const b=document.getElementById("myReqBadge");
  if(!b) return;
  b.textContent=myRequests.length;
  b.className="tab-badge"+(myRequests.length===0?" zero":"");
}

/* ── Load / render my requests ── */
const TYPE_LABELS={general:"❓ Thắc mắc",booking:"🎫 Đặt vé",payment:"💳 Thanh toán",
  refund:"💰 Hoàn tiền",technical:"🔧 Kỹ thuật",complaint:"⚠️ Khiếu nại",other:"📝 Khác"};
const STATUS_MAP={
  pending:{cls:"pending",label:"⏳ Chờ xử lý"},
  processing:{cls:"processing",label:"🔄 Đang xử lý"},
  resolved:{cls:"resolved",label:"✅ Đã giải quyết"},
  closed:{cls:"closed",label:"🔒 Đã đóng"},
};
function fmtDate(s){try{return new Date(s).toLocaleString("vi-VN",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});}catch{return s;}}

async function loadMyRequests(){
  let user=null;
  try{user=JSON.parse(localStorage.getItem("user"));}catch{}
  if(!user?.user_id){renderMyRequests();return;}
  const btn=document.getElementById("refreshBtn");
  if(btn) btn.classList.add("spinning");
  try{
    const res=await fetch(`${API}/support/user/${user.user_id}`,{signal:AbortSignal.timeout(5000)});
    if(!res.ok) throw new Error();
    const data=await res.json();
    myRequests=Array.isArray(data)?data:[];
  }catch{}
  if(btn) btn.classList.remove("spinning");
  renderMyRequests();
  updateBadge();
}

function refreshRequests(){loadMyRequests();}

function renderReqTimeline(status){
  const steps=[{lbl:"Đã gửi",icon:"📨"},{lbl:"Xử lý",icon:"⚙️"},{lbl:"Phản hồi",icon:"💬"},{lbl:"Hoàn thành",icon:"✅"}];
  const statusIdx={"OPEN":0,"NEW":0,"PENDING":0,"IN_PROGRESS":1,"PROCESSING":1,"RESPONDED":2,"REPLIED":2,"CLOSED":3,"RESOLVED":3,"DONE":3};
  const cur=statusIdx[status?.toUpperCase()]??0;
  return `<div class="req-timeline">${steps.map((s,i)=>`
    <div class="tl-step ${i<cur?"done":i===cur?"current":""}">
      <div class="tl-dot">${s.icon}</div>
      <div class="tl-lbl">${s.lbl}</div>
    </div>`).join("")}</div>`;
}

function renderMyRequests(){
  const container=document.getElementById("myReqList");
  if(!myRequests.length){
    container.innerHTML=`<div class="req-empty">
      <span class="ei">💬</span>
      <h3>Chưa có yêu cầu nào</h3>
      <p>Nếu bạn gặp vấn đề, hãy gửi yêu cầu hỗ trợ — chúng tôi phản hồi trong vòng 2 giờ</p>
      <button class="ei-btn" onclick="switchTab('send',document.getElementById('tabSend'))">
        📨 Gửi yêu cầu ngay
      </button>
    </div>`;return;
  }
  _ticketFilter="";
  document.querySelectorAll(".req-filter").forEach((b,i)=>b.classList.toggle("on",i===0));
  _renderFilteredRequests(myRequests);
}

function rateReq(btn,val){
  const row=btn.closest(".rate-row");
  if(!row) return;
  row.querySelectorAll(".rate-btn").forEach(b=>b.classList.add("rated"));
  toast(val==="good"?"😊 Cảm ơn phản hồi của bạn!":"📝 Chúng tôi sẽ cải thiện dịch vụ!", val==="good"?"success":"info");
}

/* ── Ticket search + filter ── */
let _ticketFilter="";
function filterTickets(){
  const q=(document.getElementById("ticketSearch")?.value||"").toLowerCase();
  const filtered=myRequests.filter(r=>{
    const matchQ=!q||r.title?.toLowerCase().includes(q)||(r.booking_id||"").toString().includes(q)||(r.content||"").toLowerCase().includes(q);
    const matchF=!_ticketFilter||r.status?.toLowerCase()===_ticketFilter;
    return matchQ&&matchF;
  });
  _renderFilteredRequests(filtered);
}
function setTicketFilter(f,el){
  _ticketFilter=f;
  document.querySelectorAll(".req-filter").forEach(b=>b.classList.remove("on"));
  el.classList.add("on");
  filterTickets();
}
function _renderFilteredRequests(list){
  const container=document.getElementById("myReqList");
  if(!list.length){
    container.innerHTML=`<div class="req-empty">
      <span class="ei">🔍</span>
      <h3>Không tìm thấy yêu cầu</h3>
      <p>Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc</p>
    </div>`;return;
  }
  container.innerHTML=`<div class="req-list">${list.map((r,ri)=>{
    const st=STATUS_MAP[(r.status||"").toLowerCase()]||STATUS_MAP.pending;
    const typeKey=(r.type||"").toLowerCase();
    const isResolved=["resolved","closed","done"].includes((r.status||"").toLowerCase());
    const priMap={normal:"",high:`<span style="font-size:10px;font-weight:800;color:#f39c12;background:rgba(243,156,18,.14);border:1px solid rgba(243,156,18,.25);border-radius:6px;padding:1px 6px;">🟡 Khẩn</span>`,urgent:`<span style="font-size:10px;font-weight:800;color:#e74c3c;background:rgba(231,76,60,.14);border:1px solid rgba(231,76,60,.25);border-radius:6px;padding:1px 6px;">🔴 Khẩn cấp</span>`};
    const priBadge=priMap[(r.priority||"").toLowerCase()]||"";
    return`<div class="req-card status-${st.cls}" style="animation-delay:${ri*0.06}s">
      <div class="req-card-top">
        <div>
          <div class="req-card-title">${r.title||"—"} ${priBadge}</div>
          <div class="req-card-id">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2z"/></svg>
            ${r.id||""} · ${TYPE_LABELS[typeKey]||r.type||"—"}
          </div>
        </div>
        <span class="req-status ${st.cls}">${st.label}</span>
      </div>
      ${renderReqTimeline(r.status)}
      <div class="req-meta">
        <span class="req-meta-item">📅 ${fmtDate(r.created_at)}</span>
        ${r.booking_id?`<span class="req-meta-item">🎫 Mã vé: ${r.booking_id}</span>`:""}
      </div>
      ${r.content?`<div class="req-body">${r.content.slice(0,220)}${r.content.length>220?"…":""}</div>`:""}
      ${r.admin_reply?`<div class="req-reply"><b>💬 Phản hồi từ hỗ trợ:</b><br>${r.admin_reply}</div>`:""}
      ${isResolved?`<div class="rate-row">
        <span class="rate-lbl">Hữu ích không?</span>
        <button class="rate-btn rate-good" onclick="rateReq(this,'good')">👍 Hữu ích</button>
        <button class="rate-btn rate-bad" onclick="rateReq(this,'bad')">👎 Chưa hài lòng</button>
      </div>`:""}
    </div>`;
  }).join("")}</div>`;
}

/* ── File upload ── */
let _attachedFiles=[];
function handleFileSelect(files){
  const arr=Array.from(files);
  for(const f of arr){
    if(_attachedFiles.length>=3){toast("Tối đa 3 file đính kèm","error");break;}
    if(f.size>5*1024*1024){toast(`File "${f.name}" vượt quá 5MB`,"error");continue;}
    _attachedFiles.push(f);
  }
  renderFilePreviews();
  document.getElementById("fileInput").value="";
}
function removeFile(idx){_attachedFiles.splice(idx,1);renderFilePreviews();}
function renderFilePreviews(){
  const el=document.getElementById("filePreviews");
  if(!el) return;
  el.innerHTML=_attachedFiles.map((f,i)=>{
    const isImg=f.type.startsWith("image/");
    return`<div class="fp-item">
      ${isImg
        ?`<img src="${URL.createObjectURL(f)}" alt="${f.name}">`
        :`<div class="fp-name">${f.name}</div>`
      }
      <button class="fp-del" onclick="removeFile(${i})">✕</button>
    </div>`;
  }).join("");
  /* drag-over effect */
  const zone=document.getElementById("fileDropZone");
  if(zone){
    zone.ondragover=e=>{e.preventDefault();zone.classList.add("drag-over");};
    zone.ondragleave=()=>zone.classList.remove("drag-over");
    zone.ondrop=e=>{e.preventDefault();zone.classList.remove("drag-over");handleFileSelect(e.dataTransfer.files);};
  }
}

/* ── FAQ Data ── */
const FAQ_DATA=[
  /* ─ BOOKING ─ */
  {cat:"booking",q:"Làm thế nào để đặt vé xe?",a:"Nhập điểm đi, điểm đến và ngày muốn đi tại trang chủ, chọn chuyến xe và ghế phù hợp. Tiến hành thanh toán để hoàn tất."},
  {cat:"booking",q:"Tôi có thể đặt vé trước bao nhiêu ngày?",a:"Bạn có thể đặt tối đa 30 ngày trước. Ghế được giữ 15 phút sau khi chọn; nếu chưa thanh toán hệ thống tự huỷ."},
  {cat:"booking",q:"Số lượng vé tối đa mỗi lần đặt là bao nhiêu?",a:"Tối đa 4 ghế mỗi giao dịch. Cần nhiều hơn, thực hiện thêm giao dịch mới."},
  {cat:"booking",q:"Có thể đặt vé cho người khác không?",a:"Có, bạn có thể đặt vé cho người thân. Nhập thông tin hành khách chính xác trong quá trình đặt vé."},
  {cat:"booking",q:"Tôi có thể chọn ghế cụ thể không?",a:"Có, hệ thống hiển thị sơ đồ chỗ ngồi trực quan. Bạn có thể chọn ghế yêu thích (cửa sổ, lối đi, tầng trên/dưới với xe giường nằm)."},
  {cat:"booking",q:"Ghế tôi chọn bị người khác đặt mất thì sao?",a:"Ghế được giữ 15 phút kể từ lúc bạn chọn. Nếu bạn chưa thanh toán trong thời gian đó, ghế sẽ được mở lại. Hãy thanh toán ngay sau khi chọn ghế."},
  {cat:"booking",q:"Làm thế nào để in vé hoặc lưu vé?",a:"Sau khi thanh toán, vào Tài khoản → Lịch sử đặt vé → chọn vé muốn in. Ngoài ra email xác nhận có đính kèm mã QR vé."},
  {cat:"booking",q:"Tôi có thể xem lại lịch sử đặt vé không?",a:`Có. Vào <a href="profile.html">Tài khoản</a> → tab Đặt vé của tôi. Toàn bộ vé lịch sử được lưu vĩnh viễn.`},

  /* ─ PAYMENT ─ */
  {cat:"payment",q:"Hệ thống hỗ trợ những phương thức thanh toán nào?",a:"SmartBusAI hỗ trợ: MoMo, ZaloPay, VNPay QR, Thẻ tín dụng/ghi nợ nội địa, Tiền mặt tại quầy. Tất cả giao dịch được mã hoá SSL 256-bit."},
  {cat:"payment",q:"Thanh toán thất bại thì ghế có bị mất không?",a:"Nếu thanh toán thất bại, ghế giải phóng sau ~10 phút. Bạn có thể thử lại ngay hoặc dùng phương thức thanh toán khác."},
  {cat:"payment",q:"Tôi có nhận xác nhận sau khi thanh toán không?",a:"Có, hệ thống gửi email xác nhận kèm mã vé và QR code sau khi thanh toán thành công. Thường đến trong 1–2 phút."},
  {cat:"payment",q:"Thanh toán MoMo bị trừ tiền nhưng vé không hiện?",a:"Vui lòng đợi 5–10 phút để hệ thống đồng bộ. Nếu vẫn không thấy vé, chụp màn hình lịch sử giao dịch MoMo và gửi yêu cầu hỗ trợ. Tiền sẽ không bị mất."},
  {cat:"payment",q:"Hóa đơn VAT tôi có thể lấy không?",a:"Bạn có thể yêu cầu hóa đơn VAT khi đặt vé (chọn mục 'Xuất hóa đơn') hoặc gửi yêu cầu trong vòng 24h sau khi mua vé qua mục Hỗ trợ."},

  /* ─ REFUND ─ */
  {cat:"refund",q:"Tôi có thể hủy vé và hoàn tiền không?",a:"Có thể huỷ trước 24h khởi hành. Chính sách: huỷ trước 48h — hoàn 100%; từ 24–48h — hoàn 70%; dưới 24h — không hoàn tiền."},
  {cat:"refund",q:"Tiền hoàn về đâu và mất bao lâu?",a:"Hoàn về phương thức thanh toán ban đầu trong 3–7 ngày làm việc tùy ngân hàng/ví điện tử. MoMo/ZaloPay thường nhanh hơn (1–3 ngày)."},
  {cat:"refund",q:"Chuyến xe bị hủy thì tôi có được hoàn không?",a:"Có, nhà xe hủy chuyến → hoàn 100% tự động và thông báo email ngay lập tức. Không cần liên hệ hỗ trợ."},
  {cat:"refund",q:"Tôi đặt nhầm chuyến, có đổi được không?",a:"Bạn có thể hủy và đặt lại (áp dụng chính sách hoàn tiền). Hiện tại chưa hỗ trợ đổi vé trực tiếp; tính năng này đang phát triển."},
  {cat:"refund",q:"Tôi đặt vé nhưng không đi được, có hoàn không?",a:"Áp dụng đúng chính sách hoàn tiền theo thời điểm hủy: trước 48h hoàn 100%, 24–48h hoàn 70%, dưới 24h không hoàn. Vui lòng hủy sớm nhất có thể."},

  /* ─ ACCOUNT ─ */
  {cat:"account",q:"Tôi quên mật khẩu thì làm sao?",a:`Tại trang đăng nhập, nhấn "Quên mật khẩu" và nhập email đã đăng ký. Hệ thống gửi link đặt lại mật khẩu. Kiểm tra cả hộp thư Spam nếu không thấy email.`},
  {cat:"account",q:"Làm thế nào để cập nhật thông tin cá nhân?",a:`Đăng nhập → vào <a href="profile.html">Tài khoản</a> → chỉnh sửa Họ tên, Số điện thoại, Địa chỉ → nhấn Lưu thay đổi.`},
  {cat:"account",q:"Tôi có thể đổi email đăng nhập không?",a:"Hiện tại email đăng nhập không thể thay đổi để bảo mật tài khoản. Nếu cần thiết, vui lòng liên hệ hỗ trợ kèm CMND/CCCD để xác minh."},
  {cat:"account",q:"Tài khoản bị khóa phải làm gì?",a:"Tài khoản có thể bị khóa do vi phạm điều khoản hoặc giao dịch bất thường. Liên hệ hotline 1900 6789 hoặc gửi yêu cầu hỗ trợ với đầy đủ thông tin xác minh."},
  {cat:"account",q:"Làm thế nào để xóa tài khoản?",a:`Vào <a href="profile.html">Tài khoản</a> → cuối trang → nhấn "Xóa tài khoản". Lưu ý: dữ liệu không thể khôi phục sau khi xóa.`},

  /* ─ TECHNICAL ─ */
  {cat:"technical",q:"Ứng dụng bị lỗi không tải được chuyến xe?",a:"Thử: (1) Làm mới trang Ctrl+F5, (2) Xoá cache trình duyệt, (3) Thử trình duyệt khác (Chrome/Firefox). Vẫn lỗi → gửi yêu cầu hỗ trợ kèm mô tả chi tiết và ảnh chụp màn hình."},
  {cat:"technical",q:"Tại sao trang thanh toán bị lỗi?",a:"Thường do mạng không ổn định hoặc ví/thẻ hết hạn. Kiểm tra kết nối và thử lại. Vẫn lỗi → gọi hotline 1900 6789 hoặc dùng phương thức thanh toán khác."},
  {cat:"technical",q:"QR code vé không quét được thì sao?",a:"Đảm bảo màn hình đủ sáng và không bị nhăn. Thử đặt điện thoại gần máy quét hơn. Nếu vẫn không được, nhân viên có thể nhập mã vé thủ công tại quầy."},
  {cat:"technical",q:"Website hiển thị sai trên điện thoại?",a:"SmartBusAI tương thích tốt với Chrome/Safari trên mobile. Nếu gặp lỗi hiển thị, hãy thử cập nhật trình duyệt lên phiên bản mới nhất. Báo lỗi cho chúng tôi kèm ảnh chụp màn hình."},

  /* ─ LOYALTY ─ */
  {cat:"loyalty",q:"Chương trình thành viên hoạt động như thế nào?",a:"Mỗi lần đặt vé bạn tích lũy điểm. 3 cấp hạng: 🥉 Đồng (0–10 chuyến), 🥈 Bạc (11–30 chuyến), 🥇 Vàng (31+ chuyến). Hạng cao = ưu đãi lớn hơn."},
  {cat:"loyalty",q:"Hạng thành viên Vàng có lợi ích gì?",a:"Hạng Vàng (31+ chuyến): Ưu tiên chọn ghế đẹp, hoàn tiền nhanh hơn (1–2 ngày), hỗ trợ đường dây riêng, giảm 5% trên mỗi vé, tặng vé miễn phí theo dịp."},
  {cat:"loyalty",q:"Điểm tích lũy có hết hạn không?",a:"Điểm tích lũy không hết hạn miễn là tài khoản còn hoạt động (có ít nhất 1 giao dịch trong 12 tháng). Tài khoản không hoạt động 12 tháng sẽ bị đặt lại về hạng Đồng."},
  {cat:"loyalty",q:"Tôi có thể chuyển điểm cho người khác không?",a:"Hiện tại điểm tích lũy chỉ áp dụng cho tài khoản cá nhân và không thể chuyển cho người khác."},

  /* ─ SERVICE ─ */
  {cat:"service",q:"Xe có đúng giờ không? Nếu trễ thì sao?",a:"Hầu hết các chuyến đúng giờ. Nếu xe trễ hơn 30 phút, bạn có quyền yêu cầu hoàn tiền 100% hoặc đổi sang chuyến khác. Báo ngay qua hotline 1900 6789."},
  {cat:"service",q:"Hành lý mang theo được không và giới hạn là bao nhiêu?",a:"Mỗi hành khách được mang tối đa 20kg hành lý. Hành lý quá khổ/quá cân cần thoả thuận thêm với nhà xe. Mỗi tuyến có thể có quy định khác nhau."},
  {cat:"service",q:"Xe có wifi/điều hoà/ổ cắm điện không?",a:"Tùy nhà xe và loại xe. Thông tin tiện nghi được hiển thị chi tiết trên trang chọn chuyến xe trước khi đặt vé."},
  {cat:"service",q:"Điểm đón/trả khách ở đâu?",a:"Mỗi chuyến có điểm đón và trả riêng, hiển thị rõ trên trang đặt vé và trong email xác nhận. Một số nhà xe có hỗ trợ đón tại nhà (liên hệ trực tiếp nhà xe)."},
  {cat:"service",q:"Tôi có thể đánh giá chuyến xe sau khi đi không?",a:`Có, sau khi chuyến hoàn thành bạn có thể đánh giá sao và nhận xét tại <a href="profile.html">Tài khoản</a> → Lịch sử đặt vé → chọn chuyến đã đi.`},
];

let faqCat="",faqQuery="";
function setFaqCat(cat,el){
  faqCat=cat;
  document.querySelectorAll(".faq-cat").forEach(c=>c.classList.remove("active"));
  if(el) el.classList.add("active");
  renderFaq();
}
function filterFaq(){faqQuery=document.getElementById("faqSearch").value.toLowerCase();renderFaq();}

function renderFaq(){
  const filtered=FAQ_DATA.filter(f=>
    (!faqCat||f.cat===faqCat)&&
    (!faqQuery||f.q.toLowerCase().includes(faqQuery)||f.a.toLowerCase().includes(faqQuery))
  );
  const catNames={booking:"🎫 Đặt vé",payment:"💳 Thanh toán",refund:"💰 Hoàn tiền & Hủy vé",account:"👤 Tài khoản",technical:"🔧 Kỹ thuật"};
  const groups={};
  filtered.forEach(f=>{if(!groups[f.cat])groups[f.cat]=[];groups[f.cat].push(f);});
  const container=document.getElementById("faqContainer");
  if(!filtered.length){
    container.innerHTML=`<div style="text-align:center;padding:48px 20px;color:var(--text3);">
      <div style="font-size:40px;margin-bottom:12px;opacity:.35;">🔍</div>
      <div style="font-size:14px;font-weight:700;">Không tìm thấy câu hỏi phù hợp</div>
      <div style="font-size:12.5px;margin-top:6px;color:var(--text3);">Hãy gửi yêu cầu hỗ trợ để được giải đáp trực tiếp.</div>
    </div>`;return;
  }
  let html="";
  Object.entries(groups).forEach(([cat,items])=>{
    html+=`<div class="faq-group"><div class="faq-group-title">${catNames[cat]||cat}</div>`;
    items.forEach((f,i)=>{
      const id=`faq-${cat}-${i}`;
      // Highlight search query
      let q=f.q, a=f.a;
      if(faqQuery){
        const re=new RegExp(`(${faqQuery.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`, "gi");
        q=q.replace(re,`<mark style="background:rgba(0,255,224,.25);color:#00ffe0;border-radius:3px;padding:0 2px;">$1</mark>`);
      }
      html+=`<div class="faq-item" id="${id}">
        <div class="faq-q" onclick="toggleFaq('${id}')">
          <span class="faq-q-text">${q}</span>
          <span class="faq-chevron">▼</span>
        </div>
        <div class="faq-a">
          ${a}
          <div class="faq-helpful">
            <span class="faq-helpful-lbl">Câu trả lời này có hữu ích không?</span>
            <button class="faq-help-btn fhb-yes" onclick="faqRate(this,'yes')">👍 Có</button>
            <button class="faq-help-btn fhb-no" onclick="faqRate(this,'no')">👎 Không</button>
          </div>
        </div>
      </div>`;
    });
    html+="</div>";
  });
  container.innerHTML=html;
}

function toggleFaq(id){document.getElementById(id)?.classList.toggle("open");}

function faqRate(btn,val){
  const row=btn.closest(".faq-helpful");
  if(!row) return;
  row.querySelectorAll(".faq-help-btn").forEach(b=>{b.disabled=true;b.style.opacity=".45";});
  row.innerHTML+=`<span style="font-size:11px;color:var(--text3);margin-left:4px;">${val==="yes"?"Cảm ơn! 😊":"Cảm ơn phản hồi 📝"}</span>`;
}

/* ═══ AI CHAT PANEL ═══ */
/* ═══════════════════════════════════════════════
   SMARTBOT AI ENGINE v2
   ─ Vietnamese normalization
   ─ Intent detection + context tracking
   ─ Rich responses with action buttons
   ─ Multi-turn follow-up awareness
═══════════════════════════════════════════════ */

/* ── Text normalization (remove Vietnamese diacritics) ── */
function _norm(s){
  if(!s) return "";
  const map="àáảãạăắặằẳẵâấầẩẫậ,a|đ,d|èéẻẽẹêếềểễệ,e|ìíỉĩị,i|òóỏõọôốồổỗộơớờởỡợ,o|ùúủũụưứừửữự,u|ỳýỷỹỵ,y".split("|").reduce((acc,pair)=>{
    const[chars,rep]=pair.split(",");
    chars.split("").forEach(c=>{acc[c]=rep;acc[c.toUpperCase()]=rep.toUpperCase();});
    return acc;
  },{});
  return s.toLowerCase().split("").map(c=>map[c]||c).join("");
}

/* ── Context state ── */
let _lastTopic=null;
let _turnCount=0;
let _chatOpen=false;
let _chatHistory=[];

/* ── Intent definitions ── */
const INTENTS=[
  /* GREETINGS */
  {id:"greet", pats:[/^(xin chao|chao|hello|hi|hey|alo|good morning|chào buổi|chao buoi)\b/],
   fn:()=>{
    const h=new Date().getHours();
    const g=h<5?"Chào đêm khuya":h<12?"Chào buổi sáng":h<18?"Chào buổi chiều":"Chào buổi tối";
    return{text:`${g}! 👋 Tôi là <b>SmartBot AI</b> — trợ lý thông minh của SmartBusAI.<br><br>Tôi có thể giúp bạn về:<br>🎫 Đặt vé · 💳 Thanh toán · 💰 Hoàn tiền · 🏆 Thành viên · 🔧 Lỗi kỹ thuật<br><br>Hỏi tôi bất cứ điều gì nhé!`,
    acts:[],topic:"greet"};
  }},
  /* THANKS */
  {id:"thanks", pats:[/cam on|thanks|thank you|tuyet|hay lam|tot lam|ok|oke\b/],
   fn:()=>({text:"Rất vui được giúp bạn! 😊 Nếu còn thắc mắc gì hãy hỏi tiếp — tôi ở đây 24/7!",acts:[],topic:null})},
  /* YES (follow-up) */
  {id:"yes", pats:[/^(co|yes|dung|uh|ừ|uh huh|phải)\b/],
   fn:()=>{
    if(_lastTopic==="refund") return{text:"Để gửi yêu cầu hoàn tiền nhanh nhất, vui lòng điền form bên dưới kèm mã vé liên quan.",acts:[{l:"📨 Gửi yêu cầu hoàn tiền",a:"quickAction('refund');closeAIChat()"}],topic:"refund"};
    if(_lastTopic==="booking") return{text:"Bạn vào Trang chủ → nhập điểm đi/đến + ngày → chọn chuyến → chọn ghế → thanh toán là xong!",acts:[{l:"🚌 Đặt vé ngay",a:"window.location.href='index.html'"}],topic:"booking"};
    return{text:"Bạn có thể hỏi thêm chi tiết để tôi hỗ trợ tốt hơn nhé!",acts:[],topic:null};
  }},
  /* REFUND */
  {id:"refund", pats:[/hoan tien|hoan ve|refund|tra tien|lay tien|bao lau hoan|khi nao hoan|tien ve/],
   fn:()=>({text:"💰 <b>Chính sách hoàn tiền SmartBusAI:</b><br><br>• Hủy <b>trước 48h</b> khởi hành → Hoàn <b>100%</b><br>• Hủy trong <b>24 – 48h</b> → Hoàn <b>70%</b><br>• Hủy <b>dưới 24h</b> → Không hoàn tiền<br>• Nhà xe hủy chuyến → Hoàn <b>100% tự động</b><br><br>⏱️ Thời gian hoàn về tài khoản: <b>3–7 ngày làm việc</b><br>MoMo / ZaloPay nhanh hơn: <b>1–3 ngày</b>",
    acts:[{l:"📨 Yêu cầu hoàn tiền",a:"quickAction('refund');closeAIChat()"},{l:"❓ Xem chi tiết FAQ",a:"faqGoTo('refund',14);closeAIChat()"}],topic:"refund"})},
  /* CANCEL TICKET */
  {id:"cancel", pats:[/huy ve|cancel ticket|doi ve|khong di duoc|muon huy/],
   fn:()=>({text:"🎫 <b>Hủy vé:</b><br><br>Vào <b>Tài khoản → Lịch sử đặt vé</b> → chọn vé → nhấn <b>Hủy vé</b>.<br><br>Lưu ý: hủy càng sớm hoàn tiền càng nhiều. Trước 48h = hoàn 100%.",
    acts:[{l:"👤 Vào Tài khoản",a:"window.location.href='profile.html'"},{l:"💰 Chính sách hoàn",a:"sendQuickChat('Chính sách hoàn tiền là gì?')"}],topic:"refund"})},
  /* BOOKING */
  {id:"booking", pats:[/dat ve|mua ve|book ticket|cach dat|lam sao dat|dat nhu the nao/],
   fn:()=>({text:"🎫 <b>Cách đặt vé SmartBusAI:</b><br><br>1️⃣ Vào <b>Trang chủ</b><br>2️⃣ Nhập điểm đi, điểm đến và ngày đi<br>3️⃣ Chọn chuyến xe phù hợp<br>4️⃣ Chọn ghế yêu thích<br>5️⃣ Thanh toán → nhận QR vé qua email<br><br>📅 Có thể đặt trước tối đa <b>30 ngày</b>",
    acts:[{l:"🚌 Đặt vé ngay",a:"window.location.href='booking.html'"},{l:"❓ FAQ Đặt vé",a:"faqGoTo('booking',0);closeAIChat()"}],topic:"booking"})},
  /* PAYMENT */
  {id:"payment", pats:[/thanh toan|payment|momo|zalopay|vnpay|phuong thuc|the thanh toan|chuyen khoan/],
   fn:()=>({text:"💳 <b>Phương thức thanh toán được hỗ trợ:</b><br><br>• 📱 <b>MoMo</b> — quét QR hoặc nhập SĐT<br>• 💙 <b>ZaloPay</b> — nhanh, bảo mật<br>• 🏦 <b>VNPay QR</b> — hỗ trợ 30+ ngân hàng<br>• 💵 <b>Tiền mặt</b> tại quầy nhà xe<br><br>🔒 Tất cả giao dịch mã hoá <b>SSL 256-bit</b>",
    acts:[{l:"❓ FAQ Thanh toán",a:"faqGoTo('payment',8);closeAIChat()"}],topic:"payment"})},
  /* PAYMENT FAILED */
  {id:"payment_fail", pats:[/thanh toan that bai|loi thanh toan|khong thanh toan|payment fail|bi loi|mat tien|tru tien khong ve|tru tien chua co ve/],
   fn:()=>({text:"💳 <b>Thanh toán bị lỗi / trừ tiền nhưng chưa có vé?</b><br><br>1. Đợi <b>5–10 phút</b> để hệ thống đồng bộ, sau đó kiểm tra lại Tài khoản → Lịch sử đặt vé<br>2. Nếu vẫn không thấy → chụp màn hình <b>lịch sử giao dịch</b> trong app thanh toán<br>3. Gửi yêu cầu hỗ trợ kèm ảnh — tiền <b>không bị mất</b>, sẽ hoàn lại trong 24h",
    acts:[{l:"📨 Báo lỗi thanh toán",a:"quickAction('payment');closeAIChat()"},{l:"📞 Hotline khẩn",a:"window.location.href='tel:19006789'"}],topic:"payment"})},
  /* LOST TICKET */
  {id:"lost_ticket", pats:[/mat ve|quen ve|mat ma|khong thay ve|khong co ve|lay lai ve|tim lai ve/],
   fn:()=>({text:"🎫 <b>Lấy lại vé bị mất / quên mã QR:</b><br><br>1. Vào <b>Tài khoản → Lịch sử đặt vé</b> — vé luôn được lưu tại đây<br>2. Kiểm tra <b>email</b> đăng ký (kể cả thư mục Spam)<br>3. Vé vẫn có hiệu lực — nhân viên có thể tra cứu bằng <b>CMND/CCCD</b> tại quầy<br><br>⚡ Không lo — vé không bị mất dù mất điện thoại!",
    acts:[{l:"👤 Vào Tài khoản",a:"window.location.href='profile.html'"},{l:"📨 Yêu cầu gửi lại vé",a:"quickAction('lost_ticket');closeAIChat()"}],topic:"booking"})},
  /* BUS DELAY */
  {id:"delay", pats:[/xe tre|tre gio|tre chuyen|xe muon|xe chua den|xe khong den|delay|xe bi huy/],
   fn:()=>({text:"⏰ <b>Xe trễ / không đến — bạn cần làm gì:</b><br><br>• Trễ dưới 30 phút: chờ đợi, nhà xe sẽ thông báo<br>• Trễ <b>trên 30 phút</b>: bạn có quyền yêu cầu <b>hoàn 100%</b> hoặc đổi chuyến khác<br>• Nhà xe hủy chuyến: hoàn tiền <b>tự động 100%</b><br><br>📞 Gọi ngay <b>1900 6789</b> để được xử lý ưu tiên!",
    acts:[{l:"📞 Gọi hotline ngay",a:"window.location.href='tel:19006789'"},{l:"📨 Báo cáo sự cố",a:"quickAction('delay');closeAIChat()"}],topic:"service"})},
  /* ACCOUNT / PASSWORD */
  {id:"password", pats:[/mat khau|quen mat khau|khong dang nhap|password|doi mat khau|reset|quen password/],
   fn:()=>({text:"🔑 <b>Quên mật khẩu:</b><br><br>1. Vào trang <a href='../auth/login.html' style='color:#5dc8ff'>Đăng nhập</a><br>2. Nhấn <b>"Quên mật khẩu"</b><br>3. Nhập email đăng ký<br>4. Kiểm tra email (kể cả thư mục <b>Spam</b>)<br>5. Nhấn link trong email để đặt lại mật khẩu",
    acts:[{l:"🔐 Tới trang đăng nhập",a:"window.location.href='../auth/login.html'"},{l:"📨 Liên hệ hỗ trợ",a:"quickAction('account');closeAIChat()"}],topic:"account"})},
  /* SEAT */
  {id:"seat", pats:[/chon ghe|doi ghe|ghe nao|ghe cu the|ghe uu tien|ghe tot|ghe dep/],
   fn:()=>({text:"💺 <b>Chọn ghế khi đặt vé:</b><br><br>Hệ thống hiển thị <b>sơ đồ chỗ ngồi trực quan</b> sau khi chọn chuyến. Bạn có thể chọn:<br>• 🪟 Ghế cửa sổ để ngắm cảnh<br>• 🚶 Ghế lối đi để dễ ra vào<br>• 🛏️ Tầng trên / dưới với xe giường nằm<br><br>⚡ Ghế được giữ <b>15 phút</b> sau khi chọn — hãy thanh toán ngay!",
    acts:[{l:"🚌 Đặt vé & chọn ghế",a:"window.location.href='booking.html'"}],topic:"booking"})},
  /* LOYALTY */
  {id:"loyalty", pats:[/thanh vien|hang vang|hang bac|hang dong|diem tich luy|loyalty|uu dai|giam gia/],
   fn:()=>({text:"🏆 <b>Chương trình thành viên SmartBusAI:</b><br><br>🥉 <b>Đồng</b> (0–10 chuyến): Lịch sử vé vĩnh viễn<br>🥈 <b>Bạc</b> (11–30 chuyến): + Ưu tiên chọn ghế, hỗ trợ nhanh hơn<br>🥇 <b>Vàng</b> (31+ chuyến): + Hoàn tiền 1–2 ngày, giảm 5%/vé, đường dây riêng<br><br>Điểm tích lũy <b>không hết hạn</b> (miễn có giao dịch trong 12 tháng)",
    acts:[{l:"👤 Xem hạng của tôi",a:"window.location.href='profile.html'"},{l:"❓ Xem FAQ thành viên",a:"faqGoTo('loyalty',28);closeAIChat()"}],topic:"loyalty"})},
  /* BAGGAGE */
  {id:"baggage", pats:[/hanh ly|baga|vali|tui xach|can nang|qua can/],
   fn:()=>({text:"🧳 <b>Quy định hành lý:</b><br><br>• Mỗi hành khách được mang tối đa <b>20kg</b><br>• Hành lý quá khổ/quá cân: cần thoả thuận thêm với nhà xe<br>• Mỗi tuyến có thể có quy định <b>khác nhau</b> — kiểm tra khi đặt vé<br><br>💡 Tip: Túi xách nhỏ mang lên xe không tính vào 20kg",
    acts:[{l:"❓ Xem FAQ dịch vụ",a:"faqGoTo('service',32);closeAIChat()"}],topic:"service"})},
  /* WIFI / AMENITIES */
  {id:"amenities", pats:[/wifi|dieu hoa|o cam dien|tien ich|xe co gi|xe the nao|loai xe/],
   fn:()=>({text:"📡 <b>Tiện ích trên xe:</b><br><br>Tùy nhà xe và loại chuyến, thông tin được hiển thị rõ khi chọn chuyến:<br>• WiFi miễn phí (xe cao cấp)<br>• Điều hoà nhiệt độ<br>• Ổ cắm điện / cổng USB<br>• Màn hình giải trí<br>• Nhà vệ sinh (xe dài ngày)<br><br>💡 Tìm kiếm theo loại xe <b>'Limousine'</b> hoặc <b>'Cabin'</b> để có đầy đủ tiện ích nhất",
    acts:[{l:"🚌 Xem chuyến xe",a:"window.location.href='booking.html'"}],topic:"service"})},
  /* CHANGE INFO */
  {id:"change_info", pats:[/sua thong tin|doi thong tin|cap nhat|sai ten|sai so dien thoai|sua ho so/],
   fn:()=>({text:"✏️ <b>Cập nhật thông tin cá nhân:</b><br><br>Vào <b>Tài khoản → tab Thông tin cá nhân</b> → chỉnh sửa Họ tên, SĐT, địa chỉ → nhấn <b>Lưu thay đổi</b>.<br><br>⚠️ Email đăng nhập <b>không thể thay đổi</b> — nếu cần liên hệ hỗ trợ kèm CCCD",
    acts:[{l:"👤 Vào Tài khoản",a:"window.location.href='profile.html'"},{l:"📨 Liên hệ hỗ trợ",a:"quickAction('account');closeAIChat()"}],topic:"account"})},
  /* INVOICE / VAT */
  {id:"invoice", pats:[/hoa don|vat|xuat hoa don|thue/],
   fn:()=>({text:"🧾 <b>Yêu cầu hóa đơn VAT:</b><br><br>• Chọn <b>'Xuất hóa đơn'</b> khi đặt vé trước khi thanh toán<br>• Hoặc gửi yêu cầu trong vòng <b>24h sau khi mua vé</b> qua mục Hỗ trợ<br>• Thông tin cần: Mã số thuế, tên công ty/cá nhân, địa chỉ",
    acts:[{l:"📨 Yêu cầu hóa đơn",a:"quickAction('general');closeAIChat()"}],topic:"general"})},
  /* SUPPORT / CONTACT */
  {id:"contact", pats:[/lien he|hotline|so dien thoai|contact|ho tro truc tiep|gap nguoi that/],
   fn:()=>({text:"📞 <b>Liên hệ SmartBusAI:</b><br><br>• Hotline 24/7: <b>1900 6789</b> (miễn phí)<br>• Email: <b>support@smartbusai.vn</b> (phản hồi &lt;2h)<br>• Zalo OA: <b>SmartBusAI Official</b><br>• Chat AI: <b>Tôi — SmartBot</b> 🤖 (ngay bây giờ!)<br><br>Thứ 2–CN, 07:00–23:00",
    acts:[{l:"📞 Gọi 1900 6789",a:"window.location.href='tel:19006789'"},{l:"📨 Gửi yêu cầu",a:"switchTab('send',document.getElementById('tabSend'));closeAIChat()"}],topic:null})},
];

/* ── Main AI reply engine ── */
function _aiBotReply(rawQuery){
  const q=_norm(rawQuery);
  _turnCount++;

  /* 1. Intent detection */
  for(const intent of INTENTS){
    for(const pat of intent.pats){
      if(pat.test(q)){
        const result=intent.fn(q,rawQuery);
        _lastTopic=result.topic;
        return _buildReply(result);
      }
    }
  }

  /* 2. FAQ fuzzy scoring (normalized comparison) */
  const qNorm=_norm(q);
  const words=qNorm.split(/\s+/).filter(w=>w.length>1);

  const scored=FAQ_DATA.map(f=>{
    const fqn=_norm(f.q), fan=_norm(f.a);
    let s=0;
    words.forEach(w=>{
      if(fqn.includes(w)) s+=4;
      if(fan.includes(w)) s+=1.5;
    });
    /* bonus: 2+ words from question match = highly relevant */
    const matchCount=words.filter(w=>fqn.includes(w)||fan.includes(w)).length;
    if(matchCount>=2) s+=matchCount*1.5;
    return{f,s};
  }).filter(x=>x.s>=3).sort((a,b)=>b.s-a.s);

  if(scored.length>0){
    const top=scored[0].f;
    _lastTopic=top.cat;
    const catMap={booking:"🎫",payment:"💳",refund:"💰",account:"👤",technical:"🔧",loyalty:"🏆",service:"🚌"};
    const otherMatches=scored.slice(1,3).map(x=>`<span style="font-size:11px;color:rgba(255,255,255,.38);">› ${x.f.q}</span>`).join("<br>");
    return _buildReply({
      text:`${catMap[top.cat]||"📚"} <b>${top.q}</b><br><br>${top.a}${otherMatches?`<br><br><div class="acp-divider"></div><span style="font-size:10.5px;color:rgba(255,255,255,.30);">Có thể bạn cũng quan tâm:</span><br>${otherMatches}`:""}`,
      acts:[
        {l:"📖 Xem trong FAQ",a:`faqGoTo('${top.cat}',${FAQ_DATA.indexOf(top)});closeAIChat()`},
        scored.length>1?{l:`❓ "${scored[1].f.q.slice(0,22)}…"`,a:`sendQuickChat('${scored[1].f.q.replace(/'/g,"\\'")}')`,style:"opacity:.75"}:null
      ].filter(Boolean),
      topic:top.cat
    });
  }

  /* 3. Number → booking ID hint */
  if(/\d{4,}/.test(q)){
    return _buildReply({
      text:"🔍 Có vẻ bạn muốn tra cứu theo mã vé? Vui lòng vào <b>Yêu cầu của tôi</b> và nhập mã vé vào ô tìm kiếm, hoặc vào <b>Tài khoản → Lịch sử đặt vé</b>.",
      acts:[{l:"📋 Xem yêu cầu của tôi",a:"switchTab('mine',document.getElementById('tabMine'));closeAIChat()"},{l:"👤 Lịch sử vé",a:"window.location.href='profile.html'"}],
      topic:null
    });
  }

  /* 4. Contextual follow-up */
  if(_lastTopic && _turnCount>1){
    const ctxMap={
      refund:{text:"💰 Để hoàn tiền: gửi yêu cầu kèm mã vé và lý do → xử lý trong 3–7 ngày. Hủy sớm để được hoàn nhiều hơn!",acts:[{l:"📨 Gửi yêu cầu hoàn",a:"quickAction('refund');closeAIChat()"}],topic:"refund"},
      booking:{text:"🎫 Tại trang đặt vé, chọn tuyến → ngày → chuyến → ghế → thanh toán là xong. Có thể đặt trước 30 ngày!",acts:[{l:"🚌 Đặt vé ngay",a:"window.location.href='booking.html'"}],topic:"booking"},
      payment:{text:"💳 Nếu thanh toán lỗi, hãy thử lại sau 5 phút hoặc đổi phương thức. Tiền đã trừ sẽ được hoàn lại trong 24h.",acts:[{l:"📨 Báo lỗi thanh toán",a:"quickAction('payment');closeAIChat()"}],topic:"payment"},
    };
    if(ctxMap[_lastTopic]) return _buildReply(ctxMap[_lastTopic]);
  }

  /* 5. Intelligent fallback with suggestions */
  const suggestions=FAQ_DATA.sort(()=>Math.random()-.5).slice(0,3);
  _lastTopic=null;
  return _buildReply({
    text:`Tôi chưa tìm được câu trả lời chính xác cho "<i>${rawQuery.slice(0,40)}</i>".<br><br>Bạn có thể thử:<br>• Diễn đạt lại câu hỏi ngắn gọn hơn<br>• Chọn một chủ đề gợi ý bên dưới<br>• Hoặc gửi yêu cầu để đội hỗ trợ giải đáp trong 2h`,
    acts:[
      {l:"📨 Gửi yêu cầu hỗ trợ",a:"switchTab('send',document.getElementById('tabSend'));closeAIChat()"},
      {l:"📞 Gọi 1900 6789",a:"window.location.href='tel:19006789'"},
      {l:"🤖 Tìm trong Hỏi AI",a:`switchTab('ai',document.getElementById('tabAI'));setAiQuery('${rawQuery.replace(/'/g,"\\'").slice(0,40)}');closeAIChat()`},
    ],
    topic:null
  });
}

function _buildReply({text,acts=[],topic=null}){
  const actHtml=acts.length
    ?`<div class="acp-actions">${acts.map(a=>`<button class="acp-act-btn${a.style?" style='"+a.style+"'":""}" onclick="${a.a}">${a.l}</button>`).join("")}</div>`
    :"";
  return`<div>${text}</div>${actHtml}`;
}

/* ── Chat panel control ── */
function openAIChat(){
  _chatOpen=true;
  document.getElementById("aiChatPanel").classList.add("open");
  document.getElementById("liveChatBtn").style.display="none";
  if(_chatHistory.length===0) _initChatGreet();
}
function closeAIChat(){
  _chatOpen=false;
  document.getElementById("aiChatPanel").classList.remove("open");
  document.getElementById("liveChatBtn").style.display="flex";
}
function toggleAIChat(){_chatOpen?closeAIChat():openAIChat();}

function _initChatGreet(){
  _addBotMsg("Xin chào! 👋 Tôi là <b>SmartBot AI</b> — trợ lý thông minh của SmartBusAI. Hãy hỏi tôi về đặt vé, thanh toán, hoàn tiền hay bất cứ điều gì!");
  setTimeout(()=>{
    _showTyping();
    setTimeout(()=>{
      _hideTyping();
      _addBotMsg(_buildReply({
        text:"Chọn một chủ đề để bắt đầu nhanh hơn:",
        acts:[
          {l:"💰 Hoàn tiền",a:"sendQuickChat('Chính sách hoàn tiền là gì?')"},
          {l:"🎫 Đặt vé",a:"sendQuickChat('Cách đặt vé xe?')"},
          {l:"💳 Thanh toán",a:"sendQuickChat('Các phương thức thanh toán?')"},
          {l:"⏰ Xe trễ",a:"sendQuickChat('Xe trễ phải làm gì?')"},
        ]
      }));
    },1100);
  },500);
}

function _nowTs(){
  const n=new Date();
  return`${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
}

function _addMsg(role,htmlContent){
  const feed=document.getElementById("acpMsgs");
  if(!feed) return;
  const isBot=role==="bot";
  const div=document.createElement("div");
  div.className=`acp-msg ${role}`;
  div.innerHTML=`
    ${isBot?`<div class="acp-mini-av">🤖</div>`:`<div class="acp-user-av">👤</div>`}
    <div style="flex:1;min-width:0;">
      <div class="acp-bubble">${htmlContent}</div>
      <div class="acp-msg-ts">${_nowTs()}</div>
    </div>`;
  feed.appendChild(div);
  feed.scrollTop=feed.scrollHeight;
  _chatHistory.push({role,text:htmlContent});
}
function _addBotMsg(html){_addMsg("bot",html);}
function _addUserMsg(text){_addMsg("user",`<span>${text}</span>`);}

let _typingEl=null;
function _showTyping(){
  const feed=document.getElementById("acpMsgs");
  if(!feed||_typingEl) return;
  const wrap=document.createElement("div");
  wrap.className="acp-msg bot";
  wrap.id="acpTypingWrap";
  wrap.innerHTML=`<div class="acp-mini-av">🤖</div><div class="acp-typing"><span></span><span></span><span></span></div>`;
  feed.appendChild(wrap);
  _typingEl=wrap;
  feed.scrollTop=feed.scrollHeight;
}
function _hideTyping(){if(_typingEl){_typingEl.remove();_typingEl=null;}}

function sendChatMsg(){
  const inp=document.getElementById("acpInput");
  const msg=(inp?.value||"").trim();
  if(!msg) return;
  inp.value="";
  _addUserMsg(msg);
  _showTyping();
  /* dynamic delay: shorter for simple queries, longer for complex */
  const delay=400+Math.min(msg.length*18,1000);
  setTimeout(()=>{
    _hideTyping();
    _addBotMsg(_aiBotReply(msg));
  },delay);
}

function sendQuickChat(q){
  if(!_chatOpen) openAIChat();
  setTimeout(()=>{
    _addUserMsg(q);
    _showTyping();
    setTimeout(()=>{_hideTyping();_addBotMsg(_aiBotReply(q));},700);
  },_chatHistory.length===0?400:100);
}

/* ═══ AI ASK TAB ═══ */
let _aiHistory=JSON.parse(localStorage.getItem("smartbus_ai_history")||"[]");

function initAITab(){
  if(_aiHistory.length>0){
    document.getElementById("aiHistorySection").style.display="block";
    const log=document.getElementById("aiHistoryLog");
    if(log){
      const catMap={booking:"🎫",payment:"💳",refund:"💰",account:"👤",technical:"🔧",loyalty:"🏆",service:"🚌"};
      log.innerHTML=_aiHistory.slice(0,5).map(h=>`
        <div class="ai-hist-item" onclick="setAiQuery('${h.q.replace(/'/g,"\\'")}')">
          <span style="font-size:16px;">${catMap[h.cat]||"❓"}</span>
          <div><div class="ai-hist-q">${h.q}</div><div class="ai-hist-cat">${h.cat||"FAQ"}</div></div>
          <span style="font-size:11px;color:var(--text3);">›</span>
        </div>`).join("");
    }
  }
}

function onAiSearch(val){
  const clear=document.getElementById("aiSearchClear");
  if(clear) clear.classList.toggle("show",val.length>0);
  if(val.length<2){
    document.getElementById("aiResultArea").innerHTML="";
    document.getElementById("aiSugChips").style.display="flex";
    return;
  }
  document.getElementById("aiSugChips").style.display="none";
  _renderAiResults(val);
}

function triggerAiSearch(){
  const val=document.getElementById("aiSearchInput")?.value||"";
  _renderAiResults(val);
}

function setAiQuery(q){
  const inp=document.getElementById("aiSearchInput");
  if(inp){inp.value=q;onAiSearch(q);}
}
function clearAiSearch(){
  const inp=document.getElementById("aiSearchInput");
  if(inp){inp.value="";onAiSearch("");}
}

function _renderAiResults(q){
  const ql=q.toLowerCase();
  const area=document.getElementById("aiResultArea");
  const scored=FAQ_DATA.map(f=>{
    const qw=ql.split(/\s+/);
    let s=0;
    qw.forEach(w=>{
      if(w.length<2) return;
      if(f.q.toLowerCase().includes(w)) s+=4;
      if(f.a.toLowerCase().includes(w)) s+=1;
    });
    return{f,s};
  }).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,4);

  if(!scored.length){
    area.innerHTML=`<div class="ai-no-result">
      <span class="ani">🤔</span>
      <div style="font-size:14px;font-weight:700;margin-bottom:6px;">Không tìm thấy câu trả lời phù hợp</div>
      <div style="font-size:12.5px;margin-bottom:14px;">Thử hỏi theo cách khác hoặc gửi yêu cầu hỗ trợ để được giải đáp trực tiếp.</div>
      <button class="ai-small-btn" onclick="switchTab('send',document.getElementById('tabSend'))">📨 Gửi yêu cầu</button>
      <button class="ai-small-btn" style="margin-left:8px;" onclick="openAIChat()">💬 Chat với AI</button>
    </div>`;
    return;
  }

  const catNames={booking:"🎫 Đặt vé",payment:"💳 Thanh toán",refund:"💰 Hoàn tiền",account:"👤 Tài khoản",technical:"🔧 Kỹ thuật",loyalty:"🏆 Thành viên",service:"🚌 Dịch vụ"};
  const re=new RegExp(`(${ql.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").split(/\s+/).filter(w=>w.length>1).join("|")})`,"gi");

  area.innerHTML=`<div style="font-size:11px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;">
    🔎 Tìm thấy ${scored.length} kết quả
  </div>`+scored.map(({f})=>{
    const hl=(s)=>s.replace(re,`<mark style="background:rgba(0,255,224,.25);color:#00ffe0;border-radius:3px;padding:0 2px;">$1</mark>`);
    return`<div class="ai-result-card">
      <div class="ai-result-head">
        <span>${catNames[f.cat]||f.cat}</span>
        <span style="font-size:10.5px;font-weight:500;color:rgba(255,255,255,.35);margin-left:auto;">AI</span>
      </div>
      <div class="ai-result-body">
        <div style="font-size:13.5px;font-weight:700;color:#d0e8f8;margin-bottom:9px;">${hl(f.q)}</div>
        ${hl(f.a)}
      </div>
      <div class="ai-result-actions">
        <button class="ai-small-btn" onclick="openAIChat();setTimeout(()=>sendQuickChat('${f.q.replace(/'/g,"\\'")}'),400)">
          💬 Hỏi thêm về chủ đề này
        </button>
        <button class="ai-small-btn" onclick="faqGoTo('${f.cat}','${FAQ_DATA.indexOf(f)}')">
          📖 Xem trong FAQ
        </button>
      </div>
    </div>`;
  }).join("");

  /* save to history */
  scored.slice(0,1).forEach(({f})=>{
    if(!_aiHistory.find(h=>h.q===f.q)){
      _aiHistory.unshift({q:f.q,cat:f.cat});
      if(_aiHistory.length>10) _aiHistory.pop();
      localStorage.setItem("smartbus_ai_history",JSON.stringify(_aiHistory));
    }
  });
}

function faqGoTo(cat,idx){
  switchTab("faq",document.getElementById("tabFaq"));
  setTimeout(()=>{
    const catEl=document.querySelector(`.faq-cat[onclick*="'${cat}'"]`);
    setFaqCat(cat,catEl||document.querySelector(".faq-cat.active"));
    const items=FAQ_DATA.filter(f=>f.cat===cat);
    const target=FAQ_DATA[parseInt(idx)];
    const localIdx=items.indexOf(target);
    if(localIdx>=0){
      setTimeout(()=>{
        const el=document.getElementById(`faq-${cat}-${localIdx}`);
        if(el){el.classList.add("open");el.scrollIntoView({behavior:"smooth",block:"center"});}
      },200);
    }
  },100);
}

/* ── Auto-resize textarea ── */
function autoResize(el){
  el.style.height="auto";
  el.style.height=Math.min(el.scrollHeight,240)+"px";
}

/* ── Emergency section ── */
function toggleEmgSection(){
  const body=document.getElementById("emgBody");
  const arrow=document.getElementById("emgToggle");
  const isOpen=body.classList.toggle("open");
  if(arrow) arrow.style.transform=isOpen?"rotate(180deg)":"";
  /* hide detail when closing */
  if(!isOpen){const d=document.getElementById("emgDetail");if(d){d.innerHTML="";d.classList.remove("show");}}
}

const EMG_DATA={
  lost_ticket:{
    title:"🎫 Mất vé / Quên mã QR",
    steps:[
      "Mở <b>SmartBusAI → Tài khoản → Lịch sử đặt vé</b> — vé luôn được lưu tại đây",
      "Kiểm tra <b>email</b> đăng ký (kể cả thư mục <b>Spam</b>) — có đính kèm QR vé",
      "Nhân viên quầy có thể tra cứu bằng <b>CMND/CCCD + số điện thoại</b> của bạn",
      "Nếu không tự tìm được → gửi yêu cầu kèm thông tin chuyến xe để chúng tôi gửi lại vé",
    ],
    acts:[
      {l:"👤 Vào Tài khoản",cls:"esb-secondary",a:"window.location.href='profile.html'"},
      {l:"📨 Yêu cầu gửi lại vé",cls:"esb-primary",a:"quickAction('lost_ticket');toggleEmgSection()"},
    ]
  },
  payment_stuck:{
    title:"💳 Trừ tiền nhưng chưa có vé",
    steps:[
      "Đợi <b>5–10 phút</b> rồi làm mới trang Tài khoản → Lịch sử đặt vé",
      "Chụp màn hình <b>lịch sử giao dịch</b> trong MoMo / ZaloPay / ngân hàng",
      "Kiểm tra email — vé có thể đã được gửi nhưng vào thư mục Spam",
      "Nếu sau 10 phút vẫn không thấy → gửi yêu cầu kèm ảnh giao dịch — <b>tiền sẽ được hoàn trong 24h</b>",
    ],
    acts:[
      {l:"📨 Báo lỗi thanh toán",cls:"esb-primary",a:"quickAction('payment');toggleEmgSection()"},
      {l:"📞 Hotline khẩn 1900 6789",cls:"esb-secondary",a:"window.location.href='tel:19006789'"},
    ]
  },
  bus_delay:{
    title:"⏰ Xe trễ / Không đến",
    steps:[
      "Trễ <b>dưới 30 phút</b>: chờ đợi, thường do tắc đường hoặc đón/trả khách",
      "Trễ <b>trên 30 phút</b>: bạn có quyền yêu cầu <b>hoàn 100%</b> hoặc đổi sang chuyến khác",
      "Gọi hotline <b>1900 6789</b> để xác nhận tình trạng chuyến xe",
      "Nhà xe hủy chuyến → tiền hoàn <b>tự động 100%</b> không cần yêu cầu",
    ],
    acts:[
      {l:"📞 Gọi hotline ngay",cls:"esb-primary",a:"window.location.href='tel:19006789'"},
      {l:"📨 Báo cáo xe trễ",cls:"esb-secondary",a:"quickAction('delay');toggleEmgSection()"},
    ]
  },
  bus_accident:{
    title:"🚨 Tai nạn / Sự cố xe",
    steps:[
      "<b>Đảm bảo an toàn trước</b> — di chuyển ra khu vực an toàn nếu cần",
      "Gọi <b>cứu thương 115</b> và <b>cảnh sát 113</b> nếu có thương vong",
      "Gọi ngay hotline SmartBusAI <b>1900 6789</b> để khai báo sự cố",
      "Chụp ảnh / ghi lại hiện trường để hỗ trợ bồi thường bảo hiểm",
      "SmartBusAI hỗ trợ <b>bồi thường theo hợp đồng bảo hiểm</b> của nhà xe",
    ],
    acts:[
      {l:"🆘 Gọi cứu thương 115",cls:"esb-primary",a:"window.location.href='tel:115'"},
      {l:"📞 Hotline SmartBusAI",cls:"esb-secondary",a:"window.location.href='tel:19006789'"},
    ]
  },
  urgent_refund:{
    title:"💸 Hoàn tiền khẩn cấp",
    steps:[
      "Gửi yêu cầu với mức độ ưu tiên <b>🔴 Khẩn cấp</b> — xử lý trong <b>2 giờ làm việc</b>",
      "Đính kèm: mã vé + lý do + bằng chứng (nếu có) để xử lý nhanh nhất",
      "Hoàn về phương thức thanh toán ban đầu trong <b>1–3 ngày</b> (ưu tiên)",
      "Gọi hotline <b>1900 6789</b> và nhấn phím <b>2</b> cho hoàn tiền khẩn cấp",
    ],
    acts:[
      {l:"📨 Yêu cầu hoàn tiền khẩn",cls:"esb-primary",a:"quickAction('refund');document.querySelectorAll('.pchip')[2]?.click();toggleEmgSection()"},
      {l:"📞 Hotline 1900 6789",cls:"esb-secondary",a:"window.location.href='tel:19006789'"},
    ]
  },
  wrong_info:{
    title:"⚠️ Đặt nhầm thông tin",
    steps:[
      "Nếu sai <b>điểm đi/đến hoặc ngày</b>: hủy vé và đặt lại (áp dụng chính sách hoàn tiền)",
      "Nếu sai <b>tên hành khách</b>: một số nhà xe cho phép chỉnh sửa nếu báo trước 24h",
      "Gửi yêu cầu hỗ trợ <b>càng sớm càng tốt</b> kèm mã vé và thông tin cần sửa",
      "Không tự ý sửa thông tin — liên hệ hỗ trợ để được hướng dẫn đúng cách",
    ],
    acts:[
      {l:"📨 Yêu cầu chỉnh sửa vé",cls:"esb-primary",a:"quickAction('booking');toggleEmgSection()"},
      {l:"🤖 Hỏi AI ngay",cls:"esb-secondary",a:"sendQuickChat('Tôi đặt nhầm thông tin vé phải làm gì?');toggleEmgSection()"},
    ]
  },
};

let _activeEmgCat=null;
function showEmgDetail(cat){
  const detail=document.getElementById("emgDetail");
  if(!detail) return;
  /* Toggle: click same → close */
  if(_activeEmgCat===cat){
    detail.innerHTML="";detail.classList.remove("show");_activeEmgCat=null;
    document.querySelectorAll(".emg-cat-btn").forEach(b=>b.style.borderColor="");
    return;
  }
  _activeEmgCat=cat;
  document.querySelectorAll(".emg-cat-btn").forEach(b=>b.style.borderColor="");
  event?.currentTarget?.style&&(event.currentTarget.style.borderColor="rgba(231,76,60,.50)");
  const d=EMG_DATA[cat];
  if(!d) return;
  detail.innerHTML=`
    <div class="emg-detail-title"><span>⚡</span>${d.title}</div>
    <div class="emg-steps">
      ${d.steps.map((s,i)=>`<div class="emg-step"><div class="emg-step-num">${i+1}</div><div>${s}</div></div>`).join("")}
    </div>
    <div class="emg-step-actions">
      ${d.acts.map(a=>`<button class="emg-step-btn ${a.cls}" onclick="${a.a}">${a.l}</button>`).join("")}
    </div>`;
  detail.classList.add("show");
  detail.scrollIntoView({behavior:"smooth",block:"nearest"});
}

/* ── Improved quickAction (diverse routing) ── */
function quickAction(type){
  const map={
    lost_ticket:{title:"Mất vé — Yêu cầu gửi lại mã QR",type:"booking",pri:"urgent"},
    refund:     {title:"Yêu cầu hoàn tiền",              type:"refund", pri:"high"},
    change_seat:{title:"Đổi ghế / đổi chuyến",           type:"refund", pri:"normal"},
    delay:      {title:"Báo cáo xe trễ hoặc sự cố",      type:"complaint",pri:"urgent"},
    payment:    {title:"Lỗi thanh toán — Trừ tiền chưa có vé",type:"payment",pri:"urgent"},
    booking:    {title:"Vấn đề đặt vé",                  type:"booking",pri:"normal"},
    account:    {title:"Vấn đề tài khoản",               type:"general", pri:"normal"},
    general:    {title:"Thắc mắc chung",                 type:"general", pri:"normal"},
    complaint:  {title:"Khiếu nại dịch vụ",              type:"complaint",pri:"high"},
  };
  const m=map[type]||map.general;
  switchTab("send",document.getElementById("tabSend"));
  setTimeout(()=>{
    const titleEl=document.getElementById("reqTitle");
    const typeEl=document.getElementById("reqType");
    const contentEl=document.getElementById("reqContent");
    if(titleEl) titleEl.value=m.title;
    if(typeEl){typeEl.value=m.type;onTypeChange();}
    /* Set priority chip */
    const priIdx={normal:0,high:1,urgent:2}[m.pri]||0;
    const chips=document.querySelectorAll(".pchip");
    chips.forEach(c=>c.classList.remove("on"));
    if(chips[priIdx]) chips[priIdx].click();
    /* Focus textarea */
    if(contentEl){contentEl.focus();autoResize(contentEl);}
  },150);
}

/* ── FAQ cat badge update ── */
document.getElementById("faqBadge").textContent=FAQ_DATA.length;

/* ── Init ── */
updateBadge();
renderFaq();
renderFilePreviews();

