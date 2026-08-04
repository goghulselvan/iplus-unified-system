-- Phase 1 of inventory module rebuild: categories + richer item attributes
-- + Ignite/Impact Series taxonomy, backfilled for the 48 existing products.

CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_users_read_product_categories" ON public.product_categories
  FOR SELECT USING (is_crm_user());
CREATE POLICY "crm_users_write_product_categories" ON public.product_categories
  FOR ALL USING (is_crm_user()) WITH CHECK (is_crm_user());

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.product_categories(id),
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'saleable'
    CHECK (item_type IN ('consumable', 'saleable')),
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS minimum_stock_level integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS series text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS class_number integer;

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique
  ON public.products (sku) WHERE sku IS NOT NULL;

-- Backfill taxonomy for the 48 existing Olympiad products (naming convention
-- verified 48/48 consistent on 2026-08-04: "{Subject} - iPlus Olympiads -
-- Ignite Series - Class {N}" or "Class {N} Mock Test - iPlus Olympiads -
-- Impact Series").
UPDATE public.products SET
  series = CASE WHEN name ILIKE '%Mock Test%' THEN 'Impact Series' ELSE 'Ignite Series' END,
  subject = CASE
    WHEN name ILIKE 'English%' THEN 'English'
    WHEN name ILIKE 'Maths%' THEN 'Maths'
    WHEN name ILIKE 'Science%' THEN 'Science'
    WHEN name ILIKE 'GK & Social Science%' THEN 'GK & Social Science'
    WHEN name ILIKE 'Logical Reasoning%' THEN 'Logical Reasoning'
    ELSE NULL
  END,
  class_number = substring(name from 'Class (\d+)')::integer
WHERE series IS NULL;

-- Seed a starting category so the dropdown isn't empty on first load.
INSERT INTO public.product_categories (name, description)
VALUES ('Olympiad Books & Mock Tests', 'Ignite Series subject books and Impact Series mock tests')
ON CONFLICT (name) DO NOTHING;

UPDATE public.products
SET category_id = (SELECT id FROM public.product_categories WHERE name = 'Olympiad Books & Mock Tests')
WHERE category_id IS NULL;
