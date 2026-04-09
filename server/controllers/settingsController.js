const fs   = require("fs");
const path = require("path");

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

/* POST /api/settings  (merge-patch) */
exports.saveSettings = (req, res) => {
    try {
        const current = load();
        const updated  = { ...current, ...req.body };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
        res.json({ message: "Settings saved", settings: updated });
    } catch (err) {
        console.error("Settings save error:", err);
        res.status(500).json({ error: "Failed to save settings" });
    }
};
