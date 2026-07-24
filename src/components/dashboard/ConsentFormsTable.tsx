import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { FileText, School, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useActiveProject } from '@/hooks/useOlympiadProjects';

interface ConsentFormData {
  school_id: string;
  school_name: string;
  district: string;
  board: string;
  total_forms: number;
}

export const ConsentFormsTable: React.FC = () => {
  const [consentData, setConsentData] = useState<ConsentFormData[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { data: activeProject } = useActiveProject();
  const projectId = activeProject?.id;

  useEffect(() => {
    if (projectId) {
      fetchConsentFormsData(projectId);
    } else {
      setConsentData([]);
      setLoading(false);
    }
  }, [projectId]);

  const fetchConsentFormsData = async (pid: string) => {
    try {
      setLoading(true);

      // Consent forms sent is tracked directly by count, independent of the
      // "Consent Form Requested" workflow flag — a school can have forms
      // entered without that flag ever being set (and vice versa).
      const { data: formsData, error: formsError } = await supabase
        .from('consent_forms')
        .select('school_id, forms_requested')
        .eq('project_id', pid)
        .gt('forms_requested', 0);

      if (formsError) {
        console.error('Error fetching consent forms:', formsError);
        setConsentData([]);
        return;
      }

      const schoolIds = (formsData || []).map((f: any) => f.school_id);
      if (schoolIds.length === 0) {
        setConsentData([]);
        return;
      }

      const { data: schoolsData, error: schoolsError } = await supabase
        .from('schools')
        .select('id, school_name, district, board')
        .in('id', schoolIds);

      if (schoolsError) {
        console.error('Error fetching schools:', schoolsError);
        setConsentData([]);
        return;
      }

      const schoolsById = new Map((schoolsData || []).map((s: any) => [s.id, s]));

      const processedData: ConsentFormData[] = (formsData || [])
        .map((f: any) => {
          const school = schoolsById.get(f.school_id);
          if (!school) return null;
          return {
            school_id: school.id,
            school_name: school.school_name,
            district: school.district,
            board: school.board,
            total_forms: f.forms_requested || 0,
          };
        })
        .filter((row): row is ConsentFormData => row !== null)
        .sort((a, b) => b.total_forms - a.total_forms);

      setConsentData(processedData);
    } catch (error) {
      console.error('Error fetching consent forms data:', error);
      setConsentData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSchoolClick = (schoolId: string) => {
    navigate(`/schools/${schoolId}`);
  };

  const getGrandTotal = (): number => {
    return consentData.reduce((sum, school) => sum + school.total_forms, 0);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Physical Consent Forms Sent Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">Loading consent forms data...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Physical Consent Forms Sent Summary
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Schools with a consent forms count entered for{' '}
          <span className="font-medium text-foreground">
            {activeProject?.project_name || 'the active project'}
          </span>
        </p>
      </CardHeader>
      <CardContent>
        {consentData.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Physical Consent Forms Sent</h3>
            <p className="text-muted-foreground">
              No schools have a consent forms count entered yet for this project.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-2">
                    <School className="h-5 w-5 text-blue-600" />
                    <div>
                      <p className="text-2xl font-bold">{consentData.length}</p>
                      <p className="text-sm text-muted-foreground">Schools</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-2">
                    <FileText className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="text-2xl font-bold">{getGrandTotal()}</p>
                      <p className="text-sm text-muted-foreground">Total Forms</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-2">
                    <Users className="h-5 w-5 text-purple-600" />
                    <div>
                      <p className="text-2xl font-bold">
                        {Math.round(getGrandTotal() / consentData.length)}
                      </p>
                      <p className="text-sm text-muted-foreground">Avg. per School</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Table */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold">School</TableHead>
                    <TableHead className="font-semibold">District</TableHead>
                    <TableHead className="text-center font-semibold">Forms Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consentData.map((school) => (
                    <TableRow
                      key={school.school_id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSchoolClick(school.school_id)}
                    >
                      <TableCell className="font-medium">{school.school_name}</TableCell>
                      <TableCell>{school.district}</TableCell>
                      <TableCell className="text-center font-semibold">
                        <Badge variant="secondary">{school.total_forms}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Totals Row */}
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell colSpan={2} className="text-right font-bold">TOTAL:</TableCell>
                    <TableCell className="text-center font-bold">
                      <Badge className="bg-primary text-primary-foreground">{getGrandTotal()}</Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
