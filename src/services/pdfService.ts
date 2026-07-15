import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { supabaseAdmin } from '../config';
import { HttpError } from '../middleware/errorHandler';
import { timesheetService } from './timesheetService';

const SIGNED_URL_TTL_SECONDS = 3600;
const PDF_BUCKET = 'pdfs';

async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'letter', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function uploadAndSign(path: string, pdf: Buffer): Promise<string> {
  const { error: uploadError } = await supabaseAdmin.storage
    .from(PDF_BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    throw new HttpError(500, 'PDF_UPLOAD_FAILED', uploadError.message);
  }

  const { data, error: signError } = await supabaseAdmin.storage
    .from(PDF_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (signError || !data) {
    throw new HttpError(500, 'PDF_SIGN_FAILED', signError?.message ?? 'Unable to sign PDF URL');
  }

  return data.signedUrl;
}

function timesheetHtml(employeeId: string, ppEnd: string, segments: Awaited<ReturnType<typeof timesheetService.buildTimesheet>>): string {
  const rows = segments
    .map(
      (s) => `<tr>
        <td>${s.shift_date}</td>
        <td>${s.segment_type}</td>
        <td>${s.time_in ?? s.leave_time_in ?? ''}</td>
        <td>${s.time_out ?? s.leave_time_out ?? ''}</td>
        <td>${s.leave_type ?? ''}</td>
        <td>${s.hours}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
      th { background: #eee; }
      h1 { font-size: 16px; }
    </style>
  </head><body>
    <h1>Timesheet — Employee ${employeeId} — Pay Period Ending ${ppEnd}</h1>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>In</th><th>Out</th><th>Leave Type</th><th>Hours</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`;
}

function payrollHtml(shiftDate: string, district: number, rows: any[]): string {
  const tableRows = rows
    .map(
      (r) => `<tr>
        <td>${r.company_code}</td>
        <td>${r.station}</td>
        <td>${r.platoon}</td>
        <td>${r.hours_worked}</td>
        <td>${r.leave_type ?? ''}</td>
        <td>${r.leave_hours_used}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
      th { background: #eee; }
      h1 { font-size: 16px; }
    </style>
  </head><body>
    <h1>Payroll — District ${district} — ${shiftDate}</h1>
    <table>
      <thead><tr><th>Company</th><th>Station</th><th>Platoon</th><th>Hours</th><th>Leave Type</th><th>Leave Hours</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </body></html>`;
}

export const pdfService = {
  async generateTimesheetPdf(employeeId: string, ppEnd: string): Promise<string> {
    const segments = await timesheetService.buildTimesheet(employeeId, ppEnd);
    const html = timesheetHtml(employeeId, ppEnd, segments);
    const pdf = await renderHtmlToPdfBuffer(html);
    return uploadAndSign(`timesheet/${employeeId}/${ppEnd}.pdf`, pdf);
  },

  async generatePayrollPdf(shiftDate: string, district: number): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from('payroll_rows')
      .select('*')
      .eq('shift_date', shiftDate)
      .eq('district', district);

    if (error) {
      throw new HttpError(500, 'DATABASE_ERROR', error.message);
    }

    const html = payrollHtml(shiftDate, district, data ?? []);
    const pdf = await renderHtmlToPdfBuffer(html);
    return uploadAndSign(`payroll/${district}/${shiftDate}.pdf`, pdf);
  },
};
