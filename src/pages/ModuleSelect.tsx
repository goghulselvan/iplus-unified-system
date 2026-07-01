import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, Users, Building2, ArrowRight, MapPin } from 'lucide-react';

const ModuleSelect = () => {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-primary text-primary-foreground px-6 py-4 flex items-center justify-between">
        <div className="font-bold text-lg">iPlus Olympiads</div>
        <div className="flex items-center gap-4">
          <span className="text-sm opacity-80">{profile?.username}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="text-primary-foreground hover:bg-primary/80"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back, {profile?.username}</h1>
        <p className="text-gray-500 mb-12">Select a module to continue</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
          {/* Prospect Schools tile */}
          <button
            onClick={() => navigate('/prospect')}
            className="group rounded-2xl p-8 text-left text-white shadow-md hover:shadow-2xl hover:scale-[1.02] transition-all duration-200 bg-gradient-to-br from-fuchsia-600 via-pink-500 to-orange-400"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="p-3 bg-white/15 backdrop-blur-sm rounded-xl ring-1 ring-white/20">
                <MapPin className="h-7 w-7 text-white" />
              </div>
              <ArrowRight className="h-5 w-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
            <h2 className="text-xl font-bold mb-1">Prospect Schools</h2>
            <p className="text-sm text-white/80">Outreach · Campaigns · Email Blasts</p>
          </button>

          {/* CRM tile */}
          <button
            onClick={() => navigate('/dashboard')}
            className="group rounded-2xl p-8 text-left text-white shadow-md hover:shadow-2xl hover:scale-[1.02] transition-all duration-200 bg-gradient-to-br from-blue-600 via-cyan-500 to-emerald-400"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="p-3 bg-white/15 backdrop-blur-sm rounded-xl ring-1 ring-white/20">
                <Building2 className="h-7 w-7 text-white" />
              </div>
              <ArrowRight className="h-5 w-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
            <h2 className="text-xl font-bold mb-1">CRM</h2>
            <p className="text-sm text-white/80">Registrations · Payments · Results · Workflow</p>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModuleSelect;
