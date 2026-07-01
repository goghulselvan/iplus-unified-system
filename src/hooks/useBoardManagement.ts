import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Board {
  id: string;
  board_name: string;
  board_code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const useBoardManagement = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const getActiveBoards = useCallback(async (): Promise<Board[]> => {
    try {
      const { data, error } = await supabase
        .from('boards')
        .select('*')
        .eq('is_active', true)
        .order('board_name');

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching active boards:', error);
      return [];
    }
  }, []);

  const getAllBoards = useCallback(async (): Promise<Board[]> => {
    try {
      const { data, error } = await supabase
        .from('boards')
        .select('*')
        .order('board_name');

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching all boards:', error);
      return [];
    }
  }, []);

  const createBoard = useCallback(async (boardData: {
    board_name: string;
    board_code?: string;
    is_active?: boolean;
  }) => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('boards')
        .insert([{
          board_name: boardData.board_name.trim(),
          board_code: boardData.board_code?.trim() || null,
          is_active: boardData.is_active ?? true,
          created_by: (await supabase.auth.getUser()).data.user?.id
        }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Board created successfully',
      });

      return { data, error: null };
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return { data: null, error };
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const updateBoard = useCallback(async (id: string, updates: {
    board_name?: string;
    board_code?: string;
    is_active?: boolean;
  }) => {
    try {
      setLoading(true);
      
      const updateData: any = {};
      if (updates.board_name !== undefined) updateData.board_name = updates.board_name.trim();
      if (updates.board_code !== undefined) updateData.board_code = updates.board_code?.trim() || null;
      if (updates.is_active !== undefined) updateData.is_active = updates.is_active;

      const { data, error } = await supabase
        .from('boards')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Board updated successfully',
      });

      return { data, error: null };
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return { data: null, error };
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const deleteBoard = useCallback(async (id: string) => {
    try {
      setLoading(true);
      
      const { error } = await supabase
        .from('boards')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Board deleted successfully',
      });

      return { error: null };
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return { error };
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return {
    loading,
    getActiveBoards,
    getAllBoards,
    createBoard,
    updateBoard,
    deleteBoard,
  };
};