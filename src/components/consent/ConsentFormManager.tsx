import { useState, useEffect } from 'react';
import { ConsentForm } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useActiveProject } from '@/hooks/useOlympiadProjects';

interface ConsentFormManagerProps {
  schoolId: string;
}

const ConsentFormManager = ({ schoolId }: ConsentFormManagerProps) => {
  const { data: activeProject } = useActiveProject();
  const projectId = activeProject?.id;
  const [consentForm, setConsentForm] = useState<ConsentForm | null>(null);
  const [formsCount, setFormsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const fetchConsentForm = async () => {
    if (!projectId) {
      setConsentForm(null);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('consent_forms')
        .select('*')
        .eq('school_id', schoolId)
        .eq('project_id', projectId)
        .maybeSingle();

      if (error) throw error;
      setConsentForm(data as ConsentForm | null);
      setFormsCount(data?.forms_requested || 0);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch consent form count',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const saveConsentForm = async () => {
    if (!projectId) {
      toast({ title: 'Error', description: 'No active project selected', variant: 'destructive' });
      return;
    }
    if (formsCount < 0) {
      toast({ title: 'Error', description: 'Enter a valid number of forms', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('consent_forms')
        .upsert(
          { school_id: schoolId, project_id: projectId, forms_requested: formsCount },
          { onConflict: 'school_id,project_id' },
        )
        .select()
        .single();

      if (error) throw error;

      await supabase.from('activity_logs').insert({
        school_id: schoolId,
        user_id: (await supabase.auth.getUser()).data.user?.id || '',
        activity_type: 'consent_form',
        description: `Set consent forms sent to ${formsCount}`,
      });

      setConsentForm(data as ConsentForm);
      toast({ title: 'Success', description: 'Consent forms count saved' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchConsentForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, projectId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Consent Forms</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">Loading consent forms...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consent Forms</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          One consent form applies to all classes — just record how many were sent to this school.
        </p>
        <div className="flex items-end gap-4 p-4 border rounded-lg bg-muted/30">
          <div className="flex-1 max-w-[200px]">
            <Label>Consent Forms Sent</Label>
            <Input
              type="number"
              min="0"
              value={formsCount}
              onChange={(e) => setFormsCount(parseInt(e.target.value) || 0)}
              placeholder="Enter count"
            />
          </div>
          <Button onClick={saveConsentForm} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : consentForm ? 'Update' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ConsentFormManager;
