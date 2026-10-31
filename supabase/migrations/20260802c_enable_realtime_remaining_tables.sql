-- useRealtimeSync.ts subscribes to postgres_changes on these tables, but only
-- email_jobs and follow_ups were ever added to the supabase_realtime
-- publication. Every list this hook powers (schools, workflow, payments,
-- communications, students, portal registrations/enrollments) was silently
-- stale until a manual refresh or the polling interval. Adding the rest here.
alter publication supabase_realtime add table public.schools;
alter publication supabase_realtime add table public.school_project_workflow;
alter publication supabase_realtime add table public.payment_transactions;
alter publication supabase_realtime add table public.communications;
alter publication supabase_realtime add table public.students;
alter publication supabase_realtime add table public.student_registrations;
alter publication supabase_realtime add table public.student_subjects;
alter publication supabase_realtime add table public.portal_registered_students;
alter publication supabase_realtime add table public.portal_student_enrollments;
