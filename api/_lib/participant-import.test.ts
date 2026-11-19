import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseParticipantImportSheet } from './participant-import.js';

describe('parseParticipantImportSheet', () => {
  it('accepts a blank name cell in the named participant template', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Danh sách email');
    sheet.addRow(['Số thứ tự', 'Họ và tên', 'Email công ty']);
    sheet.addRow([1, null, 'candidate@tanminhnhan.com.vn']);

    expect(parseParticipantImportSheet(sheet)).toEqual({
      rows: [{ name: null, email: 'candidate@tanminhnhan.com.vn' }],
      error: null,
    });
  });

  it('retains the participant name when supplied', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Danh sách email');
    sheet.addRow(['Số thứ tự', 'Họ và tên', 'Email công ty']);
    sheet.addRow([1, 'Nguyễn Văn A', 'candidate@tanminhnhan.com.vn']);

    expect(parseParticipantImportSheet(sheet)).toEqual({
      rows: [{ name: 'Nguyễn Văn A', email: 'candidate@tanminhnhan.com.vn' }],
      error: null,
    });
  });

  it('rejects non-sequential participant numbers', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Danh sách email');
    sheet.addRow(['Số thứ tự', 'Họ và tên', 'Email công ty']);
    sheet.addRow([2, 'Nguyễn Văn A', 'candidate@tanminhnhan.com.vn']);

    expect(parseParticipantImportSheet(sheet).error).toBe('invalid_layout');
  });
});
