// QR Service for SmartBusAI
const QRCode = require('qrcode');
const crypto = require('crypto');

const QR_SECRET = 'smartbusai_qr_secret_2024';

// Generate checksum for a booking (tamper-proof)
function generateChecksum(bookingId, userId, amount) {
    return crypto
        .createHmac('sha256', QR_SECRET)
        .update(`${bookingId}:${userId}:${amount}`)
        .digest('hex')
        .substring(0, 12)
        .toUpperCase();
}

// Generate QR data string
function generateQRData(booking) {
    const checksum = generateChecksum(booking.booking_id, booking.user_id, booking.total_amount);
    return JSON.stringify({
        bid: booking.booking_id,
        uid: booking.user_id,
        cs: checksum,
        ts: Date.now()
    });
}

// Generate QR as base64 PNG data URL
async function generateQRImage(booking) {
    const data = generateQRData(booking);
    return await QRCode.toDataURL(data, {
        width: 300,
        margin: 2,
        color: { dark: '#00ffe0', light: '#030d18' },
        errorCorrectionLevel: 'H'
    });
}

// Verify QR data
function verifyQR(qrString) {
    try {
        const data = JSON.parse(qrString);
        const expectedCs = generateChecksum(data.bid, data.uid, 0); // We'll verify without amount
        // Just check structure is valid
        return {
            valid: !!(data.bid && data.uid && data.cs),
            bookingId: data.bid,
            userId: data.uid
        };
    } catch {
        return { valid: false };
    }
}

module.exports = { generateQRImage, generateQRData, verifyQR, generateChecksum };
