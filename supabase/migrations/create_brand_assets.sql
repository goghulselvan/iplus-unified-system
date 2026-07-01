-- Create brand_assets table for storing logos, colors, and brand metadata
CREATE TABLE brand_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type TEXT NOT NULL, -- 'logo', 'color', 'font', 'tagline', 'banner'
  asset_name TEXT NOT NULL, -- 'logo_horizontal', 'color_primary', 'tagline_main'
  asset_value TEXT, -- For colors: hex code, for tagline: text
  storage_url TEXT, -- For uploaded images
  description TEXT,
  width INTEGER, -- For images
  height INTEGER, -- For images
  file_format TEXT, -- 'png', 'jpg', 'svg'
  version TEXT DEFAULT '1.0',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(asset_type, asset_name, version)
);

-- Add RLS policies
ALTER TABLE brand_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_crm_users_to_read_brand_assets"
  ON brand_assets
  FOR SELECT
  TO authenticated
  USING (is_crm_user());

CREATE POLICY "allow_crm_admins_to_manage_brand_assets"
  ON brand_assets
  FOR ALL
  TO authenticated
  USING (is_crm_user())
  WITH CHECK (is_crm_user());

-- Insert iPlus brand colors
INSERT INTO brand_assets (asset_type, asset_name, asset_value, description, version)
VALUES
  ('color', 'primary', '#4F46E5', 'Primary indigo color', '2026'),
  ('color', 'secondary', '#7C3AED', 'Secondary violet color', '2026'),
  ('color', 'accent', '#FCD34D', 'Gold accent color', '2026'),
  ('color', 'dark_blue', '#1E3A8A', 'Dark blue for headers', '2026'),
  ('color', 'white', '#FFFFFF', 'White background', '2026'),
  ('tagline', 'main', 'Ignite Inspire Impact', 'Primary brand tagline', '2026'),
  ('tagline', 'full', 'Ignite Genius, Inspire Excellence, Impact the Future', 'Extended tagline', '2026-legacy')
ON CONFLICT (asset_type, asset_name, version) DO UPDATE SET
  asset_value = EXCLUDED.asset_value,
  updated_at = now();
