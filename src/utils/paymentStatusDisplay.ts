/**
 * A manual/offline school's expected amount is computed purely from enrolled
 * students × rate (see recompute_school_payment_state / recalculate_school_payment_totals /
 * acknowledge_portal_payment). With zero students entered, expected is always ₹0 — so any
 * payment already on file makes the raw computed status read "Overpaid", even though the
 * school has simply paid before its physical name list arrived. This helper detects that
 * specific case so callers can show an honest label instead.
 */
export function isAwaitingNameList(school: { payment_received?: number | null; total_participants?: number | null }): boolean {
  return (Number(school.payment_received) || 0) > 0 && (Number(school.total_participants) || 0) === 0;
}

export const AWAITING_NAME_LIST_LABEL = 'Payment Received — Awaiting Name List';
