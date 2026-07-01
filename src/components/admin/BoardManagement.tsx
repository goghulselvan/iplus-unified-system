import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Plus, Edit, Trash2, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Board {
  id: string;
  board_name: string;
  board_code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const BoardManagement = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingBoard, setEditingBoard] = useState<Board | null>(null);
  const [newBoard, setNewBoard] = useState({
    board_name: '',
    board_code: ''
  });
  const { toast } = useToast();
  const { profile } = useAuth();

  // Check if user is superadmin
  const isSuperAdmin = profile?.role === 'superadmin';

  const fetchBoards = async () => {
    try {
      const { data, error } = await supabase
        .from('boards')
        .select('*')
        .order('board_name');

      if (error) throw error;
      setBoards(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch boards: ' + error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBoards();
  }, []);

  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newBoard.board_name.trim()) {
      toast({
        title: 'Error',
        description: 'Board name is required',
        variant: 'destructive'
      });
      return;
    }

    try {
      const boardCode = newBoard.board_code.trim() || 
        newBoard.board_name.toUpperCase().replace(/[^A-Z0-9]/g, '_');

      const { error } = await supabase
        .from('boards')
        .insert([{
          board_name: newBoard.board_name.trim(),
          board_code: boardCode,
          created_by: profile?.user_id
        }]);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Board created successfully'
      });

      setNewBoard({ board_name: '', board_code: '' });
      setIsCreateDialogOpen(false);
      fetchBoards();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to create board: ' + error.message,
        variant: 'destructive'
      });
    }
  };

  const handleUpdateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!editingBoard || !editingBoard.board_name.trim()) {
      return;
    }

    try {
      const { error } = await supabase
        .from('boards')
        .update({
          board_name: editingBoard.board_name.trim(),
          board_code: editingBoard.board_code.trim()
        })
        .eq('id', editingBoard.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Board updated successfully'
      });

      setIsEditDialogOpen(false);
      setEditingBoard(null);
      fetchBoards();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to update board: ' + error.message,
        variant: 'destructive'
      });
    }
  };

  const handleToggleActive = async (board: Board) => {
    try {
      const { error } = await supabase
        .from('boards')
        .update({ is_active: !board.is_active })
        .eq('id', board.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Board ${!board.is_active ? 'activated' : 'deactivated'} successfully`
      });

      fetchBoards();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to update board status: ' + error.message,
        variant: 'destructive'
      });
    }
  };

  const handleDeleteBoard = async (board: Board) => {
    if (!confirm(`Are you sure you want to delete "${board.board_name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('boards')
        .delete()
        .eq('id', board.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Board deleted successfully'
      });

      fetchBoards();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to delete board: ' + error.message,
        variant: 'destructive'
      });
    }
  };

  if (!isSuperAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Board Management</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Access denied. Only super administrators can manage boards.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Board Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Board Management</span>
          </CardTitle>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Board
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Board</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateBoard} className="space-y-4">
                <div>
                  <Label htmlFor="board_name">Board Name *</Label>
                  <Input
                    id="board_name"
                    value={newBoard.board_name}
                    onChange={(e) => setNewBoard({ ...newBoard, board_name: e.target.value })}
                    placeholder="e.g., CBSE, State Board"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="board_code">Board Code (Optional)</Label>
                  <Input
                    id="board_code"
                    value={newBoard.board_code}
                    onChange={(e) => setNewBoard({ ...newBoard, board_code: e.target.value })}
                    placeholder="Auto-generated if empty"
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Create Board</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Board Name</TableHead>
                <TableHead>Board Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {boards.map((board) => (
                <TableRow key={board.id}>
                  <TableCell className="font-medium">{board.board_name}</TableCell>
                  <TableCell>
                    <code className="bg-muted px-2 py-1 rounded text-sm">
                      {board.board_code}
                    </code>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={board.is_active}
                        onCheckedChange={() => handleToggleActive(board)}
                      />
                      <Badge variant={board.is_active ? 'default' : 'secondary'}>
                        {board.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    {new Date(board.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingBoard(board);
                          setIsEditDialogOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteBoard(board)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {boards.length === 0 && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No boards found. Create your first board to get started.</p>
          </div>
        )}

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Board</DialogTitle>
            </DialogHeader>
            {editingBoard && (
              <form onSubmit={handleUpdateBoard} className="space-y-4">
                <div>
                  <Label htmlFor="edit_board_name">Board Name *</Label>
                  <Input
                    id="edit_board_name"
                    value={editingBoard.board_name}
                    onChange={(e) => setEditingBoard({ 
                      ...editingBoard, 
                      board_name: e.target.value 
                    })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="edit_board_code">Board Code</Label>
                  <Input
                    id="edit_board_code"
                    value={editingBoard.board_code}
                    onChange={(e) => setEditingBoard({ 
                      ...editingBoard, 
                      board_code: e.target.value 
                    })}
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Update Board</Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export default BoardManagement;