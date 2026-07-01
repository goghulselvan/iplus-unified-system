import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Settings, Users, Calendar, CheckCircle, Circle, Pencil } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useOlympiadProjects, useOlympiadSubjects, useCreateProject, useUpdateProject, useCreateSubject, useUpdateSubject, useSetActiveProject, OlympiadProject, OlympiadSubject } from '@/hooks/useOlympiadProjects';
import { toast } from 'sonner';
import Navbar from '@/components/layout/Navbar';

const ProjectManagement = () => {
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [isSubjectDialogOpen, setIsSubjectDialogOpen] = useState(false);
  const [selectedProjectForSubjects, setSelectedProjectForSubjects] = useState<string>('');
  const [editingProject, setEditingProject] = useState<OlympiadProject | null>(null);
  const [editingSubject, setEditingSubject] = useState<OlympiadSubject | null>(null);
  const [editClasses, setEditClasses] = useState<string[]>([]);
  const [editIsActive, setEditIsActive] = useState(true);
  const [editAlphabeticalCode, setEditAlphabeticalCode] = useState('');

  const { data: projects, isLoading } = useOlympiadProjects();
  const { data: subjects } = useOlympiadSubjects(selectedProjectForSubjects, { includeInactive: true });
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const createSubject = useCreateSubject();
  const updateSubject = useUpdateSubject();
  const setActiveProject = useSetActiveProject();

  const openEditSubject = (subject: OlympiadSubject) => {
    setEditingSubject(subject);
    setEditClasses(subject.applicable_classes || []);
    setEditIsActive(subject.is_active);
    setEditAlphabeticalCode(subject.alphabetical_code || '');
  };

  const toggleEditClass = (cls: string) => {
    setEditClasses(prev => prev.includes(cls) ? prev.filter(c => c !== cls) : [...prev, cls]);
  };

  const handleUpdateSubject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingSubject) return;
    const formData = new FormData(e.currentTarget);
    if (editClasses.length === 0) {
      toast.error('Please select at least one class');
      return;
    }
    try {
      await updateSubject.mutateAsync({
        id: editingSubject.id,
        subject_name: formData.get('subject_name') as string,
        subject_code: formData.get('subject_code') as string,
        alphabetical_code: editAlphabeticalCode.trim() || undefined,
        applicable_classes: editClasses,
        is_active: editIsActive,
      });
      setEditingSubject(null);
    } catch (error) {
      console.error('Failed to update subject:', error);
    }
  };

  const handleUpdateProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingProject) return;
    const formData = new FormData(e.currentTarget);
    try {
      await updateProject.mutateAsync({
        id: editingProject.id,
        project_name: formData.get('project_name') as string,
        project_year: parseInt(formData.get('project_year') as string),
      });
      setEditingProject(null);
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  };

  const handleCreateProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const projectData = {
      project_name: formData.get('project_name') as string,
      project_year: parseInt(formData.get('project_year') as string),
    };

    try {
      await createProject.mutateAsync(projectData);
      setIsProjectDialogOpen(false);
      (e.target as HTMLFormElement).reset();
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleCreateSubject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const selectedClasses = [];
    const classFields = ['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8'];
    
    for (const cls of classFields) {
      if (formData.get(`class_${cls}`) === 'on') {
        selectedClasses.push(cls);
      }
    }

    if (selectedClasses.length === 0) {
      toast.error('Please select at least one class');
      return;
    }

    const alphaCode = (formData.get('alphabetical_code') as string)?.trim();
    const subjectData = {
      project_id: selectedProjectForSubjects,
      subject_name: formData.get('subject_name') as string,
      subject_code: formData.get('subject_code') as string,
      alphabetical_code: alphaCode || undefined,
      applicable_classes: selectedClasses,
    };

    try {
      await createSubject.mutateAsync(subjectData);
      setIsSubjectDialogOpen(false);
      (e.target as HTMLFormElement).reset();
    } catch (error) {
      console.error('Failed to create subject:', error);
    }
  };

  const handleSetActive = (projectId: string) => {
    setActiveProject.mutate(projectId);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Project Management</h1>
          <p className="text-muted-foreground">
            Manage Olympiad projects and subjects across different years
          </p>
        </div>
        <Dialog open={isProjectDialogOpen} onOpenChange={setIsProjectDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Olympiad Project</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <Label htmlFor="project_name">Project Name</Label>
                <Input
                  id="project_name"
                  name="project_name"
                  placeholder="e.g., iPlus Olympiad 2026"
                  required
                />
              </div>
              <div>
                <Label htmlFor="project_year">Project Year</Label>
                <Input
                  id="project_year"
                  name="project_year"
                  type="number"
                  placeholder="e.g., 2026"
                  min="2024"
                  max="2030"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={createProject.isPending}>
                {createProject.isPending ? 'Creating...' : 'Create Project'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Projects Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Olympiad Projects</CardTitle>
            <Badge variant="outline" className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {projects?.filter(p => p.is_active).length || 0} Active
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Project Name</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects?.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      {project.is_active ? (
                        <Badge className="flex items-center gap-1 w-fit">
                          <CheckCircle className="h-3 w-3" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                          <Circle className="h-3 w-3" />
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{project.project_name}</TableCell>
                    <TableCell>{project.project_year}</TableCell>
                    <TableCell>
                      {new Date(project.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {!project.is_active && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSetActive(project.id)}
                            disabled={setActiveProject.isPending}
                          >
                            Set Active
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingProject(project)}
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedProjectForSubjects(project.id)}
                        >
                          <Settings className="h-4 w-4 mr-1" />
                          Manage Subjects
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!projects?.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      No projects found. Create your first project to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Subject Management */}
      {selectedProjectForSubjects && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                Subjects for {projects?.find(p => p.id === selectedProjectForSubjects)?.project_name}
              </CardTitle>
              <Dialog open={isSubjectDialogOpen} onOpenChange={setIsSubjectDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Subject
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Create New Subject</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreateSubject} className="space-y-4">
                    <div>
                      <Label htmlFor="subject_name">Subject Name</Label>
                      <Input
                        id="subject_name"
                        name="subject_name"
                        placeholder="e.g., English Plus Olympiad"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="subject_code">Numeric Code</Label>
                        <Input
                          id="subject_code"
                          name="subject_code"
                          placeholder="e.g., 1"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="alphabetical_code">Alpha Code</Label>
                        <Input
                          id="alphabetical_code"
                          name="alphabetical_code"
                          placeholder="e.g., EPO"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Applicable Classes</Label>
                      <div className="grid grid-cols-5 gap-2 mt-2">
                        {['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8'].map((cls) => (
                          <div key={cls} className="flex items-center space-x-2">
                            <Checkbox id={`class_${cls}`} name={`class_${cls}`} />
                            <Label htmlFor={`class_${cls}`} className="text-sm">
                              {cls}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Button type="submit" className="w-full" disabled={createSubject.isPending}>
                      {createSubject.isPending ? 'Creating...' : 'Create Subject'}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject Name</TableHead>
                  <TableHead>Num Code</TableHead>
                  <TableHead>Alpha Code</TableHead>
                  <TableHead>Applicable Classes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjects?.map((subject) => (
                  <TableRow key={subject.id} className={!subject.is_active ? 'opacity-50' : undefined}>
                    <TableCell className="font-medium">{subject.subject_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{subject.subject_code}</Badge>
                    </TableCell>
                    <TableCell>
                      {subject.alphabetical_code
                        ? <Badge variant="secondary">{subject.alphabetical_code}</Badge>
                        : <span className="text-xs text-muted-foreground">—</span>
                      }
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {subject.applicable_classes.map((cls) => (
                          <Badge key={cls} variant="secondary" className="text-xs">
                            {cls}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={subject.is_active ? "default" : "secondary"}>
                        {subject.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openEditSubject(subject)}>
                        <Pencil className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!subjects?.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      No subjects found for this project.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Edit Project Dialog */}
      <Dialog open={!!editingProject} onOpenChange={(open) => !open && setEditingProject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          {editingProject && (
            <form onSubmit={handleUpdateProject} className="space-y-4">
              <div>
                <Label htmlFor="edit_project_name">Project Name</Label>
                <Input
                  id="edit_project_name"
                  name="project_name"
                  defaultValue={editingProject.project_name}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit_project_year">Project Year</Label>
                <Input
                  id="edit_project_year"
                  name="project_year"
                  type="number"
                  defaultValue={editingProject.project_year}
                  min="2024"
                  max="2030"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={updateProject.isPending}>
                {updateProject.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Subject Dialog */}
      <Dialog open={!!editingSubject} onOpenChange={(open) => !open && setEditingSubject(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Subject</DialogTitle>
          </DialogHeader>
          {editingSubject && (
            <form onSubmit={handleUpdateSubject} className="space-y-4">
              <div>
                <Label htmlFor="edit_subject_name">Subject Name</Label>
                <Input
                  id="edit_subject_name"
                  name="subject_name"
                  defaultValue={editingSubject.subject_name}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="edit_subject_code">Numeric Code</Label>
                  <Input
                    id="edit_subject_code"
                    name="subject_code"
                    defaultValue={editingSubject.subject_code}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="edit_alphabetical_code">Alpha Code</Label>
                  <Input
                    id="edit_alphabetical_code"
                    value={editAlphabeticalCode}
                    onChange={(e) => setEditAlphabeticalCode(e.target.value)}
                    placeholder="e.g., EPO"
                  />
                </div>
              </div>
              <div>
                <Label>Applicable Classes</Label>
                <div className="grid grid-cols-5 gap-2 mt-2">
                  {['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8'].map((cls) => (
                    <div key={cls} className="flex items-center space-x-2">
                      <Checkbox
                        id={`edit_class_${cls}`}
                        checked={editClasses.includes(cls)}
                        onCheckedChange={() => toggleEditClass(cls)}
                      />
                      <Label htmlFor={`edit_class_${cls}`} className="text-sm">
                        {cls}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="edit_is_active">Active</Label>
                  <p className="text-xs text-muted-foreground">Inactive subjects are hidden from registrations.</p>
                </div>
                <Switch id="edit_is_active" checked={editIsActive} onCheckedChange={setEditIsActive} />
              </div>
              <Button type="submit" className="w-full" disabled={updateSubject.isPending}>
                {updateSubject.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
};

export default ProjectManagement;