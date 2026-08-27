'use strict';
const crypto = require('crypto');
const https  = require('https');
const cfg    = require('../config/payment.config');
const logger = require('../utils/logger');

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

/* VNPay's checksum must be computed over the RAW (un-encoded) sorted
   key=value pairs — VNPay's own server decodes the incoming query string
   back to raw values, sorts them, and joins them the same way before
   recomputing the hash to compare. Encoding values first (this code used
   to build both the hash input AND the final URL via `new
   URLSearchParams(...).toString()`) hashes the ENCODED string instead,
   which only happens to match VNPay's own recomputation when every value
   is plain ASCII with no characters that need encoding — it silently
   breaks the moment a value has a space, a Vietnamese diacritic, or a `#`
   (exactly the shape of vnp_OrderInfo below, "SmartBusAI - Vé xe #123"),
   producing VNPay's code=99 "invalid signature" response. Confirmed as
   the actual root cause of the reported failures. */
function vnpaySignData(sortedParams) {
  return Object.entries(sortedParams).map(([k, v]) => `${k}=${v}`).join('&');
}

/* Same raw values, percent-encoded for safe transmission as an actual URL
   query string. Critically, this also stops an un-encoded `#` in
   vnp_OrderInfo from being read as a URL fragment — a browser strips
   everything from `#` onward before the request is even sent, which was
   silently dropping vnp_SecureHash and every param after it. */
function vnpayQueryString(sortedParams) {
  return Object.entries(sortedParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/* vnp_CreateDate/vnp_ExpireDate must be Asia/Ho_Chi_Minh wall-clock time
   regardless of the server process's own timezone — a server running in
   UTC (common on cloud/CI hosts) would otherwise stamp a CreateDate up to
   7h off from VNPay's own clock, which VNPay's sandbox can reject. */
function formatVNPayDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  if (parts.hour === '24') parts.hour = '00'; // Intl quirk: midnight can report as "24"
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

/* VNPay expects a plain IPv4-looking address. A local request with no
   reverse proxy in front resolves via req.socket.remoteAddress to the
   IPv6 loopback `::1`, which VNPay's sandbox rejects — normalize any
   non-IPv4 value down to the conventional 127.0.0.1 fallback. */
function normalizeVNPayIp(ip) {
  if (!ip || ip === '::1') return '127.0.0.1';
  const mapped = String(ip).match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : '127.0.0.1';
}

exports.createVNPayPayment = ({ bookingId, amount, orderInfo, ipAddr }) => {
  const { tmnCode, hashSecret, url: vnpUrl, returnUrl } = cfg.vnpay;

  const now = new Date();
  const createDate = formatVNPayDate(now);
  const expireDate = formatVNPayDate(new Date(now.getTime() + 15 * 60 * 1000)); // 15' hold, matches payTimeout default

  const orderId = `SB${bookingId}T${Date.now()}`.slice(-20);

  let params = {
    vnp_Version:    '2.1.0',
    vnp_Command:    'pay',
    vnp_TmnCode:    tmnCode,
    vnp_Locale:     'vn',
    vnp_CurrCode:   'VND',
    vnp_TxnRef:     orderId,
    vnp_OrderInfo:  orderInfo,
    vnp_OrderType:  'other',
    // VNPay requires an integer amount in the smallest currency subunit
    // (VND * 100), never a float — Math.round() guards against any
    // upstream floating-point residue (e.g. a % discount/fee calc)
    // slipping a decimal into the request or its signature.
    vnp_Amount:     Math.round(Number(amount) * 100),
    vnp_ReturnUrl:  returnUrl,
    vnp_IpAddr:     normalizeVNPayIp(ipAddr),
    vnp_CreateDate: createDate,
    vnp_ExpireDate: expireDate,
  };

  params = sortObject(params);
  const signData    = vnpaySignData(params);
  const secureHash  = crypto.createHmac('sha512', hashSecret)
    .update(Buffer.from(signData, 'utf-8')).digest('hex');
  params.vnp_SecureHash = secureHash;

  const payUrl = `${vnpUrl}?${vnpayQueryString(params)}`;

  // Debug visibility requested for verifying code=99-class failures: the
  // exact raw string that was hashed and the final redirect URL, printed
  // before this function ever returns/redirects anywhere.
  logger.info('[VNPay] createVNPayPayment', { bookingId, orderId, signData, secureHash, payUrl });

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
  // req.query values are already URL-decoded by Express — sign the raw
  // decoded values directly (see vnpaySignData's comment above) rather
  // than re-encoding them, which is what VNPay's own server does too.
  const signData  = vnpaySignData(sorted);
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
