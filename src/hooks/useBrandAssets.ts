import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BrandAsset {
  id: string;
  asset_type: string;
  asset_name: string;
  asset_value?: string;
  storage_url?: string;
  description?: string;
  width?: number;
  height?: number;
  file_format?: string;
  version: string;
  is_active: boolean;
}

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  dark_blue: string;
  white: string;
}

export interface BrandAssets {
  colors: BrandColors;
  logo_horizontal_url?: string;
  logo_icon_url?: string;
  tagline: string;
  tagline_full: string;
}

export function useBrandAssets() {
  const [assets, setAssets] = useState<BrandAssets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBrandAssets();
  }, []);

  const fetchBrandAssets = async () => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('brand_assets')
        .select('*')
        .eq('is_active', true)
        .order('asset_type', { ascending: true });

      if (err) throw err;

      // Parse assets into structured format
      const brandData: BrandAssets = {
        colors: {
          primary: '#4F46E5',
          secondary: '#7C3AED',
          accent: '#FCD34D',
          dark_blue: '#1E3A8A',
          white: '#FFFFFF',
        },
        tagline: 'Ignite Inspire Impact',
        tagline_full: 'Ignite Genius, Inspire Excellence, Impact the Future',
      };

      if (data) {
        data.forEach((asset: BrandAsset) => {
          if (asset.asset_type === 'color') {
            brandData.colors[asset.asset_name as keyof BrandColors] = asset.asset_value || '';
          } else if (asset.asset_type === 'logo') {
            if (asset.asset_name === 'horizontal') {
              brandData.logo_horizontal_url = asset.storage_url;
            } else if (asset.asset_name === 'icon') {
              brandData.logo_icon_url = asset.storage_url;
            }
          } else if (asset.asset_type === 'tagline') {
            if (asset.asset_name === 'main') {
              brandData.tagline = asset.asset_value || '';
            } else if (asset.asset_name === 'full') {
              brandData.tagline_full = asset.asset_value || '';
            }
          }
        });
      }

      setAssets(brandData);
      setError(null);
    } catch (err) {
      console.error('Error fetching brand assets:', err);
      setError(err instanceof Error ? err.message : 'Failed to load brand assets');
    } finally {
      setLoading(false);
    }
  };

  return { assets, loading, error, refetch: fetchBrandAssets };
}

// Utility function to get brand assets synchronously (for use in email templates)
export const DEFAULT_BRAND_ASSETS: BrandAssets = {
  colors: {
    primary: '#4F46E5',
    secondary: '#7C3AED',
    accent: '#FCD34D',
    dark_blue: '#1E3A8A',
    white: '#FFFFFF',
  },
  tagline: 'Ignite Inspire Impact',
  tagline_full: 'Ignite Genius, Inspire Excellence, Impact the Future',
};
