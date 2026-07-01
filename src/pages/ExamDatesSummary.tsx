import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useExamDatesSummary } from "@/hooks/useExamDatesSummary";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { exportExamDatesToCSV, exportSingleSchoolToCSV } from "@/utils/examDatesExport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Navbar from "@/components/layout/Navbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Calendar, ArrowUpDown, Search, FileDown } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

type SortField = "ss_no" | "earliest_date";
type SortOrder = "asc" | "desc";

const ExamDatesSummary = () => {
  const navigate = useNavigate();
  const { data: activeProject } = useActiveProject();
  const { data: examDatesSummary = [], isLoading } = useExamDatesSummary();
  
  const [ssNoFilter, setSsNoFilter] = useState("");
  const [schoolNameFilter, setSchoolNameFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("earliest_date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const filteredAndSortedData = useMemo(() => {
    let result = [...examDatesSummary];

    // Apply filters
    if (ssNoFilter) {
      result = result.filter((school) =>
        school.ss_no.toString().includes(ssNoFilter)
      );
    }
    if (schoolNameFilter) {
      result = result.filter((school) =>
        school.school_name.toLowerCase().includes(schoolNameFilter.toLowerCase())
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      
      if (sortField === "ss_no") {
        comparison = a.ss_no - b.ss_no;
      } else if (sortField === "earliest_date") {
        comparison = new Date(a.earliest_date).getTime() - new Date(b.earliest_date).getTime();
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [examDatesSummary, ssNoFilter, schoolNameFilter, sortField, sortOrder]);

  const handleExportAll = () => {
    exportExamDatesToCSV(filteredAndSortedData, `exam_dates_${format(new Date(), "dd-MM-yyyy")}.csv`);
  };

  const handleExportSchool = (school: typeof examDatesSummary[0]) => {
    exportSingleSchoolToCSV(school);
  };

  return (
    <>
      <Navbar />
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Exam Dates Summary</h1>
            {activeProject && (
              <p className="text-muted-foreground mt-1">
                {activeProject.project_name} ({activeProject.project_year})
              </p>
            )}
          </div>
        <Button onClick={handleExportAll} disabled={filteredAndSortedData.length === 0}>
          <FileDown className="mr-2 h-4 w-4" />
          Export All
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Schools with Scheduled Exams ({filteredAndSortedData.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by SS No..."
                value={ssNoFilter}
                onChange={(e) => setSsNoFilter(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by School Name..."
                value={schoolNameFilter}
                onChange={(e) => setSchoolNameFilter(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              Loading exam dates...
            </div>
          ) : filteredAndSortedData.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <p className="text-muted-foreground">
                {examDatesSummary.length === 0
                  ? "No schools have exam dates scheduled yet"
                  : "No schools match your filters"}
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">S.No</TableHead>
                    <TableHead className="w-28">
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("ss_no")}
                        className="hover:bg-transparent px-0 font-semibold"
                      >
                        SS No.
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>School Name</TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("earliest_date")}
                        className="hover:bg-transparent px-0 font-semibold"
                      >
                        Exam Dates
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead className="w-32 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedData.map((school, index) => (
                    <TableRow 
                      key={school.school_id} 
                      className="align-top cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey || e.button === 1) {
                          window.open(`/schools/${school.school_id}`, '_blank');
                        } else {
                          navigate(`/schools/${school.school_id}`);
                        }
                      }}
                      onAuxClick={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          window.open(`/schools/${school.school_id}`, '_blank');
                        }
                      }}
                    >
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell className="font-medium">{school.ss_no}</TableCell>
                      <TableCell className="font-medium">{school.school_name}</TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          {school.exam_dates.map((examDate, examIndex) => (
                            <div key={examIndex} className="flex items-start gap-2">
                              <span className="font-mono text-sm whitespace-nowrap">
                                {format(new Date(examDate.date), "dd-MM-yyyy")}
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {examDate.subjects.map((subject, subIndex) => (
                                  <Badge key={subIndex} variant="secondary" className="text-xs">
                                    {subject}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExportSchool(school);
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </>
  );
};

export default ExamDatesSummary;
