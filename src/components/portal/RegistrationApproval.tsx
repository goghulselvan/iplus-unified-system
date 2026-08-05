import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Search, ChevronDown, ChevronUp, PlusCircle, Eye, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const REGISTRATION_STATES = ['Tamil Nadu', 'Puducherry', 'Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana'];

function last10Digits(v: string | null | undefined): string | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

interface ContactEntry { name: string; mobile: string; role?: string }

// Before a portal-submitted value overwrites an existing contact-mobile field,
// keep the old number (if real and different) instead of silently dropping it —
// same {name, mobile, role} shape additional_contacts already uses elsewhere
// (manual entry, incoming-call auto-linking).
function preserveIfChanged(
  contacts: ContactEntry[],
  oldMobile: string | null | undefined,
  newMobile: string | null | undefined,
  oldName: string | null | undefined,
  role: string,
): ContactEntry[] {
  if (!oldMobile || !newMobile) return contacts;
  if (last10Digits(oldMobile) === last10Digits(newMobile)) return contacts;
  if (contacts.some((c) => last10Digits(c.mobile) === last10Digits(oldMobile))) return contacts;
  if (contacts.length >= 5) return contacts;
  return [...contacts, { name: oldName ?? "", mobile: oldMobile, role }];
}

interface CandidateMatch {
  id: string; school_name: string; ss_no: number; district: string; state: string;
  board: string | null; mobile: string | null; email: string | null; address: string | null;
  pincode: string | null; stage: string; linked_to_crm: boolean; matchedOn: string;
  additional_contacts: ContactEntry[] | null;
}

// Finds likely-existing prospect_schools matches for a portal registration by
// SS No, phone, or email — so staff aren't relying on a blank manual search
// and don't accidentally create a duplicate school for someone already in CRM.
async function findCandidateMatches(reg: PortalRegistration): Promise<CandidateMatch[]> {
  const found = new Map<string, CandidateMatch>();
  const cols = "id, school_name, ss_no, district, state, board, mobile, email, address, pincode, stage, linked_to_crm, additional_contacts";

  if (reg.ss_no) {
    const { data } = await supabase.from("prospect_schools").select(cols).eq("ss_no", reg.ss_no).eq("is_active", true);
    (data || []).forEach((s: any) => found.set(s.id, { ...s, matchedOn: "SS No" }));
  }
  if (reg.email) {
    const { data } = await supabase.from("prospect_schools").select(cols).ilike("email", reg.email).eq("is_active", true);
    (data || []).forEach((s: any) => { if (!found.has(s.id)) found.set(s.id, { ...s, matchedOn: "Email" }); });
  }
  const phoneDigits = last10Digits(reg.phone);
  if (phoneDigits) {
    const { data } = await supabase.from("prospect_schools").select(cols).ilike("mobile", `%${phoneDigits}%`).eq("is_active", true).limit(5);
    (data || []).forEach((s: any) => { if (!found.has(s.id)) found.set(s.id, { ...s, matchedOn: "Phone" }); });
  }
  return Array.from(found.values());
}

// Canonical district list for a state, sourced from the same district_codes /
// state_codes tables the rest of the CRM uses — never free-typed.
async function fetchDistrictsForState(state: string): Promise<string[]> {
  const { data: stateRow } = await supabase
    .from('state_codes')
    .select('state_code')
    .ilike('state_name', state)
    .eq('is_active', true)
    .single();
  if (!stateRow) return [];
  const { data } = await supabase
    .from('district_codes')
    .select('district_name')
    .eq('state_code', stateRow.state_code)
    .eq('is_active', true)
    .order('district_name');
  return (data || []).map((d) => d.district_name).filter(Boolean) as string[];
}

interface PortalRegistration {
  id: string;
  user_id: string | null;
  email: string;
  school_name: string;
  city: string;
  address1: string | null;
  address2: string | null;
  district: string;
  state: string | null;
  pincode: string | null;
  board: string | null;
  ss_no: number | null;
  contact_name: string | null;
  phone: string | null;
  corr_name: string | null;
  corr_mobile: string | null;
  principal_name: string | null;
  principal_mobile: string | null;
  coord_mobile: string | null;
  teacher_epo: string | null;
  teacher_epo_mob: string | null;
  teacher_mpo: string | null;
  teacher_mpo_mob: string | null;
  teacher_spo: string | null;
  teacher_spo_mob: string | null;
  teacher_gksspo: string | null;
  teacher_gksspo_mob: string | null;
  teacher_lrpo: string | null;
  teacher_lrpo_mob: string | null;
  teacher_kidspo: string | null;
  teacher_kidspo_mob: string | null;
  welcome_email_sent_at: string | null;
  welcome_whatsapp_sent_at: string | null;
  status: "pending" | "approved" | "rejected";
  matched_school_id: string | null;
  approved_at: string | null;
  created_at: string;
}

interface ProspectSchool {
  id: string;
  school_name: string;
  ss_no: number;
  district: string;
  state: string;
  board: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  pincode: string | null;
  stage: string;
  linked_to_crm: boolean;
  additional_contacts: ContactEntry[] | null;
}

/* ── Prospect school search ─────────────────────────────────────────────────── */

function ProspectSearchField({
  defaultSsNo,
  onSelect,
}: {
  defaultSsNo?: number | null;
  onSelect: (school: ProspectSchool) => void;
}) {
  const [query, setQuery] = useState(defaultSsNo ? String(defaultSsNo) : "");
  const [results, setResults] = useState<ProspectSchool[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = query.trim();
    if (!term) { setResults([]); return; }

    timer.current = setTimeout(async () => {
      setLoading(true);
      let q = supabase
        .from("prospect_schools")
        .select("id, school_name, ss_no, district, state, board, mobile, email, address, pincode, stage, linked_to_crm, additional_contacts")
        .eq("is_active", true)
        .order("school_name")
        .limit(10);

      if (!isNaN(parseInt(term))) {
        q = q.eq("ss_no", parseInt(term));
      } else {
        q = q.or(`school_name.ilike.%${term}%,district.ilike.%${term}%`);
      }

      const { data, error } = await q;
      setLoading(false);
      if (error) { console.error("Prospect search error:", error); setResults([]); return; }
      setResults((data as ProspectSchool[]) ?? []);
    }, 300);

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  // Auto-search on mount if defaultSsNo provided
  useEffect(() => {
    if (defaultSsNo) setQuery(String(defaultSsNo));
  }, [defaultSsNo]);

  const STAGE_STYLE: Record<string, string> = {
    new:        "bg-gray-100 text-gray-600",
    interested: "bg-amber-50 text-amber-700",
    registered: "bg-emerald-50 text-emerald-700",
  };

  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by SS No, school name or district…"
          autoFocus
          className="w-full pl-9 pr-24 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">Searching…</span>
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
                <p className="text-xs text-gray-500">SS #{s.ss_no} · {s.district}, {s.state}</p>
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${STAGE_STYLE[s.stage] ?? "bg-gray-100 text-gray-600"}`}>
                {s.stage}
              </span>
            </button>
          ))}
        </div>
      )}

      {!loading && query.trim() && results.length === 0 && (
        <p className="text-xs text-gray-400 px-1 py-2">No schools found — use "Register as New School" below.</p>
      )}
    </div>
  );
}

/* ── Inline new-school form ─────────────────────────────────────────────────── */

interface NewSchoolFields {
  school_name: string;
  ss_no: string;
  district: string;
  state: string;
  board: string;
  pincode: string;
}

function NewSchoolForm({
  reg,
  onSubmit,
  onCancel,
  loading,
}: {
  reg: PortalRegistration;
  onSubmit: (fields: NewSchoolFields) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [fields, setFields] = useState<NewSchoolFields>({
    school_name: reg.school_name,
    ss_no:       reg.ss_no ? String(reg.ss_no) : "",
    district:    "",
    state:       REGISTRATION_STATES.includes(reg.state ?? "") ? (reg.state as string) : "",
    board:       reg.board ?? "",
    pincode:     reg.pincode ?? "",
  });
  const [districts, setDistricts] = useState<string[]>([]);

  useEffect(() => {
    if (!fields.state) { setDistricts([]); return; }
    fetchDistrictsForState(fields.state).then((list) => {
      setDistricts(list);
      // Only keep the registration's own district guess if it's actually on
      // the canonical list for this state — otherwise force a real pick.
      setFields((p) => (list.includes(reg.district) && !p.district ? { ...p, district: reg.district } : p));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.state]);

  const set = (k: keyof NewSchoolFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((p) => ({ ...p, [k]: e.target.value }));

  const inp = "w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400";

  return (
    <div className="mt-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
      <p className="text-xs font-semibold text-blue-700 mb-3 uppercase tracking-wide">New School Details</p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">School Name</label>
          <input value={fields.school_name} onChange={set("school_name")} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">SS No</label>
          <input value={fields.ss_no} onChange={set("ss_no")} placeholder="Leave blank if unknown" className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Pincode</label>
          <input value={fields.pincode} onChange={set("pincode")} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">State</label>
          <Select
            value={fields.state}
            onValueChange={(v) => setFields((p) => ({ ...p, state: v, district: "" }))}
          >
            <SelectTrigger className={inp}><SelectValue placeholder="Select state" /></SelectTrigger>
            <SelectContent>
              {REGISTRATION_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">District</label>
          <Select
            value={fields.district}
            onValueChange={(v) => setFields((p) => ({ ...p, district: v }))}
            disabled={!fields.state}
          >
            <SelectTrigger className={inp}>
              <SelectValue placeholder={fields.state ? "Select district" : "Select state first"} />
            </SelectTrigger>
            <SelectContent>
              {districts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Board</label>
          <input value={fields.board} onChange={set("board")} placeholder="CBSE / ICSE / State Board" className={inp} />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit(fields)}
          disabled={loading || !fields.school_name.trim() || !fields.district.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <PlusCircle className="w-4 h-4" />
          {loading ? "Creating…" : "Create & Link"}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Full registration details dialog ───────────────────────────────────────── */

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm text-gray-800 text-right">{value?.trim() ? value : "—"}</span>
    </div>
  );
}

function RegistrationDetailsDialog({ reg, open, onOpenChange }: { reg: PortalRegistration | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  if (!reg) return null;
  const fullAddress = [reg.address1, reg.address2].filter(Boolean).join(", ") || reg.city;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reg.school_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">School</p>
            <DetailRow label="SS No" value={reg.ss_no ? String(reg.ss_no) : null} />
            <DetailRow label="Board" value={reg.board} />
            <DetailRow label="City" value={reg.city} />
            <DetailRow label="Address" value={fullAddress} />
            <DetailRow label="District" value={reg.district} />
            <DetailRow label="State" value={reg.state} />
            <DetailRow label="Pincode" value={reg.pincode} />
            <DetailRow label="Login Email" value={reg.email} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Contacts</p>
            <DetailRow label="Contact Person" value={reg.contact_name} />
            <DetailRow label="Phone" value={reg.phone} />
            <DetailRow label="Principal" value={reg.principal_name} />
            <DetailRow label="Principal Mobile" value={reg.principal_mobile} />
            <DetailRow label="Correspondent" value={reg.corr_name} />
            <DetailRow label="Correspondent Mobile" value={reg.corr_mobile} />
            <DetailRow label="Coordinator Mobile" value={reg.coord_mobile} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Olympiad Subject Coordinators</p>
            <DetailRow label="English (EPO)" value={[reg.teacher_epo, reg.teacher_epo_mob].filter(Boolean).join(" · ")} />
            <DetailRow label="Maths (MPO)" value={[reg.teacher_mpo, reg.teacher_mpo_mob].filter(Boolean).join(" · ")} />
            <DetailRow label="Science (SPO)" value={[reg.teacher_spo, reg.teacher_spo_mob].filter(Boolean).join(" · ")} />
            <DetailRow label="GK Sports (GKSSPO)" value={[reg.teacher_gksspo, reg.teacher_gksspo_mob].filter(Boolean).join(" · ")} />
            <DetailRow label="Life Readiness (LRPO)" value={[reg.teacher_lrpo, reg.teacher_lrpo_mob].filter(Boolean).join(" · ")} />
            <DetailRow label="KidsPO" value={[reg.teacher_kidspo, reg.teacher_kidspo_mob].filter(Boolean).join(" · ")} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Registration</p>
            <DetailRow label="Submitted" value={new Date(reg.created_at).toLocaleString("en-IN")} />
            <DetailRow label="Status" value={reg.status} />
            <DetailRow label="Welcome Email Sent" value={reg.welcome_email_sent_at ? new Date(reg.welcome_email_sent_at).toLocaleString("en-IN") : null} />
            <DetailRow label="Welcome WhatsApp Sent" value={reg.welcome_whatsapp_sent_at ? new Date(reg.welcome_whatsapp_sent_at).toLocaleString("en-IN") : null} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */

export function RegistrationApproval() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: activeProject } = useActiveProject();

  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [selectedProspect, setSelectedProspect] = useState<Record<string, ProspectSchool | null>>({});
  const [showNewForm, setShowNewForm]   = useState<Record<string, boolean>>({});
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [viewDetailsReg, setViewDetailsReg] = useState<PortalRegistration | null>(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState<Record<string, boolean>>({});
  const [confirmNewFor, setConfirmNewFor] = useState<string | null>(null);

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

  // Auto-suggested match for whichever registration is currently expanded —
  // checked by SS No / phone / email so staff aren't stuck with a blank
  // search box and don't accidentally create a duplicate for a school
  // that's already in CRM.
  const expandedReg = registrations?.find((r) => r.id === expandedId) ?? null;
  const { data: candidateMatches } = useQuery({
    queryKey: ["registration-candidates", expandedId],
    queryFn: () => findCandidateMatches(expandedReg as PortalRegistration),
    enabled: !!expandedReg && !selectedProspect[expandedId ?? ""],
  });

  /* ── Link to prospect school (cases 1 & 2) ─────────────────────────────── */
  const linkMutation = useMutation({
    mutationFn: async ({ reg, prospect }: { reg: PortalRegistration; prospect: ProspectSchool }) => {
      if (!activeProject) throw new Error("No active project");
      const now = new Date().toISOString();
      let crmSchoolId: string;
      let crmSsNo: number = prospect.ss_no;
      // Existing CRM school's contact fields, captured before any overwrite —
      // null for Case 2 (no schools row exists yet to have old values).
      let existingSchoolContacts: {
        mobile1: string | null; contact_person_name: string | null;
        principal_name: string | null; principal_mobile: string | null;
        corr_name: string | null; corr_mobile: string | null; coord_mobile: string | null;
        additional_contacts: ContactEntry[] | null;
      } | null = null;

      if (prospect.linked_to_crm) {
        // Case 1: already in CRM as interested — just update workflow + stage
        const { data: existing, error: findErr } = await supabase
          .from("schools")
          .select("id, ss_no, mobile1, contact_person_name, principal_name, principal_mobile, corr_name, corr_mobile, coord_mobile, additional_contacts")
          .eq("prospect_school_id", prospect.id)
          .single();
        if (findErr || !existing) throw new Error("Could not find CRM school linked to this prospect");
        crmSchoolId = existing.id;
        crmSsNo = existing.ss_no ?? prospect.ss_no;
        existingSchoolContacts = existing;

        // Update workflow to In Progress
        await supabase.from("school_project_workflow").upsert(
          { school_id: crmSchoolId, project_id: activeProject.id, registration_status: "In Progress", registration_interest: "Interested", contacted: "Yes" },
          { onConflict: "school_id,project_id" },
        );
      } else {
        // Case 2: only in prospect_schools — create CRM school. The school's own
        // portal submission is authoritative over old prospect-import data.
        const newRegAddress = [reg.address1, reg.address2].filter(Boolean).join(", ");
        const { data: newSchool, error: schoolErr } = await supabase
          .from("schools")
          .insert({
            school_name:          reg.school_name    ?? prospect.school_name,
            ss_no:                prospect.ss_no,
            district:             prospect.district,
            state:                prospect.state,
            board:                reg.board   ?? prospect.board,
            mobile1:              reg.phone   ?? prospect.mobile,
            email:                reg.email   ?? prospect.email,
            school_address:       newRegAddress || prospect.address || reg.city || null,
            pincode:              reg.pincode ?? prospect.pincode,
            prospect_school_id:   prospect.id,
            current_project_id:   activeProject.id,
            contact_person_name:  reg.contact_name   ?? null,
            principal_name:       reg.principal_name ?? null,
            principal_mobile:     reg.principal_mobile ?? null,
            coord_mobile:         reg.coord_mobile   ?? null,
            corr_name:            reg.corr_name      ?? null,
            corr_mobile:          reg.corr_mobile    ?? null,
            portal_registered:    true,
          })
          .select("id, ss_no")
          .single();
        if (schoolErr) throw schoolErr;
        crmSchoolId = newSchool.id;
        crmSsNo = newSchool.ss_no ?? prospect.ss_no;

        await supabase.from("school_project_workflow").insert({
          school_id: crmSchoolId, project_id: activeProject.id,
          registration_status: "In Progress", registration_interest: "Interested", contacted: "Yes",
        });
      }

      // Before overwriting any contact-mobile field below, keep whatever old
      // number is about to be replaced (if it's real and different) instead of
      // dropping it — same additional_contacts array both tables already share
      // with the incoming-call auto-linking trigger. Start from the union of
      // both tables' existing lists since they can drift apart.
      let contacts: ContactEntry[] = existingSchoolContacts?.additional_contacts ?? [];
      for (const c of prospect.additional_contacts ?? []) {
        if (!contacts.some((e) => last10Digits(e.mobile) === last10Digits(c.mobile))) contacts.push(c);
      }
      contacts = preserveIfChanged(contacts, existingSchoolContacts?.mobile1 ?? null, reg.phone, existingSchoolContacts?.contact_person_name ?? null, "School");
      contacts = preserveIfChanged(contacts, prospect.mobile, reg.phone, null, "School");
      contacts = preserveIfChanged(contacts, existingSchoolContacts?.principal_mobile ?? null, reg.principal_mobile, existingSchoolContacts?.principal_name ?? null, "Principal");
      contacts = preserveIfChanged(contacts, existingSchoolContacts?.corr_mobile ?? null, reg.corr_mobile, existingSchoolContacts?.corr_name ?? null, "Correspondent");
      contacts = preserveIfChanged(contacts, existingSchoolContacts?.coord_mobile ?? null, reg.coord_mobile, null, "Coordinator");

      // Update prospect stage to registered, AND sync portal-submitted details
      // into prospect_schools too — this used to only update the CRM `schools`
      // copy, leaving prospect_schools permanently stale after a school
      // self-registered with fresher contact info.
      const regAddress = [reg.address1, reg.address2].filter(Boolean).join(", ");
      await supabase.from("prospect_schools").update({
        stage: "registered",
        linked_to_crm: true,
        additional_contacts: contacts,
        ...(reg.school_name    && { school_name: reg.school_name }),
        ...(regAddress         && { address: regAddress }),
        ...(reg.email          && { email: reg.email }),
        ...(reg.phone          && { mobile: reg.phone }),
        ...(reg.pincode        && { pincode: reg.pincode }),
        ...(reg.board          && { board: reg.board }),
        ...(reg.principal_name && { principal_name: reg.principal_name }),
      }).eq("id", prospect.id);

      // Sync portal-submitted details to CRM school — the school's own portal
      // submission is treated as authoritative over old prospect-import data.
      await supabase.from("schools").update({
        additional_contacts: contacts,
        ...(reg.school_name      && { school_name: reg.school_name }),
        ...(regAddress           && { school_address: regAddress }),
        ...(reg.email            && { email: reg.email }),
        ...(reg.phone            && { mobile1: reg.phone }),
        ...(reg.contact_name     && { contact_person_name: reg.contact_name }),
        ...(reg.pincode          && { pincode: reg.pincode }),
        ...(reg.board            && { board: reg.board }),
        ...(reg.principal_name   && { principal_name: reg.principal_name }),
        ...(reg.principal_mobile && { principal_mobile: reg.principal_mobile }),
        ...(reg.coord_mobile     && { coord_mobile: reg.coord_mobile }),
        ...(reg.corr_name        && { corr_name: reg.corr_name }),
        ...(reg.corr_mobile      && { corr_mobile: reg.corr_mobile }),
        portal_registered: true,
      }).eq("id", crmSchoolId);

      // Link portal account to CRM school
      if (reg.user_id) {
        await supabase.from("school_portal_accounts")
          .update({ school_id: crmSchoolId, linked_at: now })
          .eq("user_id", reg.user_id);
      }

      // Mark registration as linked
      await supabase.from("school_portal_registrations").update({
        status: "approved", matched_school_id: crmSchoolId, approved_at: now,
      }).eq("id", reg.id);
    },
    onSuccess: (_, { prospect }) => {
      qc.invalidateQueries({ queryKey: ["portal-registrations"] });
      qc.invalidateQueries({ queryKey: ["nav-badge-counts"] });
      setExpandedId(null);
      toast({
        title: "School linked",
        description: `${prospect.school_name} linked and marked as registered.`,
      });
    },
    onError: (err) => {
      toast({ title: "Link failed", description: err instanceof Error ? err.message : "Something went wrong", variant: "destructive" });
    },
  });

  /* ── Register completely new school (case 3) ────────────────────────────── */
  const registerNewMutation = useMutation({
    mutationFn: async ({ reg, fields }: { reg: PortalRegistration; fields: NewSchoolFields }) => {
      if (!activeProject) throw new Error("No active project");
      const now = new Date().toISOString();
      const ssNo = fields.ss_no ? parseInt(fields.ss_no) : null;

      // Create prospect_schools row. ss_no is NOT NULL with a nextval() default —
      // omit the key when blank so Postgres assigns the next SS No; sending an
      // explicit null overrides the default and violates the constraint.
      const { data: newProspect, error: prospectErr } = await supabase
        .from("prospect_schools")
        .insert({
          school_name:  fields.school_name.trim(),
          ...(ssNo !== null && { ss_no: ssNo }),
          district:     fields.district.trim(),
          state:        fields.state.trim(),
          board:        fields.board.trim() || null,
          pincode:      fields.pincode.trim() || null,
          email:        reg.email,
          mobile:       reg.phone,
          address:      reg.city ?? null,
          stage:        "registered",
          linked_to_crm: true,
        })
        .select("id, ss_no")
        .single();
      if (prospectErr) throw prospectErr;

      // Create CRM school — reuse the SS No that was just assigned to prospect_schools
      // (not the original, possibly-blank form value) so both rows stay in sync.
      const newRegAddress = [reg.address1, reg.address2].filter(Boolean).join(", ");
      const { data: newSchool, error: schoolErr } = await supabase
        .from("schools")
        .insert({
          school_name:          fields.school_name.trim(),
          ss_no:                newProspect.ss_no,
          district:             fields.district.trim(),
          state:                fields.state.trim(),
          board:                fields.board.trim() || null,
          pincode:              fields.pincode.trim() || null,
          mobile1:              reg.phone,
          email:                reg.email,
          school_address:       newRegAddress || reg.city || null,
          contact_person_name:  reg.contact_name   ?? null,
          principal_name:       reg.principal_name ?? null,
          principal_mobile:     reg.principal_mobile ?? null,
          coord_mobile:         reg.coord_mobile   ?? null,
          corr_name:            reg.corr_name      ?? null,
          corr_mobile:          reg.corr_mobile    ?? null,
          prospect_school_id:   newProspect.id,
          current_project_id:   activeProject.id,
          portal_registered:    true,
        })
        .select("id")
        .single();
      if (schoolErr) throw schoolErr;

      // Workflow
      await supabase.from("school_project_workflow").insert({
        school_id: newSchool.id, project_id: activeProject.id,
        registration_status: "In Progress", registration_interest: "Interested", contacted: "Yes",
      });

      // Link portal account
      if (reg.user_id) {
        await supabase.from("school_portal_accounts")
          .update({ school_id: newSchool.id, linked_at: now })
          .eq("user_id", reg.user_id);
      }

      // Mark registration
      await supabase.from("school_portal_registrations").update({
        status: "approved", matched_school_id: newSchool.id, approved_at: now,
      }).eq("id", reg.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-registrations"] });
      qc.invalidateQueries({ queryKey: ["nav-badge-counts"] });
      setExpandedId(null);
      toast({ title: "New school created and linked" });
    },
    onError: (err) => {
      // Supabase query errors are plain {message, details, code} objects, not
      // real Error instances, unless .throwOnError() was used — so check for
      // .message directly instead of relying on instanceof Error.
      const message = (err as { message?: string })?.message || "Something went wrong";
      toast({ title: "Failed to create school", description: message, variant: "destructive" });
    },
  });

  /* ── Reject ─────────────────────────────────────────────────────────────── */
  const rejectMutation = useMutation({
    mutationFn: async ({ regId, reason }: { regId: string; reason: string }) => {
      const { error } = await supabase
        .from("school_portal_registrations")
        .update({ status: "rejected", rejection_reason: reason || null })
        .eq("id", regId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-registrations"] });
      qc.invalidateQueries({ queryKey: ["nav-badge-counts"] });
      setExpandedId(null);
    },
  });

  const STATUS_COLORS = {
    pending:  "bg-amber-50 text-amber-700",
    approved: "bg-emerald-50 text-emerald-700",
    rejected: "bg-red-50 text-red-600",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Link Schools</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Match portal registrations to prospect schools and import to CRM
          </p>
        </div>
        <div className="flex gap-2">
          {(["pending", "approved", "rejected", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                statusFilter === s ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
            const prospect   = selectedProspect[reg.id];
            const newForm    = showNewForm[reg.id];

            return (
              <div key={reg.id} className="border border-gray-200 rounded-xl overflow-hidden">
                {/* Header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : reg.id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left cursor-pointer"
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
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setViewDetailsReg(reg); }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Details
                    </button>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[reg.status]}`}>
                      {reg.status}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(reg.created_at).toLocaleDateString("en-IN")}
                    </span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {/* Expanded — pending */}
                {isExpanded && reg.status === "pending" && (
                  <div className="border-t border-gray-100 px-5 py-5 bg-gray-50/50">
                    {/* Registration details */}
                    <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
                      <div><span className="text-gray-500">Contact: </span><span className="text-gray-800">{reg.contact_name ?? "—"}</span></div>
                      <div><span className="text-gray-500">Phone: </span><span className="text-gray-800">{reg.phone ?? "—"}</span></div>
                      <div><span className="text-gray-500">Board: </span><span className="text-gray-800">{reg.board ?? "—"}</span></div>
                      <div><span className="text-gray-500">State: </span><span className="text-gray-800">{reg.state ?? "—"}</span></div>
                    </div>

                    {/* Prospect search */}
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wider">
                        Find in Prospect Schools
                      </label>

                      {prospect ? (
                        <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                          <div>
                            <p className="text-sm font-medium text-indigo-900">{prospect.school_name}</p>
                            <p className="text-xs text-indigo-600">
                              SS #{prospect.ss_no} · {prospect.district}, {prospect.state}
                            </p>
                            {prospect.stage === "interested" && (
                              <p className="text-xs text-amber-600 mt-0.5">Currently marked as Interested → will be converted to Registered</p>
                            )}
                            {prospect.stage === "new" && (
                              <p className="text-xs text-gray-500 mt-0.5">New prospect → will be imported to CRM</p>
                            )}
                            {prospect.stage === "registered" && (
                              <p className="text-xs text-emerald-600 mt-0.5">Already registered for this project</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedProspect((p) => ({ ...p, [reg.id]: null }))}
                            className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                          >
                            Change
                          </button>
                        </div>
                      ) : !newForm ? (
                        <>
                          {isExpanded && !dismissedSuggestion[reg.id] && candidateMatches && candidateMatches.length > 0 && (
                            <div className="mb-3 space-y-2">
                              {candidateMatches.map((c) => (
                                <div key={c.id} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
                                  <div>
                                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-0.5">
                                      Suggested match · same {c.matchedOn}
                                    </p>
                                    <p className="text-sm font-medium text-amber-900">{c.school_name}</p>
                                    <p className="text-xs text-amber-700">SS #{c.ss_no} · {c.district}, {c.state}</p>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedProspect((p) => ({ ...p, [reg.id]: c }))}
                                      className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors"
                                    >
                                      Use this match
                                    </button>
                                  </div>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => setDismissedSuggestion((p) => ({ ...p, [reg.id]: true }))}
                                className="text-xs text-gray-500 hover:text-gray-700"
                              >
                                None of these — search manually instead
                              </button>
                            </div>
                          )}
                          <ProspectSearchField
                            defaultSsNo={reg.ss_no}
                            onSelect={(s) => {
                              setSelectedProspect((p) => ({ ...p, [reg.id]: s }));
                              setShowNewForm((p) => ({ ...p, [reg.id]: false }));
                            }}
                          />
                        </>
                      ) : null}
                    </div>

                    {/* New school form */}
                    {newForm && !prospect && (
                      <NewSchoolForm
                        reg={reg}
                        loading={registerNewMutation.isPending}
                        onSubmit={(fields) => registerNewMutation.mutate({ reg, fields })}
                        onCancel={() => setShowNewForm((p) => ({ ...p, [reg.id]: false }))}
                      />
                    )}

                    {/* Actions */}
                    <div className="flex gap-3 mt-4">
                      {prospect && (
                        <button
                          type="button"
                          onClick={() => linkMutation.mutate({ reg, prospect })}
                          disabled={linkMutation.isPending}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {linkMutation.isPending ? "Linking…" : "Link School"}
                        </button>
                      )}

                      {!prospect && !newForm && confirmNewFor !== reg.id && (
                        <button
                          type="button"
                          onClick={() => {
                            if (candidateMatches && candidateMatches.length > 0 && !dismissedSuggestion[reg.id]) {
                              setConfirmNewFor(reg.id);
                            } else {
                              setShowNewForm((p) => ({ ...p, [reg.id]: true }));
                            }
                          }}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors border border-blue-200"
                        >
                          <PlusCircle className="w-4 h-4" />
                          Register as New School
                        </button>
                      )}

                      {confirmNewFor === reg.id && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 max-w-md">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="font-medium mb-1">A school with a matching SS No / phone / email already exists.</p>
                            <p className="mb-2">Creating a new school here will not carry over that school's existing communication history, consent forms, or status. Are you sure this isn't the same school?</p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => { setConfirmNewFor(null); setShowNewForm((p) => ({ ...p, [reg.id]: true })); }}
                                className="px-3 py-1 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
                              >
                                Yes, register as new
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmNewFor(null)}
                                className="px-3 py-1 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex-1 flex gap-2">
                        <input
                          value={rejectionReason[reg.id] ?? ""}
                          onChange={(e) => setRejectionReason((p) => ({ ...p, [reg.id]: e.target.value }))}
                          placeholder="Rejection reason (optional)"
                          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-red-400/30 focus:border-red-400"
                        />
                        <button
                          type="button"
                          onClick={() => rejectMutation.mutate({ regId: reg.id, reason: rejectionReason[reg.id] ?? "" })}
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

                {/* Expanded — approved/rejected */}
                {isExpanded && reg.status !== "pending" && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/50 text-sm text-gray-500">
                    {reg.status === "approved"
                      ? `Linked on ${reg.approved_at ? new Date(reg.approved_at).toLocaleDateString("en-IN") : "—"}`
                      : "Rejected"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <RegistrationDetailsDialog
        reg={viewDetailsReg}
        open={!!viewDetailsReg}
        onOpenChange={(o) => { if (!o) setViewDetailsReg(null); }}
      />
    </div>
  );
}
