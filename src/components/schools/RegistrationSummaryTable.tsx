import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useActiveProject } from '@/hooks/useOlympiadProjects';

const OLYMPIADS = ['EPO', 'MPO', 'SPO', 'GKSSPO', 'LRPO', 'KidsPO'] as const;
type OlympiadCode = (typeof OLYMPIADS)[number];

const OLYMPIAD_LABELS: Record<OlympiadCode, string> = {
  EPO: 'English Plus',
  MPO: 'Maths Plus',
  SPO: 'Science Plus',
  GKSSPO: 'GK & SS Plus',
  LRPO: 'LR Plus',
  KidsPO: 'Kids Plus',
};

const CLASS_ORDER = ['14', '15', '01', '02', '03', '04', '05', '06', '07', '08'];
const CLASS_LABELS: Record<string, string> = {
  '14': 'LKG', '15': 'UKG',
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [String(i + 1).padStart(2, '0'), `Class ${i + 1}`])
  ),
};

interface Props {
  schoolId: string;
  schoolName?: string;
}

export const RegistrationSummaryTable = ({ schoolId, schoolName }: Props) => {
  const { data: activeProject } = useActiveProject();

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['crm-reg-summary', schoolId, activeProject?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portal_registered_students')
        .select('id, class_code, portal_student_enrollments(olympiad_code)')
        .eq('school_id', schoolId)
        .eq('project_id', activeProject!.id);
      if (error) throw error;
      return (data ?? []).map(s => ({
        class_code: s.class_code,
        enrollments: (s.portal_student_enrollments as { olympiad_code: OlympiadCode }[]).map(e => e.olympiad_code),
      }));
    },
    enabled: !!activeProject?.id,
  });

  const { grid, totals, sortedClasses, grandTotal } = useMemo(() => {
    const emptyRow = () => Object.fromEntries(OLYMPIADS.map(c => [c, 0])) as Record<OlympiadCode, number>;
    const grid: Record<string, Record<OlympiadCode, number>> = {};
    const totals = emptyRow();

    for (const s of students) {
      if (!grid[s.class_code]) grid[s.class_code] = emptyRow();
      for (const code of s.enrollments) {
        grid[s.class_code][code]++;
        totals[code]++;
      }
    }

    const sortedClasses = Object.keys(grid).sort(
      (a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b)
    );
    const grandTotal = OLYMPIADS.reduce((s, c) => s + totals[c], 0);

    return { grid, totals, sortedClasses, grandTotal };
  }, [students]);

  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const name = schoolName || 'School';

    doc.setFontSize(16);
    doc.text('Registration Summary', 148, 15, { align: 'center' });
    doc.setFontSize(12);
    doc.text(name, 148, 22, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Total Registrations: ${grandTotal} · Total Students: ${students.length}`, 148, 28, { align: 'center' });

    const headers = ['Class', ...OLYMPIADS.map(c => OLYMPIAD_LABELS[c]), 'Total'];
    const rows = sortedClasses.map(cls => {
      const row = grid[cls];
      const rowTotal = OLYMPIADS.reduce((s, c) => s + (row[c] ?? 0), 0);
      return [CLASS_LABELS[cls] ?? cls, ...OLYMPIADS.map(c => row[c] || 0), rowTotal];
    });
    rows.push(['Total', ...OLYMPIADS.map(c => totals[c] || 0), grandTotal]);

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: 35,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229], fontStyle: 'bold', halign: 'center' },
      bodyStyles: { halign: 'center' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
      didParseCell: (data) => {
        if (data.row.index === rows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 240, 240];
        }
      },
    });

    doc.save(`Registration_Summary_${name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground py-8">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (students.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registration Summary</CardTitle>
          <CardDescription>Class-wise and subject-wise registration overview</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">
            No registrations found. Students can be added in the Registrations tab.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Registration Summary</CardTitle>
            <CardDescription>
              {students.length} students · {grandTotal} total registrations
            </CardDescription>
          </div>
          <Button onClick={handleExportPdf} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">Class</TableHead>
                {OLYMPIADS.map(code => (
                  <TableHead key={code} className="text-center font-bold" title={OLYMPIAD_LABELS[code]}>
                    {code}
                  </TableHead>
                ))}
                <TableHead className="text-center font-bold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedClasses.map(cls => {
                const row = grid[cls];
                const rowTotal = OLYMPIADS.reduce((s, c) => s + (row[c] ?? 0), 0);
                return (
                  <TableRow key={cls}>
                    <TableCell className="font-medium">{CLASS_LABELS[cls] ?? cls}</TableCell>
                    {OLYMPIADS.map(code => (
                      <TableCell key={code} className="text-center">
                        {row[code] || '—'}
                      </TableCell>
                    ))}
                    <TableCell className="text-center font-medium">{rowTotal}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell className="font-bold">Total</TableCell>
                {OLYMPIADS.map(code => (
                  <TableCell key={code} className="text-center font-bold">
                    {totals[code] || '—'}
                  </TableCell>
                ))}
                <TableCell className="text-center font-bold text-indigo-600">{grandTotal}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
