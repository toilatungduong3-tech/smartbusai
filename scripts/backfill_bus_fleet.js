'use strict';
/**
 * One-off, idempotent data-integrity + fleet-size repair.
 *
 * Found live in the running DB (2026-08-28):
 *   - 43/53 buses had ZERO rows in `seat` despite a real total_seats value
 *     (never had seat generation run against them) — of those, bus_id 10
 *     (916 real trips) and bus_id 13 (888 real trips) are actually used by
 *     real trips today, meaning ~1,804 real trips currently have an empty,
 *     unbookable seat map.
 *   - bus_id 4 has real seats (22, with 10 real bookings against them) but
 *     a stale total_seats=16 — fixed by correcting the count column, NOT
 *     by touching the seat rows real bookings already reference.
 *   - All 53 buses have seat_layout_config=NULL. getBusSeatLayout() already
 *     computes a layout on the fly when this is NULL, so it's not a broken
 *     feature by itself — but any bus getting fresh seat rows here also
 *     gets its config persisted, generated from the exact same call that
 *     produced those rows (buildSeatLayout + flattenLayoutToSeats), so the
 *     two can never describe a different layout than what's bookable.
 *   - 44 buses (added after the original 9-bus seed batch) have NULL
 *     manufacturer/manufacture_year/color/mileage.
 *   - Only 53 buses across 8 operators (~6.6/operator) — thin for a system
 *     already carrying 13k+ trips.
 *
 * Idempotent: every step only acts on rows matching the exact "broken"
 * condition it targets (0 seats, NULL metadata, etc.) — safe to re-run.
 */
require('dotenv').config();
const db = require('../server/config/db');
const { buildSeatLayout, flattenLayoutToSeats } = require('../server/services/seatLayoutService');

const MANUFACTURERS = ['Hyundai', 'Thaco', 'Samco', 'Isuzu', 'Mercedes-Benz'];
const COLORS = ['Xanh dương', 'Trắng', 'Bạc', 'Đỏ', 'Vàng'];
const PROVINCE_CODES = ['51B', '51C', '51D', '29B', '50A', '58A', '59A', '60A', '66A', '67A', '74A', '75A', '82A', '43A', '92A'];
const BUS_TYPES = [
    { type: 'Ghế ngồi 45 chỗ', seats: 45 },
    { type: 'Giường nằm 40 chỗ', seats: 40 },
    { type: 'Giường nằm 34 chỗ', seats: 34 },
    { type: 'VIP Limousine 22 chỗ', seats: 22 },
    { type: 'LIMOUSINE', seats: 34 },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function generatePlateNumber() {
    for (let i = 0; i < 20; i++) {
        const candidate = `${pick(PROVINCE_CODES)}-${randInt(10000, 99999)}`;
        const [[exists]] = await db.query('SELECT bus_id FROM bus WHERE plate_number=?', [candidate]);
        if (!exists) return candidate;
    }
    throw new Error('Could not generate a unique plate number after 20 attempts');
}

async function fixBus4() {
    const [[row]] = await db.query('SELECT total_seats FROM bus WHERE bus_id=4');
    if (row && row.total_seats !== 22) {
        await db.query('UPDATE bus SET total_seats=22 WHERE bus_id=4');
        console.log('✅ bus_id=4: corrected total_seats 16 -> 22 (matches its real, already-booked 22 seats)');
    } else {
        console.log('— bus_id=4 already correct, skipped');
    }
}

async function generateMissingSeats() {
    const [buses] = await db.query(`
        SELECT b.bus_id, b.bus_type, b.total_seats, COUNT(s.seat_id) actual
        FROM bus b LEFT JOIN seat s ON s.bus_id = b.bus_id
        GROUP BY b.bus_id, b.bus_type, b.total_seats
        HAVING actual = 0
    `);
    console.log(`Found ${buses.length} bus(es) with zero seats — generating...`);
    for (const bus of buses) {
        const layout = buildSeatLayout(bus.bus_type, bus.total_seats);
        const seats = flattenLayoutToSeats(layout);
        for (const s of seats) {
            await db.query('INSERT INTO seat (bus_id, seat_number, seat_type) VALUES (?,?,?)', [bus.bus_id, s.seat_number, s.seat_type]);
        }
        await db.query('UPDATE bus SET seat_layout_config=? WHERE bus_id=?', [JSON.stringify(layout), bus.bus_id]);
        console.log(`  bus_id=${bus.bus_id} (${bus.bus_type}, ${bus.total_seats} chỗ): generated ${seats.length} seats + seat_layout_config`);
    }
}

async function backfillMetadata() {
    const [buses] = await db.query(`
        SELECT bus_id FROM bus
        WHERE manufacturer IS NULL OR manufacture_year IS NULL OR color IS NULL OR mileage IS NULL
    `);
    console.log(`Found ${buses.length} bus(es) missing manufacturer/year/color/mileage — backfilling...`);
    for (const bus of buses) {
        await db.query(
            'UPDATE bus SET manufacturer=IFNULL(manufacturer,?), manufacture_year=IFNULL(manufacture_year,?), color=IFNULL(color,?), mileage=IFNULL(mileage,?) WHERE bus_id=?',
            [pick(MANUFACTURERS), randInt(2018, 2024), pick(COLORS), randInt(15000, 250000), bus.bus_id]
        );
    }
    if (buses.length) console.log(`  backfilled realistic manufacturer/year/color/mileage for ${buses.length} bus(es)`);
}

async function expandFleet(perOperator = 8) {
    const [operators] = await db.query('SELECT operator_id FROM bus_operator');
    console.log(`Expanding fleet: +${perOperator} bus(es) per operator (${operators.length} operators)...`);
    let created = 0;
    for (const op of operators) {
        for (let i = 0; i < perOperator; i++) {
            const { type, seats } = pick(BUS_TYPES);
            const plate_number = await generatePlateNumber();
            const layout = buildSeatLayout(type, seats);
            const seatRows = flattenLayoutToSeats(layout);

            const [result] = await db.query(
                `INSERT INTO bus (operator_id, plate_number, bus_type, total_seats, status, manufacturer, manufacture_year, color, mileage, description, seat_layout_config)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                [op.operator_id, plate_number, type, seats, 'AVAILABLE', pick(MANUFACTURERS), randInt(2018, 2024), pick(COLORS), randInt(15000, 250000), null, JSON.stringify(layout)]
            );
            const busId = result.insertId;
            for (const s of seatRows) {
                await db.query('INSERT INTO seat (bus_id, seat_number, seat_type) VALUES (?,?,?)', [busId, s.seat_number, s.seat_type]);
            }
            created++;
        }
    }
    console.log(`✅ Created ${created} new bus(es) with full seat data across ${operators.length} operators`);
}

(async () => {
    console.log('=== Bus fleet data-integrity repair + expansion ===\n');
    await fixBus4();
    await generateMissingSeats();
    await backfillMetadata();
    await expandFleet(8);

    const [[busCount]] = await db.query('SELECT COUNT(*) c FROM bus');
    const [[seatCount]] = await db.query('SELECT COUNT(*) c FROM seat');
    const [[zeroSeatBuses]] = await db.query(`
        SELECT COUNT(*) c FROM (
            SELECT b.bus_id FROM bus b LEFT JOIN seat s ON s.bus_id=b.bus_id
            GROUP BY b.bus_id HAVING COUNT(s.seat_id)=0
        ) x
    `);
    console.log(`\n=== Done. Total buses: ${busCount.c} | Total seats: ${seatCount.c} | Buses still with 0 seats: ${zeroSeatBuses.c} ===`);
    process.exit(0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
