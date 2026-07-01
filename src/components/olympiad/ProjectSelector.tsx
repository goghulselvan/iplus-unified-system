import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar, Trophy } from 'lucide-react';
import { useOlympiadProjects, useActiveProject, useSetActiveProject } from '@/hooks/useOlympiadProjects';
import { useAuth } from '@/hooks/useAuth';

const ProjectSelector = () => {
  const { profile } = useAuth();
  const { data: projects } = useOlympiadProjects();
  const { data: activeProject } = useActiveProject();
  const setActiveProject = useSetActiveProject();

  // Only superadmins can switch projects
  if (profile?.role !== 'superadmin') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Trophy className="h-4 w-4" />
        <span>{activeProject?.project_name || 'iPlus Olympiad 2025'}</span>
        <Badge variant="secondary" className="text-xs">
          {activeProject?.project_year || 2025}
        </Badge>
      </div>
    );
  }

  const handleProjectChange = (projectId: string) => {
    setActiveProject.mutate(projectId);
  };

  return (
    <div className="flex items-center gap-2">
      <Trophy className="h-4 w-4 text-muted-foreground" />
      <Select
        value={activeProject?.id || ''}
        onValueChange={handleProjectChange}
        disabled={setActiveProject.isPending}
      >
        <SelectTrigger className="w-[320px]">
          <SelectValue placeholder="Select project" />
        </SelectTrigger>
        <SelectContent>
          {projects?.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              <div className="flex items-center gap-2">
                <span>{project.project_name}</span>
                {project.is_active && (
                  <Badge variant="secondary" className="text-xs">
                    Active
                  </Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default ProjectSelector;