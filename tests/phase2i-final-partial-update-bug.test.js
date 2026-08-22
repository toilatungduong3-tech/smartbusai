'use strict';
/**
 * Phase 2I Final pass — CRITICAL bug found via live testing.
 * userController.updateUser previously wrote full_name/email/phone/gender/
 * birth_date/province/district/address_detail unconditionally with a
 * `||null` fallback, so a partial update that only intended to change one
 * field (e.g. the admin "toggle status" quick action, which sends only
 * {status}) silently wiped every other field to NULL — including email,
 * which login() looks the account up by, permanently locking the user out.
 * A real, pre-existing account (user_id 45) was found with this exact
 * damage pattern (NULL username/email/full_name despite having real
 * booking/review/support history) — left untouched, documented, not
 * repaired (no way to reconstruct the original values).
 * All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');
const ctrl = require('../server/controllers/userController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}
beforeEach(() => { jest.clearAllMocks(); });

test('partial update with only {status} does not null out other profile fields', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const req = { params: { id: '5' }, user: { user_id: 1, role: 'ADMIN' }, body: { status: 'BLOCKED' } };
    const res = mockRes();
    await ctrl.updateUser(req, res);
    const [sql, params] = db.query.mock.calls[0];
    // Every profile column must use IFNULL(?, column) — never a bare `?`
    // that would overwrite with the omitted (undefined -> null) value.
    for (const col of ['full_name', 'email', 'phone', 'gender', 'birth_date', 'province', 'district', 'address_detail']) {
        expect(sql).toMatch(new RegExp(`${col}=IFNULL\\(\\?,${col}\\)`));
    }
    // The omitted fields' bound params are all null (their source values),
    // but IFNULL means the DB keeps the existing column value regardless.
    expect(params[0]).toBeNull(); // full_name
    expect(params[1]).toBeNull(); // email
});

test('partial update with only {operator_id} does not null out other profile fields', async () => {
    db.query.mockResolvedValueOnce([[{ operator_id: 1 }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const req = { params: { id: '5' }, user: { user_id: 1, role: 'ADMIN' }, body: { operator_id: 1 } };
    const res = mockRes();
    await ctrl.updateUser(req, res);
    const [sql] = db.query.mock.calls[1];
    expect(sql).toMatch(/email=IFNULL\(\?,email\)/);
    expect(sql).toMatch(/operator_id=\?/);
});

test('sending an actual full_name value still updates it (IFNULL does not block real changes)', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const req = { params: { id: '5' }, user: { user_id: 5, role: 'PASSENGER' }, body: { full_name: 'New Name' } };
    const res = mockRes();
    await ctrl.updateUser(req, res);
    const [, params] = db.query.mock.calls[0];
    expect(params[0]).toBe('New Name');
});
