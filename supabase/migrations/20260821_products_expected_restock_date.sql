-- Lets staff flag when an out-of-stock product will be back, so the portal can
-- show "Available after {date}" instead of a bare "Out of Stock" — first real
-- case: Class 2 Maths went out of stock, restock expected after 2026-09-10.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS expected_restock_date date;
