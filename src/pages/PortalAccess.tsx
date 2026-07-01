import Navbar from "@/components/layout/Navbar";
import { RegistrationApproval } from "@/components/portal/RegistrationApproval";

export default function PortalAccessPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Portal Access</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review and approve schools that registered via the school portal.
          </p>
        </div>
        <RegistrationApproval />
      </main>
    </div>
  );
}
