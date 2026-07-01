import Navbar from '@/components/layout/Navbar';
import BulkImportExport from '@/components/bulk/BulkImportExport';

const BulkImportExportPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Bulk Import/Export</h1>
          <p className="text-muted-foreground mt-2">
            Download templates and import data in bulk or export all school data
          </p>
        </div>
        <BulkImportExport />
      </div>
    </div>
  );
};

export default BulkImportExportPage;