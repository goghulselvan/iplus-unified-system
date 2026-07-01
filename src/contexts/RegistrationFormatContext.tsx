import React, { createContext, useContext, useMemo } from "react";
import { useRegistrationFormatConfig } from "@/hooks/useRegistrationFormatConfig";

interface RegistrationFormatContextType {
  componentOrder?: string[];
  separator: string;
  isLoading: boolean;
}

const RegistrationFormatContext = createContext<RegistrationFormatContextType>({
  separator: "-",
  isLoading: false,
});

export const useRegistrationFormat = () => useContext(RegistrationFormatContext);

interface RegistrationFormatProviderProps {
  projectId?: string;
  children: React.ReactNode;
}

export const RegistrationFormatProvider: React.FC<RegistrationFormatProviderProps> = ({
  projectId,
  children,
}) => {
  const { data: formatConfig, isLoading } = useRegistrationFormatConfig(projectId);

  const value = useMemo(() => ({
    componentOrder: formatConfig?.component_order,
    separator: formatConfig?.separator || "-",
    isLoading,
  }), [formatConfig?.component_order, formatConfig?.separator, isLoading]);

  return (
    <RegistrationFormatContext.Provider value={value}>
      {children}
    </RegistrationFormatContext.Provider>
  );
};