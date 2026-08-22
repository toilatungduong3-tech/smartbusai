/**
 * SmartBusAI — Route inference (curated corridor lookup only)
 *
 * Route-forensics fix (see tests/route_visualization_forensic_audit.md):
 * extracted out of public/pages/passenger/index.html so this exact logic
 * is testable under Jest, not reimplemented/duplicated. Loaded as a plain
 * global-scope <script> in the browser; required as a CommonJS module in
 * tests.
 *
 * inferRoute() previously had a third branch, "Geographic fallback", that
 * picked intermediate provinces using ONLY latitude (no longitude check at
 * all) whenever neither ROUTE_DB nor the HWY1 spine had an entry for the
 * requested pair — fabricating stops like Hải Phòng/Quảng Ninh for a
 * Bắc Giang→Tuyên Quang route because they happen to share a latitude
 * band, despite being hundreds of km away in the wrong direction. That
 * branch has been removed entirely rather than patched. ROUTE_DB and
 * HWY1 remain: both are genuinely human-curated real corridors, not
 * heuristic guesses — when neither matches, inferRoute now returns null
 * so the caller falls through to real DB route_stop data if available,
 * or — honestly — no fabricated intermediate stops at all.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HWY1 = ['Hà Nội', 'Hà Nam', 'Nam Định', 'Ninh Bình', 'Thanh Hóa',
    'Nghệ An', 'Hà Tĩnh', 'Quảng Bình', 'Quảng Trị', 'Huế',
    'Đà Nẵng', 'Quảng Nam', 'Quảng Ngãi', 'Bình Định', 'Phú Yên',
    'Khánh Hòa', 'Ninh Thuận', 'Bình Thuận', 'Đồng Nai', 'TP.HCM'];

  const ROUTE_DB = {
    'hà nội|hải phòng': ['Hà Nội', 'Hưng Yên', 'Hải Dương', 'Hải Phòng'],
    'hải phòng|hà nội': ['Hải Phòng', 'Hải Dương', 'Hưng Yên', 'Hà Nội'],
    'hà nội|quảng ninh': ['Hà Nội', 'Bắc Giang', 'Quảng Ninh'],
    'hà nội|đà nẵng': ['Hà Nội', 'Ninh Bình', 'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Quảng Bình', 'Quảng Trị', 'Huế', 'Đà Nẵng'],
    'hà nội|huế': ['Hà Nội', 'Ninh Bình', 'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Quảng Bình', 'Quảng Trị', 'Huế'],
    'hà nội|tp.hcm': ['Hà Nội', 'Thanh Hóa', 'Nghệ An', 'Quảng Bình', 'Huế', 'Đà Nẵng', 'Bình Định', 'Khánh Hòa', 'Ninh Thuận', 'Bình Thuận', 'Đồng Nai', 'TP.HCM'],
    'hà nội|hồ chí minh': ['Hà Nội', 'Thanh Hóa', 'Nghệ An', 'Quảng Bình', 'Huế', 'Đà Nẵng', 'Bình Định', 'Khánh Hòa', 'Ninh Thuận', 'Bình Thuận', 'Đồng Nai', 'TP.HCM'],
    'tp.hcm|hà nội': ['TP.HCM', 'Đồng Nai', 'Bình Thuận', 'Ninh Thuận', 'Khánh Hòa', 'Bình Định', 'Đà Nẵng', 'Huế', 'Quảng Bình', 'Nghệ An', 'Thanh Hóa', 'Ninh Bình', 'Hà Nội'],
    'hồ chí minh|hà nội': ['TP.HCM', 'Đồng Nai', 'Bình Thuận', 'Ninh Thuận', 'Khánh Hòa', 'Bình Định', 'Đà Nẵng', 'Huế', 'Quảng Bình', 'Nghệ An', 'Thanh Hóa', 'Ninh Bình', 'Hà Nội'],
    'tp.hcm|đà nẵng': ['TP.HCM', 'Đồng Nai', 'Bình Thuận', 'Ninh Thuận', 'Khánh Hòa', 'Phú Yên', 'Bình Định', 'Quảng Ngãi', 'Quảng Nam', 'Đà Nẵng'],
    'đà nẵng|tp.hcm': ['Đà Nẵng', 'Quảng Nam', 'Quảng Ngãi', 'Bình Định', 'Phú Yên', 'Khánh Hòa', 'Ninh Thuận', 'Bình Thuận', 'Đồng Nai', 'TP.HCM'],
    'đà nẵng|hà nội': ['Đà Nẵng', 'Huế', 'Quảng Trị', 'Quảng Bình', 'Hà Tĩnh', 'Nghệ An', 'Thanh Hóa', 'Ninh Bình', 'Hà Nội'],
    'hà nội|vinh': ['Hà Nội', 'Hà Nam', 'Ninh Bình', 'Thanh Hóa', 'Vinh'],
    'vinh|hà nội': ['Vinh', 'Thanh Hóa', 'Ninh Bình', 'Hà Nam', 'Hà Nội'],
    'tp.hcm|đà lạt': ['TP.HCM', 'Đồng Nai', 'Lâm Đồng', 'Đà Lạt'],
    'đà lạt|tp.hcm': ['Đà Lạt', 'Lâm Đồng', 'Đồng Nai', 'TP.HCM'],
    'tp.hcm|cần thơ': ['TP.HCM', 'Long An', 'Tiền Giang', 'Vĩnh Long', 'Cần Thơ'],
    'cần thơ|tp.hcm': ['Cần Thơ', 'Vĩnh Long', 'Tiền Giang', 'Long An', 'TP.HCM'],
    'tp.hcm|nha trang': ['TP.HCM', 'Đồng Nai', 'Bình Thuận', 'Ninh Thuận', 'Nha Trang'],
    'nha trang|tp.hcm': ['Nha Trang', 'Ninh Thuận', 'Bình Thuận', 'Đồng Nai', 'TP.HCM'],
    'hà nội|nha trang': ['Hà Nội', 'Ninh Bình', 'Thanh Hóa', 'Nghệ An', 'Huế', 'Đà Nẵng', 'Quảng Ngãi', 'Bình Định', 'Phú Yên', 'Nha Trang'],
    'tp.hcm|buôn ma thuột': ['TP.HCM', 'Đồng Nai', 'Lâm Đồng', 'Buôn Ma Thuột'],
    'hà nội|buôn ma thuột': ['Hà Nội', 'Thanh Hóa', 'Nghệ An', 'Huế', 'Đà Nẵng', 'Gia Lai', 'Buôn Ma Thuột'],
    'tp.hcm|phan thiết': ['TP.HCM', 'Đồng Nai', 'Phan Thiết'],
    'hà nội|ninh bình': ['Hà Nội', 'Hà Nam', 'Ninh Bình'],
    'hà nội|nam định': ['Hà Nội', 'Hà Nam', 'Nam Định'],
    'hà nội|hải dương': ['Hà Nội', 'Hưng Yên', 'Hải Dương'],
  };

  function normP(s) {
    return (s || '').toLowerCase().trim()
      .replace(/thành phố\s*/, '')
      .replace(/tỉnh\s*/, '')
      .replace(/tp\.\s*/, 'tp.')
      .replace(/hcm|hồ chí minh/, 'tp.hcm')
      .replace('tp.tp.hcm', 'tp.hcm');
  }

  /* Returns a curated multi-city corridor array, or null if no curated
     entry exists for this pair. Never fabricates — see file header. */
  function inferRoute(origin, dest) {
    const o = normP(origin), d = normP(dest);
    const key = `${o}|${d}`;
    if (ROUTE_DB[key]) return ROUTE_DB[key];

    const oIdx = HWY1.findIndex(p => normP(p) === o || normP(p).includes(o) || o.includes(normP(p)));
    const dIdx = HWY1.findIndex(p => normP(p) === d || normP(p).includes(d) || d.includes(normP(p)));
    if (oIdx >= 0 && dIdx >= 0) {
      const [s, e] = oIdx < dIdx ? [oIdx, dIdx] : [dIdx, oIdx];
      let stops = HWY1.slice(s, e + 1);
      if (stops.length > 9) {
        const step = (stops.length - 1) / 5;
        const r = [stops[0]];
        for (let i = 1; i < 5; i++) r.push(stops[Math.round(i * step)]);
        r.push(stops[stops.length - 1]);
        stops = r;
      }
      return oIdx <= dIdx ? stops : [...stops].reverse();
    }

    return null;
  }

  return { HWY1, ROUTE_DB, normP, inferRoute };
});
