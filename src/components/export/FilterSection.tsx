import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, X, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { OlympiadSubject } from '@/hooks/useOlympiadProjects';

interface FilterSectionProps {
  projectId: string;
  subjects: OlympiadSubject[];
  filters: {
    schoolIds: string[];
    subjectIds: string[];
    classes: string[];
    districts: string[];
    states: string[];
    boards: string[];
    nameListStatus: string[];
  };
  onFiltersChange: (filters: FilterSectionProps['filters']) => void;
}

const CLASSES = ['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8'];
const NAME_LIST_STATUSES = ['Pending', 'Received', 'Uploaded'];

const FilterSection = ({ projectId, subjects, filters, onFiltersChange }: FilterSectionProps) => {
  const [schools, setSchools] = useState<{ id: string; ss_no: number; school_name: string }[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [boards, setBoards] = useState<string[]>([]);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    schools: false,
    subjects: true,
    classes: true,
    districts: false,
    states: false,
    boards: false,
    nameListStatus: false,
  });

  // Fetch filter options
  useEffect(() => {
    const fetchFilterOptions = async () => {
      // Fetch schools
      const { data: schoolsData } = await supabase
        .from('schools')
        .select('id, ss_no, school_name')
        .order('ss_no');
      if (schoolsData) setSchools(schoolsData);

      // Fetch unique districts
      const { data: districtsData } = await supabase
        .from('schools')
        .select('district')
        .order('district');
      if (districtsData) {
        const uniqueDistricts = [...new Set(districtsData.map(d => d.district))].filter(Boolean);
        setDistricts(uniqueDistricts);
      }

      // Fetch unique states
      const { data: statesData } = await supabase
        .from('schools')
        .select('state')
        .not('state', 'is', null);
      if (statesData) {
        const uniqueStates = [...new Set(statesData.map(s => s.state))].filter(Boolean) as string[];
        setStates(uniqueStates);
      }

      // Fetch unique boards
      const { data: boardsData } = await supabase
        .from('boards')
        .select('board_name')
        .eq('is_active', true)
        .order('board_name');
      if (boardsData) {
        setBoards(boardsData.map(b => b.board_name));
      }
    };

    fetchFilterOptions();
  }, []);

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleCheckboxChange = (
    filterKey: keyof typeof filters,
    value: string,
    checked: boolean
  ) => {
    const currentValues = filters[filterKey];
    const newValues = checked
      ? [...currentValues, value]
      : currentValues.filter(v => v !== value);
    onFiltersChange({ ...filters, [filterKey]: newValues });
  };

  const clearFilter = (filterKey: keyof typeof filters) => {
    onFiltersChange({ ...filters, [filterKey]: [] });
  };

  const selectAll = (filterKey: keyof typeof filters, allValues: string[]) => {
    onFiltersChange({ ...filters, [filterKey]: allValues });
  };

  const filteredSchools = schools.filter(s => 
    schoolSearch === '' || 
    s.school_name.toLowerCase().includes(schoolSearch.toLowerCase()) ||
    s.ss_no.toString().includes(schoolSearch)
  );

  const renderFilterSection = (
    title: string,
    sectionKey: string,
    filterKey: keyof typeof filters,
    options: { value: string; label: string }[]
  ) => {
    const selectedCount = filters[filterKey].length;
    
    return (
      <Collapsible open={openSections[sectionKey]} onOpenChange={() => toggleSection(sectionKey)}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between p-3 h-auto">
            <div className="flex items-center gap-2">
              <span className="font-medium">{title}</span>
              {selectedCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {selectedCount} selected
                </Badge>
              )}
            </div>
            {openSections[sectionKey] ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <div className="flex gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => selectAll(filterKey, options.map(o => o.value))}
              className="text-xs"
            >
              Select All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearFilter(filterKey)}
              className="text-xs"
            >
              Clear
            </Button>
          </div>
          <ScrollArea className="h-[150px]">
            <div className="space-y-2">
              {options.map(option => (
                <div key={option.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${filterKey}-${option.value}`}
                    checked={filters[filterKey].includes(option.value)}
                    onCheckedChange={(checked) => 
                      handleCheckboxChange(filterKey, option.value, checked as boolean)
                    }
                  />
                  <Label
                    htmlFor={`${filterKey}-${option.value}`}
                    className="text-sm cursor-pointer"
                  >
                    {option.label}
                  </Label>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className="space-y-2 border rounded-lg">
      {/* Schools Filter with Search */}
      <Collapsible open={openSections.schools} onOpenChange={() => toggleSection('schools')}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between p-3 h-auto">
            <div className="flex items-center gap-2">
              <span className="font-medium">Schools</span>
              {filters.schoolIds.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {filters.schoolIds.length} selected
                </Badge>
              )}
            </div>
            {openSections.schools ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <div className="relative mb-2">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or SS No..."
              value={schoolSearch}
              onChange={(e) => setSchoolSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => selectAll('schoolIds', filteredSchools.map(s => s.id))}
              className="text-xs"
            >
              Select All Visible
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearFilter('schoolIds')}
              className="text-xs"
            >
              Clear
            </Button>
          </div>
          <ScrollArea className="h-[200px]">
            <div className="space-y-2">
              {filteredSchools.slice(0, 100).map(school => (
                <div key={school.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`school-${school.id}`}
                    checked={filters.schoolIds.includes(school.id)}
                    onCheckedChange={(checked) => 
                      handleCheckboxChange('schoolIds', school.id, checked as boolean)
                    }
                  />
                  <Label htmlFor={`school-${school.id}`} className="text-sm cursor-pointer">
                    SS-{school.ss_no}: {school.school_name}
                  </Label>
                </div>
              ))}
              {filteredSchools.length > 100 && (
                <p className="text-xs text-muted-foreground pt-2">
                  Showing 100 of {filteredSchools.length} schools. Use search to find specific schools.
                </p>
              )}
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>

      {/* Subjects Filter */}
      {renderFilterSection(
        'Subjects',
        'subjects',
        'subjectIds',
        subjects.map(s => ({ value: s.id, label: `${s.subject_name} (${s.subject_code})` }))
      )}

      {/* Classes Filter */}
      {renderFilterSection(
        'Classes',
        'classes',
        'classes',
        CLASSES.map(c => ({ value: c, label: c === 'LKG' || c === 'UKG' ? c : `Class ${c}` }))
      )}

      {/* Districts Filter */}
      {renderFilterSection(
        'Districts',
        'districts',
        'districts',
        districts.map(d => ({ value: d, label: d }))
      )}

      {/* States Filter */}
      {renderFilterSection(
        'States',
        'states',
        'states',
        states.map(s => ({ value: s, label: s }))
      )}

      {/* Boards Filter */}
      {renderFilterSection(
        'Boards',
        'boards',
        'boards',
        boards.map(b => ({ value: b, label: b }))
      )}

      {/* Name List Status Filter */}
      {renderFilterSection(
        'Name List Status',
        'nameListStatus',
        'nameListStatus',
        NAME_LIST_STATUSES.map(s => ({ value: s, label: s }))
      )}

      {/* Selected Filters Summary */}
      {Object.values(filters).some(arr => arr.length > 0) && (
        <div className="p-3 border-t">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Active Filters</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onFiltersChange({
                schoolIds: [],
                subjectIds: [],
                classes: [],
                districts: [],
                states: [],
                boards: [],
                nameListStatus: [],
              })}
              className="text-xs h-7"
            >
              Clear All
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {filters.schoolIds.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {filters.schoolIds.length} Schools
                <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => clearFilter('schoolIds')} />
              </Badge>
            )}
            {filters.subjectIds.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {filters.subjectIds.length} Subjects
                <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => clearFilter('subjectIds')} />
              </Badge>
            )}
            {filters.classes.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {filters.classes.length} Classes
                <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => clearFilter('classes')} />
              </Badge>
            )}
            {filters.districts.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {filters.districts.length} Districts
                <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => clearFilter('districts')} />
              </Badge>
            )}
            {filters.states.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {filters.states.length} States
                <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => clearFilter('states')} />
              </Badge>
            )}
            {filters.boards.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {filters.boards.length} Boards
                <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => clearFilter('boards')} />
              </Badge>
            )}
            {filters.nameListStatus.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {filters.nameListStatus.length} Statuses
                <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => clearFilter('nameListStatus')} />
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FilterSection;
