import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

interface PaymentTransaction {
  school_name: string;
  ss_no: number;
  payment_amount: number;
  payment_date: string;
  payment_mode: string;
  notes: string | null;
  transaction_reference: string | null;
  added_by: string | null;
  created_at: string;
}

interface StudentRegistration {
  school_name: string;
  ss_no: number;
  student_name: string;
  student_class: string;
  registration_number_generated: string | null;
  roll_number: string | null;
  added_by: string | null;
  created_at: string;
}

interface ActivityLog {
  school_name: string;
  ss_no: number;
  activity_type: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  created_at: string;
}

interface AuditData {
  payments: PaymentTransaction[];
  newRegistrations: StudentRegistration[];
  updatedRegistrations: StudentRegistration[];
  activityLogs: ActivityLog[];
  startDate: string;
  endDate: string;
}

export const exportToCSV = (data: AuditData) => {
  const { payments, newRegistrations, updatedRegistrations, activityLogs, startDate, endDate } = data;
  
  let csv = '';
  
  // Header
  csv += `AUDIT LOG REPORT\n`;
  csv += `Generated on: ${format(new Date(), 'dd-MMM-yyyy hh:mm a')}\n`;
  csv += `Date Range: ${format(new Date(startDate), 'dd-MMM-yyyy')} to ${format(new Date(endDate), 'dd-MMM-yyyy')}\n`;
  csv += `\n`;
  
  // Summary
  csv += `=== SUMMARY ===\n`;
  csv += `Payment Transactions,${payments.length}\n`;
  csv += `New Student Registrations,${newRegistrations.length}\n`;
  csv += `Updated Student Registrations,${updatedRegistrations.length}\n`;
  csv += `Activity Log Entries,${activityLogs.length}\n`;
  csv += `\n`;
  
  // Payment Transactions
  csv += `=== PAYMENT TRANSACTIONS ===\n`;
  csv += `S.No,SS No.,School Name,Amount,Payment Date,Payment Mode,Notes,Transaction Reference,Added By,Transaction Date\n`;
  payments.forEach((payment, index) => {
    csv += `${index + 1},${payment.ss_no},"${payment.school_name}",${payment.payment_amount},${format(new Date(payment.payment_date), 'dd-MMM-yyyy')},"${payment.payment_mode}","${payment.notes || ''}","${payment.transaction_reference || ''}","${payment.added_by || 'N/A'}",${format(new Date(payment.created_at), 'dd-MMM-yyyy')}\n`;
  });
  csv += `\n`;
  
  // New Student Registrations
  csv += `=== NEW STUDENT REGISTRATIONS ===\n`;
  csv += `S.No,SS No.,School Name,Student Name,Class,Registration Number,Roll Number,Added By,Registration Date\n`;
  newRegistrations.forEach((reg, index) => {
    csv += `${index + 1},${reg.ss_no},"${reg.school_name}","${reg.student_name}","${reg.student_class}","${reg.registration_number_generated || 'N/A'}","${reg.roll_number || 'N/A'}","${reg.added_by || 'N/A'}",${format(new Date(reg.created_at), 'dd-MMM-yyyy')}\n`;
  });
  csv += `\n`;
  
  // Updated Student Registrations
  csv += `=== UPDATED STUDENT REGISTRATIONS ===\n`;
  csv += `S.No,SS No.,School Name,Student Name,Class,Registration Number,Updated By,Update Date\n`;
  updatedRegistrations.forEach((reg, index) => {
    csv += `${index + 1},${reg.ss_no},"${reg.school_name}","${reg.student_name}","${reg.student_class}","${reg.registration_number_generated || 'N/A'}","${reg.added_by || 'N/A'}",${format(new Date(reg.created_at), 'dd-MMM-yyyy')}\n`;
  });
  csv += `\n`;
  
  // Activity Logs
  csv += `=== ACTIVITY LOGS ===\n`;
  csv += `S.No,SS No.,School Name,Activity Type,Field Name,Old Value,New Value,Changed By,Change Date\n`;
  activityLogs.forEach((log, index) => {
    csv += `${index + 1},${log.ss_no},"${log.school_name}","${log.activity_type}","${log.field_name || 'N/A'}","${log.old_value || 'N/A'}","${log.new_value || 'N/A'}","${log.changed_by || 'N/A'}",${format(new Date(log.created_at), 'dd-MMM-yyyy')}\n`;
  });
  
  // Download CSV
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `audit_log_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToPDF = (data: AuditData) => {
  const { payments, newRegistrations, updatedRegistrations, activityLogs, startDate, endDate } = data;
  
  const doc = new jsPDF();
  let yPosition = 20;
  
  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('AUDIT LOG REPORT', 105, yPosition, { align: 'center' });
  
  yPosition += 10;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated on: ${format(new Date(), 'dd-MMM-yyyy hh:mm a')}`, 105, yPosition, { align: 'center' });
  
  yPosition += 6;
  doc.text(`Date Range: ${format(new Date(startDate), 'dd-MMM-yyyy')} to ${format(new Date(endDate), 'dd-MMM-yyyy')}`, 105, yPosition, { align: 'center' });
  
  yPosition += 15;
  
  // Summary Section
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Summary', 14, yPosition);
  
  yPosition += 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Payment Transactions: ${payments.length}`, 14, yPosition);
  yPosition += 6;
  doc.text(`New Student Registrations: ${newRegistrations.length}`, 14, yPosition);
  yPosition += 6;
  doc.text(`Updated Student Registrations: ${updatedRegistrations.length}`, 14, yPosition);
  yPosition += 6;
  doc.text(`Activity Log Entries: ${activityLogs.length}`, 14, yPosition);
  
  yPosition += 10;
  
  // Payment Transactions Section
  if (payments.length > 0) {
    doc.addPage();
    yPosition = 20;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Payment Transactions', 14, yPosition);
    
    yPosition += 5;
    
    autoTable(doc, {
      startY: yPosition,
      head: [['SS No.', 'School Name', 'Amount', 'Date', 'Mode', 'Notes']],
      body: payments.map(p => [
        p.ss_no,
        p.school_name,
        `₹${p.payment_amount.toFixed(2)}`,
        format(new Date(p.payment_date), 'dd-MMM-yy'),
        p.payment_mode,
        p.notes || 'N/A'
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [66, 66, 66] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: 14, right: 14 }
    });
  }
  
  // New Student Registrations Section
  if (newRegistrations.length > 0) {
    doc.addPage();
    yPosition = 20;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('New Student Registrations', 14, yPosition);
    
    yPosition += 5;
    
    autoTable(doc, {
      startY: yPosition,
      head: [['SS No.', 'School Name', 'Student Name', 'Class', 'Reg. No.', 'Date']],
      body: newRegistrations.map(r => [
        r.ss_no,
        r.school_name,
        r.student_name,
        r.student_class,
        r.registration_number_generated || 'N/A',
        format(new Date(r.created_at), 'dd-MMM-yy')
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [66, 66, 66] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: 14, right: 14 }
    });
  }
  
  // Updated Student Registrations Section
  if (updatedRegistrations.length > 0) {
    doc.addPage();
    yPosition = 20;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Updated Student Registrations', 14, yPosition);
    
    yPosition += 5;
    
    autoTable(doc, {
      startY: yPosition,
      head: [['SS No.', 'School Name', 'Student Name', 'Class', 'Update Date']],
      body: updatedRegistrations.map(r => [
        r.ss_no,
        r.school_name,
        r.student_name,
        r.student_class,
        format(new Date(r.created_at), 'dd-MMM-yy')
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [66, 66, 66] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: 14, right: 14 }
    });
  }
  
  // Activity Logs Section
  if (activityLogs.length > 0) {
    doc.addPage();
    yPosition = 20;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Activity Logs', 14, yPosition);
    
    yPosition += 5;
    
    autoTable(doc, {
      startY: yPosition,
      head: [['SS No.', 'School', 'Field', 'Old Value', 'New Value', 'Date']],
      body: activityLogs.map(l => [
        l.ss_no,
        l.school_name,
        l.field_name || 'N/A',
        l.old_value || 'N/A',
        l.new_value || 'N/A',
        format(new Date(l.created_at), 'dd-MMM-yy')
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [66, 66, 66] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: 14, right: 14 }
    });
  }
  
  // Footer on each page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text(`Page ${i} of ${pageCount}`, 105, 285, { align: 'center' });
    doc.text('Computer Generated Report - No Signature Required', 105, 290, { align: 'center' });
  }
  
  // Save PDF
  doc.save(`audit_log_${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`);
};
