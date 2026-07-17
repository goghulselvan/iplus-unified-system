import React from 'react';
import { useNavigate } from 'react-router-dom';
import { School } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, Trash2, Globe, Phone } from 'lucide-react';
import { formatForDisplay } from '@/utils/dataHelpers';

interface SchoolCardProps {
  school: School;
  onDelete: (id: string) => void;
  showDeleteButton: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export const SchoolCard: React.FC<SchoolCardProps> = ({ school, onDelete, showDeleteButton, selected, onToggleSelect }) => {
  const navigate = useNavigate();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Confirmed':
        return 'bg-green-100 text-green-800';
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPaymentStatusVariant = (status: string) => {
    switch (status) {
      case 'Received':
        return 'default';
      case 'Partial':
        return 'secondary';
      case 'Pending':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this school?')) {
      onDelete(school.id);
    }
  };

  return (
    <Card className={`hover:shadow-lg transition-shadow ${selected ? 'ring-2 ring-indigo-500 bg-indigo-50/30' : ''}`}>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex items-start gap-3">
            {onToggleSelect && (
              <Checkbox
                checked={!!selected}
                onCheckedChange={() => onToggleSelect(school.id)}
                className="mt-1"
                onClick={e => e.stopPropagation()}
              />
            )}
            <div>
              <CardTitle className="text-lg">{formatForDisplay(school.school_name)}</CardTitle>
              <p className="text-muted-foreground">SS No: {school.ss_no}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {school.portal_registered ? (
              <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 gap-1">
                <Globe className="h-3 w-3" /> Portal
              </Badge>
            ) : (
              <Badge variant="outline" className="border-gray-300 bg-gray-50 text-gray-600 gap-1">
                <Phone className="h-3 w-3" /> Manual
              </Badge>
            )}
            <Badge className={getStatusColor(school.registration_status)}>
              {school.registration_status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <p className="text-sm font-medium">Address</p>
            <p className="text-sm text-muted-foreground">{formatForDisplay(school.school_address)}</p>
          </div>
          <div>
            <p className="text-sm font-medium">District</p>
            <p className="text-sm text-muted-foreground">{formatForDisplay(school.district)}</p>
          </div>
          <div>
            <p className="text-sm font-medium">Board</p>
            <p className="text-sm text-muted-foreground">{formatForDisplay(school.board)}</p>
          </div>
        </div>
        
        <div className="flex justify-between items-center">
          <div className="flex flex-wrap gap-2 text-sm">
            <span>
              Contacted: <Badge variant={school.contacted === 'Yes' ? 'default' : 'secondary'}>
                {school.contacted}
              </Badge>
            </span>
            <span>
              Payment: <Badge variant={getPaymentStatusVariant(school.payment_status)}>
                {school.payment_status}
              </Badge>
            </span>
            <span>
              Name List: <Badge variant={
                school.name_list_status === 'Uploaded' ? 'default' : 
                school.name_list_status === 'Received' ? 'secondary' : 'outline'
              }>
                {school.name_list_status}
              </Badge>
            </span>
            {school.total_participants ? (
              <span>
                Participants: <Badge variant="default">
                  {school.total_participants}
                </Badge>
              </span>
            ) : null}
          </div>
          
          <div className="flex space-x-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => navigate(`/schools/${school.id}`)}
            >
              <Eye className="h-4 w-4 mr-1" />
              View
            </Button>
            {showDeleteButton && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleDelete}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};