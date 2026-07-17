import { supabase } from '@/integrations/supabase/client';

export interface ReceiptCommsResult {
  receiptNo: string | null;
  emailOk: boolean;
  waOk: boolean;
  waViaDocument: boolean;
  errors: string[];
}

/**
 * Payment acknowledgement comms for one transaction:
 * 1. generate-receipt → PDF in the receipts bucket + signed URL
 * 2. Email via send-template-email with the receipt attached
 * 3. WhatsApp: tries the `payment_receipt` document-header template (PDF in
 *    chat); until that AskEVA template exists/is active, falls back to the
 *    plain-text template matching the email (payment_received / payment_partial).
 */
export async function sendPaymentReceiptComms(opts: {
  schoolId: string;
  transactionId: string;
  templateType: 'payment_received' | 'payment_partial';
  userId?: string | null;
}): Promise<ReceiptCommsResult> {
  const errors: string[] = [];

  let receipt: { url: string; filename: string; receiptNo: string } | null = null;
  try {
    const { data, error } = await supabase.functions.invoke('generate-receipt', {
      body: { transactionId: opts.transactionId },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    receipt = data;
  } catch (e: any) {
    errors.push(`Receipt PDF: ${e.message}`);
  }

  let emailOk = false;
  try {
    const { data, error } = await supabase.functions.invoke('send-template-email', {
      body: {
        schoolId: opts.schoolId,
        templateType: opts.templateType,
        userId: opts.userId ?? undefined,
        ...(receipt ? { attachmentUrl: receipt.url, attachmentFilename: receipt.filename } : {}),
      },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    emailOk = true;
  } catch (e: any) {
    errors.push(`Email: ${e.message}`);
  }

  let waOk = false;
  let waViaDocument = false;
  // The payment_receipt template body says "fully confirmed / Status: Paid" —
  // only true for full payments. Partial payments stay on the payment_partial text.
  if (receipt && opts.templateType === 'payment_received') {
    const { data, error } = await supabase.functions.invoke('send-whatsapp-template', {
      body: {
        schoolId: opts.schoolId,
        templateKey: 'payment_receipt',
        documentUrl: receipt.url,
        documentFilename: receipt.filename,
      },
    });
    if (!error && data?.success !== false) { waOk = true; waViaDocument = true; }
  }
  if (!waOk) {
    try {
      const { data, error } = await supabase.functions.invoke('send-whatsapp-template', {
        body: { schoolId: opts.schoolId, templateKey: opts.templateType },
      });
      if (error) throw new Error(error.message);
      if (data?.success === false) throw new Error(data?.error ?? 'send failed');
      waOk = true;
    } catch (e: any) {
      errors.push(`WhatsApp: ${e.message}`);
    }
  }

  return { receiptNo: receipt?.receiptNo ?? null, emailOk, waOk, waViaDocument, errors };
}
