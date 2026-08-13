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

// ── VietQR (static bank transfer QR) ──────────────────────────────────────
exports.getVietQRUrl = ({ amount, bookingId }) => {
  const { bankId, accountNo, accountName, template } = cfg.vietqr;
  const info = encodeURIComponent(`Thanh toan SmartBus ${bookingId}`);
  const name = encodeURIComponent(accountName);
  return `https://img.vietqr.io/image/${bankId}-${accountNo}-${template}.png?amount=${amount}&addInfo=${info}&accountName=${name}`;
};
