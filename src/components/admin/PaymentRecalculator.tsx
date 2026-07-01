import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calculator, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const PaymentRecalculator = () => {
  const [isRecalculating, setIsRecalculating] = useState(false);

  const handleRecalculate = async () => {
    try {
      setIsRecalculating(true);
      
      // Call the database function to recalculate all schools
      const { error } = await supabase.rpc('recalculate_all_school_payment_totals');
      
      if (error) throw error;
      
      toast.success('Payment totals recalculated successfully', {
        description: 'All school expected amounts and outstanding balances have been updated.'
      });
    } catch (error) {
      console.error('Error recalculating payment totals:', error);
      toast.error('Failed to recalculate payment totals', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } finally {
      setIsRecalculating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Payment Recalculator
        </CardTitle>
        <CardDescription>
          Recalculate expected amounts and outstanding balances for all schools based on actual registrations.
          Use this when registration counts don't match payment calculations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
              What this does:
            </h4>
            <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
              <li>• Counts actual subject registrations per school</li>
              <li>• Calculates expected amount (registrations × per entry rate)</li>
              <li>• Updates outstanding balance (expected - received)</li>
              <li>• Syncs total_participants field with actual counts</li>
            </ul>
          </div>

          <Button 
            onClick={handleRecalculate}
            disabled={isRecalculating}
            className="w-full"
          >
            {isRecalculating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Recalculating...
              </>
            ) : (
              <>
                <Calculator className="mr-2 h-4 w-4" />
                Recalculate All School Payments
              </>
            )}
          </Button>

          <p className="text-xs text-muted-foreground">
            This operation may take a few seconds for large datasets.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};