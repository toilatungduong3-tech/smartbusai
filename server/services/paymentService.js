'use strict';
const crypto = require('crypto');
const https  = require('https');
const cfg    = require('../config/payment.config');

// ── MoMo ──────────────────────────────────────────────────────────────────
exports.createMoMoPayment = ({ bookingId, amount, orderInfo }) => {
  const { partnerCode, accessKey, secretKey, endpoint, redirectUrl, ipnUrl } = cfg.momo;
  const requestId = `${partnerCode}${Date.now()}`;
  const orderId   = `SMART${bookingId}_${Date.now()}`;
  const extraData = Buffer.from(JSON.stringify({ bookingId })).toString('base64');

  const rawHash = [
    `accessKey=${accessKey}`,
    `amount=${amount}`,
    `extraData=${extraData}`,
    `ipnUrl=${ipnUrl}`,
    `orderId=${orderId}`,
    `orderInfo=${orderInfo}`,
    `partnerCode=${partnerCode}`,
    `redirectUrl=${redirectUrl}`,
    `requestId=${requestId}`,
    `requestType=captureWallet`,
  ].join('&');

  const signature = crypto.createHmac('sha256', secretKey).update(rawHash).digest('hex');

  const body = JSON.stringify({
    partnerCode, accessKey, requestId,
    amount:      String(amount),
    orderId,     orderInfo,
    redirectUrl, ipnUrl,
    extraData,   requestType: 'captureWallet',
    signature,   lang: 'vi',
  });

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.payUrl) resolve({ payUrl: json.payUrl, orderId });
          else reject(new Error(json.message || `MoMo error: ${json.resultCode}`));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

exports.verifyMoMoReturn = (params) => {
  const { secretKey, accessKey } = cfg.momo;
  const {
    partnerCode, orderId, requestId, amount,
    orderInfo, orderType, transId, resultCode,
    message, payType, responseTime, extraData,
    signature: received,
  } = params;

  const rawHash = [
    `accessKey=${accessKey}`,
    `amount=${amount}`,
    `extraData=${extraData}`,
    `message=${message}`,
    `orderId=${orderId}`,
    `orderInfo=${orderInfo}`,
    `orderType=${orderType}`,
    `partnerCode=${partnerCode}`,
    `payType=${payType}`,
    `requestId=${requestId}`,
    `responseTime=${responseTime}`,
    `resultCode=${resultCode}`,
    `transId=${transId}`,
  ].join('&');

  const expected = crypto.createHmac('sha256', secretKey).update(rawHash).digest('hex');
  const sigOk = expected === received;
  const paid  = String(resultCode) === '0';
  return sigOk && paid;
};

exports.parseMoMoBookingId = (params) => {
  try {
    return JSON.parse(Buffer.from(params.extraData || '', 'base64').toString()).bookingId;
  } catch {}
  return params.orderId?.match(/SMART(\d+)_/)?.[1];
};

// ── VNPay ─────────────────────────────────────────────────────────────────
function sortObject(obj) {
  const out = {};
  Object.keys(obj).sort().forEach(k => { out[k] = obj[k]; });
  return out;
}

exports.createVNPayPayment = ({ bookingId, amount, orderInfo, ipAddr }) => {
  const { tmnCode, hashSecret, url: vnpUrl, returnUrl } = cfg.vnpay;

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const createDate = [
    now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()),
    pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds()),
  ].join('');

  const orderId = `SB${bookingId}T${Date.now()}`.slice(-20);

  let params = {
    vnp_Version:    '2.1.0',
    vnp_Command:    'pay',
    vnp_TmnCode:    tmnCode,
    vnp_Locale:     'vn',
    vnp_CurrCode:   'VND',
    vnp_TxnRef:     orderId,
    vnp_OrderInfo:  orderInfo,
    vnp_OrderType:  '250000',
    vnp_Amount:     amount * 100,
    vnp_ReturnUrl:  returnUrl,
    vnp_IpAddr:     ipAddr || '127.0.0.1',
    vnp_CreateDate: createDate,
  };

  params = sortObject(params);
  const signData  = new URLSearchParams(params).toString();
  const secureHash = crypto.createHmac('sha512', hashSecret)
    .update(Buffer.from(signData, 'utf-8')).digest('hex');
  params.vnp_SecureHash = secureHash;

  const payUrl = `${vnpUrl}?${new URLSearchParams(params).toString()}`;
  return { payUrl, orderId };
};

exports.verifyVNPayReturn = (query) => {
  const { hashSecret } = cfg.vnpay;
  const received = query.vnp_SecureHash;
  if (!received) return false;
  const params = { ...query };
  delete params.vnp_SecureHash;
  delete params.vnp_SecureHashType;
  const sorted    = sortObject(params);
  const signData  = new URLSearchParams(sorted).toString();
  const expected  = crypto.createHmac('sha512', hashSecret)
    .update(Buffer.from(signData, 'utf-8')).digest('hex');
  return received === expected && query.vnp_ResponseCode === '00';
};

exports.parseVNPayBookingId = (query) => {
  return query.vnp_TxnRef?.match(/SB(\d+)T/)?.[1];
};

// ── ZaloPay ───────────────────────────────────────────────────────────────
exports.createZaloPayPayment = ({ bookingId, amount, orderInfo }) => {
  const { appId, key1, endpoint, callbackUrl } = cfg.zalopay;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const appTransId = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth()+1)}${pad(now.getDate())}_SB${bookingId}_${Date.now()}`;
  const appTime = Date.now();
  const appUser = 'smartbusai';
  const item = '[]';
  // bookingId travels in embed_data (same role as MoMo's extraData above) —
  // ZaloPay's callback echoes embed_data back verbatim, so this is how
  // zalopay/callback recovers which booking a payment belongs to.
  const embedData = JSON.stringify({ bookingId });

  // ZaloPay v2/create MAC — order-sensitive, field order below is fixed by
  // ZaloPay's spec (app_id|app_trans_id|app_user|amount|app_time|embed_data|item).
  const macInput = [appId, appTransId, appUser, amount, appTime, embedData, item].join('|');
  const mac = crypto.createHmac('sha256', key1).update(macInput).digest('hex');

  const body = new URLSearchParams({
    app_id: String(appId), app_user: appUser, app_trans_id: appTransId,
    app_time: String(appTime), amount: String(amount), item, embed_data: embedData,
    description: orderInfo, bank_code: '', callback_url: callbackUrl, mac,
  }).toString();

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.return_code === 1 && json.order_url) resolve({ payUrl: json.order_url, orderId: appTransId });
          else reject(new Error(json.return_message || json.sub_return_message || `ZaloPay error: ${json.return_code}`));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

// ZaloPay's IPN body is { data: "<json string>", mac: "<hmac>" } — the mac
// is computed over the raw `data` string itself (unlike MoMo/VNPay, which
// sign a set of individual fields), per ZaloPay's callback spec.
exports.verifyZaloPayCallback = (body) => {
  const { key2 } = cfg.zalopay;
  const { data, mac: received } = body || {};
  if (!data || !received) return false;
  const expected = crypto.createHmac('sha256', key2).update(data).digest('hex');
  return expected === received;
};

exports.parseZaloPayCallbackData = (body) => {
  try {
    const parsed = JSON.parse(body.data);
    const embedData = JSON.parse(parsed.embed_data || '{}');
    return { bookingId: embedData.bookingId, amount: parsed.amount };
  } catch { return {}; }
};

// ── VietQR (static bank transfer QR) ──────────────────────────────────────
exports.getVietQRUrl = ({ amount, bookingId }) => {
  const { bankId, accountNo, accountName, template } = cfg.vietqr;
  const info = encodeURIComponent(`Thanh toan SmartBus ${bookingId}`);
  const name = encodeURIComponent(accountName);
  return `https://img.vietqr.io/image/${bankId}-${accountNo}-${template}.png?amount=${amount}&addInfo=${info}&accountName=${name}`;
};
