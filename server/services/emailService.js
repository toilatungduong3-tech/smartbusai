'use strict';
const nodemailer = require('nodemailer');

// Config: use environment variable or fallback to Gmail test account
// For demo: use Ethereal (fake SMTP for testing)
let transporter = null;

async function getTransporter() {
    if (transporter) return transporter;

    // Use env vars if available, else create Ethereal test account
    if (process.env.SMTP_HOST) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
    } else {
        // Ethereal for demo/testing
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: { user: testAccount.user, pass: testAccount.pass }
        });
        console.log('📧 Email test account:', testAccount.user);
        console.log('📧 Preview at: https://ethereal.email');
    }
    return transporter;
}

// HTML email template
function buildEmailHTML(title, content, color = '#00ffe0') {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
body{margin:0;padding:0;background:#04080f;font-family:'Segoe UI',Arial,sans-serif;}
.wrapper{max-width:600px;margin:0 auto;background:linear-gradient(145deg,#08122c,#04080f);border:1px solid rgba(0,255,224,.2);border-radius:16px;overflow:hidden;}
.header{background:linear-gradient(135deg,rgba(0,255,224,.15),rgba(0,168,255,.1));padding:28px 32px;border-bottom:1px solid rgba(0,255,224,.2);}
.logo{font-size:22px;font-weight:900;color:${color};letter-spacing:.5px;}
.content{padding:32px;}
h2{color:#fff;font-size:20px;margin:0 0 16px;}
p{color:rgba(255,255,255,.7);line-height:1.7;margin:8px 0;}
.highlight{background:rgba(0,255,224,.08);border:1px solid rgba(0,255,224,.2);border-radius:12px;padding:16px 20px;margin:16px 0;}
.highlight p{color:#00ffe0;font-weight:600;}
.btn{display:inline-block;background:linear-gradient(135deg,#00ffe0,#00a8ff);color:#04080f;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:800;font-size:14px;margin-top:20px;}
.footer{padding:20px 32px;border-top:1px solid rgba(255,255,255,.05);color:rgba(255,255,255,.25);font-size:11px;text-align:center;}
</style></head>
<body><div class="wrapper">
<div class="header"><div class="logo">🚌 SmartBusAI</div><p style="color:rgba(255,255,255,.5);margin:4px 0 0;font-size:13px;">Nền tảng đặt vé xe thông minh</p></div>
<div class="content">${content}</div>
<div class="footer">© 2024 SmartBusAI · support@smartbusai.vn · Hotline: 1900 6789<br>Email này được gửi tự động, vui lòng không reply.</div>
</div></body></html>`;
}

// Send booking confirmation email
async function sendBookingConfirmation(booking) {
    const t = await getTransporter();
    const content = `
        <h2>✅ Đặt vé thành công!</h2>
        <p>Xin chào <strong style="color:#fff">${booking.full_name}</strong>,</p>
        <p>Vé của bạn đã được xác nhận thành công.</p>
        <div class="highlight">
            <p>🗺️ Tuyến: ${booking.origin} → ${booking.destination}</p>
            <p>🕐 Khởi hành: ${new Date(booking.departure_time).toLocaleString('vi-VN')}</p>
            <p>💺 Ghế: ${booking.seat_numbers || 'Chưa xác định'}</p>
            <p>💰 Tổng tiền: ${Number(booking.total_amount).toLocaleString('vi-VN')} VNĐ</p>
            <p>🎫 Mã vé: #${booking.booking_id}</p>
        </div>
        <p>Vui lòng mang mã QR hoặc số vé khi lên xe.</p>
    `;
    const info = await t.sendMail({
        from: '"SmartBusAI" <noreply@smartbusai.vn>',
        to: booking.email,
        subject: `✅ Xác nhận vé #${booking.booking_id} — ${booking.origin} → ${booking.destination}`,
        html: buildEmailHTML('Xác nhận đặt vé', content)
    });
    console.log(`📧 Booking confirmation sent: ${nodemailer.getTestMessageUrl(info)}`);
    return info;
}

// Send cancellation email
async function sendBookingCancellation(booking) {
    const t = await getTransporter();
    const content = `
        <h2>❌ Vé đã bị huỷ</h2>
        <p>Xin chào <strong style="color:#fff">${booking.full_name}</strong>,</p>
        <p>Vé của bạn đã bị huỷ theo yêu cầu.</p>
        <div class="highlight" style="border-color:rgba(231,76,60,.3);background:rgba(231,76,60,.08);">
            <p style="color:#e74c3c;">🗺️ Tuyến: ${booking.origin} → ${booking.destination}</p>
            <p style="color:#e74c3c;">🎫 Mã vé: #${booking.booking_id}</p>
        </div>
        <p>Nếu bạn không yêu cầu huỷ vé này, vui lòng liên hệ hỗ trợ ngay.</p>
    `;
    const info = await t.sendMail({
        from: '"SmartBusAI" <noreply@smartbusai.vn>',
        to: booking.email,
        subject: `❌ Vé #${booking.booking_id} đã bị huỷ`,
        html: buildEmailHTML('Thông báo huỷ vé', content, '#e74c3c')
    });
    console.log(`📧 Cancellation email sent: ${nodemailer.getTestMessageUrl(info)}`);
    return info;
}

// Send trip reminder (2 hours before)
async function sendTripReminder(booking) {
    const t = await getTransporter();
    const content = `
        <h2>⏰ Nhắc nhở khởi hành!</h2>
        <p>Xin chào <strong style="color:#fff">${booking.full_name}</strong>,</p>
        <p>Chuyến xe của bạn sẽ khởi hành trong <strong style="color:#f39c12">2 giờ nữa</strong>.</p>
        <div class="highlight" style="border-color:rgba(243,156,18,.3);background:rgba(243,156,18,.08);">
            <p style="color:#f39c12;">🗺️ ${booking.origin} → ${booking.destination}</p>
            <p style="color:#f39c12;">🕐 ${new Date(booking.departure_time).toLocaleString('vi-VN')}</p>
            <p style="color:#f39c12;">💺 Ghế: ${booking.seat_numbers || '—'}</p>
        </div>
        <p>Vui lòng có mặt tại bến xe trước 30 phút.</p>
    `;
    const info = await t.sendMail({
        from: '"SmartBusAI" <noreply@smartbusai.vn>',
        to: booking.email,
        subject: `⏰ Nhắc nhở: Chuyến xe khởi hành lúc ${new Date(booking.departure_time).toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit'})}`,
        html: buildEmailHTML('Nhắc nhở khởi hành', content, '#f39c12')
    });
    console.log(`📧 Reminder sent: ${nodemailer.getTestMessageUrl(info)}`);
    return info;
}

module.exports = { sendBookingConfirmation, sendBookingCancellation, sendTripReminder };
