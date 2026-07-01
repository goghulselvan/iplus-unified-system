import { useState, useEffect } from 'react';
import { ConsentForm } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useActiveProject } from '@/hooks/useOlympiadProjects';

interface ConsentFormManagerProps {
  schoolId: string;
  isRequestedYes: boolean;
}

const ConsentFormManager = ({ schoolId, isRequestedYes }: ConsentFormManagerProps) => {
  const { data: activeProject } = useActiveProject();
  const projectId = activeProject?.id;
  const [consentForms, setConsentForms] = useState<ConsentForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [newForm, setNewForm] = useState({
    class: '',
    forms_requested: 0
  });
  const { toast } = useToast();

  const classOptions = ['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8'];

  const fetchConsentForms = async () => {
    if (!projectId) {
      setConsentForms([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('consent_forms')
        .select('*')
        .eq('school_id', schoolId)
        .eq('project_id', projectId)
        .order('class');

      if (error) throw error;
      setConsentForms(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch consent forms',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getTotalForms = () => {
    return consentForms.reduce((total, form) => total + form.forms_requested, 0);
  };

  const addConsentForm = async () => {
    if (!newForm.class || newForm.forms_requested <= 0) {
      toast({
        title: 'Error',
        description: 'Please select a class and enter a valid number of forms',
        variant: 'destructive',
      });
      return;
    }

    if (!projectId) {
      toast({
        title: 'Error',
        description: 'No active project selected',
        variant: 'destructive',
      });
      return;
    }

    // Check if class already exists
    const existingForm = consentForms.find(form => form.class === newForm.class);
    if (existingForm) {
      toast({
        title: 'Error',
        description: 'Consent form for this class already exists',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { data, error } = await supabase
        .from('consent_forms')
        .insert({
          school_id: schoolId,
          project_id: projectId,
          class: newForm.class as ConsentForm['class'],
          forms_requested: newForm.forms_requested
        })
        .select()
        .single();

      if (error) throw error;

      // Log activity
      await supabase
        .from('activity_logs')
        .insert({
          school_id: schoolId,
          user_id: (await supabase.auth.getUser()).data.user?.id || '',
          activity_type: 'consent_form',
          description: `Added consent form for Class ${newForm.class}: ${newForm.forms_requested} forms`
        });

      setConsentForms([...consentForms, data]);
      setNewForm({ class: '', forms_requested: 0 });
      
      toast({
        title: 'Success',
        description: 'Consent form added successfully'
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const updateConsentForm = async (id: string, forms_requested: number) => {
    try {
      const { error } = await supabase
        .from('consent_forms')
        .update({ forms_requested })
        .eq('id', id);

      if (error) throw error;

      setConsentForms(consentForms.map(form => 
        form.id === id ? { ...form, forms_requested } : form
      ));

      toast({
        title: 'Success',
        description: 'Consent form updated successfully'
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const deleteConsentForm = async (id: string) => {
    try {
      const { error } = await supabase
        .from('consent_forms')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setConsentForms(consentForms.filter(form => form.id !== id));
      
      toast({
        title: 'Success',
        description: 'Consent form deleted successfully'
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (isRequestedYes) {
      fetchConsentForms();
    } else {
      setConsentForms([]);
      setLoading(false);
    }
  }, [schoolId, isRequestedYes, projectId]);

  if (!isRequestedYes) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Consent Forms</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Consent forms will be available when "Consent Form Requested" is set to "Yes".
          </p>
        </CardContent>
      </Card>
    );
  }

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
        <div className="flex justify-between items-center">
          <CardTitle>Consent Forms</CardTitle>
          <Badge variant="outline" className="text-lg font-semibold">
            Total: {getTotalForms()} forms
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Existing Forms */}
        {consentForms.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-medium">Requested Forms by Class</h4>
            {consentForms.map(form => (
              <div key={form.id} className="flex items-center justify-between p-3 border rounded">
                <div className="flex items-center space-x-3">
                  <Badge variant="secondary">Class {form.class}</Badge>
                  <span>Forms: {form.forms_requested}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    min="1"
                    value={form.forms_requested}
                    onChange={(e) => updateConsentForm(form.id, parseInt(e.target.value) || 0)}
                    className="w-20"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteConsentForm(form.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add New Form */}
        <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
          <h4 className="font-medium">Add Consent Form Request</h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Class</Label>
              <select
                value={newForm.class}
                onChange={(e) => setNewForm({ ...newForm, class: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">Select Class</option>
                {classOptions
                  .filter(cls => !consentForms.find(form => form.class === cls))
                  .map(cls => (
                    <option key={cls} value={cls}>Class {cls}</option>
                  ))
                }
              </select>
            </div>
            <div>
              <Label>Number of Forms</Label>
              <Input
                type="number"
                min="1"
                value={newForm.forms_requested}
                onChange={(e) => setNewForm({ ...newForm, forms_requested: parseInt(e.target.value) || 0 })}
                placeholder="Enter count"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={addConsentForm} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ConsentFormManager;
