import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, FileText, School, Download } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/utils/csvExport';
import { useActiveProject, useOlympiadSubjects } from '@/hooks/useOlympiadProjects';

interface SummaryRow {
  school_id: string;
  ss_no: number;
  school_name: string;
  subject_counts: Record<string, number>;
}

const SUBJECT_PALETTE = [
  { from: 'from-green-50', to: 'to-green-100', dark: 'dark:from-green-900/20 dark:to-green-800/20', text: 'text-green-600' },
  { from: 'from-purple-50', to: 'to-purple-100', dark: 'dark:from-purple-900/20 dark:to-purple-800/20', text: 'text-purple-600' },
  { from: 'from-orange-50', to: 'to-orange-100', dark: 'dark:from-orange-900/20 dark:to-orange-800/20', text: 'text-orange-600' },
  { from: 'from-cyan-50', to: 'to-cyan-100', dark: 'dark:from-cyan-900/20 dark:to-cyan-800/20', text: 'text-cyan-600' },
  { from: 'from-pink-50', to: 'to-pink-100', dark: 'dark:from-pink-900/20 dark:to-pink-800/20', text: 'text-pink-600' },
  { from: 'from-amber-50', to: 'to-amber-100', dark: 'dark:from-amber-900/20 dark:to-amber-800/20', text: 'text-amber-600' },
];

interface SchoolRow {
  schoolId: string;
  ssNo: number;
  schoolName: string;
  total: number;
  counts: Record<string, number>;
}

export const RegistrationSummary = () => {
  const navigate = useNavigate();
  const { data: activeProject } = useActiveProject();
  const { data: subjects = [] } = useOlympiadSubjects(activeProject?.id);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['dashboard-reg-summary', activeProject?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_portal_registration_summary', {
        p_project_id: activeProject!.id,
      });
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
    enabled: !!activeProject?.id,
    staleTime: 60 * 1000,
  });

  const { stats, schoolData } = useMemo(() => {
    const codes = subjects.map(s => s.alphabetical_code).filter(Boolean) as string[];
    const perSubject = Object.fromEntries(codes.map(c => [c, 0]));
    const schoolRows: SchoolRow[] = [];

    for (const row of rows) {
      const counts = row.subject_counts ?? {};
      let total = 0;
      for (const c of codes) {
        const n = counts[c] ?? 0;
        perSubject[c] = (perSubject[c] ?? 0) + n;
        total += n;
      }
      schoolRows.push({ schoolId: row.school_id, ssNo: row.ss_no, schoolName: row.school_name, total, counts });
    }

    const totalRegistrations = Object.values(perSubject).reduce((s, n) => s + n, 0);
    return { stats: { totalRegistrations, perSubject }, schoolData: schoolRows };
  }, [rows, subjects]);

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Registration Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-muted h-16 rounded" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Registration Summary
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={schoolData.length === 0}
            onClick={() => {
              const codes = subjects.map(s => s.alphabetical_code).filter(Boolean) as string[];
              const header = ['S.No', 'SS No.', 'School Name', 'Total', ...codes.map(c => subjects.find(s => s.alphabetical_code === c)?.subject_name ?? c)];
              const dataRows = schoolData.map((s, i) => [
                i + 1, s.ssNo, s.schoolName, s.total,
                ...codes.map(c => s.counts[c] || 0),
              ]);
              const totalsRow = [
                '', '', 'Total', stats.totalRegistrations,
                ...codes.map(c => stats.perSubject[c] || 0),
              ];
              downloadCSV([header, ...dataRows, totalsRow], `Registration_Summary_${new Date().toISOString().split('T')[0]}.csv`);
            }}
          >
            <Download className="h-4 w-4 mr-2" />
            Download Summary Table
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 p-4 rounded-lg text-center col-span-2 md:col-span-1">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Users className="h-4 w-4 text-blue-600" />
            </div>
            <p className="text-sm text-muted-foreground mb-1">Total Registrations</p>
            <p className="text-xl font-bold text-blue-600">{stats.totalRegistrations}</p>
          </div>

          {subjects.map((subj, idx) => {
            const c = SUBJECT_PALETTE[idx % SUBJECT_PALETTE.length];
            return (
              <div
                key={subj.alphabetical_code}
                className={`bg-gradient-to-r ${c.from} ${c.to} ${c.dark} p-4 rounded-lg text-center`}
                title={subj.subject_name}
              >
                <p className="text-sm text-muted-foreground mb-1">{subj.subject_name}</p>
                <p className={`text-xl font-bold ${c.text}`}>{stats.perSubject[subj.alphabetical_code] ?? 0}</p>
              </div>
            );
          })}
        </div>

        {schoolData.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <School className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">School-wise Registration Summary</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">S.No</TableHead>
                  <TableHead className="w-24">SS No.</TableHead>
                  <TableHead>School Name</TableHead>
                  <TableHead className="text-center">Total</TableHead>
                  {subjects.map(subj => (
                    <TableHead key={subj.alphabetical_code} className="text-center" title={subj.subject_name}>
                      {subj.alphabetical_code}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {schoolData.map((school, index) => (
                  <TableRow
                    key={school.schoolId}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) window.open(`/schools/${school.schoolId}`, '_blank');
                      else navigate(`/schools/${school.schoolId}`);
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) { e.preventDefault(); window.open(`/schools/${school.schoolId}`, '_blank'); }
                    }}
                  >
                    <TableCell className="font-medium text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="font-medium">{school.ssNo}</TableCell>
                    <TableCell className="font-medium">{school.schoolName}</TableCell>
                    <TableCell className="text-center font-semibold">{school.total}</TableCell>
                    {subjects.map(subj => (
                      <TableCell key={subj.alphabetical_code} className="text-center">
                        {school.counts[subj.alphabetical_code] || 0}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-bold">
                  <TableCell colSpan={3} className="font-bold">Total</TableCell>
                  <TableCell className="text-center font-bold">{stats.totalRegistrations}</TableCell>
                  {subjects.map(subj => (
                    <TableCell key={subj.alphabetical_code} className="text-center font-bold">
                      {stats.perSubject[subj.alphabetical_code] || 0}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}

        {schoolData.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No registrations found for the current project.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
