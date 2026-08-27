const fs   = require("fs");
const path = require("path");
const logger = require('../utils/logger');

const SETTINGS_FILE = path.join(__dirname, "../config/settings.json");

/* ── helpers ── */
function load() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); }
    catch { return {}; }
}

/* GET /api/settings */
exports.getSettings = (req, res) => {
    res.json(load());
};

/* Shared read for server-side price calculations (bookingController) that
   need the current systemFee without going through HTTP — same file/
   source of truth as getSettings/saveSettings above, so the value an
   admin saves can never desync from the value actually charged. */
exports.getSystemFeePercent = () => {
    const fee = Number(load().systemFee);
    return Number.isFinite(fee) ? fee : 0;
};

/* Same rationale as getSystemFeePercent() above — bookingController.
   createBooking previously hardcoded VIP surcharge as basePrice*1.5 (50%)
   regardless of this setting, while booking.html's own display already
   read the real configured value (settings.json currently has it at 20%,
   not 50%) — a 30-point price gap between what the passenger saw and what
   got charged for every VIP seat. Default of 50 matches booking.html's
   own client-side fallback for when the field is missing/invalid. */
exports.getVipSurchargePercent = () => {
    const pct = Number(load().vipSurcharge);
    return Number.isFinite(pct) ? pct : 50;
};

/* Phí hệ thống (systemFee, %) is hard-capped at 0–2.0% with at most 1
   decimal digit. This fee compounds into every ticket's displayed price
   (see booking.html's feeAdjusted calc), so a stray typo here — e.g. 20
   instead of 2.0, or two decimal digits — would misprice every booking
   system-wide with no other guard in place. */
function validateSystemFee(value) {
    const asStr = String(value).trim();
    const num = Number(asStr);
    const oneDecimalMax = /^-?\d+(\.\d)?$/.test(asStr);
    return Number.isFinite(num) && num >= 0 && num <= 2.0 && oneDecimalMax;
}

/* POST /api/settings  (merge-patch) */
exports.saveSettings = (req, res) => {
    try {
        if (req.body.systemFee !== undefined && !validateSystemFee(req.body.systemFee)) {
            return res.status(400).json({
                message: "Phí hệ thống chỉ được nằm trong khoảng từ 0% đến 2.0% (tối đa 1 chữ số thập phân)"
            });
        }

        const current = load();
        const updated  = { ...current, ...req.body };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
        res.json({ message: "Settings saved", settings: updated });
    } catch (err) {
        logger.error("Settings save error:", err);
        res.status(500).json({ message: "Failed to save settings" });
    }
};
