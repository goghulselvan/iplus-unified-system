import React, { useState, useEffect } from 'react';
import { Input } from './input';

interface DebouncedInputProps {
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
  placeholder?: string;
  className?: string;
}

export const DebouncedInput: React.FC<DebouncedInputProps> = ({
  value: initialValue,
  onChange,
  debounceMs = 300,
  placeholder,
  className,
}) => {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(value);
    }, debounceMs);

    return () => clearTimeout(timeout);
  }, [value, onChange, debounceMs]);

  return (
    <Input
      placeholder={placeholder}
      className={className}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
};