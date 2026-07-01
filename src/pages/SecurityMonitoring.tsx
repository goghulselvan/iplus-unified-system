import { SecurityMonitoringDashboard } from '@/components/security/SecurityMonitoringDashboard';
import Navbar from '@/components/layout/Navbar';

const SecurityMonitoring = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8">
        <SecurityMonitoringDashboard />
      </main>
    </div>
  );
};

export default SecurityMonitoring;