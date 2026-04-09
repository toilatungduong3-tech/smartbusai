/* ═══════════════════════════════════════════════════════════
   admin-notif.js — SmartBusAI Admin Notification System
   Inject in every admin page. Bell element must have id="notifBell".
═══════════════════════════════════════════════════════════ */
(function(){
'use strict';

const LS_KEY = 'adminNotifLastSeen';
let _data    = [];
let _isOpen  = false;

/* ── Inject CSS ── */
const _css = document.createElement('style');
_css.textContent = `
.notif-count{
  position:absolute;top:-5px;right:-5px;
  min-width:17px;height:17px;border-radius:9px;
  background:#e74c3c;color:#fff;
  font-size:9px;font-weight:800;letter-spacing:-.3px;
  display:flex;align-items:center;justify-content:center;
  padding:0 3px;border:2px solid #020508;
  font-family:"Segoe UI",Arial,sans-serif;
  pointer-events:none;line-height:1;
}
#adminNotifPanel{
  position:fixed;z-index:9999;width:370px;max-height:520px;
  display:flex;flex-direction:column;
  background:linear-gradient(160deg,rgba(5,12,28,.99) 0%,rgba(3,8,20,.98) 100%);
  backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);
  border:1px solid rgba(0,255,224,.18);
  border-top:2px solid rgba(0,255,224,.35);
  border-radius:18px;
  box-shadow:0 28px 90px rgba(0,0,0,.80),0 0 0 1px rgba(255,255,255,.04),0 0 50px rgba(0,255,224,.07);
  overflow:hidden;
  opacity:0;transform:translateY(-10px) scale(.96);
  transition:opacity .22s cubic-bezier(.22,.61,.36,1),transform .22s cubic-bezier(.22,.61,.36,1);
  pointer-events:none;
}
#adminNotifPanel.anp-open{
  opacity:1;transform:translateY(0) scale(1);
  pointer-events:all;
}
.anp-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:14px 18px 12px;
  border-bottom:1px solid rgba(255,255,255,.07);
  flex-shrink:0;
  background:rgba(0,255,224,.03);
}
.anp-head-left{display:flex;align-items:center;gap:8px;}
.anp-head-title{
  font-size:13px;font-weight:800;color:#00ffe0;letter-spacing:.1px;
}
.anp-head-count{
  font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;
  background:rgba(231,76,60,.20);border:1px solid rgba(231,76,60,.35);
  color:#e74c3c;display:none;
}
.anp-mark{
  font-size:11px;font-weight:600;color:rgba(255,255,255,.35);
  cursor:pointer;padding:4px 9px;border-radius:7px;transition:all .18s;
  border:1px solid transparent;
}
.anp-mark:hover{color:#00ffe0;background:rgba(0,255,224,.10);border-color:rgba(0,255,224,.20);}
.anp-list{
  overflow-y:auto;flex:1;
  scrollbar-width:thin;scrollbar-color:rgba(0,255,224,.20) transparent;
}
.anp-list::-webkit-scrollbar{width:4px;}
.anp-list::-webkit-scrollbar-track{background:transparent;}
.anp-list::-webkit-scrollbar-thumb{background:rgba(0,255,224,.22);border-radius:99px;}
.anp-item{
  display:flex;align-items:flex-start;gap:11px;
  padding:11px 16px;cursor:pointer;
  border-bottom:1px solid rgba(255,255,255,.04);
  transition:background .15s;position:relative;overflow:hidden;
}
.anp-item::before{
  content:"";position:absolute;left:0;top:0;bottom:0;width:2px;
  background:transparent;transition:background .18s;
}
.anp-item:last-child{border-bottom:none;}
.anp-item:hover{background:rgba(255,255,255,.04);}
.anp-item:hover::before{background:rgba(255,255,255,.15);}
.anp-item.anp-unread{background:rgba(0,255,224,.04);}
.anp-item.anp-unread:hover{background:rgba(0,255,224,.08);}
.anp-item.anp-unread::before{background:rgba(0,255,224,.7);}
.anp-ico{
  width:36px;height:36px;border-radius:10px;flex-shrink:0;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);
  display:flex;align-items:center;justify-content:center;font-size:16px;
  transition:transform .18s;
}
.anp-item:hover .anp-ico{transform:scale(1.08);}
.anp-body{flex:1;min-width:0;}
.anp-ttl{
  font-size:12.5px;font-weight:700;color:rgba(232,244,248,.80);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;
}
.anp-item.anp-unread .anp-ttl{color:#fff;}
.anp-msg{
  font-size:11.5px;color:rgba(255,255,255,.40);margin-top:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.anp-time{
  font-size:10px;color:rgba(255,255,255,.26);margin-top:4px;font-weight:600;
  display:flex;align-items:center;gap:4px;
}
.anp-item.anp-unread .anp-time{color:rgba(0,255,224,.50);}
.anp-udot{
  width:7px;height:7px;border-radius:50%;flex-shrink:0;
  background:#00ffe0;box-shadow:0 0 8px rgba(0,255,224,.75);
  margin-top:4px;animation:notifDotPulse 1.8s ease-in-out infinite;
}
@keyframes notifDotPulse{
  0%,100%{opacity:1;transform:scale(1);}
  50%{opacity:.5;transform:scale(.7);}
}
.anp-empty{
  padding:44px 20px;text-align:center;
  color:rgba(255,255,255,.28);font-size:13px;
}
.anp-empty-ico{font-size:38px;margin-bottom:10px;display:block;opacity:.6;}
.anp-footer{
  padding:9px 16px;border-top:1px solid rgba(255,255,255,.06);
  display:flex;align-items:center;justify-content:space-between;
  flex-shrink:0;background:rgba(255,255,255,.015);
}
.anp-footer-txt{font-size:10.5px;color:rgba(255,255,255,.22);}
.anp-footer-close{
  font-size:11.5px;font-weight:700;color:rgba(0,255,224,.55);
  cursor:pointer;transition:color .18s;
}
.anp-footer-close:hover{color:#00ffe0;}
/* Type icon background colors */
.anp-new_user    .anp-ico{background:rgba(0,168,255,.14);border-color:rgba(0,168,255,.25);}
.anp-new_operator .anp-ico{background:rgba(108,92,231,.14);border-color:rgba(108,92,231,.25);}
.anp-new_booking  .anp-ico{background:rgba(46,204,113,.14);border-color:rgba(46,204,113,.25);}
.anp-cancel_booking .anp-ico{background:rgba(231,76,60,.14);border-color:rgba(231,76,60,.25);}
.anp-support      .anp-ico{background:rgba(243,156,18,.14);border-color:rgba(243,156,18,.25);}
.anp-new_review   .anp-ico{background:rgba(253,121,168,.14);border-color:rgba(253,121,168,.25);}
.anp-service_order .anp-ico{background:rgba(0,255,224,.12);border-color:rgba(0,255,224,.25);}
`;
document.head.appendChild(_css);

/* ── Inject Panel HTML ── */
const _panel = document.createElement('div');
_panel.id = 'adminNotifPanel';
_panel.innerHTML = `
  <div class="anp-head">
    <div class="anp-head-left">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#00ffe0"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
      <span class="anp-head-title">Thông báo</span>
      <span class="anp-head-count" id="anpHeadCount"></span>
    </div>
    <span class="anp-mark" onclick="adminNotif.markAll()">Đọc tất cả</span>
  </div>
  <div class="anp-list" id="anpList">
    <div class="anp-empty"><span class="anp-empty-ico">🔔</span>Đang tải…</div>
  </div>
  <div class="anp-footer">
    <span class="anp-footer-txt" id="anpFooterTxt"></span>
    <span class="anp-footer-close" onclick="adminNotif.close()">✕ Đóng</span>
  </div>
`;
document.body.appendChild(_panel);

/* ── Position panel below button ── */
function _position(btn){
  const r   = btn.getBoundingClientRect();
  const pw  = 370;
  let   left = r.right - pw;
  if(left < 8) left = 8;
  if(left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  _panel.style.top  = (r.bottom + 8) + 'px';
  _panel.style.left = left + 'px';
}

/* ── Toggle ── */
function toggle(btn){
  _isOpen = !_isOpen;
  if(_isOpen){
    _position(btn);
    _panel.classList.add('anp-open');
    _render();
    // Mark seen when opened
    localStorage.setItem(LS_KEY, Date.now().toString());
    setTimeout(_updateBadge, 0);
  } else {
    _panel.classList.remove('anp-open');
  }
}

/* ── Close ── */
function close(){
  _isOpen = false;
  _panel.classList.remove('anp-open');
}

/* ── Outside click ── */
document.addEventListener('click', function(e){
  if(!_isOpen) return;
  const bell = document.getElementById('notifBell');
  if(_panel.contains(e.target) || (bell && bell.contains(e.target))) return;
  close();
});

/* ── Load from API ── */
async function _load(){
  try{
    const res = await fetch('/api/admin/notifications');
    if(!res.ok) return;
    _data = await res.json();
    _updateBadge();
    if(_isOpen) _render();
  } catch(e){ /* silent */ }
}

/* ── Count unread ── */
function _unread(){
  const seen = parseInt(localStorage.getItem(LS_KEY)||'0');
  return _data.filter(n => new Date(n.time).getTime() > seen).length;
}

/* ── Update bell badge ── */
function _updateBadge(){
  const count  = _unread();
  const badge  = document.getElementById('notifBadge');
  const dot    = document.getElementById('notifDot');
  const hcount = document.getElementById('anpHeadCount');
  if(badge){
    if(count > 0){
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
  if(dot)    dot.style.display    = count > 0 ? 'block' : 'none';
  if(hcount){
    if(count > 0){
      hcount.textContent   = count + ' mới';
      hcount.style.display = 'inline-flex';
    } else {
      hcount.style.display = 'none';
    }
  }
}

/* ── Render list ── */
function _render(){
  const listEl   = document.getElementById('anpList');
  const footerEl = document.getElementById('anpFooterTxt');
  if(!listEl) return;

  if(!_data.length){
    listEl.innerHTML = '<div class="anp-empty"><span class="anp-empty-ico">✅</span>Không có thông báo nào</div>';
    if(footerEl) footerEl.textContent = '';
    return;
  }

  const seen = parseInt(localStorage.getItem(LS_KEY)||'0');
  listEl.innerHTML = _data.map(n => {
    const isNew = new Date(n.time).getTime() > seen;
    return `<div class="anp-item anp-${n.type}${isNew?' anp-unread':''}" onclick="adminNotif._click('${n.link}')">
      <div class="anp-ico">${n.icon}</div>
      <div class="anp-body">
        <div class="anp-ttl">${_esc(n.title)}</div>
        <div class="anp-msg">${_esc(n.message)}</div>
        <div class="anp-time">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 5v5.25l4.5 2.67-.75 1.23L11 13V7h1.5z"/></svg>
          ${_timeAgo(n.time)}
        </div>
      </div>
      ${isNew ? '<div class="anp-udot"></div>' : ''}
    </div>`;
  }).join('');

  if(footerEl) footerEl.textContent = _data.length + ' thông báo · Cập nhật tự động';
}

/* ── Mark all read ── */
function markAll(){
  localStorage.setItem(LS_KEY, Date.now().toString());
  _updateBadge();
  _render();
}

/* ── Click item ── */
function _click(link){
  if(link){
    const cur = location.pathname.split('/').pop();
    if(cur !== link) window.location.href = link;
  }
  close();
}

/* ── Escape HTML ── */
function _esc(s){
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Time-ago ── */
function _timeAgo(t){
  const d = (Date.now() - new Date(t).getTime()) / 1000;
  if(d < 60)    return 'Vừa xong';
  if(d < 3600)  return Math.floor(d/60) + ' phút trước';
  if(d < 86400) return Math.floor(d/3600) + ' giờ trước';
  if(d < 604800) return Math.floor(d/86400) + ' ngày trước';
  return new Date(t).toLocaleDateString('vi-VN');
}

/* ── Fill admin name from localStorage ── */
function _fillAdminName(){
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    const name = u.full_name || u.name || 'Admin';
    const el = document.getElementById('adminNameLabel');
    if(el) el.textContent = name;
  } catch(e){}
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', function(){
  _fillAdminName();
  _load();
  setInterval(_load, 30000);
});

/* ── Public API ── */
window.adminNotif = { toggle, close, markAll, _click };

})();
