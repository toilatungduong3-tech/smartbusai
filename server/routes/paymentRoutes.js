'use strict';
const express = require('express');
const logger = require('../utils/logger');
const router  = express.Router();
const db      = require('../config/db');
const pmt     = require('../services/paymentService');
const { paymentLimiter } = require('../middleware/rateLimiter');

/* Sprint 12 — paymentLimiter applied only to the two endpoints an actual
   browser client calls directly (/create, /vietqr/confirm). The gateway
   webhooks below (momo/notify, zalopay/callback, vnpay/ipn) are called
   server-to-server by the payment provider's own infrastructure — rate
   limiting those by IP risks throttling legitimate retries from a shared
   gateway IP pool, and they're already protected by signature/amount
   verification (see the Phase 2I comments throughout this file). */

// ── POST /api/payment/create ───────────────────────────────────────────────
// Tạo yêu cầu thanh toán cho booking đã có (status PENDING)
// Body: { booking_id, payment_method: 'momo'|'vnpay'|'vietqr' }
//
// Phase 2I (CRITICAL, price tampering): this previously took `amount`
// straight from the client body and used it to build the gateway payUrl
// with zero validation against the booking's real total — a caller could
// request a payUrl for e.g. 1,000đ on a 500,000đ booking, actually pay that
// trivial amount, and vnpay/return · momo/notify would mark the booking
// PAID on nothing more than a validly-signed gateway callback (which never
// checked the amount either). amount is no longer accepted from the client
// at all; it is always looked up from booking.total_amount server-side.
router.post('/create', paymentLimiter, async (req, res) => {
  const { booking_id, payment_method } = req.body;
  if (!booking_id || !payment_method) {
    return res.status(400).json({ message: 'Thiếu dữ liệu (booking_id, payment_method)' });
  }

  const [[bk]] = await db.query('SELECT status, total_amount FROM booking WHERE booking_id=?', [booking_id]);
  if (!bk) return res.status(404).json({ message: 'Không tìm thấy vé' });
  if (bk.status !== 'PENDING') {
    return res.status(409).json({ message: `Không thể thanh toán vé ở trạng thái ${bk.status}` });
  }

  const amountInt = Math.round(Number(bk.total_amount));
  const orderInfo = `SmartBusAI - Vé xe #${booking_id}`;

  try {
    if (payment_method === 'momo') {
      const { payUrl, orderId } = await pmt.createMoMoPayment({
        bookingId: booking_id, amount: amountInt, orderInfo,
      });
      await db.query('UPDATE booking SET payment_ref=? WHERE booking_id=?', [orderId, booking_id]);
      return res.json({ payUrl, method: 'momo' });
    }

    if (payment_method === 'vnpay') {
      const ipAddr = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1')
        .split(',')[0].trim();
      const { payUrl, orderId } = pmt.createVNPayPayment({
        bookingId: booking_id, amount: amountInt, orderInfo, ipAddr,
      });
      await db.query('UPDATE booking SET payment_ref=? WHERE booking_id=?', [orderId, booking_id]);
      return res.json({ payUrl, method: 'vnpay' });
    }

    if (payment_method === 'zalopay') {
      const { payUrl, orderId } = await pmt.createZaloPayPayment({
        bookingId: booking_id, amount: amountInt, orderInfo,
      });
      await db.query('UPDATE booking SET payment_ref=? WHERE booking_id=?', [orderId, booking_id]);
      return res.json({ payUrl, method: 'zalopay' });
    }

    if (payment_method === 'vietqr') {
      const qrUrl = pmt.getVietQRUrl({ amount: amountInt, bookingId: booking_id });
      return res.json({ qrUrl, method: 'vietqr' });
    }

    return res.status(400).json({ message: `Phương thức không hỗ trợ: ${payment_method}` });
  } catch (e) {
    logger.error('[payment/create]', e.message);
    return res.status(502).json({ message: e.message || 'Lỗi kết nối cổng thanh toán' });
  }
});

// ── GET /api/payment/vnpay/return ──────────────────────────────────────────
router.get('/vnpay/return', async (req, res) => {
  const isValid  = pmt.verifyVNPayReturn(req.query);
  const bookingId = pmt.parseVNPayBookingId(req.query);
  const amount    = bookingId ? Math.round(Number(req.query.vnp_Amount) / 100) : 0;

  // Phase 2I (defense-in-depth): only mark PAID if the amount actually paid
  // at the gateway matches this booking's real total_amount — /create is
  // now the only source of the gateway amount and always uses the DB
  // total, so these should always match for a legitimate transaction.
  if (isValid && bookingId) {
    const [[bkAmt]] = await db.query('SELECT total_amount FROM booking WHERE booking_id=?', [bookingId]).catch(() => [[]]);
    if (bkAmt && Math.round(Number(bkAmt.total_amount)) === amount) {
      await db.query(
        `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`,
        [bookingId]
      ).catch(() => {});
      await db.query(
        `INSERT INTO payment (booking_id, method, amount, status, payment_time)
         VALUES (?, 'VNPAY', ?, 'COMPLETED', NOW())`,
        [bookingId, amount]
      ).catch(() => {});
    } else {
      logger.error(`[vnpay/return] amount mismatch booking=${bookingId} paid=${amount} expected=${bkAmt?.total_amount}`);
    }
  }

  let bookingCode = '';
  if (bookingId) {
    const [[bk]] = await db.query('SELECT booking_code FROM booking WHERE booking_id=?', [bookingId]).catch(() => [[]]);
    bookingCode = bk?.booking_code || '';
  }
  const status = isValid ? 'success' : 'failed';
  res.redirect(`/pages/passenger/payment-result.html?status=${status}&bookingId=${bookingId||''}&method=vnpay&bookingCode=${encodeURIComponent(bookingCode)}`);
});

// ── GET /api/payment/momo/return ───────────────────────────────────────────
router.get('/momo/return', async (req, res) => {
  const isValid   = pmt.verifyMoMoReturn(req.query);
  const bookingId = pmt.parseMoMoBookingId(req.query);
  const amount    = Number(req.query.amount) || 0;

  // Phase 2I (defense-in-depth): see vnpay/return above.
  if (isValid && bookingId) {
    const [[bkAmt]] = await db.query('SELECT total_amount FROM booking WHERE booking_id=?', [bookingId]).catch(() => [[]]);
    if (bkAmt && Math.round(Number(bkAmt.total_amount)) === Math.round(amount)) {
      await db.query(
        `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`,
        [bookingId]
      ).catch(() => {});
      await db.query(
        `INSERT INTO payment (booking_id, method, amount, status, payment_time)
         VALUES (?, 'MOMO', ?, 'COMPLETED', NOW())`,
        [bookingId, amount]
      ).catch(() => {});
    } else {
      logger.error(`[momo/return] amount mismatch booking=${bookingId} paid=${amount} expected=${bkAmt?.total_amount}`);
    }
  }

  let bookingCode = '';
  if (bookingId) {
    const [[bk]] = await db.query('SELECT booking_code FROM booking WHERE booking_id=?', [bookingId]).catch(() => [[]]);
    bookingCode = bk?.booking_code || '';
  }
  const status = isValid ? 'success' : 'failed';
  res.redirect(`/pages/passenger/payment-result.html?status=${status}&bookingId=${bookingId||''}&method=momo&bookingCode=${encodeURIComponent(bookingCode)}`);
});

// ── POST /api/payment/momo/notify ──────────────────────────────────────────
// MoMo IPN (server-to-server callback)
router.post('/momo/notify', async (req, res) => {
  try {
    const isValid   = pmt.verifyMoMoReturn(req.body);
    const bookingId = pmt.parseMoMoBookingId(req.body);
    const amount    = Number(req.body.amount) || 0;
    // Phase 2I (defense-in-depth): see vnpay/return above.
    if (isValid && bookingId) {
      const [[bkAmt]] = await db.query('SELECT total_amount FROM booking WHERE booking_id=?', [bookingId]).catch(() => [[]]);
      if (bkAmt && Math.round(Number(bkAmt.total_amount)) === Math.round(amount)) {
        await db.query(
          `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`,
          [bookingId]
        ).catch(() => {});
      } else {
        logger.error(`[momo/notify] amount mismatch booking=${bookingId} paid=${amount} expected=${bkAmt?.total_amount}`);
      }
    }
  } catch (e) { logger.error('[momo/notify]', e.message); }
  res.json({ message: 'ok' });
});

// ── POST /api/payment/zalopay/callback ─────────────────────────────────────
// ZaloPay IPN (server-to-server) — the authoritative confirmation for
// ZaloPay payments. Response shape ({return_code, return_message}) is
// ZaloPay's own required ack format, not a generic REST response — ZaloPay
// retries the callback if it doesn't see return_code:1.
router.post('/zalopay/callback', async (req, res) => {
  try {
    if (!pmt.verifyZaloPayCallback(req.body)) {
      return res.json({ return_code: -1, return_message: 'mac not match' });
    }
    const { bookingId, amount } = pmt.parseZaloPayCallbackData(req.body);
    if (bookingId) {
      // Phase 2I (defense-in-depth): see vnpay/return above.
      const [[bkAmt]] = await db.query('SELECT total_amount FROM booking WHERE booking_id=?', [bookingId]).catch(() => [[]]);
      if (bkAmt && Math.round(Number(bkAmt.total_amount)) === Math.round(Number(amount))) {
        await db.query(
          `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`,
          [bookingId]
        ).catch(() => {});
        await db.query(
          `INSERT INTO payment (booking_id, method, amount, status, payment_time)
           VALUES (?, 'ZALOPAY', ?, 'COMPLETED', NOW())`,
          [bookingId, amount]
        ).catch(() => {});
      } else {
        logger.error(`[zalopay/callback] amount mismatch booking=${bookingId} paid=${amount} expected=${bkAmt?.total_amount}`);
      }
    }
    return res.json({ return_code: 1, return_message: 'success' });
  } catch (e) {
    logger.error('[zalopay/callback]', e.message);
    return res.json({ return_code: 0, return_message: e.message });
  }
});

// ── GET /api/payment/zalopay/return ────────────────────────────────────────
// Browser redirect after the user finishes on ZaloPay's page. Unlike
// VNPay/MoMo, ZaloPay does not sign this leg — the callback above is the
// only authoritative source of truth, so this just reflects whatever
// status the callback has (hopefully already) written, rather than trying
// to verify anything itself.
router.get('/zalopay/return', async (req, res) => {
  const appTransId = req.query.apptransid || req.query.app_trans_id || '';
  const bookingId  = String(appTransId).match(/SB(\d+)_/)?.[1];

  let status = 'failed', bookingCode = '';
  if (bookingId) {
    const [[bk]] = await db.query('SELECT status, booking_code FROM booking WHERE booking_id=?', [bookingId]).catch(() => [[]]);
    if (bk) { status = bk.status === 'PAID' ? 'success' : 'failed'; bookingCode = bk.booking_code || ''; }
  }
  res.redirect(`/pages/passenger/payment-result.html?status=${status}&bookingId=${bookingId||''}&method=zalopay&bookingCode=${encodeURIComponent(bookingCode)}`);
});

// ── POST /api/payment/vnpay/ipn ────────────────────────────────────────────
// VNPay's real architecture separates the browser return (GET /vnpay/return
// above, which the user's browser hits and can be interrupted by a closed
// tab / dropped connection) from a server-to-server IPN VNPay calls
// independently of the user's browser — added so a payment that actually
// succeeded at VNPay still gets marked PAID even if the browser round-trip
// never completes. Same signature/amount verification as /vnpay/return;
// response shape ({RspCode, Message}) is VNPay's own required IPN ack
// format (VNPay retries on anything other than RspCode "00").
router.post('/vnpay/ipn', async (req, res) => {
  try {
    const isValid  = pmt.verifyVNPayReturn(req.query && Object.keys(req.query).length ? req.query : req.body);
    const source   = req.query && Object.keys(req.query).length ? req.query : req.body;
    const bookingId = pmt.parseVNPayBookingId(source);
    const amount    = bookingId ? Math.round(Number(source.vnp_Amount) / 100) : 0;

    if (!isValid) return res.json({ RspCode: '97', Message: 'Invalid signature' });
    if (!bookingId) return res.json({ RspCode: '01', Message: 'Order not found' });

    const [[bkAmt]] = await db.query('SELECT total_amount, status FROM booking WHERE booking_id=?', [bookingId]).catch(() => [[]]);
    if (!bkAmt) return res.json({ RspCode: '01', Message: 'Order not found' });
    if (Math.round(Number(bkAmt.total_amount)) !== amount) return res.json({ RspCode: '04', Message: 'Invalid amount' });

    if (bkAmt.status === 'PENDING') {
      await db.query(`UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`, [bookingId]).catch(() => {});
      await db.query(
        `INSERT INTO payment (booking_id, method, amount, status, payment_time)
         VALUES (?, 'VNPAY', ?, 'COMPLETED', NOW())`,
        [bookingId, amount]
      ).catch(() => {});
    }
    return res.json({ RspCode: '00', Message: 'Confirm Success' });
  } catch (e) {
    logger.error('[vnpay/ipn]', e.message);
    return res.json({ RspCode: '99', Message: 'Unknown error' });
  }
});

// ── POST /api/payment/vietqr/confirm ──────────────────────────────────────
// Người dùng xác nhận đã chuyển khoản (VietQR / bank transfer — mô phỏng,
// không phải xác thực chữ ký ngân hàng thật; xem ghi chú ở payment.config.js).
//
// F-13/F-17 (Phase 2H, Priority 4): trước đây chỉ cần biết booking_id là có
// thể đánh dấu BẤT KỲ vé nào là đã thanh toán. Sửa bằng cách yêu cầu thêm
// booking_code — cùng cơ chế "bí mật chia sẻ" đã dùng cho tính năng tra cứu
// vé khách (guest lookup) hiện có, áp dụng cho cả khách và người dùng đã
// đăng nhập (tránh phụ thuộc vào việc trang này có gửi JWT hay không, việc
// đó thuộc phạm vi RBAC riêng, chưa xử lý ở phase này).
async function confirmVietQR(req, res) {
  const { booking_id, booking_code } = req.body;
  if (!booking_id || !booking_code) {
    return res.status(400).json({ message: 'Thiếu booking_id hoặc booking_code' });
  }
  try {
    const [[bk]] = await db.query(
      'SELECT status, total_amount, booking_code FROM booking WHERE booking_id=?',
      [booking_id]
    );
    if (!bk) return res.status(404).json({ message: 'Không tìm thấy vé' });
    if (!bk.booking_code || bk.booking_code !== booking_code) {
      return res.status(403).json({ message: 'Mã vé không khớp' });
    }
    if (bk.status === 'PAID') return res.json({ success: true, message: 'Vé đã được thanh toán' });
    if (bk.status !== 'PENDING') {
      return res.status(409).json({ message: `Không thể xác nhận thanh toán cho vé ở trạng thái ${bk.status}` });
    }

    const [updResult] = await db.query(
      `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`,
      [booking_id]
    );
    if (updResult.affectedRows !== 1) {
      // Trạng thái đã đổi giữa lúc kiểm tra và lúc ghi (race) — không tạo
      // thêm bản ghi payment trùng lặp.
      return res.status(409).json({ message: 'Trạng thái vé đã thay đổi, vui lòng tải lại' });
    }
    await db.query(
      `INSERT INTO payment (booking_id, method, amount, status, payment_time)
       VALUES (?, 'VIETQR', ?, 'COMPLETED', NOW())`,
      [booking_id, bk.total_amount]
    ).catch(() => {});

    res.json({ success: true });
  } catch (e) {
    logger.error('[vietqr/confirm]', e.message);
    res.status(500).json({ message: 'Lỗi xác nhận thanh toán' });
  }
}
router.post('/vietqr/confirm', paymentLimiter, confirmVietQR);

// ── GET /api/payment/status/:bookingId ────────────────────────────────────
router.get('/status/:bookingId', async (req, res) => {
  try {
    /* Phase 2I: this endpoint previously returned booking_code with zero
       auth for any booking_id — a direct bypass of the F-13/F-17 fix,
       since an attacker could learn the exact secret vietqr/confirm
       requires. status alone is not sensitive (no PII, no secret); the
       booking_code display on payment-result.html now comes from the
       redirect URL instead (the caller already has it at that point —
       see booking.html's confirmGatewayPayment/confirmVietQR, and the
       vnpay/return · momo/return handlers below). */
    const [[bk]] = await db.query(
      'SELECT status FROM booking WHERE booking_id=?',
      [req.params.bookingId]
    );
    if (!bk) return res.status(404).json({ message: 'Không tìm thấy vé' });
    res.json({ status: bk.status });
  } catch (e) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.confirmVietQR = confirmVietQR; // exported for direct unit testing only
module.exports = router;
