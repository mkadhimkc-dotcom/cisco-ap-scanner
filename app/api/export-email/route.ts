import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { EmailExportPayload } from '@/lib/types';

const isPayload = (value: unknown): value is EmailExportPayload => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<EmailExportPayload>;
  return (
    typeof v.to === 'string' &&
    typeof v.filename === 'string' &&
    typeof v.csv === 'string' &&
    v.to.length <= 320 &&
    v.filename.length <= 150 &&
    v.csv.length > 0
  );
};

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !from) {
    return NextResponse.json({ error: 'Email service is not configured' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isPayload(body)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { to, filename, csv } = body;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    return NextResponse.json({ error: 'Invalid destination email' }, { status: 400 });
  }

  const resend = new Resend(apiKey);

  try {
    await resend.emails.send({
      from,
      to,
      subject: `Cisco AP Scan Export - ${new Date().toISOString().slice(0, 10)}`,
      text: 'Attached is your Cisco AP scan export CSV generated from the field scanner.',
      attachments: [
        {
          filename,
          content: Buffer.from(csv).toString('base64'),
        },
      ],
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 });
  }
}
