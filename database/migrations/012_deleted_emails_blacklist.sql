-- 012_deleted_emails_blacklist.sql
-- Prevents credit farming by blocking re-registration of deleted accounts

-- Create table to track deleted email addresses
CREATE TABLE IF NOT EXISTS deleted_emails (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL,
    deleted_at TIMESTAMPTZ DEFAULT NOW(),
    reason TEXT DEFAULT 'user_deleted_account'
);

-- Add index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_deleted_emails_email ON deleted_emails(email);
CREATE INDEX IF NOT EXISTS idx_deleted_emails_deleted_at ON deleted_emails(deleted_at);

-- Add comment explaining the purpose
COMMENT ON TABLE deleted_emails IS 'Prevents credit farming by blocking re-registration of deleted accounts';
COMMENT ON COLUMN deleted_emails.email IS 'Email address that had an account deleted';
COMMENT ON COLUMN deleted_emails.user_id IS 'ID of the deleted user account';
COMMENT ON COLUMN deleted_emails.deleted_at IS 'When the account was deleted';
COMMENT ON COLUMN deleted_emails.reason IS 'Reason for deletion (user_deleted_account, admin_deleted, etc.)';
