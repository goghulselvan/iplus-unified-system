import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { 
  checkAdvancedRateLimit, 
  detectPII, 
  maskPII, 
  validateAndSanitizeInput,
  isBusinessHours,
  detectSuspiciousActivity 
} from '@/lib/security';

interface SecurityConfig {
  enablePIIMasking: boolean;
  enableAdvancedRateLimit: boolean;
  enableBusinessHours: boolean;
  enableSuspiciousDetection: boolean;
}

interface SecurityContext {
  userAgent: string;
  ipAddress?: string;
  timestamp: number;
  sessionId: string;
}

interface SecurityEvent {
  id: string;
  action: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  table_name: string;
  details: Record<string, any>;
  created_at: string;
}

export const useAdvancedSecurity = (config: SecurityConfig = {
  enablePIIMasking: true,
  enableAdvancedRateLimit: true,
  enableBusinessHours: true,
  enableSuspiciousDetection: true
}) => {
  const [securityContext, setSecurityContext] = useState<SecurityContext>({
    userAgent: navigator.userAgent,
    timestamp: Date.now(),
    sessionId: crypto.randomUUID()
  });
  const [recentEvents, setRecentEvents] = useState<SecurityEvent[]>([]);
  const [isBlocked, setIsBlocked] = useState(false);
  const { toast } = useToast();

  // Initialize security context
  useEffect(() => {
    const initializeSecurityContext = async () => {
      try {
        // Get IP address (in production, this would come from server)
        const response = await fetch('https://api.ipify.org?format=json');
        const { ip } = await response.json();
        
        setSecurityContext(prev => ({
          ...prev,
          ipAddress: ip,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.warn('Failed to get IP address for security context');
      }
    };

    initializeSecurityContext();
  }, []);

  // Load recent security events
  const loadRecentEvents = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('security_audit_logs')
        .select('*')
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last hour
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const events: SecurityEvent[] = (data || []).map(log => {
        const oldValues = log.old_values && typeof log.old_values === 'object' ? log.old_values as Record<string, any> : {};
        const newValues = log.new_values && typeof log.new_values === 'object' ? log.new_values as Record<string, any> : {};
        
        return {
          id: log.id,
          action: log.action,
          severity: log.action.includes('CRITICAL') ? 'critical' :
                   log.action.includes('SUSPICIOUS') || log.action.includes('UNAUTHORIZED') ? 'high' :
                   log.action.includes('BULK') || log.action.includes('PII') ? 'medium' : 'low',
          table_name: log.table_name,
          details: { ...oldValues, ...newValues },
          created_at: log.created_at
        };
      });

      setRecentEvents(events);

      // Check for suspicious patterns
      if (config.enableSuspiciousDetection) {
        const actions = events.map(event => ({
          timestamp: new Date(event.created_at).getTime(),
          action: event.action,
          ip: securityContext.ipAddress
        }));

        if (detectSuspiciousActivity(actions)) {
          setIsBlocked(true);
          toast({
            title: 'Security Alert',
            description: 'Suspicious activity detected. Some operations may be temporarily restricted.',
            variant: 'destructive',
          });
        }
      }
    } catch (error) {
      console.error('Failed to load recent security events:', error);
    }
  }, [config.enableSuspiciousDetection, securityContext.ipAddress, toast]);

  // Validate and sanitize data before operations
  const validateData = useCallback((data: Record<string, any>): { isValid: boolean; sanitized: Record<string, any>; errors: string[] } => {
    const sanitized: Record<string, any> = {};
    const errors: string[] = [];
    let isValid = true;

    Object.entries(data).forEach(([key, value]) => {
      if (typeof value === 'string') {
        let validationType: 'email' | 'phone' | 'name' | 'text' = 'text';
        
        if (key.toLowerCase().includes('email')) validationType = 'email';
        else if (key.toLowerCase().includes('mobile') || key.toLowerCase().includes('phone')) validationType = 'phone';
        else if (key.toLowerCase().includes('name')) validationType = 'name';

        const validation = validateAndSanitizeInput(value, validationType);
        
        if (!validation.isValid) {
          isValid = false;
          errors.push(`${key}: ${validation.errors.join(', ')}`);
        }
        
        sanitized[key] = validation.sanitized;
      } else {
        sanitized[key] = value;
      }
    });

    return { isValid, sanitized, errors };
  }, []);

  // Mask PII in data for logging or display
  const maskSensitiveData = useCallback((data: Record<string, any>): Record<string, any> => {
    if (!config.enablePIIMasking) return data;

    const masked: Record<string, any> = {};

    Object.entries(data).forEach(([key, value]) => {
      if (typeof value === 'string') {
        // Check if this field contains PII
        const piiDetected = detectPII(value);
        if (piiDetected.length > 0) {
          masked[key] = maskPII(value);
        } else {
          masked[key] = value;
        }
      } else {
        masked[key] = value;
      }
    });

    return masked;
  }, [config.enablePIIMasking]);

  // Check if operation is allowed
  const checkOperationAllowed = useCallback(async (operation: string, resourceType: string): Promise<{ allowed: boolean; reason?: string }> => {
    // Check if user is blocked
    if (isBlocked) {
      return { allowed: false, reason: 'Account temporarily restricted due to suspicious activity' };
    }

    // Check business hours for sensitive operations
    if (config.enableBusinessHours && ['DELETE', 'BULK_DELETE', 'EXPORT'].some(op => operation.includes(op))) {
      if (!isBusinessHours()) {
        return { allowed: false, reason: 'Sensitive operations are restricted outside business hours' };
      }
    }

    // Check advanced rate limiting
    if (config.enableAdvancedRateLimit) {
      const rateLimitKey = `${operation}_${resourceType}_${securityContext.sessionId}`;
      if (!checkAdvancedRateLimit(rateLimitKey, 10, 60000, 20, 300000)) {
        return { allowed: false, reason: 'Rate limit exceeded. Please wait before trying again.' };
      }
    }

    // Check database-level validation
    try {
      const { data: canProceed } = await supabase.rpc('validate_sensitive_operation', {
        p_operation: operation.toUpperCase(),
        p_table_name: resourceType
      });

      if (!canProceed) {
        return { allowed: false, reason: 'Operation blocked by security policies' };
      }
    } catch (error) {
      console.error('Failed to validate operation:', error);
      return { allowed: false, reason: 'Security validation failed' };
    }

    return { allowed: true };
  }, [isBlocked, config.enableBusinessHours, config.enableAdvancedRateLimit, securityContext.sessionId]);

  // Log security event
  const logSecurityEvent = useCallback(async (
    action: string,
    details: Record<string, any> = {},
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ) => {
    try {
      const maskedDetails = maskSensitiveData(details);
      
      const { error } = await supabase
        .from('security_audit_logs')
        .insert({
          user_id: (await supabase.auth.getUser()).data.user?.id,
          action,
          table_name: details.table_name || 'unknown',
          record_id: details.record_id || null,
          old_values: details.old_values || null,
          new_values: maskedDetails,
          user_agent: securityContext.userAgent,
        });

      if (error) {
        console.error('Failed to log security event:', error);
      }

      // Show critical alerts to user
      if (severity === 'critical') {
        toast({
          title: 'Critical Security Event',
          description: 'A critical security event has been logged and administrators have been notified.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Security logging error:', error);
    }
  }, [maskSensitiveData, securityContext.userAgent, toast]);

  // Reset security state (e.g., unblock user)
  const resetSecurityState = useCallback(() => {
    setIsBlocked(false);
    setSecurityContext(prev => ({
      ...prev,
      timestamp: Date.now(),
      sessionId: crypto.randomUUID()
    }));
    toast({
      title: 'Security State Reset',
      description: 'Security restrictions have been cleared.',
    });
  }, [toast]);

  // Load events on component mount and periodically
  useEffect(() => {
    loadRecentEvents();
    const interval = setInterval(loadRecentEvents, 30000); // Every 30 seconds
    return () => clearInterval(interval);
  }, [loadRecentEvents]);

  return {
    securityContext,
    recentEvents,
    isBlocked,
    validateData,
    maskSensitiveData,
    checkOperationAllowed,
    logSecurityEvent,
    resetSecurityState,
    loadRecentEvents,
  };
};