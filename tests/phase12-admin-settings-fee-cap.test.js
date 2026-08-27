'use strict';
/**
 * Admin Settings — Phí hệ thống (systemFee) hard cap: 0% – 2.0%, at most
 * 1 decimal digit. Added alongside the map-routing upgrade task; previously
 * settingsController.saveSettings() merge-patched req.body onto disk with
 * zero validation on any field (settings.json even had systemFee:9 — 4.5x
 * over the new cap — persisted from before this rule existed).
 */

const fs = require('fs');

jest.mock('fs', () => ({
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
}));

const settingsCtrl = require('../server/controllers/settingsController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => {
    jest.clearAllMocks();
    fs.readFileSync.mockReturnValue(JSON.stringify({ systemFee: 2, minAmount: 10000 }));
});

describe('settingsController.saveSettings — systemFee cap', () => {
    test.each([2.1, 3, 100, -0.1, -5])(
        'rejects out-of-range systemFee=%p with 400 + exact message',
        (fee) => {
            const req = { body: { systemFee: fee } };
            const res = mockRes();
            settingsCtrl.saveSettings(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                message: 'Phí hệ thống chỉ được nằm trong khoảng từ 0% đến 2.0% (tối đa 1 chữ số thập phân)'
            });
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        }
    );

    test.each([1.25, 0.33, 1.999])(
        'rejects systemFee=%p for having more than 1 decimal digit even though it is in range',
        (fee) => {
            const req = { body: { systemFee: fee } };
            const res = mockRes();
            settingsCtrl.saveSettings(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        }
    );

    test.each([0, 2, 2.0, 0.1, 1.5])(
        'accepts in-range, 1-decimal-max systemFee=%p and persists it',
        (fee) => {
            const req = { body: { systemFee: fee } };
            const res = mockRes();
            settingsCtrl.saveSettings(req, res);
            expect(res.status).not.toHaveBeenCalledWith(400);
            expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
            const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
            expect(written.systemFee).toBe(fee);
        }
    );

    test('does not require/validate systemFee when saving an unrelated section', () => {
        const req = { body: { payTimeout: 20 } };
        const res = mockRes();
        settingsCtrl.saveSettings(req, res);
        expect(res.status).not.toHaveBeenCalledWith(400);
        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });
});
