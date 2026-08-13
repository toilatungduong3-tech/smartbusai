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
};
