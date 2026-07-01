import Navbar from "@/components/layout/Navbar";
import { PaymentQueue } from "@/components/portal/PaymentQueue";

export default function PaymentQueuePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Payment Queue</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Portal payment submissions waiting for acknowledgement across all schools.
          </p>
        </div>
        <PaymentQueue />
      </main>
    </div>
  );
}
