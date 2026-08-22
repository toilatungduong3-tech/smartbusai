'use strict';
/**
 * SmartBusAI — Sprint 6: Dynamic Seat Layout Engine.
 *
 * Builds a JSON floor/row/column/aisle matrix (`bus.seat_layout_config`)
 * from a bus's free-text `bus_type` + `total_seats`, then flattens it into
 * the same `{seat_number, seat_type}` shape seatController.js already
 * inserts into the `seat` table — the seat table's own schema is
 * unchanged, this only replaces HOW its rows are generated.
 *
 * Bus-type classification reuses the same keyword categories already
 * established and tested in tripController.js's search filter (VIP /
 * LIMOUSINE / NORMAL free-text matching against real bus_type strings
 * like "VIP Limousine 16 chỗ", "Giường nằm 40 chỗ") — not a new taxonomy.
 */

function classifyBusCategory(busType) {
    const t = String(busType || '').toUpperCase();
    if (t.includes('GIƯỜNG NẰM') || t.includes('SLEEPER')) return 'SLEEPER';
    if (t.includes('LIMOUSINE') || t.includes('VIP')) return 'LIMOUSINE';
    return 'SEATER';
}

/** One row of seat cells, alternating seat columns with a single aisle gap
 *  at `aislePos` (0-indexed column count before the aisle). */
function buildRow(rowNum, cols, aislePos, seatType, floor, specialTag) {
    const cells = [];
    for (let c = 0; c < cols.length; c++) {
        if (c === aislePos) cells.push({ aisle: true });
        cells.push({
            col: cols[c],
            seat_number: `${cols[c]}${rowNum}`,
            floor,
            type: seatType,
            special: specialTag || null,
        });
    }
    return { row: rowNum, cells };
}

function buildSeaterLayout(totalSeats) {
    // Matches the pre-Sprint-6 flat layout exactly (4 columns A-D, first 2
    // rows VIP) — existing seeded buses keep the same seat_number/type
    // shape they always had, just now also described as a JSON blueprint.
    const cols = ['A', 'B', 'C', 'D'];
    const rows = [];
    let created = 0;
    for (let r = 1; created < totalSeats; r++) {
        const seatType = r <= 2 ? 'VIP' : 'NORMAL';
        const row = buildRow(r, cols, 2, seatType, 1, r === 1 ? 'near_driver' : null);
        // Trim cells beyond totalSeats on the final row.
        const seatCells = row.cells.filter(c => !c.aisle);
        if (created + seatCells.length > totalSeats) {
            let keep = totalSeats - created;
            row.cells = row.cells.filter(c => {
                if (c.aisle) return true;
                if (keep > 0) { keep--; return true; }
                return false;
            });
        }
        created += row.cells.filter(c => !c.aisle).length;
        rows.push(row);
    }
    return { floors: [{ floor: 1, rows }] };
}

function buildLimousineLayout(totalSeats) {
    // Spacious 1+1/2-across VIP seating, aisle after the first column.
    const cols = ['A', 'B'];
    const rows = [];
    let created = 0;
    for (let r = 1; created < totalSeats; r++) {
        const row = buildRow(r, cols, 1, 'VIP', 1, r === 1 ? 'near_driver' : (created + 2 >= totalSeats ? 'near_wc' : null));
        let seatCells = row.cells.filter(c => !c.aisle);
        if (created + seatCells.length > totalSeats) {
            let keep = totalSeats - created;
            row.cells = row.cells.filter(c => {
                if (c.aisle) return true;
                if (keep > 0) { keep--; return true; }
                return false;
            });
        }
        created += row.cells.filter(c => !c.aisle).length;
        rows.push(row);
    }
    return { floors: [{ floor: 1, rows }] };
}

function buildSleeperLayout(totalSeats) {
    // 2 floors, 2 berth-columns (A/B) per row, aisle between them.
    const perFloor = Math.ceil(totalSeats / 2);
    const cols = ['A', 'B'];
    const floors = [];
    let remaining = totalSeats;
    for (let f = 1; f <= 2 && remaining > 0; f++) {
        const floorSeats = Math.min(perFloor, remaining);
        const rows = [];
        let created = 0;
        for (let r = 1; created < floorSeats; r++) {
            const row = buildRow(r, cols, 1, 'NORMAL', f, null);
            let seatCells = row.cells.filter(c => !c.aisle);
            if (created + seatCells.length > floorSeats) {
                let keep = floorSeats - created;
                row.cells = row.cells.filter(c => {
                    if (c.aisle) return true;
                    if (keep > 0) { keep--; return true; }
                    return false;
                });
            }
            created += row.cells.filter(c => !c.aisle).length;
            rows.push(row);
        }
        // Last row of the last floor is nearest the rear WC on most real coaches.
        if (rows.length) {
            const lastRow = rows[rows.length - 1];
            lastRow.cells.forEach(c => { if (!c.aisle) c.special = 'near_wc'; });
        }
        floors.push({ floor: f, rows });
        remaining -= floorSeats;
    }
    return { floors };
}

/** Builds the full JSON layout matrix for a bus. Seat numbers use a
 *  floor-prefixed scheme for SLEEPER buses (2 floors can otherwise
 *  collide on "A1") — floor 2 seat_numbers get a "2-" prefix. */
function buildSeatLayout(busType, totalSeats) {
    const n = Number(totalSeats);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error('totalSeats phải là số nguyên dương');
    }
    const category = classifyBusCategory(busType);
    let layout;
    if (category === 'SLEEPER') layout = buildSleeperLayout(n);
    else if (category === 'LIMOUSINE') layout = buildLimousineLayout(n);
    else layout = buildSeaterLayout(n);

    // Disambiguate seat_number across floors (SLEEPER only has >1 floor).
    layout.floors.forEach(f => {
        if (f.floor === 1) return;
        f.rows.forEach(row => row.cells.forEach(c => {
            if (!c.aisle) c.seat_number = `${f.floor}-${c.seat_number}`;
        }));
    });

    layout.category = category;
    layout.total_seats = n;
    return layout;
}

/** Flattens a layout matrix into the flat {seat_number, seat_type} pairs
 *  seatController.js inserts into the `seat` table — aisle cells excluded. */
function flattenLayoutToSeats(layout) {
    const seats = [];
    for (const floor of layout.floors) {
        for (const row of floor.rows) {
            for (const cell of row.cells) {
                if (cell.aisle) continue;
                seats.push({ seat_number: cell.seat_number, seat_type: cell.type === 'VIP' ? 'VIP' : 'NORMAL' });
            }
        }
    }
    return seats;
}

module.exports = { classifyBusCategory, buildSeatLayout, flattenLayoutToSeats };
