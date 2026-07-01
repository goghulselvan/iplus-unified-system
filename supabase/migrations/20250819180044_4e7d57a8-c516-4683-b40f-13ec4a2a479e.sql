-- Enable real-time for follow_ups table
ALTER TABLE public.follow_ups REPLICA IDENTITY FULL;
ALTER publication supabase_realtime ADD TABLE public.follow_ups;

-- Enable real-time for communications table  
ALTER TABLE public.communications REPLICA IDENTITY FULL;
ALTER publication supabase_realtime ADD TABLE public.communications;