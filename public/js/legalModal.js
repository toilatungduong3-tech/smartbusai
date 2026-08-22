'use strict';
/**
 * Sprint 10 — In-page Legal Reader Modal.
 *
 * openLegalModal('privacy' | 'terms', anchorId?) fetches the standalone
 * privacy-policy.html / terms-of-service.html page (still directly
 * reachable by URL — this is not a content fork, just a second way to
 * view the exact same <main>) and injects its content into a modal
 * instead of navigating away. Cached per-URL after first load so
 * re-opening within the same page view doesn't re-fetch.
 */
(function () {
  const CACHE = {};
  let _lastFocus = null;

  const URLS = {
    privacy: '/pages/legal/privacy-policy.html',
    terms: '/pages/legal/terms-of-service.html',
  };

  async function fetchContent(url) {
    if (CACHE[url]) return CACHE[url];
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const main = doc.querySelector('main');
    const titleRaw = doc.querySelector('title');
    const title = (titleRaw ? titleRaw.textContent : '').replace(/\s*—\s*SmartBusAI\s*$/, '');
    const entry = { content: main ? main.innerHTML : '', title: title || 'Chính sách' };
    CACHE[url] = entry;
    return entry;
  }

  function ensureModal() {
    let modal = document.getElementById('sbLegalModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'sbLegalModal';
    modal.className = 'sb-legal-backdrop';
    modal.innerHTML =
      '<div class="sb-legal-modal" role="dialog" aria-modal="true" aria-labelledby="sbLegalTitle">' +
        '<div class="sb-legal-header">' +
          '<h2 class="sb-legal-title" id="sbLegalTitle"></h2>' +
          '<button type="button" class="sb-legal-close" id="sbLegalCloseBtn" aria-label="Đóng">✕</button>' +
        '</div>' +
        '<div class="sb-legal-body" id="sbLegalBody"><div class="sb-legal-loading">Đang tải…</div></div>' +
        '<div class="sb-legal-footer">' +
          '<button type="button" class="sb-legal-agree" id="sbLegalAgreeBtn">✅ Tôi đã hiểu &amp; Đồng ý</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    // Backdrop click (but not a click that started/ended inside the modal card).
    modal.addEventListener('mousedown', (e) => { modal._downOnBackdrop = (e.target === modal); });
    modal.addEventListener('click', (e) => { if (e.target === modal && modal._downOnBackdrop) closeLegalModal(); });
    modal.querySelector('#sbLegalCloseBtn').addEventListener('click', closeLegalModal);
    modal.querySelector('#sbLegalAgreeBtn').addEventListener('click', closeLegalModal);
    return modal;
  }

  async function openLegalModal(kind, anchorId) {
    const url = URLS[kind];
    if (!url) return;
    _lastFocus = document.activeElement;
    const modal = ensureModal();
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    const body = document.getElementById('sbLegalBody');
    const titleEl = document.getElementById('sbLegalTitle');
    body.innerHTML = '<div class="sb-legal-loading">Đang tải…</div>';
    try {
      const { content, title } = await fetchContent(url);
      titleEl.textContent = title;
      body.innerHTML = content;
      if (anchorId) {
        const target = body.querySelector('#' + anchorId);
        if (target) target.scrollIntoView({ block: 'start' });
      } else {
        body.scrollTop = 0;
      }
    } catch (e) {
      body.innerHTML = '<p style="text-align:center;color:rgba(251,113,133,.85);padding:30px 0;">Không tải được nội dung — vui lòng thử lại.</p>';
    }
    document.getElementById('sbLegalCloseBtn').focus();
  }

  function closeLegalModal() {
    const modal = document.getElementById('sbLegalModal');
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
    if (_lastFocus && typeof _lastFocus.focus === 'function') _lastFocus.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('sbLegalModal');
    if (modal && modal.classList.contains('open')) closeLegalModal();
  });

  window.openLegalModal = openLegalModal;
  window.closeLegalModal = closeLegalModal;
})();
