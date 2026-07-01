import React, { useState, useMemo, useEffect } from 'react';
import { downloadCSV as downloadCSVFile } from '@/utils/csvExport';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Download, Search, Users, BookOpen, School, Trophy } from 'lucide-react';
import { useActiveProject, useOlympiadSubjects } from '@/hooks/useOlympiadProjects';
import { useSchoolsPaginated } from '@/hooks/useSchoolsPaginated';
import { VirtualList } from '@/components/ui/virtual-list';
import Navbar from '@/components/layout/Navbar';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const CLASS_ORDER = ['14', '15', '01', '02', '03', '04', '05', '06', '07', '08'];
const CLASS_LABELS: Record<string, string> = {
  '14': 'LKG', '15': 'UKG',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i + 1).padStart(2, '0'), `Class ${i + 1}`])),
};
const CLASS_SELECT_OPTIONS = CLASS_ORDER.map(c => ({ value: c, label: CLASS_LABELS[c] }));

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

const OlympiadManagement = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedOlympiad, setSelectedOlympiad] = useState<string>('all');
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'participations' | 'students'>('participations');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const { data: activeProject } = useActiveProject();
  const { schools } = useSchoolsPaginated();
  const { data: subjects = [] } = useOlympiadSubjects(activeProject?.id);

  // alpha_code → subject_name lookup, built from DB
  const subjectLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjects) {
      if (s.alphabetical_code) map.set(s.alphabetical_code, s.subject_name);
    }
    return map;
  }, [subjects]);

  const { data: participations = [], isLoading } = useQuery({
    queryKey: ['portal-participations', activeProject?.id],
    queryFn: async (): Promise<Participation[]> => {
      const { data, error } = await supabase
        .from('portal_registered_students')
        .select(`
          id,
          student_name,
          class_code,
          school_id,
          schools(school_name, ss_no),
          portal_student_enrollments(id, olympiad_code)
        `)
        .eq('project_id', activeProject!.id);

      if (error) throw error;

      const rows: Participation[] = [];
      for (const student of data ?? []) {
        const school = student.schools as unknown as { school_name: string; ss_no: number } | null;
        for (const enroll of (student.portal_student_enrollments as { id: string; olympiad_code: string }[]) ?? []) {
          rows.push({
            enrollmentId: enroll.id,
            olympiadCode: enroll.olympiad_code as OlympiadCode,
            studentId: student.id,
            studentName: student.student_name,
            classCode: student.class_code,
            schoolId: student.school_id,
            schoolName: school?.school_name ?? '—',
            ssNo: school?.ss_no ?? 0,
          });
        }
      }
      return rows;
    },
    enabled: !!activeProject?.id,
    staleTime: 2 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    let list = participations;
    if (selectedOlympiad !== 'all') list = list.filter(p => p.olympiadCode === selectedOlympiad);
    if (selectedClass !== 'all') list = list.filter(p => p.classCode === selectedClass);
    if (selectedSchool !== 'all') list = list.filter(p => p.schoolId === selectedSchool);
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(p =>
        p.studentName.toLowerCase().includes(q) ||
        p.schoolName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [participations, selectedOlympiad, selectedClass, selectedSchool, debouncedSearch]);

  const groupedStudents = useMemo(() => {
    const map = new Map<string, { studentId: string; studentName: string; classCode: string; schoolName: string; ssNo: number; olympiads: Set<string>; count: number }>();
    for (const p of filtered) {
      if (!map.has(p.studentId)) {
        map.set(p.studentId, { studentId: p.studentId, studentName: p.studentName, classCode: p.classCode, schoolName: p.schoolName, ssNo: p.ssNo, olympiads: new Set(), count: 0 });
      }
      const entry = map.get(p.studentId)!;
      entry.olympiads.add(p.olympiadCode);
      entry.count++;
    }
    return Array.from(map.values()).map(e => ({ ...e, olympiads: Array.from(e.olympiads) }));
  }, [filtered]);

  const totalUniqueStudents = useMemo(() => new Set(participations.map(p => p.studentId)).size, [participations]);
  const totalSchools = useMemo(() => new Set(participations.map(p => p.schoolId)).size, [participations]);

  const olympiadStats = useMemo(() => {
    // Build stats for every subject the active project has configured
    const subjectCodes = subjects
      .map(s => s.alphabetical_code)
      .filter((c): c is string => !!c);

    // Also include any codes that appear in enrollments but aren't in subjects (legacy data)
    const enrolledCodes = [...new Set(participations.map(p => p.olympiadCode))];
    const allCodes = [...new Set([...subjectCodes, ...enrolledCodes])];

    return allCodes.map(code => {
      const matching = participations.filter(p => p.olympiadCode === code);
      const schoolSet = new Set(matching.map(p => p.schoolId));
      const classCounts = CLASS_ORDER
        .map(cls => ({ cls, count: matching.filter(p => p.classCode === cls).length }))
        .filter(x => x.count > 0);
      return {
        code,
        label: subjectLabelMap.get(code) ?? code,
        total: matching.length,
        schools: schoolSet.size,
        classCounts,
      };
    });
  }, [participations, subjects, subjectLabelMap]);

  const handleExport = (type: 'all' | 'filtered') => {
    const data = type === 'all' ? participations : filtered;
    if (!data.length) { alert('No data to export'); return; }
    const rows = [
      ['SS No', 'School Name', 'Student Name', 'Class', 'Olympiad'],
      ...data.map(p => [p.ssNo, p.schoolName, p.studentName, CLASS_LABELS[p.classCode] ?? p.classCode, p.olympiadCode]),
    ];
    downloadCSVFile(rows, `olympiad-participants-${type}-${new Date().toISOString().split('T')[0]}.csv`);
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
          <div className="flex gap-2">
            <Button onClick={() => handleExport('filtered')} variant="outline">
              <Download className="h-4 w-4 mr-2" /> Export Filtered
            </Button>
            <Button onClick={() => handleExport('all')}>
              <Download className="h-4 w-4 mr-2" /> Export All
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: 'Total Participations', value: participations.length, icon: Users },
            { title: 'Participating Schools', value: totalSchools, icon: School },
            { title: 'Total Students', value: totalUniqueStudents, icon: Trophy },
          ].map(({ title, value, icon: Icon }) => (
            <Card key={title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{isLoading ? '—' : value}</div>
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
                      <span className="text-2xl font-bold text-blue-600">{total}</span>
                      <span className="text-sm text-muted-foreground">participants</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <School className="h-4 w-4 text-green-600" />
                      <span className="text-lg font-semibold text-green-600">{schools}</span>
                      <span className="text-sm text-muted-foreground">schools</span>
                    </div>
                  </div>
                  {classCounts.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {classCounts.map(({ cls, count }) => (
                        <div key={cls} className="flex flex-col items-center">
                          <Badge variant="outline" className="text-xs mb-1">{CLASS_LABELS[cls] ?? cls}</Badge>
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

              <Select value={selectedOlympiad} onValueChange={setSelectedOlympiad}>
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

              <Select value={selectedClass} onValueChange={setSelectedClass}>
                <SelectTrigger><SelectValue placeholder="All Classes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {CLASS_SELECT_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedSchool} onValueChange={setSelectedSchool}>
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
              }}>
                Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Student list */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {viewMode === 'students'
                  ? `Name List (${groupedStudents.length} of ${totalUniqueStudents})`
                  : `All Participations (${filtered.length} of ${participations.length})`}
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
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
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

                {viewMode === 'students' ? (
                  <VirtualList
                    items={groupedStudents}
                    itemHeight={60}
                    containerHeight={600}
                    renderItem={(student) => (
                      <div className="grid grid-cols-5 gap-4 p-3 border-b text-sm hover:bg-muted/50">
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
                    )}
                  />
                ) : (
                  <VirtualList
                    items={filtered}
                    itemHeight={60}
                    containerHeight={600}
                    renderItem={(p) => (
                      <div className="grid grid-cols-5 gap-4 p-3 border-b text-sm hover:bg-muted/50">
                        <div className="font-medium">{p.ssNo}</div>
                        <div>{p.schoolName}</div>
                        <div className="font-medium">{p.studentName}</div>
                        <div><Badge variant="outline">{CLASS_LABELS[p.classCode] ?? p.classCode}</Badge></div>
                        <div><Badge variant="secondary" className="text-xs">{p.olympiadCode}</Badge></div>
                      </div>
                    )}
                  />
                )}

                {((viewMode === 'students' && groupedStudents.length === 0) ||
                  (viewMode === 'participations' && filtered.length === 0)) && !isLoading && (
                  <div className="text-center py-8 text-muted-foreground">
                    No {viewMode === 'students' ? 'students' : 'participations'} match the current filters.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
};

export default OlympiadManagement;
