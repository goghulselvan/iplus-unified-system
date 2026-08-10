import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Item = {
  id: string;
  quantity: number;
  products: { name: string } | null;
  invoices: { dispatched_at: string | null } | null;
};

type Order = {
  id: string;
  order_number: number | null;
  fy: number | null;
  created_at: string;
  product_order_items: Item[];
};

interface Props {
  schoolId: string;
}

export default function SchoolBookOrders({ schoolId }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase.from('product_orders' as any)
      .select('id, order_number, fy, created_at, product_order_items(id, quantity, products(name), invoices(dispatched_at))')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setOrders((data || []) as unknown as Order[]); setLoading(false); });
  }, [schoolId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Package className="h-4 w-4" /> Book Orders</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No book orders yet.</p>
        ) : (
          <div className="space-y-4">
            {orders.map(o => (
              <div key={o.id} className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 font-mono text-sm font-medium">
                  {o.order_number != null && o.fy != null ? `ORD/${o.fy}-${o.fy + 1}/${o.order_number}` : 'Order'}
                  <span className="ml-2 text-xs text-muted-foreground font-sans">
                    {new Date(o.created_at).toLocaleDateString('en-IN')}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {o.product_order_items.map(item => (
                      <tr key={item.id} className="border-t">
                        <td className="px-4 py-2">{item.products?.name ?? '—'} × {item.quantity}</td>
                        <td className="px-4 py-2 text-right">
                          {item.invoices?.dispatched_at ? (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">
                              Dispatched {new Date(item.invoices.dispatched_at).toLocaleDateString('en-IN')}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-100">Pending Dispatch</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
