import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, Download, FileText, Users, DollarSign } from "lucide-react";
import { useAccountantDashboard } from "@/hooks/useAccountantDashboard";
import { useState } from "react";
import { format } from "date-fns";
import Navbar from "@/components/layout/Navbar";

const AccountantDashboard = () => {
  const { metrics, payments, loading, filters, applyFilters, exportFiltered, exportAll } = useAccountantDashboard();
  const [startDate, setStartDate] = useState(filters.startDate || '');
  const [endDate, setEndDate] = useState(filters.endDate || '');

  const handleFilterApply = () => {
    applyFilters({
      startDate: startDate || undefined,
      endDate: endDate || undefined
    });
  };

  const handleClearFilters = () => {
    setStartDate('');
    setEndDate('');
    applyFilters({});
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Accountant Dashboard</h1>
            <p className="text-muted-foreground">
              Monitor payment status and registrations
            </p>
          </div>
        </div>

        {/* Enhanced Metrics Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Paid Schools
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics?.total_paid_schools || 0}</div>
              <p className="text-xs text-muted-foreground">
                Schools with payment received
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Registrations
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics?.total_registrations || 0}</div>
              <p className="text-xs text-muted-foreground">
                Student registrations from paid schools
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Payment Received
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₹{metrics?.total_payment_amount?.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">
                Total payments received
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Expected Amount
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₹{metrics?.total_expected_amount?.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">
                Total expected revenue
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Concessions Given
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₹{metrics?.total_concessions?.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">
                Total discounts provided
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Outstanding Balance
              </CardTitle>
              <DollarSign className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">₹{metrics?.total_outstanding?.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">
                Amount pending collection
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Export */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Records</CardTitle>
            <CardDescription>
              Filter and export payment data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-end mb-6">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleFilterApply}>
                  <Calendar className="h-4 w-4 mr-2" />
                  Apply Filter
                </Button>
                <Button variant="outline" onClick={handleClearFilters}>
                  Clear
                </Button>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <Button onClick={exportFiltered} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export Filtered ({payments.length} records)
              </Button>
              <Button onClick={exportAll} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export All
              </Button>
            </div>

            {/* Payment Table */}
            <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Serial No</TableHead>
              <TableHead>Payment Date</TableHead>
              <TableHead>SS No</TableHead>
              <TableHead>School Name</TableHead>
              <TableHead>No. of Reg.</TableHead>
              <TableHead>Expected Amount</TableHead>
              <TableHead>This Payment</TableHead>
              <TableHead>Total Received</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead>Payment Mode</TableHead>
              <TableHead>District</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  No payment records found
                </TableCell>
              </TableRow>
            ) : (
              payments.map((payment, index) => (
                <TableRow key={payment.transaction_id}>
                  <TableCell className="font-medium">{index + 1}</TableCell>
                  <TableCell>
                    {format(new Date(payment.payment_date), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>{payment.ss_no}</TableCell>
                  <TableCell className="max-w-xs truncate" title={payment.school_name}>
                    {payment.school_name}
                  </TableCell>
                  <TableCell>{payment.registration_count}</TableCell>
                  <TableCell>₹{payment.expected_amount?.toLocaleString() || 0}</TableCell>
                  <TableCell>₹{payment.payment_amount?.toLocaleString() || 0}</TableCell>
                  <TableCell>₹{payment.total_received?.toLocaleString() || 0}</TableCell>
                  <TableCell>₹{payment.outstanding_balance?.toLocaleString() || 0}</TableCell>
                  <TableCell>{payment.payment_mode}</TableCell>
                  <TableCell>{payment.district}</TableCell>
                  <TableCell>{payment.state}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AccountantDashboard;