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
  class_lkg?: number;
  class_ukg?: number;
  class_i?: number;
  class_ii?: number;
  class_iii?: number;
  class_iv?: number;
  class_v?: number;
  class_vi?: number;
  class_vii?: number;
  class_viii?: number;
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

      // 1. Find schools that have physical consent forms sent FOR THIS PROJECT
      //    (per-project status lives in school_project_workflow)
      const { data: workflowRows, error: workflowError } = await supabase
        .from('school_project_workflow')
        .select('school_id')
        .eq('project_id', pid)
        .eq('consent_form_sent', 'Sent');

      if (workflowError) {
        console.error('Error fetching project workflow:', workflowError);
        setConsentData([]);
        return;
      }

      const schoolIds = (workflowRows || []).map(r => r.school_id);
      if (schoolIds.length === 0) {
        setConsentData([]);
        return;
      }

      // 2. Fetch those schools' basic info
      const { data: schoolsData, error: schoolsError } = await supabase
        .from('schools')
        .select('id, school_name, district, board')
        .in('id', schoolIds);

      if (schoolsError) {
        console.error('Error fetching schools:', schoolsError);
        setConsentData([]);
        return;
      }

      // 3. Fetch consent_forms ONLY for this project + these schools
      const { data: formsData, error: formsError } = await supabase
        .from('consent_forms')
        .select('school_id, class, forms_requested')
        .eq('project_id', pid)
        .in('school_id', schoolIds);

      if (formsError) {
        console.error('Error fetching consent forms:', formsError);
        setConsentData([]);
        return;
      }

      // 4. Group forms by school
      const formsBySchool = new Map<string, { class: string; forms_requested: number }[]>();
      (formsData || []).forEach((f: any) => {
        if (!formsBySchool.has(f.school_id)) formsBySchool.set(f.school_id, []);
        formsBySchool.get(f.school_id)!.push({
          class: String(f.class),
          forms_requested: f.forms_requested || 0,
        });
      });

      // 5. Build display rows
      const processedData: ConsentFormData[] = (schoolsData || []).map((school: any) => {
        const consentForms = formsBySchool.get(school.id) || [];
        const classData: any = {
          school_id: school.id,
          school_name: school.school_name,
          district: school.district,
          board: school.board,
          total_forms: 0,
        };

        consentForms.forEach((form) => {
          const formClass = form.class.toLowerCase();
          let className = '';
          switch (formClass) {
            case 'lkg': className = 'class_lkg'; break;
            case 'ukg': className = 'class_ukg'; break;
            case '1': case 'i': className = 'class_i'; break;
            case '2': case 'ii': className = 'class_ii'; break;
            case '3': case 'iii': className = 'class_iii'; break;
            case '4': case 'iv': className = 'class_iv'; break;
            case '5': case 'v': className = 'class_v'; break;
            case '6': case 'vi': className = 'class_vi'; break;
            case '7': case 'vii': className = 'class_vii'; break;
            case '8': case 'viii': className = 'class_viii'; break;
          }
          if (className) {
            classData[className] = (classData[className] || 0) + form.forms_requested;
            classData.total_forms += form.forms_requested;
          }
        });

        return classData;
      }).filter(school => school.total_forms > 0);

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

  const getTotalByClass = (className: string): number => {
    return consentData.reduce((sum, school) => sum + (school[className as keyof ConsentFormData] as number || 0), 0);
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
          Schools with physical consent forms sent for{' '}
          <span className="font-medium text-foreground">
            {activeProject?.project_name || 'the active project'}
          </span>
          , organized by class
        </p>
      </CardHeader>
      <CardContent>
        {consentData.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Physical Consent Forms Sent</h3>
            <p className="text-muted-foreground">
              No schools have physical consent forms sent yet for this project.
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
                    <TableHead className="text-center font-semibold">LKG</TableHead>
                    <TableHead className="text-center font-semibold">UKG</TableHead>
                    <TableHead className="text-center font-semibold">Class I</TableHead>
                    <TableHead className="text-center font-semibold">Class II</TableHead>
                    <TableHead className="text-center font-semibold">Class III</TableHead>
                    <TableHead className="text-center font-semibold">Class IV</TableHead>
                    <TableHead className="text-center font-semibold">Class V</TableHead>
                    <TableHead className="text-center font-semibold">Class VI</TableHead>
                    <TableHead className="text-center font-semibold">Class VII</TableHead>
                    <TableHead className="text-center font-semibold">Class VIII</TableHead>
                    <TableHead className="text-center font-semibold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consentData.map((school) => (
                    <TableRow
                      key={school.school_id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSchoolClick(school.school_id)}
                    >
                      <TableCell className="font-medium">
                        <div>
                          <p className="font-semibold">{school.school_name}</p>
                        </div>
                      </TableCell>
                      <TableCell>{school.district}</TableCell>
                      <TableCell className="text-center">{school.class_lkg || 0}</TableCell>
                      <TableCell className="text-center">{school.class_ukg || 0}</TableCell>
                      <TableCell className="text-center">{school.class_i || 0}</TableCell>
                      <TableCell className="text-center">{school.class_ii || 0}</TableCell>
                      <TableCell className="text-center">{school.class_iii || 0}</TableCell>
                      <TableCell className="text-center">{school.class_iv || 0}</TableCell>
                      <TableCell className="text-center">{school.class_v || 0}</TableCell>
                      <TableCell className="text-center">{school.class_vi || 0}</TableCell>
                      <TableCell className="text-center">{school.class_vii || 0}</TableCell>
                      <TableCell className="text-center">{school.class_viii || 0}</TableCell>
                      <TableCell className="text-center font-semibold">
                        <Badge variant="secondary">{school.total_forms}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Totals Row */}
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell colSpan={2} className="text-right font-bold">TOTALS:</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_lkg')}</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_ukg')}</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_i')}</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_ii')}</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_iii')}</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_iv')}</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_v')}</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_vi')}</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_vii')}</TableCell>
                    <TableCell className="text-center font-bold">{getTotalByClass('class_viii')}</TableCell>
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
