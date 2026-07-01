import { CheckCircle, Circle, Clock } from 'lucide-react';

type Stage = {
  key: string;
  label: string;
  status: 'done' | 'active' | 'pending';
};

function getStages(school: any): Stage[] {
  const done   = (v: any, vals: string[]) => vals.includes(v);
  const active = (v: any, vals: string[]) => v && !vals.includes(v);

  return [
    {
      key: 'brochure',
      label: 'Brochure',
      status: done(school.brochure_delivery_status, ['Digital Sent', 'Both Physical & Digital'])
        ? 'done'
        : done(school.brochure_delivery_status, ['Physical Only'])
        ? 'active'
        : 'pending',
    },
    {
      key: 'registration',
      label: 'Registration',
      status: done(school.registration_status, ['Confirmed'])
        ? 'done'
        : done(school.registration_status, ['In Progress'])
        ? 'active'
        : 'pending',
    },
    {
      key: 'consent',
      label: 'Consent Form',
      status: done(school.consent_form_sent, ['Sent', 'Sent Digitally'])
        ? 'done'
        : done(school.consent_form_requested, ['Yes'])
        ? 'active'
        : 'pending',
    },
    {
      key: 'payment',
      label: 'Payment',
      status: done(school.payment_status, ['Received'])
        ? 'done'
        : done(school.payment_status, ['Partial'])
        ? 'active'
        : 'pending',
    },
    {
      key: 'namelist',
      label: 'Name List',
      status: done(school.name_list_status, ['Uploaded', 'Received'])
        ? 'done'
        : done(school.name_list_status, ['Received'])
        ? 'active'
        : 'pending',
    },
    {
      key: 'qpaper',
      label: 'Question Paper',
      status: done(school.question_paper_sent, ['Sent']) ? 'done' : 'pending',
    },
    {
      key: 'answersheet',
      label: 'Answer Sheet',
      status: done(school.answer_sheet_status, ['Received']) ? 'done' : 'pending',
    },
    {
      key: 'results',
      label: 'Results',
      status: done(school.result_status, ['Sent']) ? 'done' : 'pending',
    },
  ];
}

export function WorkflowPipeline({ school }: { school: any }) {
  const stages = getStages(school);
  const doneCount = stages.filter(s => s.status === 'done').length;

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-700">Workflow Progress</span>
        <span className="text-xs text-gray-500 font-medium">
          {doneCount}/{stages.length} completed
        </span>
      </div>
      <div className="flex items-center gap-0 overflow-x-auto pb-1">
        {stages.map((stage, i) => (
          <div key={stage.key} className="flex items-center flex-1 min-w-0">
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
            </div>
            {i < stages.length - 1 && (
              <div className={`h-0.5 flex-shrink-0 w-4 mb-5 transition-colors ${
                stage.status === 'done' ? 'bg-green-300' : 'bg-gray-200'
              }`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
