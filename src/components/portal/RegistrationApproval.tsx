import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Search, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PortalRegistration {
  id: string;
  user_id: string | null;
  email: string;
  school_name: string;
  city: string;
  district: string;
  state: string | null;
  pincode: string | null;
  address1: string | null;
  address2: string | null;
  board: string | null;
  ss_no: number | null;
  contact_name: string | null;
  phone: string | null;
  corr_name: string | null;
  corr_mobile: string | null;
  principal_name: string | null;
  principal_mobile: string | null;
  coord_mobile: string | null;
  status: "pending" | "approved" | "rejected";
  matched_school_id: string | null;
  approved_at: string | null;
  created_at: string;
}

interface CrmSchool {
  id: string;
  school_name: string;
  ss_no: number;
  district: string;
  school_address: string;
}

/* ── Live server-side school search ───────────────────────────────────────── */

function SchoolSearchField({ onSelect }: { onSelect: (school: CrmSchool) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CrmSchool[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = query.trim();
    if (!term) { setResults([]); return; }

    timer.current = setTimeout(async () => {
      setLoading(true);
      let q = supabase
        .from("schools")
        .select("id, school_name, ss_no, district, school_address")
        .order("school_name")
        .limit(10);

      if (!isNaN(parseInt(term))) {
        // Numeric → exact SS No match
        q = q.eq("ss_no", parseInt(term));
      } else {
        // Text → school name or district
        q = q.or(`school_name.ilike.%${term}%,district.ilike.%${term}%`);
      }

      const { data, error } = await q;
      setLoading(false);
      if (error) { console.error("School search error:", error); setResults([]); return; }
      setResults((data as CrmSchool[]) ?? []);
    }, 300);

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by school name or SS No…"
          autoFocus
          className="w-full pl-9 pr-24 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">
            Searching…
          </span>
        )}
      </div>

      {results.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-indigo-50 text-left transition-colors border-b border-gray-100 last:border-0"
            >
              <div>
                <p className="text-sm text-gray-800 font-medium">{s.school_name}</p>
                <p className="text-xs text-gray-500">SS #{s.ss_no} · {s.district}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && query.trim() && results.length === 0 && (
        <p className="text-xs text-gray-400 px-1 py-2">No schools found for "{query}"</p>
      )}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

export function RegistrationApproval() {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedSchool, setSelectedSchool] = useState<Record<string, CrmSchool | null>>({});
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  const { data: registrations, isLoading, error: fetchError } = useQuery({
    queryKey: ["portal-registrations", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("school_portal_registrations")
        .select("*")
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as PortalRegistration[];
    },
  });


  const approveMutation = useMutation({
    mutationFn: async ({ regId, schoolId, reg }: { regId: string; schoolId: string; reg: PortalRegistration }) => {
      // 1. Approve + link → fires trg_invite_portal_user which creates
      //    school_portal_accounts and school_project_workflow automatically
      const { error } = await supabase
        .from("school_portal_registrations")
        .update({
          status: "approved",
          matched_school_id: schoolId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", regId);
      if (error) throw error;

      // 2. Sync portal contact details into the matched CRM school
      await supabase
        .from("schools")
        .update({
          ...(reg.email            && { email: reg.email }),
          ...(reg.phone            && { mobile1: reg.phone }),
          ...(reg.contact_name     && { contact_person_name: reg.contact_name }),
          ...(reg.district         && { district: reg.district }),
          ...(reg.state            && { state: reg.state }),
          ...(reg.pincode          && { pincode: reg.pincode }),
          ...(reg.address1         && { address1: reg.address1 }),
          ...(reg.address2         && { address2: reg.address2 }),
          ...(reg.board            && { board: reg.board }),
          ...(reg.principal_name   && { principal_name: reg.principal_name }),
          ...(reg.principal_mobile && { principal_mobile: reg.principal_mobile }),
          ...(reg.coord_mobile     && { coord_mobile: reg.coord_mobile }),
          ...(reg.corr_name        && { corr_name: reg.corr_name }),
          ...(reg.corr_mobile      && { corr_mobile: reg.corr_mobile }),
          portal_registered: true,
        })
        .eq("id", schoolId);

      // 3. Set registration_status = 'In Progress' → fires DB trigger → WA + email sent
      //    Only updates if not already In Progress (avoids duplicate welcome messages)
      await supabase
        .from("schools")
        .update({ registration_status: "In Progress" })
        .eq("id", schoolId)
        .neq("registration_status", "In Progress");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-registrations"] });
      qc.invalidateQueries({ queryKey: ["nav-badge-counts"] });
      setExpandedId(null);
      // Welcome WA + email sent automatically by DB trigger on registration_status change
    },
    onError: (err) => {
      alert(`Error: ${err instanceof Error ? err.message : "Something went wrong"}`);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ regId, reason, reg }: { regId: string; reason: string; reg: PortalRegistration }) => {
      // Find orphaned school so we can notify via email
      let orphanedSchoolId: string | null = null;
      if (reg.user_id) {
        const { data: account } = await supabase
          .from("school_portal_accounts")
          .select("school_id")
          .eq("user_id", reg.user_id)
          .maybeSingle();
        orphanedSchoolId = account?.school_id ?? null;
      }
      const { error } = await supabase
        .from("school_portal_registrations")
        .update({ status: "rejected", rejection_reason: reason || null })
        .eq("id", regId);
      if (error) throw error;
      return { orphanedSchoolId, reg };
    },
    onSuccess: ({ orphanedSchoolId, reg }) => {
      qc.invalidateQueries({ queryKey: ["portal-registrations"] });
      qc.invalidateQueries({ queryKey: ["nav-badge-counts"] });
      setExpandedId(null);
      if (orphanedSchoolId) {
        notifySchool(
          orphanedSchoolId,
          'portal_registration_rejected',
          'portal_registration_rejected',
          reg.email,
          reg.phone ?? undefined,
        ).catch(console.error);
      }
    },
  });

  const STATUS_COLORS = {
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-emerald-50 text-emerald-700",
    rejected: "bg-red-50 text-red-600",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">School Portal Registrations</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Link online registrations to existing CRM schools by SS No
          </p>
        </div>
        <div className="flex gap-2">
          {(["pending", "approved", "rejected", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                statusFilter === s
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : fetchError ? (
        <div className="py-4 text-red-500 text-sm bg-red-50 rounded-xl p-4">
          <p className="font-semibold mb-2">Error loading registrations:</p>
          <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(fetchError, null, 2)}</pre>
        </div>
      ) : !registrations || registrations.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No {statusFilter === "all" ? "" : statusFilter} registrations
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {registrations.map((reg) => {
            const isExpanded = expandedId === reg.id;
            const picked = selectedSchool[reg.id];

            return (
              <div key={reg.id} className="border border-gray-200 rounded-xl overflow-hidden">
                {/* Header row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : reg.id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{reg.school_name}</p>
                      <p className="text-xs text-gray-500">{reg.email} · {reg.city}, {reg.district}</p>
                    </div>
                    {reg.ss_no && (
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        SS #{reg.ss_no}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[reg.status]}`}>
                      {reg.status}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(reg.created_at).toLocaleDateString("en-IN")}
                    </span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>

                {/* Expanded detail — pending */}
                {isExpanded && reg.status === "pending" && (
                  <div className="border-t border-gray-100 px-5 py-5 bg-gray-50/50">
                    <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
                      <div><span className="text-gray-500">Contact: </span><span className="text-gray-800">{reg.contact_name ?? "—"}</span></div>
                      <div><span className="text-gray-500">Phone: </span><span className="text-gray-800">{reg.phone ?? "—"}</span></div>
                    </div>

                    {/* School matching */}
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wider">
                        Match to CRM School
                      </label>

                      {picked ? (
                        <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                          <div>
                            <p className="text-sm font-medium text-indigo-900">{picked.school_name}</p>
                            <p className="text-xs text-indigo-600">SS #{picked.ss_no} · {picked.district}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedSchool((p) => ({ ...p, [reg.id]: null }))}
                            className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <SchoolSearchField
                          onSelect={(s) => setSelectedSchool((p) => ({ ...p, [reg.id]: s }))}
                        />
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (!picked) { alert("Select a CRM school to link before approving."); return; }
                          approveMutation.mutate({ regId: reg.id, schoolId: picked.id, reg });
                        }}
                        disabled={approveMutation.isPending || !picked}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {approveMutation.isPending ? "Linking…" : "Link to School"}
                      </button>

                      <div className="flex-1 flex gap-2">
                        <input
                          value={rejectionReason[reg.id] ?? ""}
                          onChange={(e) => setRejectionReason((p) => ({ ...p, [reg.id]: e.target.value }))}
                          placeholder="Rejection reason (optional)"
                          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-red-400/30 focus:border-red-400"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            rejectMutation.mutate({ regId: reg.id, reason: rejectionReason[reg.id] ?? "", reg })
                          }
                          disabled={rejectMutation.isPending}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Expanded detail — approved / rejected */}
                {isExpanded && reg.status !== "pending" && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/50 text-sm text-gray-500">
                    {reg.status === "approved"
                      ? `Approved on ${reg.approved_at ? new Date(reg.approved_at).toLocaleDateString("en-IN") : "—"}`
                      : "Rejected"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
