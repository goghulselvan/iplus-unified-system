-- Add RLS policies for api_keys table using profiles table for role check

-- Policy for superadmins to insert API keys
CREATE POLICY "Superadmins can insert api_keys"
ON api_keys
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role = 'superadmin'
  )
);

-- Policy for superadmins to update API keys
CREATE POLICY "Superadmins can update api_keys"
ON api_keys
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role = 'superadmin'
  )
);

-- Policy for superadmins to delete API keys
CREATE POLICY "Superadmins can delete api_keys"
ON api_keys
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role = 'superadmin'
  )
);

-- Policy for superadmins to select API keys
CREATE POLICY "Superadmins can select api_keys"
ON api_keys
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role = 'superadmin'
  )
);