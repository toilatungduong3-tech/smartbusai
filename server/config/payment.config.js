'use strict';
// ═══════════════════════════════════════════════════════
// PAYMENT GATEWAY CONFIG — SmartBusAI
// Thay bằng credentials thật khi deploy production
// ═══════════════════════════════════════════════════════

const BASE_URL = process.env.BASE_URL || 'http://localhost:2704';

module.exports = {
  momo: {
    partnerCode:  process.env.MOMO_PARTNER_CODE  || 'MOMO',
    accessKey:    process.env.MOMO_ACCESS_KEY    || 'F8BBA842ECF85',
    secretKey:    process.env.MOMO_SECRET_KEY    || 'K951B6PE1waDMi640xX08PD3vg6EkVlz',
    endpoint:     'https://test-payment.momo.vn/v2/gateway/api/create',
    redirectUrl:  `${BASE_URL}/api/payment/momo/return`,
    ipnUrl:       `${BASE_URL}/api/payment/momo/notify`,
  },
  vnpay: {
    tmnCode:    process.env.VNPAY_TMN_CODE    || 'DEMOV210',
    hashSecret: process.env.VNPAY_HASH_SECRET || 'RAOEXHYVSDDIIENYWSLDIIZTANXUXZFJ',
    url:        'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    returnUrl:  `${BASE_URL}/api/payment/vnpay/return`,
  },
  vietqr: {
    // Thay bằng thông tin tài khoản ngân hàng thật
    bankId:      process.env.VIETQR_BANK_ID      || 'MB',
    accountNo:   process.env.VIETQR_ACCOUNT_NO   || '0123456789',
    accountName: process.env.VIETQR_ACCOUNT_NAME || 'SMARTBUS AI',
    template:    'compact2',
  },
  // ZaloPay Sandbox — app_id/key1/key2/endpoint below are ZaloPay's own
  // published sandbox demo app (from their public integration docs, same
  // "vendor's own test credentials, not a leaked secret" status as the
  // MoMo/VNPay defaults above). Swap for real merchant credentials from
  // the ZaloPay Merchant Portal before processing real money.
  zalopay: {
    appId:       process.env.ZALOPAY_APP_ID  || '2553',
    key1:        process.env.ZALOPAY_KEY1    || 'PcY4iZIKFCIdgZvA6ueMcMHHUbRLYjPL',
    key2:        process.env.ZALOPAY_KEY2    || 'kLtgPl8HHhfvMuDHPwKfgfsY4Ydm9eIz',
    endpoint:    'https://sb-openapi.zalopay.vn/v2/create',
    callbackUrl: `${BASE_URL}/api/payment/zalopay/callback`,
    redirectUrl: `${BASE_URL}/api/payment/zalopay/return`,
  },
};
