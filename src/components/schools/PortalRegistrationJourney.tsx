import { useState } from 'react';
import { CheckCircle, Circle, Clock, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useSchoolWorkflow } from '@/hooks/useSchoolProjectWorkflow';
import { usePortalRegistrationProgress } from '@/hooks/usePortalRegistrationProgress';
import { useActiveProject } from '@/hooks/useOlympiadProjects';

type Stage = {
  key: string;
  label: string;
  status: 'done' | 'active' | 'pending';
  caption?: string;
};

const fmtINR = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function PortalRegistrationJourney({ school }: { school: any }) {
  const [open, setOpen] = useState(false);
  const { data: activeProject } = useActiveProject();
  const { data: workflow } = useSchoolWorkflow(school.id);
  const { data: progress } = usePortalRegistrationProgress(school.id, activeProject?.id);

  const studentCount = progress?.studentCount ?? 0;
  const enrollmentCount = progress?.enrollmentCount ?? 0;
  const submittedTotal = progress?.submittedTotal ?? 0;
  const listSubmitted = !!(workflow as any)?.list_submitted_at;
  const paymentReceived = Number(school.payment_received ?? 0);
  const paymentAckDone = school.payment_status === 'Received' || school.payment_status === 'Overpaid';

  const stages: Stage[] = [
    {
      key: 'registered',
      label: 'Registered on Portal',
      status: 'done',
    },
    {
      key: 'students',
      label: 'Student List',
      status: listSubmitted ? 'done' : studentCount > 0 ? 'active' : 'pending',
      caption: studentCount > 0 ? `${studentCount} student${studentCount === 1 ? '' : 's'} added` : undefined,
    },
    {
      key: 'enrollments',
      label: 'Subjects Enrolled',
      status: listSubmitted ? 'done' : enrollmentCount > 0 ? 'active' : 'pending',
      caption: enrollmentCount > 0 ? `${enrollmentCount} enrollment${enrollmentCount === 1 ? '' : 's'}` : undefined,
    },
    {
      key: 'payment_submitted',
      label: 'Payment Submitted',
      status: submittedTotal > 0 ? 'done' : 'pending',
      caption: submittedTotal > 0 ? `${fmtINR(submittedTotal)} submitted` : undefined,
    },
    {
      key: 'payment_ack',
      label: 'Payment Acknowledged',
      status: school.payment_status === 'Received' || school.payment_status === 'Overpaid'
        ? 'done'
        : school.payment_status === 'Partial'
        ? 'active'
        : 'pending',
      caption: paymentReceived > 0 ? `${fmtINR(paymentReceived)} received` : undefined,
    },
    {
      key: 'list_locked',
      label: 'List Submitted',
      status: listSubmitted ? 'done' : 'pending',
    },
    {
      key: 'confirmed',
      label: 'Registration Confirmed',
      // Gated behind Payment Acknowledged (stage 5) — registration_status flips
      // to 'In Progress' the moment a portal school gets linked in the CRM,
      // which is unrelated to whether it has actually paid or submitted anything.
      status: !paymentAckDone
        ? 'pending'
        : school.registration_status === 'Confirmed'
        ? 'done'
        : 'active',
    },
  ];

  const doneCount = stages.filter(s => s.status === 'done').length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="bg-white border border-gray-200 rounded-xl mb-6">
      <CollapsibleTrigger className="w-full flex items-center justify-between px-5 py-4 text-left">
        <span className="text-sm font-semibold text-gray-700">Portal Registration Journey</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">{doneCount}/{stages.length} completed</span>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-5 pb-4">
        <div className="flex items-start gap-0 overflow-x-auto pb-1 pt-1">
          {stages.map((stage, i) => (
            <div key={stage.key} className="flex items-start flex-1 min-w-0">
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 transition-colors ${
                  stage.status === 'done'   ? 'bg-green-100'  :
                  stage.status === 'active' ? 'bg-indigo-100' : 'bg-gray-100'
                }`}>
                  {stage.status === 'done' ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : stage.status === 'active' ? (
                    <Clock className="h-5 w-5 text-indigo-600" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-300" />
                  )}
                </div>
                <span className={`text-xs mt-1.5 text-center leading-tight px-1 font-medium ${
                  stage.status === 'done'   ? 'text-green-700'  :
                  stage.status === 'active' ? 'text-indigo-700' : 'text-gray-400'
                }`}>
                  {stage.label}
                </span>
                {stage.caption && (
                  <span className="text-[11px] mt-0.5 text-center leading-tight px-1 text-gray-500">
                    {stage.caption}
                  </span>
                )}
              </div>
              {i < stages.length - 1 && (
                <div className={`h-0.5 flex-shrink-0 w-4 mt-4 transition-colors ${
                  stage.status === 'done' ? 'bg-green-300' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
