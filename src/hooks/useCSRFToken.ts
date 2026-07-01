import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const useCSRFToken = () => {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generateToken = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('generate_csrf_token');
      if (error) throw error;
      setToken(data);
      return data;
    } catch (error) {
      console.error('Failed to generate CSRF token:', error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const validateToken = async (tokenToValidate: string) => {
    try {
      const { data, error } = await supabase.rpc('validate_csrf_token', {
        token_to_validate: tokenToValidate
      });
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Failed to validate CSRF token:', error);
      return false;
    }
  };

  useEffect(() => {
    generateToken();
  }, []);

  return {
    token,
    generateToken,
    validateToken,
    loading
  };
};