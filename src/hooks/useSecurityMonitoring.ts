import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { checkRateLimit } from '@/lib/security';

interface SecurityMonitoringOptions {
  action: string;
  resourceType: string;
  resourceId?: string;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
}

export const useSecurityMonitoring = () => {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const logSecurityEvent = useCallback(async (
    action: string,
    details: Record<string, any> = {},
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ) => {
    try {
      // Log to browser console for immediate visibility
      console.warn(`[SECURITY] ${severity.toUpperCase()}: ${action}`, details);

      // Get current user for audit trail
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Log to Supabase for audit trail
        const { error } = await supabase
          .from('security_audit_logs')
          .insert({
            user_id: user.id,
            action,
            table_name: details.table_name || 'unknown',
            record_id: details.record_id || null,
            old_values: details.old_values || null,
            new_values: details.new_values || null,
            user_agent: navigator.userAgent,
          });

        if (error) {
          console.error('Failed to log security event:', error);
        }
      }

      // Show critical alerts to user (but don't cause re-renders)
      if (severity === 'critical') {
        setTimeout(() => {
          toast({
            title: 'Security Alert',
            description: 'A security event has been detected and logged.',
            variant: 'destructive',
          });
        }, 0);
      }
    } catch (error) {
      console.error('Security logging error:', error);
    }
  }, []);

  const monitoredAction = useCallback(async <T>(
    options: SecurityMonitoringOptions,
    action: () => Promise<T>
  ): Promise<T | null> => {
    const { action: actionName, resourceType, resourceId, rateLimit } = options;
    
    try {
      setIsLoading(true);
      
      // Check database-level rate limiting for sensitive operations
      const { data: canProceed } = await supabase.rpc('validate_sensitive_operation', {
        p_operation: actionName.toUpperCase(),
        p_table_name: resourceType
      });

      if (!canProceed) {
        setTimeout(() => {
          toast({
            title: 'Operation Blocked',
            description: 'This operation is restricted due to security policies.',
            variant: 'destructive',
          });
        }, 0);
        return null;
      }

      // Check client-side rate limiting if configured
      if (rateLimit) {
        const key = `${actionName}_${resourceType}_${resourceId || 'global'}`;
        if (!checkRateLimit(key, rateLimit.maxRequests, rateLimit.windowMs)) {
          await logSecurityEvent('client_rate_limit_exceeded', {
            action: actionName,
            resource_type: resourceType,
            resource_id: resourceId,
          }, 'high');
          
          setTimeout(() => {
            toast({
              title: 'Rate Limit Exceeded',
              description: 'Too many requests. Please wait before trying again.',
              variant: 'destructive',
            });
          }, 0);
          return null;
        }
      }

      // Log the action attempt
      await logSecurityEvent(`${actionName}_attempt`, {
        resource_type: resourceType,
        resource_id: resourceId,
      }, 'low');

      // Execute the action
      const result = await action();

      // Log successful completion
      await logSecurityEvent(`${actionName}_success`, {
        resource_type: resourceType,
        resource_id: resourceId,
      }, 'low');

      return result;
    } catch (error: any) {
      // Log the failure
      await logSecurityEvent(`${actionName}_failure`, {
        resource_type: resourceType,
        resource_id: resourceId,
        error: error.message,
      }, 'medium');

      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [logSecurityEvent]);

  const detectSuspiciousPatterns = useCallback(async () => {
    try {
      await supabase.rpc('detect_suspicious_patterns');
    } catch (error) {
      console.error('Failed to run suspicious pattern detection:', error);
    }
  }, []);

  const cleanupAuditLogs = useCallback(async () => {
    try {
      await supabase.rpc('cleanup_old_audit_logs');
      // console.log('Audit logs cleanup completed');
    } catch (error) {
      // console.error('Failed to cleanup audit logs:', error);
    }
  }, []);

  return {
    logSecurityEvent,
    monitoredAction,
    detectSuspiciousPatterns,
    cleanupAuditLogs,
    isLoading,
  };
};