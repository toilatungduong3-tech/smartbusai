'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const pmt     = require('../services/paymentService');

// ── POST /api/payment/create ───────────────────────────────────────────────
// Tạo yêu cầu thanh toán cho booking đã có (status PENDING)
// Body: { booking_id, payment_method: 'momo'|'vnpay'|'vietqr', amount }
router.post('/create', async (req, res) => {
  const { booking_id, payment_method, amount } = req.body;
  if (!booking_id || !payment_method || !amount) {
    return res.status(400).json({ message: 'Thiếu dữ liệu (booking_id, payment_method, amount)' });
  }

  const amountInt = Math.round(Number(amount));
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

    if (payment_method === 'vietqr') {
      const qrUrl = pmt.getVietQRUrl({ amount: amountInt, bookingId: booking_id });
      return res.json({ qrUrl, method: 'vietqr' });
    }

    return res.status(400).json({ message: `Phương thức không hỗ trợ: ${payment_method}` });
  } catch (e) {
    console.error('[payment/create]', e.message);
    return res.status(502).json({ message: e.message || 'Lỗi kết nối cổng thanh toán' });
  }
});

// ── GET /api/payment/vnpay/return ──────────────────────────────────────────
router.get('/vnpay/return', async (req, res) => {
  const isValid  = pmt.verifyVNPayReturn(req.query);
  const bookingId = pmt.parseVNPayBookingId(req.query);
  const amount    = bookingId ? Math.round(Number(req.query.vnp_Amount) / 100) : 0;

  if (isValid && bookingId) {
    await db.query(
      `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`,
      [bookingId]
    ).catch(() => {});
    await db.query(
      `INSERT INTO payment (booking_id, method, amount, status, payment_time)
       VALUES (?, 'VNPAY', ?, 'COMPLETED', NOW())`,
      [bookingId, amount]
    ).catch(() => {});
  }

  const status = isValid ? 'success' : 'failed';
  res.redirect(`/pages/passenger/payment-result.html?status=${status}&bookingId=${bookingId||''}&method=vnpay`);
});

// ── GET /api/payment/momo/return ───────────────────────────────────────────
router.get('/momo/return', async (req, res) => {
  const isValid   = pmt.verifyMoMoReturn(req.query);
  const bookingId = pmt.parseMoMoBookingId(req.query);
  const amount    = Number(req.query.amount) || 0;

  if (isValid && bookingId) {
    await db.query(
      `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`,
      [bookingId]
    ).catch(() => {});
    await db.query(
      `INSERT INTO payment (booking_id, method, amount, status, payment_time)
       VALUES (?, 'MOMO', ?, 'COMPLETED', NOW())`,
      [bookingId, amount]
    ).catch(() => {});
  }

  const status = isValid ? 'success' : 'failed';
  res.redirect(`/pages/passenger/payment-result.html?status=${status}&bookingId=${bookingId||''}&method=momo`);
});

// ── POST /api/payment/momo/notify ──────────────────────────────────────────
// MoMo IPN (server-to-server callback)
router.post('/momo/notify', async (req, res) => {
  try {
    const isValid   = pmt.verifyMoMoReturn(req.body);
    const bookingId = pmt.parseMoMoBookingId(req.body);
    if (isValid && bookingId) {
      await db.query(
        `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`,
        [bookingId]
      ).catch(() => {});
    }
  } catch (e) { console.error('[momo/notify]', e.message); }
  res.json({ message: 'ok' });
});

// ── POST /api/payment/vietqr/confirm ──────────────────────────────────────
// Người dùng xác nhận đã chuyển khoản (VietQR / bank transfer)
router.post('/vietqr/confirm', async (req, res) => {
  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ message: 'Thiếu booking_id' });
  try {
    const [[bk]] = await db.query('SELECT status, total_amount FROM booking WHERE booking_id=?', [booking_id]);
    if (!bk) return res.status(404).json({ message: 'Không tìm thấy vé' });
    if (bk.status === 'PAID') return res.json({ success: true, message: 'Vé đã được thanh toán' });

    await db.query(
      `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'`,
      [booking_id]
    );
    await db.query(
      `INSERT INTO payment (booking_id, method, amount, status, payment_time)
       VALUES (?, 'VIETQR', ?, 'COMPLETED', NOW())`,
      [booking_id, bk.total_amount]
    ).catch(() => {});

    res.json({ success: true });
  } catch (e) {
    console.error('[vietqr/confirm]', e.message);
    res.status(500).json({ message: 'Lỗi xác nhận thanh toán' });
  }
});

// ── GET /api/payment/status/:bookingId ────────────────────────────────────
router.get('/status/:bookingId', async (req, res) => {
  try {
    const [[bk]] = await db.query(
      'SELECT status, booking_code FROM booking WHERE booking_id=?',
      [req.params.bookingId]
    );
    if (!bk) return res.status(404).json({ message: 'Không tìm thấy vé' });
    res.json({ status: bk.status, booking_code: bk.booking_code });
  } catch (e) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;
