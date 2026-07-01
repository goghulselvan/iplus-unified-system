import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

  // Reset inactivity timer
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    
    if (user) {
      inactivityTimerRef.current = setTimeout(() => {
        signOut();
      }, INACTIVITY_TIMEOUT);
    }
  }, [user]);

  // Track user activity
  useEffect(() => {
    if (!user) return;

    const activities = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    const handleActivity = () => {
      resetInactivityTimer();
    };

    activities.forEach(activity => {
      document.addEventListener(activity, handleActivity, true);
    });

    // Start the timer
    resetInactivityTimer();

    return () => {
      activities.forEach(activity => {
        document.removeEventListener(activity, handleActivity, true);
      });
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [user, resetInactivityTimer]);

  useEffect(() => {
    let mounted = true;
    
    // Set up auth state listener with improved error handling
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;
        
        // console.log('Auth state change:', event, session?.user?.id);
        
        // Handle session updates immediately
        setSession(session);
        setUser(session?.user ?? null);
        
        // Handle profile fetching with better error handling
        if (session?.user && event !== 'SIGNED_OUT') {
          setTimeout(() => {
            if (!mounted) return;
            
            supabase
              .from('profiles')
              .select('*')
              .eq('user_id', session.user.id)
              .maybeSingle()
              .then(({ data: profileData, error }) => {
                if (!mounted) return;
                if (error) {
                  console.error('Profile fetch error:', error);
                  return;
                }
                setProfile(profileData as Profile);
              });
          }, 0);
        } else {
          setProfile(null);
        }
        
        // Only set loading to false after handling the session
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
          setLoading(false);
        }
      }
    );

    // Get initial session with retry logic for Windows compatibility
    const getInitialSession = async (retries = 3) => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Initial session error:', error);
          if (retries > 0) {
            setTimeout(() => getInitialSession(retries - 1), 100);
            return;
          }
        }
        
        if (!mounted) return;
        
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', session.user.id)
            .maybeSingle();
            
          if (!profileError && mounted) {
            setProfile(profileData as Profile);
          }
        }
        
        if (mounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error('Session initialization error:', error);
        if (retries > 0) {
          setTimeout(() => getInitialSession(retries - 1), 200);
        } else if (mounted) {
          setLoading(false);
        }
      }
    };

    getInitialSession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      // Additional validation for Windows compatibility
      if (data.session && data.user && !error) {
        // Force a session refresh to ensure persistence on Windows
        setTimeout(async () => {
          try {
            await supabase.auth.refreshSession();
          } catch (refreshError) {
            console.warn('Session refresh warning:', refreshError);
          }
        }, 100);
      }
      
      return { error };
    } catch (unexpectedError) {
      console.error('Sign in unexpected error:', unexpectedError);
      return { error: unexpectedError };
    }
  };

  const signOut = async () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    
    try {
      // Always clear local state first to ensure UI responds immediately
      setUser(null);
      setSession(null);
      setProfile(null);
      
      // Then attempt to sign out from Supabase
      const { error } = await supabase.auth.signOut();
      
      if (error) {
        console.warn('Sign out warning:', error.message);
        // Even if signOut fails on server, local state is already cleared
        // which will redirect user to login page
      }
    } catch (error) {
      console.error('Sign out error:', error);
      // Ensure state is cleared even on unexpected errors
      setUser(null);
      setSession(null);
      setProfile(null);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      signIn,
      signOut
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};