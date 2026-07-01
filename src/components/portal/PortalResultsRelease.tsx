import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Unlock, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface School {
  id: string;
  school_name: string;
  ss_no: number;
  city: string;
}

interface OlympiadProject {
  id: string;
  name: string;
}

interface ResultRelease {
  id: string;
  school_id: string;
  project_id: string;
  released_at: string;
  notes: string | null;
}

export function PortalResultsRelease() {
  const qc = useQueryClient();
  const [schoolSearch, setSchoolSearch] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [notes, setNotes] = useState("");

  const { data: schools } = useQuery({
    queryKey: ["schools-for-release"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schools")
        .select("id, school_name, ss_no, city")
        .order("school_name");
      if (error) throw error;
      return data as School[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ["olympiad-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("olympiad_projects")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data as OlympiadProject[];
    },
  });

  const { data: releases, isLoading: releasesLoading } = useQuery({
    queryKey: ["result-releases", selectedSchool?.id],
    enabled: !!selectedSchool,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_result_release")
        .select("*")
        .eq("school_id", selectedSchool!.id);
      if (error) throw error;
      return data as ResultRelease[];
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async ({ projectId }: { projectId: string }) => {
      const { error } = await supabase.from("school_result_release").insert({
        school_id: selectedSchool!.id,
        project_id: projectId,
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["result-releases"] });
      setNotes("");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async ({ releaseId }: { releaseId: string }) => {
      const { error } = await supabase
        .from("school_result_release")
        .delete()
        .eq("id", releaseId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["result-releases"] }),
  });

  const filteredSchools = (schools ?? []).filter((s) =>
    !schoolSearch.trim() ||
    s.school_name.toLowerCase().includes(schoolSearch.toLowerCase()) ||
    String(s.ss_no).includes(schoolSearch)
  );

  const releasedProjectIds = new Set((releases ?? []).map((r) => r.project_id));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Left: school selector */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Select School</h3>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={schoolSearch}
            onChange={(e) => setSchoolSearch(e.target.value)}
            placeholder="Search by name or SS no…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400"
          />
        </div>

        <div className="border border-gray-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
          {filteredSchools.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSchool(s)}
              className={`w-full flex items-center justify-between px-4 py-3 text-left border-b border-gray-100 last:border-0 transition-colors ${
                selectedSchool?.id === s.id
                  ? "bg-indigo-50 border-indigo-200"
                  : "hover:bg-gray-50"
              }`}
            >
              <div>
                <p className="text-sm font-medium text-gray-800">{s.school_name}</p>
                <p className="text-xs text-gray-500">SS #{s.ss_no} · {s.city}</p>
              </div>
              {selectedSchool?.id === s.id && (
                <div className="w-2 h-2 rounded-full bg-indigo-500" />
              )}
            </button>
          ))}
          {filteredSchools.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No schools found</p>
          )}
        </div>
      </div>

      {/* Right: project release toggles */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          {selectedSchool ? `Results for ${selectedSchool.school_name}` : "Select a school"}
        </h3>

        {!selectedSchool ? (
          <div className="border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-400">
            Choose a school to manage result visibility
          </div>
        ) : releasesLoading ? (
          <div className="text-center py-12 text-sm text-gray-400">Loading…</div>
        ) : (
          <>
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Release notes (applied to next release)
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Results for IEO 2026 released"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400"
              />
            </div>

            <div className="flex flex-col gap-2">
              {(projects ?? []).map((p) => {
                const released = releasedProjectIds.has(p.id);
                const releaseRow = (releases ?? []).find((r) => r.project_id === p.id);

                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                      released
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{p.name}</p>
                      {released && releaseRow && (
                        <p className="text-xs text-emerald-600 mt-0.5">
                          Released {new Date(releaseRow.released_at).toLocaleDateString("en-IN")}
                          {releaseRow.notes ? ` · ${releaseRow.notes}` : ""}
                        </p>
                      )}
                    </div>

                    {released ? (
                      <button
                        onClick={() => releaseRow && revokeMutation.mutate({ releaseId: releaseRow.id })}
                        disabled={revokeMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                        title="Revoke results access for this school"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        Revoke
                      </button>
                    ) : (
                      <button
                        onClick={() => releaseMutation.mutate({ projectId: p.id })}
                        disabled={releaseMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        Release
                      </button>
                    )}
                  </div>
                );
              })}

              {(!projects || projects.length === 0) && (
                <p className="text-sm text-gray-400 text-center py-8">No olympiad projects found</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
