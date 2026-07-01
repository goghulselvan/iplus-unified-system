-- Add api_key_id column to api_request_logs for linking to api_keys table
ALTER TABLE api_request_logs 
ADD COLUMN api_key_id UUID REFERENCES api_keys(id);

-- Create index for faster lookups
CREATE INDEX idx_api_request_logs_api_key_id ON api_request_logs(api_key_id);