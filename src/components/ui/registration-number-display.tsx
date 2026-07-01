import React from "react";
import { useRegistrationFormat } from "@/contexts/RegistrationFormatContext";
import { formatRegistrationNumberDisplay } from "@/utils/registrationNumberFormatter";

interface RegistrationNumberDisplayProps {
  registrationNumber: string;
  className?: string;
}

export const RegistrationNumberDisplay = React.memo<RegistrationNumberDisplayProps>(({
  registrationNumber,
  className = "font-mono",
}) => {
  const { componentOrder, separator } = useRegistrationFormat();

  const formattedNumber = React.useMemo(() => {
    return formatRegistrationNumberDisplay(
      registrationNumber,
      componentOrder,
      separator
    );
  }, [registrationNumber, componentOrder, separator]);

  return (
    <span className={className} title={`Original: ${registrationNumber}`}>
      {formattedNumber}
    </span>
  );
});

RegistrationNumberDisplay.displayName = "RegistrationNumberDisplay";