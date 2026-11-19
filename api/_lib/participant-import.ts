import type { Worksheet } from 'exceljs';

export type ParticipantImportRow = { email: string; name: string | null };
export type ParticipantImportResult =
  | { rows: ParticipantImportRow[]; error: null }
  | { rows: ParticipantImportRow[]; error: 'invalid_layout' | 'empty' };

export function parseParticipantImportSheet(sheet: Worksheet): ParticipantImportResult {
  const rows: ParticipantImportRow[] = [];
  let layout: 'email-only' | 'numbered' | 'named' | null = null;
  let sequence = 0;
  let invalidLayout = false;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = [1, 2, 3].map((column) => String(row.getCell(column).text ?? '').trim());
    const populatedColumns: number[] = [];
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      if (String(cell.text ?? '').trim()) populatedColumns.push(column);
    });
    if (populatedColumns.length === 0) return;

    const [first, second, third] = values.map((value) => value.toLocaleLowerCase('vi'));
    if (rowNumber === 1 && populatedColumns.length === 1 && populatedColumns[0] === 1
      && ['email', 'email công ty'].includes(first)) {
      layout = 'email-only';
      return;
    }
    if (rowNumber === 1 && populatedColumns.length === 2
      && populatedColumns[0] === 1 && populatedColumns[1] === 2
      && ['số thứ tự', 'stt'].includes(first)
      && ['email', 'email công ty'].includes(second)) {
      layout = 'numbered';
      return;
    }
    if (rowNumber === 1 && populatedColumns.length === 3
      && populatedColumns[0] === 1 && populatedColumns[1] === 2 && populatedColumns[2] === 3
      && ['số thứ tự', 'stt'].includes(first)
      && ['họ và tên', 'họ tên', 'tên thí sinh', 'tên'].includes(second)
      && ['email', 'email công ty'].includes(third)) {
      layout = 'named';
      return;
    }

    if (!layout) {
      if (populatedColumns.length === 1 && populatedColumns[0] === 1) layout = 'email-only';
      else if (populatedColumns.length === 2 && populatedColumns[0] === 1 && populatedColumns[1] === 2)
        layout = 'numbered';
      else if (populatedColumns.every((column) => column <= 3)
        && populatedColumns.includes(1) && populatedColumns.includes(3)) layout = 'named';
      else if (populatedColumns.length === 3
        && populatedColumns[0] === 1 && populatedColumns[1] === 2 && populatedColumns[2] === 3)
        layout = 'named';
    }

    if (layout === 'named') {
      if (populatedColumns.some((column) => column > 3)
        || !values[0] || !values[2]
        || !Number.isInteger(Number(values[0])) || Number(values[0]) !== sequence + 1
        || values[1].length > 120) {
        invalidLayout = true;
        return;
      }
      sequence += 1;
      rows.push({ name: values[1] || null, email: values[2] });
      return;
    }

    if (layout === 'numbered') {
      if (populatedColumns.some((column) => column > 2)
        || !values[0] || !values[1]
        || !Number.isInteger(Number(values[0])) || Number(values[0]) !== sequence + 1) {
        invalidLayout = true;
        return;
      }
      sequence += 1;
      rows.push({ name: null, email: values[1] });
      return;
    }

    if (layout !== 'email-only' || populatedColumns.some((column) => column !== 1)) {
      invalidLayout = true;
      return;
    }
    rows.push({ name: null, email: values[0] });
  });

  if (invalidLayout) return { rows, error: 'invalid_layout' };
  if (rows.length === 0) return { rows, error: 'empty' };
  return { rows, error: null };
}
