import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/layout/ProtectedRoute";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Schools from "./pages/Schools";
import SchoolDetail from "./pages/SchoolDetail";
import OlympiadManagement from "./pages/OlympiadManagement";
import ProjectManagement from "./pages/ProjectManagement";
import Communication from "./pages/Communication";
import BulkWhatsApp from "./pages/BulkWhatsApp";
import AddressLabelPrint, { AddressLabelPrintPage } from "./pages/AddressLabelPrint";
import FollowUps from "./pages/FollowUps";
import ExamDatesSummary from "./pages/ExamDatesSummary";
import ExamSlotPublish from "./pages/ExamSlotPublish";

import Users from "./pages/Users";
import BulkImportExportPage from "./pages/BulkImportExport";
import SecurityMonitoring from "./pages/SecurityMonitoring";
import BoardManagementPage from "./pages/BoardManagement";
import Admin from "./pages/Admin";
import AccountantDashboard from "./pages/AccountantDashboard";
import CommunicationTemplates from "./pages/CommunicationTemplates";
import WhatsAppTemplates from "./pages/WhatsAppTemplates";
import ExportModule from "./pages/ExportModule";
import Results from "./pages/Results";
import PortalAccessPage from "./pages/PortalAccess";
import PaymentQueuePage from "./pages/PaymentQueuePage";
import MarketingMessages from "./pages/MarketingMessages";
import TemplateManagement from "./pages/TemplateManagement";
import DataManagement from "./pages/DataManagement";
import ModuleSelect from "./pages/ModuleSelect";
import ProspectDashboard from "./pages/ProspectDashboard";
import ProspectLayout from "./components/prospect/ProspectLayout";
import ProspectSchoolHistory from "./pages/ProspectSchoolHistory";
import ProspectSchoolsPage from "./pages/ProspectSchoolsPage";
import ProspectTemplates from "./pages/ProspectTemplates";
import ProspectTemplateBuilder from "./pages/ProspectTemplateBuilder";
import ProspectCampaigns from "./pages/ProspectCampaigns";
import ProspectCampaignNew from "./pages/ProspectCampaignNew";
import ProspectCampaignDetail from "./pages/ProspectCampaignDetail";
import ProspectBulkWhatsApp from "./pages/ProspectBulkWhatsApp";
import ProspectVoiceCampaigns from "./pages/ProspectVoiceCampaigns";
import NotFound from "./pages/NotFound";
import { RegistrationFormatProvider } from "@/contexts/RegistrationFormatContext";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { queryClient } from "@/lib/queryClient";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

// Real-time sync wrapper component
const RealtimeSyncProvider = ({ children, projectId }: { children: React.ReactNode; projectId?: string }) => {
  // Initialize real-time sync for all critical tables
  useRealtimeSync({
    tables: ['portal_registered_students', 'portal_student_enrollments', 'schools', 'payment_transactions', 'school_project_workflow'],
    projectId,
    debounceMs: 1000, // 1 second debounce for 300 concurrent users
  });
  
  return <>{children}</>;
};

const ProspectAddressLabels = () => (
  <ProspectLayout>
    <AddressLabelPrintPage source="prospect" />
  </ProspectLayout>
);

const AppContent = () => {
  const { data: activeProject, isLoading, error, refetch } = useActiveProject();
  
  // Show loading state while fetching active project
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">Loading application...</p>
        </div>
      </div>
    );
  }

  // Show error state with helpful troubleshooting tips
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-destructive text-5xl">⚠️</div>
          <h2 className="text-2xl font-semibold">Connection Issue</h2>
          <p className="text-muted-foreground">
            Unable to load project data. This might be due to network connectivity issues.
          </p>
          <div className="bg-muted p-4 rounded-lg text-sm text-left space-y-2">
            <p className="font-semibold">Troubleshooting tips:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Check your internet connection</li>
              <li>Try refreshing the page (F5)</li>
              <li>Clear your browser cache and cookies</li>
              <li>Run: <code className="bg-background px-1 rounded">ipconfig /flushdns</code> in Command Prompt</li>
              <li>Check Windows Credential Manager for old credentials</li>
            </ul>
          </div>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <RealtimeSyncProvider projectId={activeProject?.id}>
      <RegistrationFormatProvider projectId={activeProject?.id}>
        <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route
          path="/module-select"
          element={
            <ProtectedRoute>
              <ModuleSelect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ModuleSelect />
            </ProtectedRoute>
          }
        />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/schools" 
          element={
            <ProtectedRoute>
              <Schools />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/schools/:id" 
          element={
            <ProtectedRoute>
              <SchoolDetail />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/communication" 
          element={
            <ProtectedRoute>
              <Communication />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/bulk-whatsapp"
          element={
            <ProtectedRoute requiredPermission="bulk_whatsapp">
              <BulkWhatsApp />
            </ProtectedRoute>
          }
        />
        <Route path="/address-labels" element={<ProtectedRoute><AddressLabelPrint /></ProtectedRoute>} />
        <Route 
          path="/follow-ups" 
          element={
            <ProtectedRoute>
              <FollowUps />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/olympiad-management" 
          element={
            <ProtectedRoute>
              <OlympiadManagement />
            </ProtectedRoute>
          } 
        />
        <Route
          path="/exam-dates"
          element={
            <ProtectedRoute>
              <ExamDatesSummary />
            </ProtectedRoute>
          }
         />
         <Route
           path="/exam-slot-publish"
           element={
             <ProtectedRoute>
               <ExamSlotPublish />
             </ProtectedRoute>
           }
         />
         <Route
           path="/portal-access"
           element={
             <ProtectedRoute>
               <PortalAccessPage />
             </ProtectedRoute>
           }
         />
         <Route
           path="/payment-queue"
           element={
             <ProtectedRoute>
               <PaymentQueuePage />
             </ProtectedRoute>
           }
         />
         <Route 
           path="/results" 
           element={
             <ProtectedRoute>
               <Results />
             </ProtectedRoute>
           } 
         />
        <Route 
          path="/projects"
          element={
            <ProtectedRoute adminOnly>
              <ProjectManagement />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/users" 
          element={
            <ProtectedRoute adminOnly>
              <Users />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/bulk-import-export" 
          element={
            <ProtectedRoute>
              <BulkImportExportPage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/security" 
          element={
            <ProtectedRoute adminOnly>
              <SecurityMonitoring />
            </ProtectedRoute>
          } 
        />
         <Route 
           path="/board-management" 
           element={
             <ProtectedRoute adminOnly>
               <BoardManagementPage />
             </ProtectedRoute>
           } 
         />
         <Route 
           path="/admin" 
           element={
             <ProtectedRoute adminOnly>
               <Admin />
             </ProtectedRoute>
           } 
         />
         <Route 
           path="/accountant" 
           element={
             <ProtectedRoute accountantOnly>
               <AccountantDashboard />
             </ProtectedRoute>
           } 
         />
         <Route 
           path="/communication-templates" 
           element={
             <ProtectedRoute adminOnly>
               <CommunicationTemplates />
             </ProtectedRoute>
           } 
         />
         <Route 
           path="/whatsapp-templates" 
           element={
             <ProtectedRoute adminOnly>
               <WhatsAppTemplates />
             </ProtectedRoute>
           } 
         />
         <Route 
           path="/export-module" 
           element={
             <ProtectedRoute adminOnly>
               <ExportModule />
             </ProtectedRoute>
           } 
         />
         <Route
           path="/marketing-messages"
           element={<ProtectedRoute><MarketingMessages /></ProtectedRoute>}
         />
         <Route
           path="/template-management"
           element={<ProtectedRoute adminOnly><TemplateManagement /></ProtectedRoute>}
         />
         <Route
           path="/data-management"
           element={<ProtectedRoute adminOnly><DataManagement /></ProtectedRoute>}
         />
         <Route path="/prospect" element={<ProtectedRoute><ProspectDashboard /></ProtectedRoute>} />
         <Route path="/prospect/schools/:id/history" element={<ProtectedRoute><ProspectSchoolHistory /></ProtectedRoute>} />
         <Route path="/prospect/schools" element={<ProtectedRoute><ProspectSchoolsPage /></ProtectedRoute>} />
         <Route path="/prospect/templates" element={<ProtectedRoute><ProspectTemplates /></ProtectedRoute>} />
         <Route path="/prospect/templates/new" element={<ProtectedRoute><ProspectTemplateBuilder /></ProtectedRoute>} />
         <Route path="/prospect/templates/:id" element={<ProtectedRoute><ProspectTemplateBuilder /></ProtectedRoute>} />
         <Route path="/prospect/campaigns" element={<ProtectedRoute><ProspectCampaigns /></ProtectedRoute>} />
         <Route path="/prospect/bulk-whatsapp" element={<ProtectedRoute><ProspectBulkWhatsApp /></ProtectedRoute>} />
         <Route path="/prospect/voice-campaigns" element={<ProtectedRoute><ProspectVoiceCampaigns /></ProtectedRoute>} />
         <Route path="/prospect/address-labels" element={
           <ProtectedRoute>
             <ProspectAddressLabels />
           </ProtectedRoute>
         } />
         <Route path="/prospect/campaigns/new" element={<ProtectedRoute><ProspectCampaignNew /></ProtectedRoute>} />
         <Route path="/prospect/campaigns/:id" element={<ProtectedRoute><ProspectCampaignDetail /></ProtectedRoute>} />
         <Route path="*" element={<NotFound />} />
        </Routes>
      </RegistrationFormatProvider>
    </RealtimeSyncProvider>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
