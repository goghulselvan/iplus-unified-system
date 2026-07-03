import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { downloadCSV as downloadCSVFile } from '@/utils/csvExport';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Download, Search, Users, BookOpen, School, Trophy, ChevronLeft, ChevronRight } from 'lucide-react';
import { useActiveProject, useOlympiadSubjects } from '@/hooks/useOlympiadProjects';
import { useSchoolsPaginated } from '@/hooks/useSchoolsPaginated';
import Navbar from '@/components/layout/Navbar';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const CLASS_ORDER = ['14', '15', '01', '02', '03', '04', '05', '06', '07', '08'];
const CLASS_LABELS: Record<string, string> = {
  '14': 'LKG', '15': 'UKG',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i + 1).padStart(2, '0'), `Class ${i + 1}`])),
};
const CLASS_SELECT_OPTIONS = CLASS_ORDER.map(c => ({ value: c, label: CLASS_LABELS[c] }));

const PAGE_SIZE = 100;

interface Participation {
  enrollmentId: string;
  olympiadCode: string;
  studentId: string;
  studentName: string;
  classCode: string;
  schoolId: string;
  schoolName: string;
  ssNo: number;
}

interface OlympiadStats {
  total_participations: number;
  total_students: number;
  total_schools: number;
  subject_stats: Record<string, { participations: number; students: number; schools: number }>;
}

interface SubjectClassStat {
  olympiad_code: string;
  class_code: string;
  count: number;
}

const OlympiadManagement = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedOlympiad, setSelectedOlympiad] = useState<string>('all');
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'participations' | 'students'>('participations');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Reset page on filter change
  const handleFilterChange = useCallback((setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  }, []);

  const { data: activeProject } = useActiveProject();
  const { schools } = useSchoolsPaginated();
  const { data: subjects = [] } = useOlympiadSubjects(activeProject?.id);

  const subjectLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjects) if (s.alphabetical_code) map.set(s.alphabetical_code, s.subject_name);
    return map;
  }, [subjects]);

  // Fast aggregate stats — independent of list pagination
  const { data: stats, isLoading: statsLoading } = useQuery<OlympiadStats>({
    queryKey: ['olympiad-stats', activeProject?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_olympiad_stats', {
        p_project_id: activeProject!.id,
      });
      if (error) throw error;
      const row = data?.[0];
      return {
        total_participations: Number(row?.total_participations ?? 0),
        total_students: Number(row?.total_students ?? 0),
        total_schools: Number(row?.total_schools ?? 0),
        subject_stats: (row?.subject_stats as any) ?? {},
      };
    },
    enabled: !!activeProject?.id,
    staleTime: 60 * 1000,
  });

  // Per-subject class breakdown for stats cards
  const { data: classStats = [] } = useQuery<SubjectClassStat[]>({
    queryKey: ['olympiad-class-stats', activeProject?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_olympiad_subject_class_stats', {
        p_project_id: activeProject!.id,
      });
      if (error) throw error;
      return (data ?? []) as SubjectClassStat[];
    },
    enabled: !!activeProject?.id,
    staleTime: 60 * 1000,
  });

  // Paginated participation list — server-side filters
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: [
      'olympiad-participations',
      activeProject?.id, debouncedSearch,
      selectedOlympiad, selectedClass, selectedSchool, page,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_olympiad_participations', {
        p_project_id:    activeProject!.id,
        p_search:        debouncedSearch || null,
        p_olympiad_code: selectedOlympiad !== 'all' ? selectedOlympiad : null,
        p_class_code:    selectedClass   !== 'all' ? selectedClass   : null,
        p_school_id:     selectedSchool  !== 'all' ? selectedSchool  : null,
        p_limit:  PAGE_SIZE,
        p_offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!activeProject?.id,
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev, // keep previous page visible while loading next
  });

  const participations: Participation[] = useMemo(() =>
    (listData ?? []).map((r: any) => ({
      enrollmentId: r.enrollment_id,
      olympiadCode: r.olympiad_code,
      studentId:    r.student_id,
      studentName:  r.student_name,
      classCode:    r.class_code,
      schoolId:     r.school_id,
      schoolName:   r.school_name,
      ssNo:         r.ss_no,
    })), [listData]);

  const totalCount  = Number((listData?.[0] as any)?.total_count ?? 0);
  const totalPages  = Math.ceil(totalCount / PAGE_SIZE);

  // Group current page by student for student view
  const groupedStudents = useMemo(() => {
    const map = new Map<string, { studentId: string; studentName: string; classCode: string; schoolName: string; ssNo: number; olympiads: Set<string> }>();
    for (const p of participations) {
      if (!map.has(p.studentId)) {
        map.set(p.studentId, { studentId: p.studentId, studentName: p.studentName, classCode: p.classCode, schoolName: p.schoolName, ssNo: p.ssNo, olympiads: new Set() });
      }
      map.get(p.studentId)!.olympiads.add(p.olympiadCode);
    }
    return Array.from(map.values()).map(e => ({ ...e, olympiads: Array.from(e.olympiads) }));
  }, [participations]);

  // Build olympiad stats list for cards
  const olympiadStats = useMemo(() => {
    const subjectCodes = subjects.map(s => s.alphabetical_code).filter(Boolean) as string[];
    const enrolledCodes = Object.keys(stats?.subject_stats ?? {});
    const allCodes = [...new Set([...subjectCodes, ...enrolledCodes])];

    return allCodes.map(code => {
      const ss = stats?.subject_stats?.[code];
      const classCounts = classStats
        .filter(c => c.olympiad_code === code && Number(c.count) > 0)
        .sort((a, b) => CLASS_ORDER.indexOf(a.class_code) - CLASS_ORDER.indexOf(b.class_code));
      return {
        code,
        label: subjectLabelMap.get(code) ?? code,
        total:   Number(ss?.participations ?? 0),
        schools: Number(ss?.schools       ?? 0),
        classCounts,
      };
    });
  }, [stats, classStats, subjects, subjectLabelMap]);

  const handleExport = async () => {
    // Export current filtered result — fetch all matching rows (no page limit)
    const { data } = await supabase.rpc('get_olympiad_participations', {
      p_project_id:    activeProject!.id,
      p_search:        debouncedSearch || null,
      p_olympiad_code: selectedOlympiad !== 'all' ? selectedOlympiad : null,
      p_class_code:    selectedClass   !== 'all' ? selectedClass   : null,
      p_school_id:     selectedSchool  !== 'all' ? selectedSchool  : null,
      p_limit:  100000,
      p_offset: 0,
    });
    if (!data?.length) { alert('No data to export'); return; }
    const rows = [
      ['SS No', 'School Name', 'Student Name', 'Class', 'Olympiad'],
      ...(data as any[]).map(r => [r.ss_no, r.school_name, r.student_name, CLASS_LABELS[r.class_code] ?? r.class_code, r.olympiad_code]),
    ];
    downloadCSVFile(rows, `olympiad-participants-${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Olympiad Management</h1>
            <p className="text-muted-foreground">
              {activeProject?.project_name || 'iPlus Olympiad 2026'} — Participation Overview
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Includes both portal self-registrations and staff-added registrations
            </p>
          </div>
          <Button onClick={handleExport} variant="outline">
            <Download className="h-4 w-4 mr-2" /> Export Filtered
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: 'Total Participations', value: stats?.total_participations ?? 0, icon: Users },
            { title: 'Participating Schools', value: stats?.total_schools ?? 0, icon: School },
            { title: 'Total Students', value: stats?.total_students ?? 0, icon: Trophy },
          ].map(({ title, value, icon: Icon }) => (
            <Card key={title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{statsLoading ? '—' : value.toLocaleString()}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Subject-wise breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Subject-wise Participant Count
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {olympiadStats.map(({ code, label, total, schools, classCounts }) => (
                <div key={code} className="bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-lg border">
                  <h3 className="font-semibold text-lg">{label}</h3>
                  <p className="text-sm text-muted-foreground mb-2">{code}</p>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue-600" />
                      <span className="text-2xl font-bold text-blue-600">{total.toLocaleString()}</span>
                      <span className="text-sm text-muted-foreground">participants</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <School className="h-4 w-4 text-green-600" />
                      <span className="text-lg font-semibold text-green-600">{schools.toLocaleString()}</span>
                      <span className="text-sm text-muted-foreground">schools</span>
                    </div>
                  </div>
                  {classCounts.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {classCounts.map(({ class_code, count }) => (
                        <div key={class_code} className="flex flex-col items-center">
                          <Badge variant="outline" className="text-xs mb-1">{CLASS_LABELS[class_code] ?? class_code}</Badge>
                          <span className="text-xs font-medium text-muted-foreground">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader><CardTitle>Filters & Search</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search students or schools..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={selectedOlympiad} onValueChange={handleFilterChange(setSelectedOlympiad)}>
                <SelectTrigger><SelectValue placeholder="All Subjects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subjects</SelectItem>
                  {subjects.filter(s => s.alphabetical_code).map(s => (
                    <SelectItem key={s.id} value={s.alphabetical_code!}>
                      {s.alphabetical_code} — {s.subject_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedClass} onValueChange={handleFilterChange(setSelectedClass)}>
                <SelectTrigger><SelectValue placeholder="All Classes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {CLASS_SELECT_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedSchool} onValueChange={handleFilterChange(setSelectedSchool)}>
                <SelectTrigger><SelectValue placeholder="All Schools" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Schools</SelectItem>
                  {schools?.map(school => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.school_name} (SS-{school.ss_no})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="outline" onClick={() => {
                setSearchTerm(''); setDebouncedSearch('');
                setSelectedOlympiad('all'); setSelectedClass('all'); setSelectedSchool('all');
                setPage(1);
              }}>
                Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Student list */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>
                {viewMode === 'students'
                  ? `Name List (page ${page} of ${totalPages || 1})`
                  : `All Participations — ${totalCount.toLocaleString()} total`}
              </CardTitle>
              <div className="flex gap-2">
                <Button variant={viewMode === 'students' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('students')}>
                  Grouped by Student
                </Button>
                <Button variant={viewMode === 'participations' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('participations')}>
                  All Participations
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {listLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <>
                <div className="border rounded-lg">
                  <div className="bg-muted/50 p-3 border-b">
                    <div className="grid grid-cols-5 gap-4 text-sm font-medium text-muted-foreground">
                      <div>SS No</div>
                      <div>School Name</div>
                      <div>Student Name</div>
                      <div>Class</div>
                      <div>{viewMode === 'students' ? 'Subjects' : 'Olympiad'}</div>
                    </div>
                  </div>

                  <div className="overflow-auto max-h-[600px]">
                    {viewMode === 'students' ? (
                      groupedStudents.length === 0 ? null : groupedStudents.map((student) => (
                        <div key={student.studentId} className="grid grid-cols-5 gap-4 p-3 border-b text-sm hover:bg-muted/50">
                          <div className="font-medium">{student.ssNo}</div>
                          <div>{student.schoolName}</div>
                          <div className="font-medium">{student.studentName}</div>
                          <div><Badge variant="outline">{CLASS_LABELS[student.classCode] ?? student.classCode}</Badge></div>
                          <div className="flex flex-wrap gap-1">
                            {student.olympiads.map(code => (
                              <Badge key={code} variant="secondary" className="text-xs">{code}</Badge>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      participations.length === 0 ? null : participations.map((p) => (
                        <div key={p.enrollmentId} className="grid grid-cols-5 gap-4 p-3 border-b text-sm hover:bg-muted/50">
                          <div className="font-medium">{p.ssNo}</div>
                          <div>{p.schoolName}</div>
                          <div className="font-medium">{p.studentName}</div>
                          <div><Badge variant="outline">{CLASS_LABELS[p.classCode] ?? p.classCode}</Badge></div>
                          <div><Badge variant="secondary" className="text-xs">{p.olympiadCode}</Badge></div>
                        </div>
                      ))
                    )}

                    {participations.length === 0 && !listLoading && (
                      <div className="text-center py-8 text-muted-foreground">
                        No {viewMode === 'students' ? 'students' : 'participations'} match the current filters.
                      </div>
                    )}
                  </div>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm text-muted-foreground">
                      Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="flex items-center text-sm px-2">Page {page} of {totalPages}</span>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
};

export default OlympiadManagement;
