import { useState } from "react";
import Navbar from "@/components/layout/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Activity } from "lucide-react";
import {
  useOlympiadHealth,
  useSchoolStatistics,
} from "@/hooks/useOlympiadResults";
import { StudentResultModal } from "@/components/results/StudentResultModal";

const Results = () => {
  const health = useOlympiadHealth();
  const schoolStats = useSchoolStatistics();
  const [searchReg, setSearchReg] = useState("");
  const [activeReg, setActiveReg] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Olympiad Results</h1>
            <p className="text-muted-foreground">
              Live data from iPlus Olympiad Insights Hub
            </p>
          </div>
          <Card className="px-4 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Activity
                className={`h-4 w-4 ${
                  health.isError
                    ? "text-destructive"
                    : health.data !== undefined
                      ? "text-primary"
                      : "text-muted-foreground"
                }`}
              />
              {health.isLoading
                ? "Connecting…"
                : health.isError
                  ? "Source unreachable"
                  : `${health.data ?? 0} students evaluated`}
            </div>
          </Card>
        </div>

        <Tabs defaultValue="schools" className="w-full">
          <TabsList>
            <TabsTrigger value="schools">Schools</TabsTrigger>
            <TabsTrigger value="students">Student Lookup</TabsTrigger>
            <TabsTrigger value="awards">Awards</TabsTrigger>
            <TabsTrigger value="rankings">Rankings</TabsTrigger>
          </TabsList>

          {/* Schools tab */}
          <TabsContent value="schools" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>School Performance</CardTitle>
              </CardHeader>
              <CardContent>
                {schoolStats.isLoading ? (
                  <Skeleton className="h-64" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SS No</TableHead>
                        <TableHead>School</TableHead>
                        <TableHead className="text-right">Evaluated</TableHead>
                        <TableHead className="text-right">Avg %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(schoolStats.data ?? []).slice(0, 200).map((s, i) => (
                        <TableRow key={i}>
                          <TableCell>{s.ss_no}</TableCell>
                          <TableCell>{s.school_name}</TableCell>
                          <TableCell className="text-right">{s.evaluated_count}</TableCell>
                          <TableCell className="text-right">
                            {Math.round(s.avg_percentage)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Student lookup tab */}
          <TabsContent value="students" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Find Student by Registration Number</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="14-digit registration number"
                    value={searchReg}
                    onChange={(e) => setSearchReg(e.target.value)}
                    maxLength={14}
                  />
                  <Button
                    onClick={() => setActiveReg(searchReg.trim() || null)}
                    disabled={searchReg.trim().length !== 14}
                  >
                    <Search className="h-4 w-4 mr-1" />
                    Lookup
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Format: SubjectStateDistrictSchoolClassStudent (1+2+3+3+2+3 = 14 digits)
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Awards tab */}
          <TabsContent value="awards">
            <Card>
              <CardHeader>
                <CardTitle>Awards</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Open a school's detail page → <Badge variant="outline">Results</Badge> tab to see and manage awards for that school.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rankings tab */}
          <TabsContent value="rankings">
            <Card>
              <CardHeader>
                <CardTitle>Rankings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Coming soon — rankings filtered by class &amp; subject.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <StudentResultModal
          registrationNumber={activeReg}
          open={!!activeReg}
          onOpenChange={(o) => !o && setActiveReg(null)}
        />
      </div>
    </div>
  );
};

export default Results;
